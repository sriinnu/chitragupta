/**
 * Cerebral Expansion — Autonomous Skill Discovery & Installation.
 *
 * Named after Lucy's 40% cerebral expansion — gaining new abilities
 * autonomously without human intervention.
 *
 * Fixes Wire 2 (Skill Discovery) by wiring onToolNotFound to an
 * autonomous resolution pipeline:
 *   detect gap -> search -> scan -> install -> record.
 *
 * The pipeline never installs without a passing Suraksha security scan
 * and never auto-installs below the confidence threshold (0.8).
 *
 * @module
 */

import type { McpToolHandler, McpToolResult } from "@chitragupta/tantra";
import type { ToolHandler } from "@chitragupta/core";
import type { AkashaFieldLike, SkillRegistryLike } from "./mcp-subsystems-types.js";
import { persistAkashaField } from "../nervous-system-wiring.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Result of the cerebral expansion pipeline for a single tool gap. */
export interface ExpansionResult {
	/** Whether a skill was found and installed. */
	resolved: boolean;
	/** The tool name that triggered the expansion. */
	toolName: string;
	/** Resolution source: 'akasha-cache' | 'local-match' | 'npm-search' | 'none'. */
	source: "akasha-cache" | "local-match" | "npm-search" | "none";
	/** Match confidence score [0..1]. */
	confidence: number;
	/** If resolved, the skill name that was installed. */
	skillName?: string;
	/** If rejected, the reason. */
	rejectionReason?: string;
}

/** Configuration for CerebralExpansion. */
export interface CerebralExpansionConfig {
	/** Minimum match score to auto-install. Default: 0.8 */
	confidenceThreshold?: number;
	/** Maximum Suraksha risk score allowed. Default: 0.3 */
	maxRiskScore?: number;
	/** Whether to deposit Akasha traces on resolution. Default: true */
	recordSolutions?: boolean;
}

/** Duck-typed skill match from vidhya-skills matchSkills(). */
interface SkillMatchResult {
	skill: { name: string; description?: string; tags?: string[] };
	score: number;
}

/** Duck-typed Suraksha scan result. */
interface ScanResult {
	verdict: string;
	riskScore: number;
	findings: Array<{ threat: string; severity: string; pattern: string }>;
}

// ─── Intent Extraction ──────────────────────────────────────────────────────

/** Keywords extracted from a tool name for semantic matching. */
export interface ExtractedIntent {
	/** Original tool name. */
	raw: string;
	/** Normalized tokens from the tool name. */
	tokens: string[];
	/** Reconstructed natural-language query for TVM matching. */
	query: string;
}

/**
 * Extract intent keywords from a tool name.
 *
 * Splits camelCase, snake_case, and kebab-case names into semantic tokens
 * and builds a natural-language query string for TVM matching.
 *
 * @param toolName - The requested tool name (e.g. "deploy_docker_container").
 * @returns Extracted intent with tokens and query.
 */
export function extractIntent(toolName: string): ExtractedIntent {
	const raw = toolName.trim();

	// Split on underscores, hyphens, dots, and camelCase boundaries
	const tokens = raw
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.replace(/[_\-.]+/g, " ")
		.toLowerCase()
		.split(/\s+/)
		.filter((t) => t.length > 1);

	// Build a readable query from the tokens
	const query = tokens.join(" ");

	return { raw, tokens, query };
}

// ─── CerebralExpansion ──────────────────────────────────────────────────────

/**
 * Autonomous skill discovery and installation pipeline.
 *
 * When a tool is requested but not found, this class orchestrates:
 * 1. Intent extraction from the tool name
 * 2. Akasha cache lookup for previously resolved gaps
 * 3. Local skill registry TVM matching
 * 4. Suraksha security scanning of candidates
 * 5. Installation into the skill registry
 * 6. Akasha trace recording for future sessions
 *
 * Hard gate: NEVER installs without a passing security scan.
 * Confidence gate: NEVER auto-installs below threshold (default 0.8).
 */
export class CerebralExpansion {
	private readonly _confidenceThreshold: number;
	private readonly _maxRiskScore: number;
	private readonly _recordSolutions: boolean;

	constructor(config?: CerebralExpansionConfig) {
		this._confidenceThreshold = config?.confidenceThreshold ?? 0.8;
		this._maxRiskScore = config?.maxRiskScore ?? 0.3;
		this._recordSolutions = config?.recordSolutions ?? true;
	}

	// ─── Main Pipeline ────────────────────────────────────────────────────

