/**
 * @chitragupta/cli — API infrastructure wiring extracted from api.ts.
 *
 * Wires optional subsystems for the programmatic API:
 *   - Dharma policy engine (inline evaluation)
 *   - Embedding provider
 *   - MemoryBridge (identity + semantic search)
 *   - Vidhya-skills (skill discovery + orchestration)
 *   - CheckpointManager, CommHub, Samiti, KaalaBrahma
 *   - TrigunaActuator, Lokapala, RtaEngine, NidraDaemon
 */

import path from "path";

import type { AgentProfile, ThinkingLevel } from "@chitragupta/core";
import { PolicyEngine, STANDARD_PRESET } from "@chitragupta/dharma";
import type { PolicyAction, PolicyContext } from "@chitragupta/dharma";
import type { AgentConfig, ToolHandler } from "@chitragupta/anina";
import type { Session } from "@chitragupta/smriti/types";

import {
	loadProjectMemory,
	getActionType,
	createEmbeddingProviderInstance,
} from "./bootstrap.js";

/** Result of API infrastructure wiring. */
export interface ApiWiringResult {
	policyAdapter?: AgentConfig["policyEngine"];
	embeddingProvider?: Awaited<ReturnType<typeof createEmbeddingProviderInstance>>;
	memoryContext?: string;
	identityContext?: string;
	skillContext?: string;
	skillWatcherCleanups: Array<() => void>;
	checkpointManager?: {
		save: (sessionId: string, data: {
			version: 1; sessionId: string; turns: unknown[];
			metadata: Record<string, unknown>; timestamp: number;
		}) => Promise<unknown>;
	};
	nidraDaemon?: {
		start: () => void; stop: () => Promise<void>;
		touch: () => void;
		onDream: (cb: (progress: (...args: unknown[]) => void) => Promise<void>) => void;
		onDeepSleep: (cb: () => Promise<void>) => void;
	};
	commHub?: AgentConfig["commHub"];
	commHubDestroy?: () => void;
	samiti?: AgentConfig["samiti"];
	kaala?: AgentConfig["kaala"];
	kaalaStopMonitoring?: () => void;
	lokapala?: AgentConfig["lokapala"];
	rtaEngine?: { persistAuditLog?: (db: unknown) => void };
}

/** Parameters for API wiring. */
export interface ApiWiringParams {
	projectPath: string;
	tools: ToolHandler[];
	sessionId: string;
	noMemory?: boolean;
}

/**
 * Wire all optional infrastructure for the programmatic API.
 *
 * Each subsystem is best-effort: failure to initialize one does not
 * block the others.
 */
export async function wireApiInfrastructure(params: ApiWiringParams): Promise<ApiWiringResult> {
	const { projectPath, tools, sessionId, noMemory } = params;
	const result: ApiWiringResult = { skillWatcherCleanups: [] };

	// ── Policy engine ──
	wirePolicyEngine(result, sessionId, projectPath);

	// ── Embedding provider ──
	result.embeddingProvider = await createEmbeddingProviderInstance();

	// ── Memory + Identity context ──
	if (!noMemory) {
		result.memoryContext = loadProjectMemory(projectPath);
		await wireMemoryBridge(result, projectPath);
	}

	// ── Skills ──
	await wireSkills(result, projectPath, tools);

	// ── CheckpointManager ──
	await wireCheckpointManager(result, projectPath);

	// ── CommHub + Samiti ──
	await wireCommHubAndSamiti(result);

	// ── KaalaBrahma ──
	await wireKaalaBrahma(result);

	// ── TrigunaActuator ──
	await wireTrigunaActuator(result);

	// ── Lokapala ──
	await wireLokapala(result);

	// ── RtaEngine ──
	await wireRtaEngine(result);

	// ── NidraDaemon ──
	await wireNidraDaemon(result, projectPath);

	return result;
}

// ─── Individual Wiring Functions ────────────────────────────────────────────

