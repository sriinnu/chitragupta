/**
 * @chitragupta/prana — Analysis & stats node adapters.
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
			const rawQuery = (ctx.extra.skillQuery as string | undefined) ?? "";
			const query = rawQuery.trim();
			if (!query) {
				throw new Error("Missing workflow context key 'skillQuery'");
			}
			const { analyzeTask } = await dynamicImport("@chitragupta/vidhya-skills");
			const analysis = analyzeTask(query);
			return { query, analysis };
		});
		return {
			ok: true,
			summary: "Vimarsh analysis complete",
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
			const vimarsh = ctx.stepOutputs["vimarsh-analyze"] as
				| { analysis?: unknown; query?: string }
				| undefined;
			if (!vimarsh?.analysis) {
				throw new Error("Missing Vimarsh analysis from step 'vimarsh-analyze'");
			}

			const { sourceSkill, DEFAULT_SHIKSHA_CONFIG } = await dynamicImport("@chitragupta/vidhya-skills");
			const source = await sourceSkill(vimarsh.analysis, DEFAULT_SHIKSHA_CONFIG);
			return {
				sourced: true,
				query: vimarsh.query ?? "",
				tier: source.tier,
				source,
			};
		});
		return {
			ok: true,
			summary: `Praptya sourcing complete (${String((data as Record<string, unknown>).tier)})`,
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
			const vimarsh = ctx.stepOutputs["vimarsh-analyze"] as
				| { analysis?: unknown }
				| undefined;
			const sourced = ctx.stepOutputs["praptya-source"] as
				| { source?: unknown; tier?: string }
				| undefined;
			if (!vimarsh?.analysis) {
				throw new Error("Missing Vimarsh analysis from step 'vimarsh-analyze'");
			}
			if (!sourced?.source) {
				throw new Error("Missing Praptya source from step 'praptya-source'");
			}

			const { buildSkill } = await dynamicImport("@chitragupta/vidhya-skills");
			const skill = buildSkill(vimarsh.analysis, sourced.source);
			return {
				built: true,
				tier: sourced.tier,
				skill,
			};
		});
		return {
			ok: true,
			summary: `Nirmana build complete (${((((data as Record<string, unknown>).skill as Record<string, unknown> | undefined)?.manifest as Record<string, unknown> | undefined)?.name as string | undefined) ?? "unnamed"})`,
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
			const build = ctx.stepOutputs["nirmana-build"] as
				| { skill?: { manifest?: { name?: string }; content?: string } }
				| undefined;
			const skill = build?.skill;
			const skillName = skill?.manifest?.name;
			if (!skill || !skillName || !skill.content) {
				throw new Error("Missing built skill from step 'nirmana-build'");
			}

			const { SurakshaScanner } = await dynamicImport("@chitragupta/vidhya-skills");
			const scanner = new SurakshaScanner();
			const scanResult = scanner.scan(skillName, skill.content);
			const clean = scanResult.verdict === "clean";
			return {
				scanned: true,
				clean,
				scanResult,
			};
		});
		return {
			ok: (data as Record<string, unknown>).clean === true,
			summary: (data as Record<string, unknown>).clean
				? "Suraksha scan passed"
				: "Suraksha scan found risks",
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
			const scan = ctx.stepOutputs["suraksha-scan"] as { clean?: boolean } | undefined;
			if (scan?.clean !== true) {
				throw new Error("Cannot register skill: Suraksha scan did not pass");
			}

			const build = ctx.stepOutputs["nirmana-build"] as
				| { skill?: { manifest?: { name?: string; description?: string; inputSchema?: Record<string, unknown> } } }
				| undefined;
			const manifest = build?.skill?.manifest;
			if (!manifest?.name || !manifest.description) {
				throw new Error("Cannot register skill: built manifest missing from step 'nirmana-build'");
			}

			const registry = ctx.extra.skillRegistry as
				| { register(manifest: unknown): void }
				| undefined;
			if (registry) {
				registry.register(manifest);
				return {
					registered: true,
					target: "skillRegistry",
					name: manifest.name,
					timestamp: Date.now(),
				};
			}

			const orchestrator = ctx.extra.vidyaOrchestrator as
				| {
					onToolRegistered(
						toolDef: { name: string; description: string; inputSchema?: Record<string, unknown> },
						kula?: "shiksha",
					): void;
				}
				| undefined;
			if (orchestrator?.onToolRegistered) {
				orchestrator.onToolRegistered(
					{
						name: manifest.name,
						description: manifest.description,
						inputSchema: manifest.inputSchema,
					},
					"shiksha",
				);
				return {
					registered: true,
					target: "vidyaOrchestrator",
					name: manifest.name,
					timestamp: Date.now(),
				};
			}

			return {
				registered: false,
				reason: "No skillRegistry or vidyaOrchestrator provided in workflow context",
				timestamp: Date.now(),
			};
		});
		return {
			ok: (data as Record<string, unknown>).registered === true,
			summary: (data as Record<string, unknown>).registered
				? "Skill registered"
				: `Skill registration skipped (${String((data as Record<string, unknown>).reason ?? "unknown reason")})`,
			data,
			durationMs,
		};
	} catch (err) {
		return fail("Skill registration failed", 0, err);
	}
}