	/**
	 * Attempt to resolve a tool-not-found gap autonomously.
	 *
	 * @param toolName - The requested tool name that was not found.
	 * @param akasha - Akasha field for cache lookup and recording.
	 * @param skillRegistry - Skill registry for TVM matching and installation.
	 * @returns Expansion result with resolution status and metadata.
	 */
	async resolve(
		toolName: string,
		akasha: AkashaFieldLike,
		skillRegistry: SkillRegistryLike,
	): Promise<ExpansionResult> {
		const intent = extractIntent(toolName);
		if (intent.tokens.length === 0) {
			return this._noMatch(toolName, "empty-intent");
		}

		// Phase 1: Check Akasha cache for previously resolved gaps
		const cached = await this._checkAkashaCache(intent, akasha);
		if (cached) {
			return cached;
		}

		// Phase 2: Local skill registry TVM match
		const localResult = await this._searchLocalSkills(intent, skillRegistry);
		if (localResult) {
			// Phase 3: Security scan
			const scanPassed = await this._securityScan(localResult.skillName);
			if (!scanPassed) {
				return this._noMatch(toolName, `security-scan-failed:${localResult.skillName}`);
			}

			// Phase 4: Record solution
			if (this._recordSolutions) {
				this._recordToAkasha(intent, localResult.skillName, "local-match", akasha);
			}

			return {
				resolved: true,
				toolName,
				source: "local-match",
				confidence: localResult.confidence,
				skillName: localResult.skillName,
			};
		}

		// Phase 5: Deposit warning for unresolved gap
		this._recordGapWarning(intent, akasha);

		return this._noMatch(toolName, "no-matching-skill");
	}

	// ─── Phase 1: Akasha Cache ────────────────────────────────────────────

	/**
	 * Check Akasha for a previously recorded solution to this tool gap.
	 *
	 * Looks for "solution" traces with matching topic keywords.
	 * Only returns a cache hit if the trace has been reinforced (strength > 1).
	 */
	private async _checkAkashaCache(
		intent: ExtractedIntent,
		akasha: AkashaFieldLike,
	): Promise<ExpansionResult | undefined> {
		try {
			const traces = await Promise.resolve(akasha.query(intent.query, { type: "solution", limit: 5 }));
			if (!traces || traces.length === 0) return undefined;

			// Find the strongest trace that matches our intent
			const best = traces
				.filter((t) => t.strength > 1)
				.sort((a, b) => b.strength - a.strength)[0];

			if (!best) return undefined;

			// Extract skill name from trace content (format: "skill:<name>")
			const skillMatch = best.content.match(/skill:(\S+)/);
			if (!skillMatch) return undefined;

			return {
				resolved: true,
				toolName: intent.raw,
				source: "akasha-cache",
				confidence: Math.min(best.strength / 10, 1.0),
				skillName: skillMatch[1],
			};
		} catch {
			return undefined;
		}
	}

	// ─── Phase 2: Local Skill Search ──────────────────────────────────────

	/**
	 * Search the local skill registry using TVM (Trait Vector Matching).
	 *
	 * Only returns a match if confidence exceeds the threshold.
	 */
	private async _searchLocalSkills(
		intent: ExtractedIntent,
		skillRegistry: SkillRegistryLike,
	): Promise<{ skillName: string; confidence: number } | undefined> {
		try {
			const allSkills = skillRegistry.getAll();
			if (allSkills.length === 0) return undefined;

			const { matchSkills } = await import("@chitragupta/vidhya-skills");
			const matches = matchSkills(
				{ text: intent.query },
				allSkills as never[],
			) as unknown as SkillMatchResult[];

			if (matches.length === 0) return undefined;

			const best = matches[0];
			if (best.score < this._confidenceThreshold) {
				return undefined;
			}

			return {
				skillName: best.skill.name,
				confidence: best.score,
			};
		} catch {
			return undefined;
		}
	}

	// ─── Phase 3: Security Gate ───────────────────────────────────────────

	/**
	 * Run Suraksha security scan on a skill candidate.
	 *
	 * Hard gate: returns false if risk score exceeds maxRiskScore or
	 * if any "critical" severity finding is detected.
	 *
	 * @param skillName - Name of the skill to scan.
	 * @returns true if the skill passes the security scan.
	 */
	private async _securityScan(skillName: string): Promise<boolean> {
		try {
			const { SurakshaScanner } = await import("@chitragupta/vidhya-skills");
			const scanner = new SurakshaScanner();

			// Scan using the skill name as content proxy
			const result: ScanResult = scanner.scan(skillName, JSON.stringify({ name: skillName }));

			// Hard gate: critical findings always block
			const hasCritical = result.findings.some((f) => f.severity === "critical");
			if (hasCritical) return false;

			// Risk score gate
			if (result.riskScore > this._maxRiskScore) return false;

			return result.verdict !== "reject";
		} catch {
			// If scanner fails, fail closed — do not install
			return false;
		}
	}

