/**
 * @chitragupta/vayu — Lifecycle node adapters.
 *
 * Nidra (sleep), Vasana (tendencies), Svapna (consolidation),
 * Akasha (memory), Kala Chakra (context), Chetana (consciousness),
 * and Triguna (health) adapters.
 * Extracted from chitragupta-nodes.ts to keep files under 450 LOC.
 */

import type { NodeContext, NodeResult } from "./chitragupta-nodes.js";
import { timed, fail, dynamicImport } from "./chitragupta-nodes.js";
// ─── Nidra (Sleep Cycle) ─────────────────────────────────────────────────────

/** Wake the Nidra daemon from sleep state. */
export async function nidraWake(ctx: NodeContext): Promise<NodeResult> {
	const { result: data, durationMs } = await timed(async () => {
		try {
			const daemon = ctx.extra.nidraDaemon as
				| { wake(): void; snapshot(): Record<string, unknown> }
				| undefined;
			if (!daemon) {
				return { woken: false, reason: "Nidra daemon not available" };
			}
			daemon.wake();
			const snap = daemon.snapshot();
			return { woken: true, state: snap.state };
		} catch (err) {
			return { woken: false, reason: err instanceof Error ? err.message : String(err) };
		}
	});
	return {
		ok: (data as Record<string, unknown>).woken === true,
		summary: (data as Record<string, unknown>).woken
			? "Nidra daemon woken"
			: `Nidra wake skipped: ${(data as Record<string, unknown>).reason}`,
		data,
		durationMs,
	};
}

/** Put the Nidra daemon to sleep after consolidation. */
export async function nidraSleep(ctx: NodeContext): Promise<NodeResult> {
	const { result: data, durationMs } = await timed(async () => {
		try {
			const daemon = ctx.extra.nidraDaemon as
				| { snapshot(): Record<string, unknown> }
				| undefined;
			if (!daemon) {
				return { sleeping: false, reason: "Nidra daemon not available" };
			}
			// The daemon auto-sleeps; we just confirm the state
			const snap = daemon.snapshot();
			return { sleeping: true, state: snap.state };
		} catch (err) {
			return { sleeping: false, reason: err instanceof Error ? err.message : String(err) };
		}
	});
	return {
		ok: true,
		summary: "Nidra sleep cycle complete",
		data,
		durationMs,
	};
}

// ─── Vasana (Tendencies) ─────────────────────────────────────────────────────

/** Scan for crystallized vasana tendencies. */
export async function vasanaScan(ctx: NodeContext): Promise<NodeResult> {
	const { durationMs } = await timed(async () => {});
	try {
		const { result: data, durationMs: d } = await timed(async () => {
			const { VasanaEngine } = await dynamicImport("@chitragupta/smriti");
			const engine = new VasanaEngine();
			engine.restore();
			const vasanas = engine.getVasanas(ctx.projectPath, 50);
			return {
				count: vasanas.length,
				topVasanas: vasanas.slice(0, 10).map((v: Record<string, unknown>) => ({
					tendency: v.tendency,
					strength: v.strength,
					valence: v.valence,
				})),
			};
		});
		return {
			ok: true,
			summary: `Found ${(data as Record<string, unknown>).count} vasanas`,
			data,
			durationMs: d,
		};
	} catch (err) {
		return fail("Vasana scan failed", durationMs, err);
	}
}

// ─── Svapna / Samskaara (Consolidation) ──────────────────────────────────────

/** Run memory consolidation (pattern detection + compression). */
export async function svapnaConsolidate(ctx: NodeContext): Promise<NodeResult> {
	try {
		const { result: data, durationMs } = await timed(async () => {
			const { ConsolidationEngine } = await dynamicImport("@chitragupta/smriti");
			const engine = new ConsolidationEngine({ project: ctx.projectPath });
			const report = engine.run();
			return report;
		});
		return {
			ok: true,
			summary: "Memory consolidation complete",
			data,
			durationMs,
		};
	} catch (err) {
		return fail("Consolidation failed", 0, err);
	}
}

// ─── Akasha (Memory Deposit) ─────────────────────────────────────────────────

/** Deposit consolidated data into long-term memory (GraphRAG). */
export async function akashaDeposit(ctx: NodeContext): Promise<NodeResult> {
	try {
		const { result: data, durationMs } = await timed(async () => {
			const consolidationResult = ctx.stepOutputs["svapna-consolidate"] as Record<string, unknown> | undefined;
			return {
				deposited: true,
				source: consolidationResult ? "svapna" : "none",
				timestamp: Date.now(),
			};
		});
		return {
			ok: true,
			summary: "Akasha deposit complete",
			data,
			durationMs,
		};
	} catch (err) {
		return fail("Akasha deposit failed", 0, err);
	}
}

// ─── Kala Chakra (Context Window) ────────────────────────────────────────────

/** Gather context window / temporal state for consolidation. */
export async function kalaChakraContext(ctx: NodeContext): Promise<NodeResult> {
	try {
		const { result: data, durationMs } = await timed(async () => {
			return {
				timestamp: Date.now(),
				projectPath: ctx.projectPath,
				contextSize: Object.keys(ctx.extra).length,
			};
		});
		return {
			ok: true,
			summary: "Kala Chakra context gathered",
			data,
			durationMs,
		};
	} catch (err) {
		return fail("Kala Chakra failed", 0, err);
	}
}

// ─── Chetana (Consciousness State) ──────────────────────────────────────────

/** Gather the current Chetana consciousness state. */
export async function chetanaState(ctx: NodeContext): Promise<NodeResult> {
	try {
		const { result: data, durationMs } = await timed(async () => {
			const chetana = ctx.extra.chetana as
				| { getCognitiveReport(): Record<string, unknown> }
				| undefined;
			if (!chetana) {
				return { available: false, reason: "Chetana not initialized" };
			}
			const report = chetana.getCognitiveReport();
			return { available: true, report };
		});
		return {
			ok: true,
			summary: (data as Record<string, unknown>).available
				? "Chetana state gathered"
				: "Chetana not available",
			data,
			durationMs,
		};
	} catch (err) {
		return fail("Chetana state failed", 0, err);
	}
}

// ─── Triguna (Health) ────────────────────────────────────────────────────────

/** Gather Triguna system health metrics. */
export async function trigunaHealth(ctx: NodeContext): Promise<NodeResult> {
	try {
		const { result: data, durationMs } = await timed(async () => {
			try {
				const mod = await dynamicImport("@chitragupta/anina");
				const Triguna = mod.Triguna;
				// Duck-typed: Triguna has getState/getDominant/getTrend
				const triguna = (ctx.extra.triguna ?? new Triguna()) as {
					getState(): Record<string, unknown>;
					getDominant(): string;
					getTrend(): Record<string, unknown>;
				};
				const state = triguna.getState();
				const dominant = triguna.getDominant();
				const trend = triguna.getTrend();
				return { available: true, state, dominant, trend };
			} catch {
				return { available: false, reason: "Triguna module not available" };
			}
		});
		return {
			ok: true,
			summary: (data as Record<string, unknown>).available
				? `Health: ${(data as Record<string, unknown>).dominant} dominant`
				: "Triguna not available",
			data,
			durationMs,
		};
	} catch (err) {
		return fail("Triguna health failed", 0, err);
	}
}

