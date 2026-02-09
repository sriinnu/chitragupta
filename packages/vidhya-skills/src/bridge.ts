/**
 * @module bridge
 * @description Bridge between the Vidya skill registry and the agent system.
 *
 * The VidyaBridge connects skill discovery to the agent's tool selection
 * process. When an agent asks "what skill handles file reading?", the bridge
 * queries the registry and returns the best match.
 *
 * It also auto-registers skills when tools are loaded, ensuring the
 * registry stays in sync with available capabilities.
 *
 * Like a Vedic purohita (priest) who bridges the human and divine realms,
 * VidyaBridge mediates between the agent's intent and the system's capabilities.
 *
 * @packageDocumentation
 */

import type { ToolDefinition } from "./generator.js";
import { generateSkillFromTool } from "./generator.js";
import type { SkillRegistry } from "./registry.js";
import type { SkillManifest, SkillMatch } from "./types.js";
import type { SkillSandbox } from "./skill-sandbox.js";
import type {
	EnhancedSkillManifest, PanchaKoshaScores,
	AshramamState, VidyaTantraMatch, SkillState,
} from "./types-v2.js";
import type { MatchContext } from "./matcher.js";
import { matchSkillsV2 } from "./matcher.js";
import type { SamskaraSkillBridge } from "./samskara-skill.js";
import type { AshramamMachine } from "./ashrama.js";

/**
 * Bridge between the Vidya skill registry and the agent system.
 *
 * Provides a simplified interface for the agent loop to:
 * 1. Register available tools as skills
 * 2. Find the best skill for a given task
 * 3. Look up skill metadata for a known tool
 *
 * @example
 * ```ts
 * const registry = new SkillRegistry();
 * const bridge = new VidyaBridge(registry);
 *
 * // Register all available tools
 * bridge.registerToolsAsSkills([
 *   { name: "read_file", description: "Read a file", inputSchema: { ... } },
 *   { name: "write_file", description: "Write a file", inputSchema: { ... } },
 * ]);
 *
 * // Agent asks: "I need to read a configuration file"
 * const match = bridge.recommendSkill("read a configuration file");
 * if (match) {
 *   console.log(match.skill.name); // "read_file"
 *   console.log(match.score);       // 0.85
 * }
 * ```
 */
export class VidyaBridge {
	/** The underlying skill registry. */
	private registry: SkillRegistry;

	/** Track which tools have been registered to avoid duplicates. */
	private registeredTools = new Set<string>();

	/** Optional sandbox for gating external tool registrations. */
	private sandbox?: SkillSandbox;

	/**
	 * Create a new VidyaBridge.
	 *
	 * @param registry - The skill registry to bridge to.
	 * @param sandbox - Optional sandbox for gating external tools.
	 */
	constructor(registry: SkillRegistry, sandbox?: SkillSandbox) {
		this.registry = registry;
		this.sandbox = sandbox;
	}

	/**
	 * Register external tools as skills through the quarantine sandbox.
	 *
	 * Unlike `registerToolsAsSkills()` (which trusts built-in tools),
	 * this method routes each tool through the sandbox for quarantine.
	 *
	 * Requires a sandbox to be set in the constructor.
	 *
	 * @param tools - Array of external tool definitions.
	 * @returns Array of quarantine IDs for each submitted tool.
	 */
	registerExternalToolsAsSkills(tools: ToolDefinition[]): string[] {
		if (!this.sandbox) {
			throw new Error("Sandbox not set. Pass a SkillSandbox to the VidyaBridge constructor.");
		}

		const ids: string[] = [];
		for (const tool of tools) {
			if (this.registeredTools.has(tool.name)) continue;

			const skill = generateSkillFromTool(tool);
			const quarantineId = this.sandbox.submit(
				{
					name: skill.name,
					description: skill.description,
					tags: skill.tags,
					content: JSON.stringify(skill),
				},
				"external",
			);
			ids.push(quarantineId);
		}
		return ids;
	}

	/**
	 * Drain approved skills from the sandbox and register them in the live registry.
	 *
	 * @returns Number of skills promoted.
	 */
	promoteApproved(): number {
		if (!this.sandbox) return 0;

		const approved = this.sandbox.drainApproved();
		let count = 0;
		for (const entry of approved) {
			try {
				// Parse the stored skill content back to a manifest
				const content = entry.skill.content;
				if (content) {
					const manifest: SkillManifest = JSON.parse(content);
					this.registry.register(manifest);
					this.registeredTools.add(manifest.name);
					count++;
				}
			} catch {
				// If content isn't valid JSON manifest, skip
			}
		}
		return count;
	}

