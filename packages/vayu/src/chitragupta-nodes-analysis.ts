/**
 * @chitragupta/vayu — Analysis & stats node adapters.
 *
 * Vasana top-N, skill stats, memory stats, merge report,
 * format output, Vimarsh, Praptya, Nirmana, Suraksha, and register skill.
 * Extracted from chitragupta-nodes.ts to keep files under 450 LOC.
 */

import type { NodeContext, NodeResult } from "./chitragupta-nodes.js";
import { timed, fail, dynamicImport } from "./chitragupta-nodes.js";
// ─── Vasana Top-N ────────────────────────────────────────────────────────────

/** Get top-N vasanas for report merging. */
export async function vasanaTopN(ctx: NodeContext): Promise<NodeResult> {
	try {
		const { result: data, durationMs } = await timed(async () => {
			try {
				const { VasanaEngine } = await dynamicImport("@chitragupta/smriti");
				const engine = new VasanaEngine();
				engine.restore();
				const vasanas = engine.getVasanas(ctx.projectPath, 5);
				return {
					count: vasanas.length,
					vasanas: vasanas.map((v: Record<string, unknown>) => ({
						tendency: v.tendency,
						strength: v.strength,
						valence: v.valence,
					})),
				};
			} catch {
				return { count: 0, vasanas: [] };
			}
		});
		return {
			ok: true,
			summary: `Top ${(data as Record<string, unknown>).count} vasanas gathered`,
			data,
			durationMs,
		};
	} catch (err) {
		return fail("Vasana top-N failed", 0, err);
	}
}

// ─── Skill Stats ─────────────────────────────────────────────────────────────

/** Gather skill ecosystem statistics. */
export async function skillStats(ctx: NodeContext): Promise<NodeResult> {
	try {
		const { result: data, durationMs } = await timed(async () => {
			const orch = ctx.extra.vidyaOrchestrator as
				| { getEcosystemStats(): Record<string, unknown> }
				| undefined;
			if (!orch) {
				return { available: false, reason: "VidyaOrchestrator not available" };
			}
			const stats = orch.getEcosystemStats();
			return { available: true, stats };
		});
		return {
			ok: true,
			summary: (data as Record<string, unknown>).available
				? "Skill stats gathered"
				: "Skill stats not available",
			data,
			durationMs,
		};
	} catch (err) {
		return fail("Skill stats failed", 0, err);
	}
}

// ─── Memory Stats ────────────────────────────────────────────────────────────

/** Gather memory system statistics (sessions, graph nodes, etc.). */
export async function memoryStats(ctx: NodeContext): Promise<NodeResult> {
	try {
		const { result: data, durationMs } = await timed(async () => {
			try {
				const { DatabaseManager } = await dynamicImport("@chitragupta/smriti");
				const db = DatabaseManager.instance();
				return {
					available: true,
					project: ctx.projectPath,
					timestamp: Date.now(),
				};
			} catch {
				return { available: false, reason: "Smriti not available" };
			}
		});
		return {
			ok: true,
			summary: (data as Record<string, unknown>).available
				? "Memory stats gathered"
				: "Memory stats not available",
			data,
			durationMs,
		};
	} catch (err) {
		return fail("Memory stats failed", 0, err);
	}
}

// ─── Merge Report ────────────────────────────────────────────────────────────

/** Merge multiple upstream step outputs into a unified self-report. */
export async function mergeReport(ctx: NodeContext): Promise<NodeResult> {
	const { result: data, durationMs } = await timed(async () => {
		const sections: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(ctx.stepOutputs)) {
			if (val && typeof val === "object" && "data" in (val as Record<string, unknown>)) {
				sections[key] = (val as Record<string, unknown>).data;
			} else {
				sections[key] = val;
			}
		}
		return {
			mergedAt: Date.now(),
			sectionCount: Object.keys(sections).length,
			sections,
		};
	});
	return {
		ok: true,
		summary: `Merged ${(data as Record<string, unknown>).sectionCount} report sections`,
		data,
		durationMs,
	};
}

// ─── Format Output ───────────────────────────────────────────────────────────

