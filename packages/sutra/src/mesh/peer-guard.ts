/**
 * Peer Guard — Connection diversity and anti-eclipse protections.
 *
 * Implements Bitcoin-inspired defenses against Sybil/eclipse attacks:
 *   - Subnet diversity: limits connections per /24 subnet
 *   - Outbound preference: ensures minimum outbound connections
 *   - Connection age rotation: cycles oldest inbound connections
 *   - Rate limiting: caps inbound connection attempts per IP
 *   - Peer scoring: tracks reliability for preferred reconnection
 *
 * @module
 */

import type { PeerNodeInfo } from "./peer-types.js";

// ─── Configuration ──────────────────────────────────────────────────────────

/** Configuration for peer guard anti-eclipse protections. */
export interface PeerGuardConfig {
	/** Max connections per /24 subnet. Default: 8 */
	maxPerSubnet?: number;
	/** Minimum outbound connections to maintain. Default: 4 */
	minOutbound?: number;
	/** Max inbound connections (separate from maxPeers). Default: 25 */
	maxInbound?: number;
	/** Max connection attempts per IP per minute. Default: 10 */
	maxAttemptsPerMinute?: number;
	/** Evict oldest inbound connection after this age (ms). Default: 3_600_000 (1h) */
	maxInboundAgeMs?: number;
	/** Enable subnet diversity enforcement. Default: true */
	enforceSubnetDiversity?: boolean;
}

const DEFAULTS: Required<PeerGuardConfig> = {
	maxPerSubnet: 8,
	minOutbound: 4,
	maxInbound: 25,
	maxAttemptsPerMinute: 10,
	maxInboundAgeMs: 3_600_000,
	enforceSubnetDiversity: true,
};

// ─── Peer Score ─────────────────────────────────────────────────────────────

/** Reliability score for a known peer. */
export interface PeerScore {
	nodeId: string;
	endpoint: string;
	/** Total successful connections. */
	successes: number;
	/** Total failed connection attempts. */
	failures: number;
	/** Average latency (ms). */
	avgLatencyMs: number;
	/** Last seen timestamp. */
	lastSeen: number;
	/** First seen timestamp. */
	firstSeen: number;
	/** Whether this is a static/seed peer (never evicted). */
	isStatic: boolean;
}

// ─── PeerGuard ──────────────────────────────────────────────────────────────

/**
 * Enforces connection diversity rules and tracks peer reliability.
 *
 * Used by PeerConnectionManager to decide whether to accept/reject
 * connections and which peers to prefer for outbound connections.
 */
export class PeerGuard {
	private readonly config: Required<PeerGuardConfig>;

	/** subnet → count of active connections */
	private readonly subnetCounts = new Map<string, number>();
	/** ip → timestamps of recent connection attempts */
	private readonly attemptLog = new Map<string, number[]>();
	/** nodeId → PeerScore */
	private readonly scores = new Map<string, PeerScore>();

	private outboundCount = 0;
	private inboundCount = 0;

	constructor(config?: PeerGuardConfig) {
		this.config = { ...DEFAULTS, ...config };
	}

	// ─── Connection Decisions ──────────────────────────────────────

	/**
	 * Check whether an inbound connection should be accepted.
	 * Returns a rejection reason, or null if the connection is allowed.
	 */
	shouldAcceptInbound(remoteIp: string): string | null {
		// Rate limit: max attempts per IP per minute
		if (this.isRateLimited(remoteIp)) {
			return `rate limited: >${this.config.maxAttemptsPerMinute} attempts/min from ${remoteIp}`;
		}
		this.recordAttempt(remoteIp);

		// Max inbound cap
		if (this.inboundCount >= this.config.maxInbound) {
			return `max inbound reached (${this.config.maxInbound})`;
		}

		// Subnet diversity
		if (this.config.enforceSubnetDiversity) {
			const subnet = this.extractSubnet(remoteIp);
			const count = this.subnetCounts.get(subnet) ?? 0;
			if (count >= this.config.maxPerSubnet) {
				return `subnet ${subnet} at capacity (${this.config.maxPerSubnet})`;
			}
		}

		return null;
	}

	/**
	 * Check whether we should initiate an outbound connection.
	 * Returns true if we need more outbound connections.
	 */
	needsMoreOutbound(): boolean {
		return this.outboundCount < this.config.minOutbound;
	}

	// ─── Connection Tracking ──────────────────────────────────────

	/** Record a new outbound connection. */
	recordOutbound(endpoint: string): void {
		this.outboundCount++;
		const ip = this.extractIp(endpoint);
		const subnet = this.extractSubnet(ip);
		this.subnetCounts.set(subnet, (this.subnetCounts.get(subnet) ?? 0) + 1);
	}

	/** Record a new inbound connection. */
	recordInbound(remoteIp: string): void {
		this.inboundCount++;
		const subnet = this.extractSubnet(remoteIp);
		this.subnetCounts.set(subnet, (this.subnetCounts.get(subnet) ?? 0) + 1);
	}

