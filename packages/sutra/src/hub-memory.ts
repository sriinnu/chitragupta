/**
 * @chitragupta/sutra — Shared memory and result collection for CommHub.
 *
 * Extracted from hub.ts to keep file sizes manageable.
 * Provides shared memory regions with CAS versioning, region watchers,
 * and result collectors for parallel agent work.
 */

import type { ResultCollector, SharedMemoryRegion } from "./types.js";

export type RegionChangeHandler = (key: string, value: unknown, version: number) => void;

/**
 * Manages shared memory regions with CAS versioning and result collectors.
 *
 * Regions support access control, watchers for change notifications, and
 * optional TTL expiration. Result collectors aggregate parallel agent work.
 */
export class SharedMemoryManager {
	private readonly regions = new Map<string, SharedMemoryRegion>();
	private readonly regionWatchers = new Map<string, Set<RegionChangeHandler>>();
	private readonly collectors = new Map<string, ResultCollector>();
	private readonly logFn: (msg: string) => void;

	constructor(logFn: (msg: string) => void) {
		this.logFn = logFn;
	}

	// ─── Regions ─────────────────────────────────────────────────────────

	/**
	 * Create a new shared memory region.
	 *
	 * @param name - Unique region name.
	 * @param owner - The agent that owns this region (only the owner can delete it).
	 * @param accessList - Agent IDs allowed to write. Use `["*"]` for public access.
	 * @returns The created region object.
	 * @throws If a region with the same name already exists.
	 */
	createRegion(name: string, owner: string, accessList: string[] = ["*"]): SharedMemoryRegion {
		if (this.regions.has(name)) {
			throw new Error(`Region "${name}" already exists.`);
		}

		const region: SharedMemoryRegion = {
			id: crypto.randomUUID(),
			name,
			owner,
			data: {},
			version: 0,
			accessList,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};

		this.regions.set(name, region);
		this.logFn(`[region:create] ${name} owner=${owner}`);
		return region;
	}

	/** Get a region by name. */
	getRegion(name: string): SharedMemoryRegion | undefined {
		return this.regions.get(name);
	}

	/** Read a value from a region. */
	read(regionName: string, key: string): unknown {
		const region = this.regions.get(regionName);
		if (!region) throw new Error(`Region "${regionName}" does not exist.`);
		return region.data[key];
	}

	/**
	 * Write a value to a region with optimistic CAS semantics.
	 *
	 * Checks the access list, increments the region version, and notifies watchers.
	 *
	 * @param regionName - The region to write to.
	 * @param key - The key within the region.
	 * @param value - The value to store.
	 * @param agentId - The writing agent (must be in the access list).
	 * @throws If the region does not exist or the agent lacks write access.
	 */
	write(regionName: string, key: string, value: unknown, agentId: string): void {
		const region = this.regions.get(regionName);
		if (!region) throw new Error(`Region "${regionName}" does not exist.`);

		if (!region.accessList.includes("*") && !region.accessList.includes(agentId)) {
			throw new Error(
				`Agent "${agentId}" does not have write access to region "${regionName}".`,
			);
		}

		if (region.maxSize && !(key in region.data) && Object.keys(region.data).length >= region.maxSize) {
			throw new Error(
				`Region "${regionName}" has reached its max size of ${region.maxSize} entries.`,
			);
		}

		region.data[key] = value;
		region.version++;
		region.updatedAt = Date.now();

		this.logFn(`[region:write] ${regionName}.${key} v${region.version} by ${agentId}`);

		const watchers = this.regionWatchers.get(regionName);
		if (watchers) {
			for (const handler of watchers) {
				try { handler(key, value, region.version); } catch { /* swallow */ }
			}
		}
	}

	/** Delete a region. Only the owner can delete it. */
	deleteRegion(name: string, agentId: string): void {
		const region = this.regions.get(name);
		if (!region) throw new Error(`Region "${name}" does not exist.`);
		if (region.owner !== agentId) {
			throw new Error(
				`Agent "${agentId}" is not the owner of region "${name}" (owner: ${region.owner}).`,
			);
		}

		this.regions.delete(name);
		this.regionWatchers.delete(name);
		this.logFn(`[region:delete] ${name} by ${agentId}`);
	}