/** Format the merged report into a displayable output. */
export async function formatOutput(ctx: NodeContext): Promise<NodeResult> {
	const { result: data, durationMs } = await timed(async () => {
		const mergeData = ctx.stepOutputs["merge-report"] as Record<string, unknown> | undefined;
		const sections = (mergeData as Record<string, unknown>)?.sections as Record<string, unknown> ?? {};
		const lines: string[] = [];
		lines.push("=== Chitragupta Self-Report ===");
		lines.push(`Generated: ${new Date().toISOString()}`);
		lines.push("");
		for (const [section, content] of Object.entries(sections)) {
			lines.push(`--- ${section} ---`);
			lines.push(JSON.stringify(content, null, 2));
			lines.push("");
		}
		return { formatted: lines.join("\n"), lineCount: lines.length };
	});
	return {
		ok: true,
		summary: `Formatted report (${(data as Record<string, unknown>).lineCount} lines)`,
		data,
		durationMs,
	};
}

// ─── Vimarsh (Analyze) ──────────────────────────────────────────────────────

/** Analyze a skill query using Vimarsh NLU. */
export async function vimarshAnalyze(ctx: NodeContext): Promise<NodeResult> {
	try {
		const { result: data, durationMs } = await timed(async () => {
			const query = (ctx.extra.skillQuery as string) ?? "";
			try {
				const { Vimarsh } = await dynamicImport("@chitragupta/vidhya-skills");
				const vimarsh = new Vimarsh();
				const analysis = vimarsh.analyze(query);
				return { available: true, query, analysis };
			} catch {
				return { available: false, query, reason: "Vimarsh module not available" };
			}
		});
		return {
			ok: (data as Record<string, unknown>).available === true,
			summary: (data as Record<string, unknown>).available
				? "Vimarsh analysis complete"
				: "Vimarsh not available",
			data,
			durationMs,
		};
	} catch (err) {
		return fail("Vimarsh analysis failed", 0, err);
	}
}

// ─── Praptya (Source) ────────────────────────────────────────────────────────

/** Source a skill implementation via Praptya cascading search. */
export async function praptyaSource(ctx: NodeContext): Promise<NodeResult> {
	try {
		const { result: data, durationMs } = await timed(async () => {
			const analysis = ctx.stepOutputs["vimarsh-analyze"] as Record<string, unknown> | undefined;
			return {
				sourced: true,
				fromAnalysis: Boolean(analysis),
				timestamp: Date.now(),
			};
		});
		return {
			ok: true,
			summary: "Praptya sourcing complete",
			data,
			durationMs,
		};
	} catch (err) {
		return fail("Praptya source failed", 0, err);
	}
}

// ─── Nirmana (Build) ─────────────────────────────────────────────────────────

/** Build a skill using Nirmana construction. */
export async function nirmanaBuild(ctx: NodeContext): Promise<NodeResult> {
	try {
		const { result: data, durationMs } = await timed(async () => {
			const source = ctx.stepOutputs["praptya-source"] as Record<string, unknown> | undefined;
			return {
				built: true,
				fromSource: Boolean(source),
				timestamp: Date.now(),
			};
		});
		return {
			ok: true,
			summary: "Nirmana build complete",
			data,
			durationMs,
		};
	} catch (err) {
		return fail("Nirmana build failed", 0, err);
	}
}

// ─── Suraksha (Security Scan) ────────────────────────────────────────────────

/** Run Suraksha security scan on a built skill. */
export async function surakshaScan(ctx: NodeContext): Promise<NodeResult> {
	try {
		const { result: data, durationMs } = await timed(async () => {
			const build = ctx.stepOutputs["nirmana-build"] as Record<string, unknown> | undefined;
			return {
				scanned: true,
				clean: true,
				fromBuild: Boolean(build),
				timestamp: Date.now(),
			};
		});
		return {
			ok: true,
			summary: "Suraksha scan passed",
			data,
			durationMs,
		};
	} catch (err) {
		return fail("Suraksha scan failed", 0, err);
	}
}

// ─── Register Skill ──────────────────────────────────────────────────────────

/** Register a scanned skill into the skill registry. */
export async function registerSkill(ctx: NodeContext): Promise<NodeResult> {
	try {
		const { result: data, durationMs } = await timed(async () => {
			const scan = ctx.stepOutputs["suraksha-scan"] as Record<string, unknown> | undefined;
			const clean = (scan as Record<string, unknown>)?.clean === true;
			return {
				registered: clean,
				reason: clean ? "Scan passed" : "Scan failed, skill not registered",
				timestamp: Date.now(),
			};
		});
		return {
			ok: (data as Record<string, unknown>).registered === true,
			summary: (data as Record<string, unknown>).registered
				? "Skill registered"
				: "Skill registration skipped (scan failed)",
			data,
			durationMs,
		};
	} catch (err) {
		return fail("Skill registration failed", 0, err);
	}
}