function wirePolicyEngine(
	result: ApiWiringResult,
	sessionId: string,
	projectPath: string,
): void {
	try {
		const preset = STANDARD_PRESET;
		const dharmaEngine = new PolicyEngine(preset.config);
		for (const ps of preset.policySets) { dharmaEngine.addPolicySet(ps); }

		result.policyAdapter = {
			check(toolName: string, args: Record<string, unknown>): { allowed: boolean; reason?: string } {
				const actionType = getActionType(toolName);
				const action: PolicyAction = {
					type: actionType, tool: toolName, args,
					filePath: (args.path ?? args.file_path ?? args.filePath) as string | undefined,
					command: (args.command ?? args.cmd) as string | undefined,
					content: (args.content ?? args.text) as string | undefined,
					url: (args.url ?? args.uri) as string | undefined,
				};
				const context: PolicyContext = {
					sessionId, agentId: "api", agentDepth: 0, projectPath,
					totalCostSoFar: 0, costBudget: preset.config.costBudget,
					filesModified: [], commandsRun: [], timestamp: Date.now(),
				};

				let blocked = false;
				let reason: string | undefined;
				try {
					const verdicts: Array<{ status: string; reason: string }> = [];
					for (const ps of preset.policySets) {
						for (const rule of ps.rules) {
							const r = rule.evaluate(action, context);
							if (r && typeof r === "object" && "status" in r && !("then" in r)) {
								verdicts.push(r as { status: string; reason: string });
							}
						}
					}
					const deny = verdicts.find((v) => v.status === "deny");
					if (deny) { blocked = true; reason = deny.reason; }
				} catch { /* allow by default */ }
				return blocked ? { allowed: false, reason } : { allowed: true };
			},
		};
	} catch { /* dharma is optional */ }
}

async function wireMemoryBridge(result: ApiWiringResult, projectPath: string): Promise<void> {
	try {
		const { MemoryBridge } = await import("@chitragupta/anina");
		const memoryBridge = new MemoryBridge({
			enabled: true, project: projectPath, enableSmaran: true,
			enableGraphRAG: true, enableHybridSearch: true,
			identityPath: projectPath, embeddingProvider: result.embeddingProvider,
		});
		const identityCtx = memoryBridge.getIdentityContext();
		if (identityCtx) {
			const loaded = identityCtx.load().trim();
			if (loaded.length > 0) { result.identityContext = loaded; }
		}
		const bridgedMemory = await memoryBridge.loadMemoryContext(projectPath, "api");
		if (bridgedMemory?.trim().length) {
			result.memoryContext = result.memoryContext
				? `${result.memoryContext}\n\n${bridgedMemory}`
				: bridgedMemory;
		}
	} catch { /* best-effort */ }
}

async function wireSkills(
	result: ApiWiringResult,
	projectPath: string,
	tools: ToolHandler[],
): Promise<void> {
	try {
		const { SkillRegistry, VidyaBridge, VidyaOrchestrator } = await import("@chitragupta/vidhya-skills");
		const skillRegistry = new SkillRegistry();
		const bridge = new VidyaBridge(skillRegistry);
		bridge.registerToolsAsSkills(
			tools.map((tool) => ({
				name: tool.definition.name,
				description: tool.definition.description,
				inputSchema: tool.definition.inputSchema as Record<string, unknown>,
			})),
		);

		try {
			const { loadSkillTiers } = await import("./shared-factories.js");
			const tierResult = await loadSkillTiers({ projectPath, skillRegistry });
			result.skillWatcherCleanups.push(...tierResult.watcherCleanups);
		} catch { /* optional */ }

		if (skillRegistry.size > 0) {
			const allSkills = skillRegistry.getAll();
			const tagCounts = new Map<string, number>();
			for (const skill of allSkills) {
				for (const tag of skill.tags) { tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1); }
			}
			const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tag, count]) => `${tag} (${count})`);
			const lines = [
				"## Skill Discovery", "",
				`${skillRegistry.size} skills registered via Trait Vector Matching (TVM).`,
				"Tools are auto-discoverable through semantic matching, not exact name memorization.",
			];
			if (topTags.length > 0) { lines.push("", `Skill domains: ${topTags.join(", ")}`); }
			result.skillContext = lines.join("\n");
		}

		try {
			const stateDir = path.join(projectPath, ".chitragupta");
			const vidyaOrchestrator = new VidyaOrchestrator(
				{ registry: skillRegistry, bridge },
				{ persistPath: path.join(stateDir, "vidya-state.json"), enableAutoComposition: true },
			);
			await vidyaOrchestrator.initialize();
		} catch { /* best-effort */ }
	} catch { /* vidhya-skills is optional */ }
}

async function wireCheckpointManager(result: ApiWiringResult, projectPath: string): Promise<void> {
	try {
		const { CheckpointManager } = await import("@chitragupta/smriti");
		result.checkpointManager = new CheckpointManager({
			checkpointDir: path.join(projectPath, ".chitragupta", "checkpoints"),
		});
	} catch { /* optional */ }
}

async function wireCommHubAndSamiti(result: ApiWiringResult): Promise<void> {
	try {
		const { CommHub, Samiti } = await import("@chitragupta/sutra");
		const hub = new CommHub({ enableLogging: false });
		result.commHub = hub as unknown as AgentConfig["commHub"];
		result.commHubDestroy = () => hub.destroy();
		result.samiti = new Samiti() as unknown as AgentConfig["samiti"];
	} catch { /* optional */ }
}

