/**
 * Peer Address Database — Bitcoin-style persistent peer storage.
 *
 * Two-table design inspired by Bitcoin's addrman:
 *   - "new" — addresses heard about via discovery, never connected
 *   - "tried" — addresses we've successfully connected to
 *
 * Provides bootstrap peers on startup sorted by reliability and recency,
 * and persists to disk so nodes reconnect faster after restart.
 *
 * @module
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { PeerNodeInfo, PeerNetworkEventHandler } from "./peer-types.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Source of how we learned about this peer address. */
export type PeerAddrSource = "static" | "exchange" | "relay" | "manual" | "seed";

/** Bucket classification for the two-table design. */
export type PeerAddrBucket = "new" | "tried";

/** A stored peer address entry with connection history. */
export interface PeerAddr {
	nodeId: string;
	endpoint: string;
	/** When we last successfully connected or heard from this peer. */
	lastSeen: number;
	/** When we first learned about this peer. */
	firstSeen: number;
	/** When we last attempted to connect. */
	lastAttempt: number;
	/** Total connection attempts. */
	attempts: number;
	/** Successful connections. */
	successes: number;
	/** Failed connection attempts. */
	failures: number;
	/** How we learned about this address. */
	source: PeerAddrSource;
	/** Current bucket: "new" (heard about) or "tried" (connected before). */
	bucket: PeerAddrBucket;
	/** /24 subnet for diversity tracking. */
	subnet: string;
	/** Node capabilities if known. */
	capabilities?: string[];
	/** Human-readable label if known. */
	label?: string;
}

/** Configuration for the peer address database. */
export interface PeerAddrDbConfig {
	/** Max entries in the "new" table. Default: 1000 */
	maxNew?: number;
	/** Max entries in the "tried" table. Default: 256 */
	maxTried?: number;
	/** Prune entries older than this (ms). Default: 7 days */
	maxAgeMs?: number;
	/** Max entries per /24 subnet in "new" table (anti-eclipse). Default: 8 */
	maxPerSubnet?: number;
}

const DEFAULTS: Required<PeerAddrDbConfig> = {
	maxNew: 1000,
	maxTried: 256,
	maxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
	maxPerSubnet: 8,
};

// ─── PeerAddrDb ──────────────────────────────────────────────────────────────

/**
 * Persistent peer address database.
 *
 * Tracks all known peer addresses in two buckets ("new" and "tried"),
 * enforces subnet diversity limits, and provides ranked bootstrap peers.
 * Subscribe to PeerConnectionManager events via `attachTo()`.
 */
export class PeerAddrDb {
	private readonly config: Required<PeerAddrDbConfig>;
	/** nodeId → PeerAddr for addresses heard about but never connected. */
	private readonly newAddrs = new Map<string, PeerAddr>();
	/** nodeId → PeerAddr for addresses we've successfully connected to. */
	private readonly triedAddrs = new Map<string, PeerAddr>();

	constructor(config?: PeerAddrDbConfig) {
		this.config = { ...DEFAULTS, ...config };
	}

	// ─── Core Operations ─────────────────────────────────────────────

	/**
	 * Add or update a peer address.
	 * New peers go to the "new" bucket; known peers are updated in place.
	 */
	add(info: PeerNodeInfo, source: PeerAddrSource = "exchange"): void {
		if (!info.endpoint || !info.nodeId) return;

		// Update existing entry if found in either table
		const existing = this.triedAddrs.get(info.nodeId) ?? this.newAddrs.get(info.nodeId);
		if (existing) {
			existing.lastSeen = Date.now();
			existing.endpoint = info.endpoint; // endpoint may change
			if (info.capabilities) existing.capabilities = info.capabilities;
			if (info.label) existing.label = info.label;
			return;
		}

		// Enforce subnet diversity in "new" table
		const subnet = this.extractSubnet(info.endpoint);
		if (this.countSubnetInNew(subnet) >= this.config.maxPerSubnet) return;

		// Evict oldest "new" entry if at capacity
		if (this.newAddrs.size >= this.config.maxNew) {
			this.evictOldestNew();
		}

		const now = Date.now();
		this.newAddrs.set(info.nodeId, {
			nodeId: info.nodeId,
			endpoint: info.endpoint,
			lastSeen: now,
			firstSeen: info.joinedAt ?? now,
			lastAttempt: 0,
			attempts: 0,
			successes: 0,
			failures: 0,
			source,
			bucket: "new",
			subnet,
			capabilities: info.capabilities,
			label: info.label,
		});
	}

