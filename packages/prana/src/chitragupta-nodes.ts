/**
 * @chitragupta/prana — Chitragupta node adapters.
 *
 * Wraps Chitragupta subsystem modules as Prana step handlers.
 * Each adapter takes a context object, performs its operation,
 * and returns a structured result. Uses dynamic imports so the
 * DAG engine does not hard-depend on every subsystem.
 */

// ─── Context ─────────────────────────────────────────────────────────────────

/** Shared execution context passed to every node adapter. */
export interface NodeContext {
	/** Project root path (defaults to cwd). */
	projectPath: string;
	/** Upstream step outputs keyed by step ID. */
	stepOutputs: Record<string, unknown>;
	/** Arbitrary context bag for cross-step communication. */
	extra: Record<string, unknown>;
}

/** Standard adapter result. */
export interface NodeResult {
	/** Whether the adapter completed without error. */
	ok: boolean;
	/** Human-readable summary of what happened. */
	summary: string;
	/** Structured payload (adapter-specific). */
	data: unknown;
	/** Duration in milliseconds. */
	durationMs: number;
}

// ─── Helper ──────────────────────────────────────────────────────────────────

/** Time an async operation, returning both the result and elapsed milliseconds. */
export async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
	const start = Date.now();
	const result = await fn();
	return { result, durationMs: Date.now() - start };
}

/** Create a failed NodeResult with an error summary. */
export function fail(summary: string, durationMs: number, error?: unknown): NodeResult {
	return {
		ok: false,
		summary: `${summary}: ${error instanceof Error ? error.message : String(error ?? "unknown")}`,
		data: null,
		durationMs,
	};
}

/**
 * Dynamic import helper that bypasses TypeScript module resolution.
 * These packages are optional runtime dependencies — the adapters
 * gracefully handle their absence via try/catch.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function dynamicImport(specifier: string): Promise<any> {
	return import(/* webpackIgnore: true */ specifier);
}

// Re-export adapters from extracted modules
export {
	nidraWake, nidraSleep, vasanaScan, swapnaConsolidate,
	akashaDeposit, kalaChakraContext, chetanaState, trigunaHealth,
} from "./chitragupta-nodes-lifecycle.js";
export {
	vasanaTopN, skillStats, memoryStats, mergeReport,
	formatOutput, vimarshAnalyze, praptyaSource, nirmanaBuild,
	surakshaScan, registerSkill,
} from "./chitragupta-nodes-analysis.js";
export {
	rakshakaSecurity, gatiPerformance, satyaCorrectness,
	mergeFindings, sabhaDeliberation, applyFixes,
	healthReport, learningCheck,
} from "./chitragupta-nodes-quality.js";
export {
	autoresearchScope, acpResearchCouncil, autoresearchBaseline,
	autoresearchRun, autoresearchEvaluate, autoresearchFinalize, autoresearchRecord,
	paktPackResearchContext,
} from "./chitragupta-nodes-research.js";

// Import adapters for the registry
import {
	nidraWake, nidraSleep, vasanaScan, swapnaConsolidate,
	akashaDeposit, kalaChakraContext, chetanaState, trigunaHealth,
} from "./chitragupta-nodes-lifecycle.js";
import {
	vasanaTopN, skillStats, memoryStats, mergeReport,
	formatOutput, vimarshAnalyze, praptyaSource, nirmanaBuild,
	surakshaScan, registerSkill,
} from "./chitragupta-nodes-analysis.js";
import {
	rakshakaSecurity, gatiPerformance, satyaCorrectness,
	mergeFindings, sabhaDeliberation, applyFixes,
	healthReport, learningCheck,
} from "./chitragupta-nodes-quality.js";
import {
	autoresearchScope, acpResearchCouncil, autoresearchBaseline,
	autoresearchRun, autoresearchEvaluate, autoresearchFinalize, autoresearchRecord,
	paktPackResearchContext,
} from "./chitragupta-nodes-research.js";
// ─── Node Registry ───────────────────────────────────────────────────────────

/** Map of step ID prefixes to adapter functions. */
export const NODE_ADAPTERS: Record<string, (ctx: NodeContext) => Promise<NodeResult>> = {
	"nidra-wake": nidraWake,
	"nidra-sleep": nidraSleep,
	"vasana-scan": vasanaScan,
	"swapna-consolidate": swapnaConsolidate,
	"akasha-deposit": akashaDeposit,
	"kala-chakra-context": kalaChakraContext,
	"chetana-state": chetanaState,
	"triguna-health": trigunaHealth,
	"vasana-top-n": vasanaTopN,
	"skill-stats": skillStats,
	"memory-stats": memoryStats,
	"merge-report": mergeReport,
	"format-output": formatOutput,
	"vimarsh-analyze": vimarshAnalyze,
	"praptya-source": praptyaSource,
	"nirmana-build": nirmanaBuild,
	"suraksha-scan": surakshaScan,
	"register-skill": registerSkill,
	"rakshaka-security": rakshakaSecurity,
	"gati-performance": gatiPerformance,
	"satya-correctness": satyaCorrectness,
	"merge-findings": mergeFindings,
	"sabha-deliberation": sabhaDeliberation,
	"apply-fixes": applyFixes,
	"health-report": healthReport,
	"learning-check": learningCheck,
	"autoresearch-scope": autoresearchScope,
	"acp-research-council": acpResearchCouncil,
	"autoresearch-baseline": autoresearchBaseline,
	"autoresearch-run": autoresearchRun,
	"autoresearch-evaluate": autoresearchEvaluate,
	"autoresearch-finalize": autoresearchFinalize,
	"autoresearch-record": autoresearchRecord,
	"pakt-pack-research-context": paktPackResearchContext,
};

/**
 * Execute a node adapter by step ID.
 *
 * @param stepId - The step ID to look up in NODE_ADAPTERS.
 * @param ctx - The execution context.
 * @returns The adapter result, or a failure result if the adapter is not found.
 */
export async function executeNodeAdapter(
	stepId: string,
	ctx: NodeContext,
): Promise<NodeResult> {
	const adapter = NODE_ADAPTERS[stepId];
	if (!adapter) {
		return {
			ok: false,
			summary: `No adapter found for step: ${stepId}`,
			data: null,
			durationMs: 0,
		};
	}
	try {
		return await adapter(ctx);
	} catch (err) {
		return fail(`Adapter "${stepId}" threw`, 0, err);
	}
}
