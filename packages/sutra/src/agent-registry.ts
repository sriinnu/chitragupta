/**
 * Parichaya — Agent registry for discovery and capability matching.
 * Sanskrit: Parichaya (परिचय) = introduction, acquaintance.
 *
 * Allows agents to register themselves with capabilities, expertise,
 * and availability. Other agents or the orchestrator can query the
 * registry to find the best agent for a task.
 *
 * Like a sabha (सभा) — an assembly hall — where each participant
 * announces their skills and availability, and the wisest match
 * is found through the mathematics of set similarity (Jaccard).
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AgentEntry {
	/** Unique agent identifier. */
	id: string;
	/** Human-readable agent name. */
	name: string;
	/** List of capabilities this agent provides (e.g., "code-gen", "search"). */
	capabilities: string[];
	/** Domain expertise tags (e.g., "typescript", "security"). */
	expertise: string[];
	/** Current operational status. */
	status: "idle" | "busy" | "offline";
	/** Current workload as a fraction in [0, 1]. 0 = idle, 1 = fully loaded. */
	load: number;
	/** Arbitrary metadata for extensibility. */
	metadata?: Record<string, unknown>;
	/** Unix timestamp (ms) when the agent was first registered. */
	registeredAt: number;
	/** Unix timestamp (ms) of the most recent heartbeat. */
	lastHeartbeat: number;
}

export interface AgentQuery {
	/** Required capabilities — agents must have at least one match. */
	capabilities?: string[];
	/** Desired expertise — used for scoring, not strict filtering. */
	expertise?: string[];
	/** Acceptable statuses. Default: ["idle", "busy"]. */
	status?: AgentEntry["status"][];
	/** Maximum acceptable load. Default: 1.0 (no limit). */
	maxLoad?: number;
}

export interface AgentRegistryConfig {
	/** Heartbeat timeout in ms. Agents exceeding this are marked offline. Default: 60000 */
	heartbeatTimeout?: number;
	/** Maximum number of agents the registry will hold. Default: 1000 */
	maxAgents?: number;
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

/**
 * Jaccard similarity: |A ∩ B| / |A ∪ B|
 *
 * Returns 0 when both sets are empty (no information = no similarity).
 * This is the standard set-similarity metric, well-suited for comparing
 * unordered tag sets of varying lengths.
 */
function jaccard(a: string[], b: string[]): number {
	if (a.length === 0 && b.length === 0) return 0;
	const setA = new Set(a);
	const setB = new Set(b);
	let intersection = 0;
	for (const item of setA) {
		if (setB.has(item)) intersection++;
	}
	const union = setA.size + setB.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

// ─── Registry ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<AgentRegistryConfig> = {
	heartbeatTimeout: 60_000,
	maxAgents: 1000,
};

/**
 * Agent registry for discovery and capability-based matching.
 *
 * @example
 * ```ts
 * const registry = new AgentRegistry();
 * registry.register({
 *   id: "agent-1", name: "Code Generator",
 *   capabilities: ["code-gen", "refactor"], expertise: ["typescript"],
 *   status: "idle", load: 0,
 * });
 *
 * const best = registry.findBest(["code-gen"], ["typescript"]);
 * // => { id: "agent-1", ... }
 * ```
 */
export class AgentRegistry {
	private readonly config: Required<AgentRegistryConfig>;
	private readonly agents = new Map<string, AgentEntry>();

	constructor(config?: AgentRegistryConfig) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	// ─── Registration ──────────────────────────────────────────────

	/**
	 * Register or update an agent.
	 *
	 * If the agent ID already exists, the entry is replaced while
	 * preserving the original `registeredAt` timestamp.
	 *
	 * @param entry - Agent data (without auto-generated timestamps).
	 * @throws If the registry has reached its maximum capacity and the agent is new.
	 */
	register(entry: Omit<AgentEntry, "registeredAt" | "lastHeartbeat">): void {
		const existing = this.agents.get(entry.id);
		if (!existing && this.agents.size >= this.config.maxAgents) {
			throw new Error(
				`AgentRegistry is full (max ${this.config.maxAgents}). ` +
				`Unregister an agent before adding new ones.`,
			);
		}

		const now = Date.now();
		this.agents.set(entry.id, {
			...entry,
			registeredAt: existing?.registeredAt ?? now,
			lastHeartbeat: now,
		});
	}

	/**
	 * Unregister an agent by ID.
	 *
	 * @param agentId - The agent to remove.
	 * @returns True if the agent was found and removed, false otherwise.
	 */
	unregister(agentId: string): boolean {
		return this.agents.delete(agentId);
	}

	// ─── Status ────────────────────────────────────────────────────