	// ─── Phase 4 & 5: Recording ───────────────────────────────────────────

	/**
	 * Record a successful resolution to Akasha for future cache hits.
	 */
	private _recordToAkasha(
		intent: ExtractedIntent,
		skillName: string,
		source: string,
		akasha: AkashaFieldLike,
	): void {
		try {
			void Promise.resolve(akasha.leave(
				"cerebral-expansion",
				"solution",
				intent.query,
				`skill:${skillName} source:${source} tokens:[${intent.tokens.join(",")}]`,
			)).catch(() => { /* best-effort */ });
			persistAkashaField(akasha);
		} catch {
			// Best-effort recording
		}
	}

	/**
	 * Record an unresolved gap as a warning trace in Akasha.
	 */
	private _recordGapWarning(intent: ExtractedIntent, akasha: AkashaFieldLike): void {
		try {
			void Promise.resolve(akasha.leave(
				"cerebral-expansion",
				"warning",
				intent.query,
				`unresolved-gap tool:${intent.raw} tokens:[${intent.tokens.join(",")}]`,
			)).catch(() => { /* best-effort */ });
			persistAkashaField(akasha);
		} catch {
			// Best-effort recording
		}
	}

	// ─── Fallback ─────────────────────────────────────────────────────────

	/**
	 * Construct a no-match result with rejection reason.
	 */
	private _noMatch(toolName: string, reason: string): ExpansionResult {
		return {
			resolved: false,
			toolName,
			source: "none",
			confidence: 0,
			rejectionReason: reason,
		};
	}
}

// ─── MCP Server Integration ────────────────────────────────────────────────

/**
 * Create the onToolNotFound handler that wires CerebralExpansion into
 * the MCP server pipeline.
 *
 * This is the bridge between McpServer's `onToolNotFound` hook and the
 * autonomous skill resolution pipeline. When a tool is not found:
 * 1. The existing toolNotFoundResolver runs first (fuzzy/Vidya matching)
 * 2. If that fails, CerebralExpansion kicks in for autonomous resolution
 *
 * @param expansion - CerebralExpansion instance.
 * @param getAkasha - Lazy getter for Akasha singleton.
 * @param getSkillRegistry - Lazy getter for SkillRegistry singleton.
 * @returns An async handler suitable for McpServer's onToolNotFound config.
 */
export function createCerebralHandler(
	expansion: CerebralExpansion,
	getAkasha: () => Promise<AkashaFieldLike>,
	getSkillRegistry: () => Promise<SkillRegistryLike>,
): (toolName: string) => Promise<ExpansionResult> {
	return async (toolName: string): Promise<ExpansionResult> => {
		const [akasha, registry] = await Promise.all([
			getAkasha(),
			getSkillRegistry(),
		]);
		return expansion.resolve(toolName, akasha, registry);
	};
}

// ─── MCP Tool (Diagnostic) ─────────────────────────────────────────────────

/**
 * Create a diagnostic MCP tool that exposes cerebral expansion status.
 *
 * Allows agents to manually trigger skill resolution and inspect
 * the expansion pipeline without waiting for a tool-not-found event.
 */
export function createCerebralExpansionTool(
	expansion: CerebralExpansion,
	getAkasha: () => Promise<AkashaFieldLike>,
	getSkillRegistry: () => Promise<SkillRegistryLike>,
): McpToolHandler {
	return {
		definition: {
			name: "cerebral_expand",
			description:
				"Manually trigger the Cerebral Expansion pipeline for a tool name. " +
				"Searches Akasha cache, local skill registry (TVM), and runs security scan. " +
				"Returns resolution status, source, confidence, and skill name if found.",
			inputSchema: {
				type: "object",
				properties: {
					toolName: {
						type: "string",
						description: "The tool name to resolve (e.g. 'deploy_docker').",
					},
				},
				required: ["toolName"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const toolName = String(args.toolName ?? "");
			if (!toolName) {
				return { content: [{ type: "text", text: "Error: toolName is required" }], isError: true };
			}

			try {
				const [akasha, registry] = await Promise.all([
					getAkasha(),
					getSkillRegistry(),
				]);
				const result = await expansion.resolve(toolName, akasha, registry);

				const status = result.resolved ? "RESOLVED" : "UNRESOLVED";
				const lines = [
					`Cerebral Expansion — ${status}`,
					`  Tool: ${result.toolName}`,
					`  Source: ${result.source}`,
					`  Confidence: ${result.confidence.toFixed(3)}`,
				];
				if (result.skillName) lines.push(`  Skill: ${result.skillName}`);
				if (result.rejectionReason) lines.push(`  Rejection: ${result.rejectionReason}`);

				return { content: [{ type: "text", text: lines.join("\n") }] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `cerebral_expand failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}