	/** Remove a connection (outbound or inbound). */
	removeConnection(endpoint: string, outbound: boolean): void {
		if (outbound) this.outboundCount = Math.max(0, this.outboundCount - 1);
		else this.inboundCount = Math.max(0, this.inboundCount - 1);
		const ip = this.extractIp(endpoint);
		const subnet = this.extractSubnet(ip);
		const count = this.subnetCounts.get(subnet);
		if (count !== undefined) {
			if (count <= 1) this.subnetCounts.delete(subnet);
			else this.subnetCounts.set(subnet, count - 1);
		}
	}

	// ─── Peer Scoring ────────────────────────────────────────────

	/** Record a successful connection to a peer. */
	recordSuccess(nodeId: string, endpoint: string, latencyMs: number, isStatic = false): void {
		const existing = this.scores.get(nodeId);
		if (existing) {
			existing.successes++;
			existing.avgLatencyMs = (existing.avgLatencyMs * (existing.successes - 1) + latencyMs) / existing.successes;
			existing.lastSeen = Date.now();
			existing.endpoint = endpoint;
		} else {
			this.scores.set(nodeId, {
				nodeId, endpoint, successes: 1, failures: 0,
				avgLatencyMs: latencyMs, lastSeen: Date.now(),
				firstSeen: Date.now(), isStatic,
			});
		}
	}

	/** Record a failed connection attempt. */
	recordFailure(nodeId: string, endpoint: string): void {
		const existing = this.scores.get(nodeId);
		if (existing) {
			existing.failures++;
			existing.lastSeen = Date.now();
		} else {
			this.scores.set(nodeId, {
				nodeId, endpoint, successes: 0, failures: 1,
				avgLatencyMs: 0, lastSeen: Date.now(),
				firstSeen: Date.now(), isStatic: false,
			});
		}
	}

	/**
	 * Get peers ranked by reliability for reconnection.
	 * Score = (successes / (successes + failures)) * recency_weight.
	 */
	getRankedPeers(limit = 20): PeerScore[] {
		const now = Date.now();
		return [...this.scores.values()]
			.filter((p) => p.successes > 0)
			.sort((a, b) => {
				const scoreA = this.computeScore(a, now);
				const scoreB = this.computeScore(b, now);
				return scoreB - scoreA;
			})
			.slice(0, limit);
	}

	/** Get all peer scores (for persistence). */
	getScores(): ReadonlyMap<string, PeerScore> { return this.scores; }

	/** Load scores (from persisted storage). */
	loadScores(scores: PeerScore[]): void {
		for (const s of scores) this.scores.set(s.nodeId, s);
	}

	/** Current counts for monitoring. */
	getCounts(): { outbound: number; inbound: number; subnets: number; scored: number } {
		return {
			outbound: this.outboundCount,
			inbound: this.inboundCount,
			subnets: this.subnetCounts.size,
			scored: this.scores.size,
		};
	}

	/** Max inbound age before rotation is allowed. */
	getMaxInboundAgeMs(): number {
		return this.config.maxInboundAgeMs;
	}

	// ─── Rate Limiting ──────────────────────────────────────────

	private isRateLimited(ip: string): boolean {
		const now = Date.now();
		const attempts = this.attemptLog.get(ip);
		if (!attempts) return false;
		const recent = attempts.filter((t) => now - t < 60_000);
		this.attemptLog.set(ip, recent);
		return recent.length >= this.config.maxAttemptsPerMinute;
	}

	private recordAttempt(ip: string): void {
		const attempts = this.attemptLog.get(ip) ?? [];
		attempts.push(Date.now());
		this.attemptLog.set(ip, attempts);
	}

	// ─── Helpers ────────────────────────────────────────────────

	/** Compute a reliability score (0-1) with recency weighting. */
	private computeScore(peer: PeerScore, now: number): number {
		const total = peer.successes + peer.failures;
		if (total === 0) return 0;
		const reliability = peer.successes / total;
		const ageHours = (now - peer.lastSeen) / 3_600_000;
		const recencyWeight = Math.max(0.1, 1 - ageHours / 24);
		// Static peers get a bonus
		const staticBonus = peer.isStatic ? 0.2 : 0;
		return Math.min(1, reliability * recencyWeight + staticBonus);
	}

	/** Extract /24 subnet from an IP address. */
	private extractSubnet(ip: string): string {
		const parts = ip.split(".");
		if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
		// IPv6 or unrecognized — use the whole address as its own "subnet"
		return ip;
	}

	/** Extract IP from an endpoint URL. */
	private extractIp(endpoint: string): string {
		try {
			const url = new URL(endpoint);
			return url.hostname;
		} catch { /* intentional: non-URL endpoints use raw string as IP */ return endpoint; }
	}
}