	/**
	 * Update an agent's status and optionally its load.
	 *
	 * @param agentId - The agent to update.
	 * @param status - New operational status.
	 * @param load - New load value in [0, 1]. Unchanged if omitted.
	 * @returns True if the agent was found and updated.
	 */
	updateStatus(agentId: string, status: AgentEntry["status"], load?: number): boolean {
		const agent = this.agents.get(agentId);
		if (!agent) return false;
		agent.status = status;
		if (load !== undefined) agent.load = Math.max(0, Math.min(1, load));
		agent.lastHeartbeat = Date.now();
		return true;
	}

	/**
	 * Record a heartbeat for an agent, updating its `lastHeartbeat` timestamp.
	 *
	 * @param agentId - The agent sending the heartbeat.
	 * @returns True if the agent was found.
	 */
	heartbeat(agentId: string): boolean {
		const agent = this.agents.get(agentId);
		if (!agent) return false;
		agent.lastHeartbeat = Date.now();
		return true;
	}

	// ─── Discovery ─────────────────────────────────────────────────

	/**
	 * Find agents matching a query, scored by capability/expertise overlap.
	 *
	 * Scoring formula:
	 *   score = 0.6 * jaccard(query.capabilities, agent.capabilities)
	 *         + 0.3 * jaccard(query.expertise, agent.expertise)
	 *         + 0.1 * (1 - agent.load)
	 *
	 * The 60/30/10 weighting prioritizes capability match, then expertise
	 * relevance, then availability — reflecting the principle that an agent
	 * must first be *able*, then *knowledgeable*, then *available*.
	 *
	 * @param query - The search criteria.
	 * @returns Matching agents sorted by score (best first).
	 */
	find(query: AgentQuery): AgentEntry[] {
		const statusFilter = new Set(query.status ?? ["idle", "busy"]);
		const maxLoad = query.maxLoad ?? 1.0;

		const scored: Array<{ agent: AgentEntry; score: number }> = [];

		for (const agent of this.agents.values()) {
			// Hard filters: status and load
			if (!statusFilter.has(agent.status)) continue;
			if (agent.load > maxLoad) continue;

			// Score: weighted Jaccard similarity + availability
			const capScore = query.capabilities
				? jaccard(query.capabilities, agent.capabilities)
				: 0;
			const expScore = query.expertise
				? jaccard(query.expertise, agent.expertise)
				: 0;
			const availScore = 1 - agent.load;

			const score = 0.6 * capScore + 0.3 * expScore + 0.1 * availScore;
			scored.push({ agent, score });
		}

		// Sort by score descending, then by registeredAt ascending (older = more established)
		scored.sort((a, b) => {
			const sd = b.score - a.score;
			if (Math.abs(sd) > 1e-9) return sd;
			return a.agent.registeredAt - b.agent.registeredAt;
		});

		return scored.map((s) => s.agent);
	}

	/**
	 * Find the single best agent for a set of required capabilities.
	 *
	 * Convenience method: equivalent to `find({ capabilities, expertise })[0]`.
	 *
	 * @param capabilities - Required capabilities.
	 * @param expertise - Optional desired expertise.
	 * @returns The best matching agent, or undefined if none found.
	 */
	findBest(capabilities: string[], expertise?: string[]): AgentEntry | undefined {
		const results = this.find({ capabilities, expertise });
		return results[0];
	}

	// ─── Introspection ─────────────────────────────────────────────

	/**
	 * Get all registered agents.
	 *
	 * @returns Array of all agent entries (no ordering guarantee).
	 */
	getAll(): AgentEntry[] {
		return [...this.agents.values()];
	}

	/**
	 * Get a specific agent by ID.
	 *
	 * @param agentId - The agent ID to look up.
	 * @returns The agent entry, or undefined if not found.
	 */
	get(agentId: string): AgentEntry | undefined {
		return this.agents.get(agentId);
	}

	// ─── Maintenance ───────────────────────────────────────────────

	/**
	 * Sweep stale agents whose heartbeat has exceeded the timeout.
	 *
	 * Agents that have not sent a heartbeat within `timeoutMs` are
	 * marked as "offline". This does not unregister them — they can
	 * come back by sending a new heartbeat or re-registering.
	 *
	 * @param timeoutMs - Override heartbeat timeout. Default from config.
	 * @returns Array of agent IDs that were marked offline.
	 */
	sweep(timeoutMs?: number): string[] {
		const timeout = timeoutMs ?? this.config.heartbeatTimeout;
		const now = Date.now();
		const swept: string[] = [];

		for (const agent of this.agents.values()) {
			if (agent.status === "offline") continue;
			if (now - agent.lastHeartbeat > timeout) {
				agent.status = "offline";
				swept.push(agent.id);
			}
		}

		return swept;
	}

	/**
	 * Clear all agents from the registry.
	 */
	clear(): void {
		this.agents.clear();
	}
}