async function wireKaalaBrahma(result: ApiWiringResult): Promise<void> {
	try {
		const { KaalaBrahma } = await import("@chitragupta/anina");
		const { loadGlobalSettings } = await import("@chitragupta/core");
		const agentsCfg = loadGlobalSettings().agents;
		const k = new KaalaBrahma({
			heartbeatInterval: 5000, staleThreshold: 30000,
			maxAgentDepth: agentsCfg?.maxDepth ?? 8, maxSubAgents: agentsCfg?.maxSubAgents ?? 12,
		});
		k.startMonitoring();
		result.kaala = k as unknown as AgentConfig["kaala"];
		result.kaalaStopMonitoring = () => k.stopMonitoring();

		if (result.samiti) {
			k.onStatusChange((agentId: string, oldStatus: string, newStatus: string) => {
				try {
					result.samiti!.broadcast("#alerts", {
						sender: "kaala-brahma",
						severity: newStatus === "error" ? "warning" as const : "info" as const,
						category: "lifecycle",
						content: `Agent ${agentId}: ${oldStatus} → ${newStatus}`,
					});
				} catch { /* best-effort */ }
			});
		}
	} catch { /* optional */ }
}

async function wireTrigunaActuator(result: ApiWiringResult): Promise<void> {
	try {
		const { TrigunaActuator } = await import("@chitragupta/anina");
		new TrigunaActuator(
			(result.kaala as unknown as import("@chitragupta/anina").KaalaLifecycle) ?? null,
			result.samiti ?? null,
		);
	} catch { /* optional */ }
}

async function wireLokapala(result: ApiWiringResult): Promise<void> {
	try {
		const { LokapalaController } = await import("@chitragupta/anina");
		result.lokapala = new LokapalaController() as unknown as AgentConfig["lokapala"];
	} catch { /* optional */ }
}

async function wireRtaEngine(result: ApiWiringResult): Promise<void> {
	try {
		const { RtaEngine } = await import("@chitragupta/dharma");
		result.rtaEngine = new RtaEngine() as unknown as { persistAuditLog?: (db: unknown) => void };
	} catch { /* optional */ }
}

async function wireNidraDaemon(result: ApiWiringResult, projectPath: string): Promise<void> {
	try {
		const { NidraDaemon } = await import("@chitragupta/anina");
		const nidra = new NidraDaemon({ project: projectPath });
		result.nidraDaemon = nidra as unknown as typeof result.nidraDaemon;
		result.nidraDaemon!.start();

		nidra.onDream(async (progress) => {
			try {
				const { ConsolidationEngine } = await import("@chitragupta/smriti");
				progress("REPLAY", 0.1);
				const consolidator = new ConsolidationEngine();
				consolidator.load();
				progress("RECOMBINE", 0.3);
				const { listSessions: ls, loadSession: ld } = await import("@chitragupta/smriti/session-store");
				const recentMetas = ls(projectPath).slice(0, 5);
				const recentSessions: Session[] = [];
				for (const meta of recentMetas) { try { const s = ld(meta.id, projectPath); if (s) recentSessions.push(s); } catch { /* skip */ } }
				if (recentSessions.length > 0) { progress("CRYSTALLIZE", 0.5); consolidator.consolidate(recentSessions); progress("PROCEDURALIZE", 0.7); consolidator.decayRules(); consolidator.pruneRules(); progress("COMPRESS", 0.9); consolidator.save(); }
				progress("COMPRESS", 1.0);
			} catch { /* best-effort */ }
		});

		nidra.onDeepSleep(async () => {
			try {
				const { DatabaseManager } = await import("@chitragupta/smriti");
				const dbm = DatabaseManager.instance();
				for (const dbName of ["agent", "graph", "vectors"] as const) { try { const db = dbm.get(dbName); db.pragma("wal_checkpoint(TRUNCATE)"); db.exec("VACUUM"); } catch { /* best-effort */ } }
				try { dbm.get("agent").exec(`INSERT INTO turns_fts(turns_fts) VALUES('optimize')`); } catch { /* best-effort */ }
				try { dbm.get("agent").exec(`DELETE FROM consolidation_log WHERE rowid NOT IN (SELECT rowid FROM consolidation_log ORDER BY created_at DESC LIMIT 100)`); } catch { /* best-effort */ }
				if (result.rtaEngine?.persistAuditLog) { try { result.rtaEngine.persistAuditLog(dbm.get("agent")); } catch { /* best-effort */ } }
			} catch { /* best-effort */ }
		});
	} catch { /* optional */ }
}