	/**
	 * Register an array of tool definitions as skills in the registry.
	 *
	 * Each tool is auto-converted to a {@link SkillManifest} via the generator
	 * module, including verb/object extraction, tag generation, and trait
	 * vector computation.
	 *
	 * Tools that have already been registered (by name) are skipped to
	 * prevent duplicate registrations.
	 *
	 * @param tools - Array of tool definitions to register.
	 */
	registerToolsAsSkills(tools: ToolDefinition[]): void {
		for (const tool of tools) {
			if (this.registeredTools.has(tool.name)) continue;

			const skill = generateSkillFromTool(tool);
			this.registry.register(skill);
			this.registeredTools.add(tool.name);
		}
	}

	/**
	 * Recommend the single best skill for a given query.
	 *
	 * Returns the top-scoring match, or `null` if no skill meets
	 * the minimum threshold.
	 *
	 * @param query - Natural language description of what's needed.
	 * @param threshold - Minimum score threshold. Defaults to 0.1.
	 * @returns The best matching skill, or `null` if none qualify.
	 */
	recommendSkill(query: string, threshold: number = 0.1): SkillMatch | null {
		const matches = this.registry.query({
			text: query,
			topK: 1,
			threshold,
		});

		return matches.length > 0 ? matches[0] : null;
	}

	/**
	 * Recommend multiple skills for a given query.
	 *
	 * Returns up to `topK` matches, sorted by descending score.
	 *
	 * @param query - Natural language description of what's needed.
	 * @param topK - Maximum number of results. Defaults to 5.
	 * @param threshold - Minimum score threshold. Defaults to 0.1.
	 * @returns Array of matching skills sorted by relevance.
	 */
	recommendSkills(
		query: string,
		topK: number = 5,
		threshold: number = 0.1,
	): SkillMatch[] {
		return this.registry.query({
			text: query,
			topK,
			threshold,
		});
	}

	/**
	 * Get the skill manifest for a specific tool by name.
	 *
	 * This is useful when the agent already knows which tool it wants
	 * to use and needs the skill metadata (e.g., capabilities, examples,
	 * anti-patterns).
	 *
	 * @param toolName - The tool name to look up.
	 * @returns The skill manifest, or `null` if not found.
	 */
	getSkillForTool(toolName: string): SkillManifest | null {
		// First, try direct name lookup
		const direct = this.registry.get(toolName);
		if (direct) return direct;

		// Then search by source tool name in all skills
		const all = this.registry.getAll();
		for (const skill of all) {
			if (
				skill.source.type === "tool" &&
				skill.source.toolName === toolName
			) {
				return skill;
			}
		}

		return null;
	}

	/**
	 * Register a single MCP server's tools as skills.
	 *
	 * Convenience method that wraps tool definitions with MCP server source info.
	 *
	 * @param serverId - The MCP server's unique identifier.
	 * @param serverName - The MCP server's display name.
	 * @param tools - Array of tool definitions from the server.
	 */
	registerMCPServerTools(
		serverId: string,
		serverName: string,
		tools: ToolDefinition[],
	): void {
		for (const tool of tools) {
			if (this.registeredTools.has(tool.name)) continue;

			const skill = generateSkillFromTool(tool);

			// Override source to reflect MCP origin
			skill.source = {
				type: "mcp-server",
				serverId,
				serverName,
			};

			this.registry.register(skill);
			this.registeredTools.add(tool.name);
		}
	}

	/**
	 * Unregister all tools that were registered by this bridge.
	 *
	 * Useful when disconnecting an MCP server or resetting the tool set.
	 */
	unregisterAll(): void {
		for (const toolName of this.registeredTools) {
			this.registry.unregister(toolName);
		}
		this.registeredTools.clear();
	}

	/**
	 * Detect whether the top matches indicate a skill gap.
	 *
	 * A gap is detected when no match exceeds the threshold — meaning
	 * no registered skill closely matches the user's intent.
	 *
	 * @param query - Natural language query.
	 * @param threshold - Gap threshold. Defaults to 0.3.
	 * @param topK - Number of top matches to check. Defaults to 3.
	 * @returns True if a skill gap is detected.
	 */
	detectSkillGap(query: string, threshold: number = 0.3, topK: number = 3): boolean {
		const matches = this.recommendSkills(query, topK, 0.0);
		if (matches.length === 0) return true;
		return matches.every((m) => m.score < threshold);
	}

	/**
	 * Get the number of tools registered through this bridge.
	 */
	get registeredCount(): number {
		return this.registeredTools.size;
	}

	// ─── Vidya-Tantra Enhanced Methods ─────────────────────────────────────

	/** Optional Samskara bridge for recording usage impressions. */
	private samskaraBridge?: SamskaraSkillBridge;