	/** Move a peer from "new" to "tried" on successful connection. */
	markConnected(nodeId: string, endpoint?: string): void {
		const addr = this.newAddrs.get(nodeId) ?? this.triedAddrs.get(nodeId);
		if (!addr) {
			// Unknown peer connected — create a tried entry
			if (!endpoint) return;
			const now = Date.now();
			this.ensureTriedCapacity();
			this.triedAddrs.set(nodeId, {
				nodeId, endpoint, lastSeen: now, firstSeen: now,
				lastAttempt: now, attempts: 1, successes: 1, failures: 0,
				source: "exchange", bucket: "tried",
				subnet: this.extractSubnet(endpoint),
			});
			return;
		}

		addr.successes++;
		addr.lastSeen = Date.now();
		addr.lastAttempt = Date.now();
		if (endpoint) addr.endpoint = endpoint;

		// Promote from "new" to "tried"
		if (addr.bucket === "new") {
			this.newAddrs.delete(nodeId);
			addr.bucket = "tried";
			this.ensureTriedCapacity();
			this.triedAddrs.set(nodeId, addr);
		}
	}

	/** Record a failed connection attempt. */
	markFailed(nodeId: string): void {
		const addr = this.triedAddrs.get(nodeId) ?? this.newAddrs.get(nodeId);
		if (!addr) return;
		addr.failures++;
		addr.lastAttempt = Date.now();
		addr.attempts++;
	}

	/** Record a connection attempt (before outcome is known). */
	markAttempted(nodeId: string): void {
		const addr = this.triedAddrs.get(nodeId) ?? this.newAddrs.get(nodeId);
		if (addr) {
			addr.attempts++;
			addr.lastAttempt = Date.now();
		}
	}

	// ─── Bootstrap & Querying ────────────────────────────────────────

	/**
	 * Get the best peers for bootstrap, sorted by reliability then recency.
	 * Prioritizes "tried" peers, then fills with "new" peers.
	 * Ensures subnet diversity in results (max 2 per /24).
	 */
	getBootstrapPeers(limit = 20): PeerAddr[] {
		const now = Date.now();
		const tried = [...this.triedAddrs.values()]
			.sort((a, b) => this.bootstrapScore(b, now) - this.bootstrapScore(a, now));
		const fresh = [...this.newAddrs.values()]
			.sort((a, b) => b.lastSeen - a.lastSeen);

		const result: PeerAddr[] = [];
		const subnetCounts = new Map<string, number>();

		for (const addr of [...tried, ...fresh]) {
			if (result.length >= limit) break;
			const count = subnetCounts.get(addr.subnet) ?? 0;
			if (count >= 2) continue; // diversity: max 2 per /24 in bootstrap set
			subnetCounts.set(addr.subnet, count + 1);
			result.push(addr);
		}
		return result;
	}

	/** Get all entries (for inspection/debugging). */
	getAll(): { tried: PeerAddr[]; new: PeerAddr[] } {
		return {
			tried: [...this.triedAddrs.values()],
			new: [...this.newAddrs.values()],
		};
	}

	/** Get counts for monitoring. */
	getCounts(): { tried: number; new: number; total: number } {
		return {
			tried: this.triedAddrs.size,
			new: this.newAddrs.size,
			total: this.triedAddrs.size + this.newAddrs.size,
		};
	}

	// ─── Persistence ─────────────────────────────────────────────────

	/** Save the address database to a JSON file. */
	async save(filePath: string): Promise<void> {
		const data = {
			version: 1,
			savedAt: Date.now(),
			tried: [...this.triedAddrs.values()],
			new: [...this.newAddrs.values()],
		};
		await mkdir(dirname(filePath), { recursive: true });
		await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
	}