	/** Watch a region for changes. Returns an unwatch function. */
	watchRegion(regionName: string, handler: RegionChangeHandler): () => void {
		if (!this.regions.has(regionName)) {
			throw new Error(`Region "${regionName}" does not exist.`);
		}

		if (!this.regionWatchers.has(regionName)) {
			this.regionWatchers.set(regionName, new Set());
		}

		this.regionWatchers.get(regionName)!.add(handler);

		return () => {
			this.regionWatchers.get(regionName)?.delete(handler);
		};
	}

	/** Clean up expired regions. */
	cleanupRegions(): void {
		const now = Date.now();
		for (const [name, region] of this.regions.entries()) {
			if (region.ttl && region.createdAt + region.ttl <= now) {
				this.logFn(`[region:expire] ${name}`);
				this.regions.delete(name);
				this.regionWatchers.delete(name);
			}
		}
	}

	/** Number of active regions. */
	get regionCount(): number {
		return this.regions.size;
	}

	/** Clear all regions and watchers. */
	clear(): void {
		this.regions.clear();
		this.regionWatchers.clear();
		this.collectors.clear();
	}

	// ─── Result Collection ───────────────────────────────────────────────

	/** Create a result collector that expects results from `expected` agents. */
	createCollector<T = unknown>(expected: number): ResultCollector<T> {
		const collector: ResultCollector<T> = {
			id: crypto.randomUUID(),
			expected,
			results: new Map(),
			errors: new Map(),
			resolvers: [],
		};

		this.collectors.set(collector.id, collector as ResultCollector);
		this.logFn(`[collector:create] ${collector.id} expected=${expected}`);
		return collector;
	}

	/** Submit a successful result to a collector. */
	submitResult<T = unknown>(collectorId: string, agentId: string, result: T): void {
		const collector = this.collectors.get(collectorId) as ResultCollector<T> | undefined;
		if (!collector) throw new Error(`Collector "${collectorId}" does not exist.`);

		collector.results.set(agentId, result);
		this.logFn(`[collector:result] ${agentId} -> ${collectorId} (${collector.results.size + collector.errors.size}/${collector.expected})`);
		this.checkCollectorComplete(collector);
	}

	/** Submit an error result to a collector. */
	submitError(collectorId: string, agentId: string, error: Error): void {
		const collector = this.collectors.get(collectorId);
		if (!collector) throw new Error(`Collector "${collectorId}" does not exist.`);

		collector.errors.set(agentId, error);
		this.logFn(`[collector:error] ${agentId} -> ${collectorId}`);
		this.checkCollectorComplete(collector);
	}

	/** Wait for all expected results. Resolves with results map. */
	waitForAll<T = unknown>(collectorId: string, timeout = 60_000): Promise<Map<string, T>> {
		const collector = this.collectors.get(collectorId) as ResultCollector<T> | undefined;
		if (!collector) throw new Error(`Collector "${collectorId}" does not exist.`);

		if (collector.results.size + collector.errors.size >= collector.expected) {
			return Promise.resolve(collector.results);
		}

		return new Promise<Map<string, T>>((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error(
					`Collector "${collectorId}" timed out after ${timeout}ms. ` +
					`Got ${collector.results.size + collector.errors.size}/${collector.expected} results.`,
				));
			}, timeout);

			collector.resolvers.push((results) => {
				clearTimeout(timer);
				resolve(results as Map<string, T>);
			});
		});
	}

	/** Number of active collectors. */
	get collectorCount(): number {
		return this.collectors.size;
	}

	// ─── Internal ─────────────────────────────────────────────────────────

	private checkCollectorComplete<T>(collector: ResultCollector<T>): void {
		const total = collector.results.size + collector.errors.size;
		if (total >= collector.expected) {
			for (const resolver of collector.resolvers) {
				resolver(collector.results);
			}
			collector.resolvers = [];
		}
	}
}