	/** Optional Ashrama machine for lifecycle transitions. */
	private ashramamMachine?: AshramamMachine;

	/**
	 * Attach Vidya-Tantra lifecycle components.
	 *
	 * Once set, the bridge uses the three-phase matching pipeline
	 * and records usage impressions through the Samskara bridge.
	 *
	 * @param opts - Samskara bridge and/or Ashrama machine.
	 */
	setVidyaTantra(opts: {
		samskaraBridge?: SamskaraSkillBridge;
		ashramamMachine?: AshramamMachine;
	}): void {
		this.samskaraBridge = opts.samskaraBridge;
		this.ashramamMachine = opts.ashramamMachine;
	}

	/**
	 * Recommend skills using the three-phase Vidya-Tantra pipeline.
	 *
	 * Phase 1: Algorithmic pre-filter (ashrama gate, pranamaya, TVM, kula, trust)
	 * Phase 2: Contextual re-rank (Chetana, Samskaara, Thompson Sampling)
	 * Phase 3: Model disambiguation flag (when top-2 within 0.05)
	 *
	 * Falls back to standard `recommendSkills()` if no enhanced skills are registered.
	 *
	 * @param query - Natural language description of what's needed.
	 * @param context - Optional Chetana/Samskaara context for re-ranking.
	 * @param topK - Maximum number of results. Defaults to 5.
	 * @param threshold - Minimum score threshold. Defaults to 0.1.
	 * @returns Array of VidyaTantraMatch results with phase metadata.
	 */
	recommendSkillsV2(
		query: string,
		context?: MatchContext,
		topK: number = 5,
		threshold: number = 0.1,
	): VidyaTantraMatch[] {
		const allSkills = this.registry.getAll() as EnhancedSkillManifest[];

		return matchSkillsV2(
			{ text: query, topK, threshold },
			allSkills,
			context,
		);
	}

	/**
	 * Record a skill usage impression through the Samskara bridge.
	 *
	 * Call this after a tool execution to update mastery, Thompson params,
	 * Dreyfus levels, and preference tracking.
	 *
	 * No-op if no Samskara bridge is attached.
	 *
	 * @param opts - Impression details.
	 */
	recordImpression(opts: {
		skillName: string;
		success: boolean;
		latencyMs: number;
		sessionId?: string;
		triggerQuery?: string;
		matchScore?: number;
		wasOverridden?: boolean;
		preferredSkill?: string;
		affectValence?: number;
		affectFrustration?: number;
	}): void {
		if (!this.samskaraBridge) return;

		this.samskaraBridge.recordImpression({
			skillName: opts.skillName,
			success: opts.success,
			latencyMs: opts.latencyMs,
			sessionId: opts.sessionId ?? "",
			triggerQuery: opts.triggerQuery ?? "",
			matchScore: opts.matchScore ?? 0,
			wasOverridden: opts.wasOverridden ?? false,
			timestamp: new Date().toISOString(),
			...(opts.preferredSkill !== undefined && { preferredSkill: opts.preferredSkill }),
			...(opts.affectValence !== undefined && { affectValence: opts.affectValence }),
			...(opts.affectFrustration !== undefined && { affectFrustration: opts.affectFrustration }),
		});
	}

	/**
	 * Get the lifecycle state for a skill from the registry.
	 *
	 * @param skillName - The skill name.
	 * @returns The SkillState if found, or undefined.
	 */
	getSkillState(skillName: string): SkillState | undefined {
		return this.registry.getState(skillName);
	}

	/**
	 * Get all matchable skills (grihastha + vanaprastha stages only).
	 *
	 * @returns Skills in active lifecycle stages.
	 */
	getMatchableSkills(): EnhancedSkillManifest[] {
		return this.registry.getMatchable() as EnhancedSkillManifest[];
	}

	/**
	 * Build a MatchContext from the current Samskara bridge state.
	 *
	 * Extracts mastery data and preference rules into a format
	 * suitable for `matchSkillsV2()`.
	 *
	 * @returns A partial MatchContext, or undefined if no Samskara bridge.
	 */
	buildContextFromSamskara(): Partial<MatchContext> | undefined {
		if (!this.samskaraBridge) return undefined;

		const mastery = new Map<string, import("./types-v2.js").AnandamayaMastery>();

		const preferences = this.samskaraBridge.getPreferences();
		const preferenceRules: Array<{
			preferred: string;
			over: string;
			confidence: number;
		}> = [];

		for (const pref of preferences) {
			preferenceRules.push({
				preferred: pref.preferred,
				over: pref.over,
				confidence: pref.confidence,
			});
		}

		return {
			mastery,
			preferenceRules,
		};
	}
}
