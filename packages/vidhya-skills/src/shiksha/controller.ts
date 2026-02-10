/**
 * Shiksha (शिक्षा — Learning) — Autonomous Skill Learning Controller.
 *
 * Orchestrates the full learning pipeline:
 * 1. Vimarsh (analyze) → TaskAnalysis
 * 2. Praptya (source) → SourceResult
 * 3. Nirmana (build) → GeneratedSkill
 * 4. Suraksha (scan) → SurakshaScanResult
 * 5. Auto-approve? → execute or quarantine
 *
 * Speed target: <50ms for local shell skills.
 *
 * @packageDocumentation
 */

import { execFile } from "node:child_process";
import type { SkillMatch } from "../types.js";
import type { SkillRegistry } from "../registry.js";
import type { SkillPipeline } from "../pariksha.js";
import type { SkillEvolution } from "../skill-evolution.js";
import type { SurakshaScanner, SurakshaScanResult } from "../suraksha.js";
import { analyzeTask } from "./vimarsh.js";
import { sourceSkill } from "./praptya.js";
import { buildSkill } from "./nirmana.js";
import type {
	ShikshaConfig,
	ShikshaResult,
	ShikshaEvent,
	ShikshaEventType,
	ShikshaControllerConfig,
	GeneratedSkill,
	BashExecutor,
} from "./types.js";
import { DEFAULT_SHIKSHA_CONFIG, SHIKSHA_HARD_CEILINGS } from "./types.js";
import { formatCloudDisplay } from "./megha.js";

// ─── Default Bash Executor ─────────────────────────────────────────────────

const defaultBashExecutor: BashExecutor = {
	execute(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		return new Promise((resolve) => {
			// Use sh -c to support pipes and shell features
			execFile("sh", ["-c", command], { timeout: 30_000 }, (err, stdout, stderr) => {
				resolve({
					stdout: stdout ?? "",
					stderr: stderr ?? "",
					exitCode: err ? (err as NodeJS.ErrnoException & { code?: number }).code ?? 1 : 0,
				});
			});
		});
	},
};

// ─── Controller ────────────────────────────────────────────────────────────

/**
 * ShikshaController — Autonomous skill learning orchestrator.
 *
 * When the skill registry has no match for a user's request:
 * 1. Analyzes the task (zero-cost NLU)
 * 2. Sources a solution (5-tier fallback)
 * 3. Builds a skill
 * 4. Scans for security
 * 5. Auto-approves if safe, or quarantines
 * 6. Executes if approved
 * 7. Registers for future use
 */
export class ShikshaController {
	private config: ShikshaConfig;
	private registry: SkillRegistry;
	private pipeline?: SkillPipeline;
	private scanner?: SurakshaScanner;
	private evolution?: SkillEvolution;
	private onEvent?: (event: ShikshaEvent) => void;
	private bashExecutor: BashExecutor;

	constructor(
		deps: {
			registry: SkillRegistry;
			pipeline?: SkillPipeline;
			scanner?: SurakshaScanner;
			evolution?: SkillEvolution;
		},
		controllerConfig?: ShikshaControllerConfig,
	) {
		this.config = clampConfig({
			...DEFAULT_SHIKSHA_CONFIG,
			...(controllerConfig?.config ?? {}),
		});
		this.registry = deps.registry;
		this.pipeline = deps.pipeline;
		this.scanner = deps.scanner;
		this.evolution = deps.evolution;
		this.onEvent = controllerConfig?.onEvent;
		this.bashExecutor = controllerConfig?.bashExecutor ?? defaultBashExecutor;
	}

	// ─── Gap Detection ───────────────────────────────────────────────

	/**
	 * Check if the current matches indicate a skill gap.
	 *
	 * A gap is detected when:
	 * - No matches at all, OR
	 * - All matches score below the gap threshold
	 *
	 * @param query - User query.
	 * @param matches - Current skill matches from VidyaBridge.
	 * @returns True if a gap is detected.
	 */
	detectGap(query: string, matches: SkillMatch[]): boolean {
		if (!query.trim()) return false;
		if (matches.length === 0) return true;
		return matches.every((m) => m.score < this.config.gapThreshold);
	}