	/** Load the address database from a JSON file. */
	async load(filePath: string): Promise<void> {
		try {
			const raw = await readFile(filePath, "utf-8");
			const data = JSON.parse(raw) as {
				version?: number;
				tried?: PeerAddr[];
				new?: PeerAddr[];
			};
			if (data.tried) {
				for (const addr of data.tried) {
					addr.bucket = "tried";
					this.triedAddrs.set(addr.nodeId, addr);
				}
			}
			if (data.new) {
				for (const addr of data.new) {
					addr.bucket = "new";
					this.newAddrs.set(addr.nodeId, addr);
				}
			}
		} catch (err: unknown) {
			// File doesn't exist or is corrupt — start fresh
			process.stderr.write(`[mesh:peer-addr-db] load failed (starting fresh): ${err instanceof Error ? err.message : String(err)}\n`);
		}
	}

	// ─── Maintenance ─────────────────────────────────────────────────

	/** Remove entries older than maxAgeMs. Returns count of pruned entries. */
	prune(maxAgeMs?: number): number {
		const cutoff = Date.now() - (maxAgeMs ?? this.config.maxAgeMs);
		let pruned = 0;
		for (const [id, addr] of this.newAddrs) {
			if (addr.lastSeen < cutoff) { this.newAddrs.delete(id); pruned++; }
		}
		for (const [id, addr] of this.triedAddrs) {
			if (addr.lastSeen < cutoff) { this.triedAddrs.delete(id); pruned++; }
		}
		return pruned;
	}

	// ─── Event Integration ───────────────────────────────────────────

	/**
	 * Subscribe to PeerConnectionManager events to auto-track peers.
	 * Returns an unsubscribe function.
	 */
	attachTo(manager: { on(handler: PeerNetworkEventHandler): () => void }): () => void {
		return manager.on((event) => {
			switch (event.type) {
				case "peer:connected":
					this.add(event.info, "exchange");
					this.markConnected(event.peerId, event.info.endpoint);
					break;
				case "peer:disconnected":
					// Don't remove — just record last seen time is already updated
					break;
				case "peer:discovered":
					this.add(event.info, "relay");
					break;
				case "peer:dead":
					this.markFailed(event.peerId);
					break;
			}
		});
	}

	// ─── Internal Helpers ────────────────────────────────────────────

	/** Bootstrap score: reliability * recency. Tried peers score higher. */
	private bootstrapScore(addr: PeerAddr, now: number): number {
		const total = addr.successes + addr.failures;
		const reliability = total > 0 ? addr.successes / total : 0.5;
		const ageHours = (now - addr.lastSeen) / 3_600_000;
		const recency = Math.max(0.1, 1 - ageHours / (24 * 7)); // decay over 7 days
		const triedBonus = addr.bucket === "tried" ? 0.3 : 0;
		return Math.min(1, reliability * recency + triedBonus);
	}

	/** Extract /24 subnet from an endpoint URL. */
	private extractSubnet(endpoint: string): string {
		try {
			const host = new URL(endpoint).hostname;
			const parts = host.split(".");
			if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
			return host;
		} catch { /* intentional: non-URL endpoints use raw string as subnet key */ return endpoint; }
	}

	/** Count entries in "new" table from a given subnet. */
	private countSubnetInNew(subnet: string): number {
		let count = 0;
		for (const addr of this.newAddrs.values()) {
			if (addr.subnet === subnet) count++;
		}
		return count;
	}

	/** Evict the oldest entry from the "new" table. */
	private evictOldestNew(): void {
		let oldest: string | null = null;
		let oldestTime = Infinity;
		for (const [id, addr] of this.newAddrs) {
			if (addr.lastSeen < oldestTime) { oldest = id; oldestTime = addr.lastSeen; }
		}
		if (oldest) this.newAddrs.delete(oldest);
	}

	/** Ensure "tried" table has capacity, evicting least reliable if needed. */
	private ensureTriedCapacity(): void {
		if (this.triedAddrs.size < this.config.maxTried) return;
		// Evict least reliable tried peer
		let worst: string | null = null;
		let worstScore = Infinity;
		const now = Date.now();
		for (const [id, addr] of this.triedAddrs) {
			const score = this.bootstrapScore(addr, now);
			if (score < worstScore) { worst = id; worstScore = score; }
		}
		if (worst) this.triedAddrs.delete(worst);
	}
}