	// ─── Main Learning Pipeline ──────────────────────────────────────

	/**
	 * Main entry point — detect gap, learn, approve, execute.
	 *
	 * @param query - User's natural language query.
	 * @param topMatch - Optional best match from VidyaBridge (for context).
	 * @returns Learning result.
	 */
	async learn(query: string, topMatch?: SkillMatch): Promise<ShikshaResult> {
		const startTime = performance.now();
		const events: ShikshaEvent[] = [];
		const emit = (type: ShikshaEventType, detail?: string) => {
			const event: ShikshaEvent = { type, timestamp: Date.now(), detail };
			events.push(event);
			this.onEvent?.(event);
		};

		try {
			// ─── 1. Analyze task ──────────────────────────────────
			emit("gap:detected", `Query: ${query}`);
			emit("skill:analyzing", query);

			const analysis = analyzeTask(query);
			emit("skill:analyzed", `Strategy: ${analysis.strategy}, Domain: ${analysis.domain}, Confidence: ${analysis.confidence.toFixed(2)}`);

			// If analysis is too low-confidence or strategy is llm-required, bail
			if (analysis.strategy === "llm-required" && analysis.candidateUtilities.length === 0) {
				emit("skill:failed", "No shell utilities found, LLM required — falling through");
				return {
					success: false,
					autoApproved: false,
					executed: false,
					events,
					durationMs: performance.now() - startTime,
					error: "No matching utilities found. Task requires LLM.",
				};
			}

			// ─── 2. Source solution ───────────────────────────────
			emit("skill:sourcing", `Trying ${analysis.candidateUtilities.length} candidates`);

			const sourceResult = await sourceSkill(analysis, this.config, this.registry);
			emit("skill:sourced", `Tier: ${sourceResult.tier}`);

			// If code generation tier, bail — needs LLM
			if (sourceResult.tier === "code-generation") {
				emit("skill:failed", "Requires code generation (LLM) — falling through");
				return {
					success: false,
					autoApproved: false,
					executed: false,
					events,
					durationMs: performance.now() - startTime,
					error: "Task requires code generation. Falling through to agent.",
				};
			}

			// ─── Cloud recipe tier — never auto-approve, display recipe ───
			if (sourceResult.tier === "cloud-recipe" && sourceResult.cloudResult) {
				emit("skill:cloud_detected", "Provider detection complete");
				const display = formatCloudDisplay(sourceResult.cloudResult, query);
				emit("skill:cloud_recipe", "Recipe formatted");

				return {
					success: true,
					autoApproved: false,
					executed: false,
					cloudRecipeDisplay: display,
					events,
					durationMs: performance.now() - startTime,
				};
			}

			// ─── 3. Build skill ──────────────────────────────────
			emit("skill:generating");

			const skill = buildSkill(analysis, sourceResult);
			emit("skill:generated", `Skill: ${skill.manifest.name}`);

			// ─── 4. Security scan ────────────────────────────────
			emit("skill:scanning");

			let scanResult: SurakshaScanResult | undefined;
			if (this.scanner) {
				scanResult = this.scanner.scan(skill.manifest.name, skill.content);
				emit("skill:scanned", `Verdict: ${scanResult.verdict}, Risk: ${scanResult.riskScore.toFixed(3)}`);
			}

			// ─── 5. Auto-approve decision ────────────────────────
			const autoApproved = this.shouldAutoApprove(scanResult, skill);

			if (autoApproved) {
				emit("skill:auto_approved", skill.manifest.name);

				// Register in live registry immediately
				this.registry.register(skill.manifest);

				// Track in evolution
				if (this.evolution) {
					this.evolution.recordMatch(skill.manifest.name, query, 1.0);
				}

				// ─── 6. Execute if configured ────────────────────
				let executionOutput: string | undefined;
				if (this.config.autoExecute && skill.implementation.type === "shell") {
					emit("skill:executing", skill.implementation.script);

					const result = await this.executeShellSkill(skill.implementation.script);
					executionOutput = result;
					emit("skill:executed", `Output: ${(result ?? "").slice(0, 100)}`);
				}

				emit("skill:learned", skill.manifest.name);

				return {
					success: true,
					skill,
					autoApproved: true,
					executed: !!executionOutput,
					executionOutput,
					scanResult,
					events,
					durationMs: performance.now() - startTime,
				};
			}

			// ─── 7. Quarantine (not auto-approved) ───────────────
			emit("skill:quarantined", `Skill ${skill.manifest.name} needs review`);

			let quarantineId: string | undefined;
			if (this.pipeline) {
				const ingestResult = await this.pipeline.ingest(
					skill.content,
					{ type: "generated", identifier: "shiksha" },
					{ name: skill.manifest.name, description: skill.manifest.description, tags: skill.manifest.tags },
				);
				quarantineId = ingestResult.quarantineId;
			}

			return {
				success: true,
				skill,
				autoApproved: false,
				executed: false,
				quarantineId,
				scanResult,
				events,
				durationMs: performance.now() - startTime,
			};
		} catch (error) {
			emit("skill:failed", error instanceof Error ? error.message : String(error));
			return {
				success: false,
				autoApproved: false,
				executed: false,
				events,
				durationMs: performance.now() - startTime,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	// ─── Auto-Approval Logic ─────────────────────────────────────────

	/**
	 * Decide if a skill can be auto-approved without user review.
	 *
	 * Rules:
	 * - clean + shell + !network + !privilege → YES
	 * - clean + builtin-tool → YES
	 * - typescript → NEVER (can't verify safety)
	 * - llm-chain → NEVER (unpredictable)
	 * - anything else → NEVER
	 */
	private shouldAutoApprove(
		scanResult: SurakshaScanResult | undefined,
		skill: GeneratedSkill,
	): boolean {
		if (!this.config.autoApprove) return false;

		// If no scanner, we can't verify — don't auto-approve
		if (!scanResult) return false;

		// Must have a clean scan
		if (scanResult.verdict !== "clean") return false;

		const impl = skill.implementation;

		// Shell commands: only if no network + no privilege
		if (impl.type === "shell") {
			const candidates = skill.taskAnalysis.candidateUtilities;
			const needsNetwork = candidates.some((c) => c.requiresNetwork);
			const needsPrivilege = candidates.some((c) => c.requiresPrivilege);
			return !needsNetwork && !needsPrivilege;
		}

		// Tool-chain (builtin): auto-approve if clean
		if (impl.type === "tool-chain") {
			return true;
		}

		// TypeScript and LLM chains: never auto-approve
		return false;
	}

	// ─── Skill Execution ─────────────────────────────────────────────

	/**
	 * Execute a shell skill and return the output.
	 */
	private async executeShellSkill(script: string): Promise<string> {
		const result = await this.bashExecutor.execute(script);
		if (result.exitCode !== 0 && result.stderr) {
			return `${result.stdout}\n[stderr]: ${result.stderr}`.trim();
		}
		return result.stdout.trim();
	}

	// ─── Configuration ───────────────────────────────────────────────

	/** Get the current configuration (read-only). */
	getConfig(): Readonly<ShikshaConfig> {
		return { ...this.config };
	}
}

// ─── Config Clamping ───────────────────────────────────────────────────────

/**
 * Clamp user-configurable values to system hard ceilings.
 */
function clampConfig(raw: ShikshaConfig): ShikshaConfig {
	return {
		...raw,
		gapThreshold: Math.min(raw.gapThreshold, SHIKSHA_HARD_CEILINGS.maxGapThreshold),
		sourcingTimeoutMs: Math.min(raw.sourcingTimeoutMs, SHIKSHA_HARD_CEILINGS.maxSourcingTimeoutMs),
		minNpmDownloads: Math.max(raw.minNpmDownloads, SHIKSHA_HARD_CEILINGS.minNpmDownloadsFloor),
		minGithubStars: Math.max(raw.minGithubStars, SHIKSHA_HARD_CEILINGS.minGithubStarsFloor),
		cloudDetectionCacheTTL: Math.min(raw.cloudDetectionCacheTTL, SHIKSHA_HARD_CEILINGS.maxCloudDetectionCacheTTL),
	};
}
