/**
 * @chitragupta/cli — TUI mode infrastructure wiring extracted from main.ts.
 *
 * Wires optional subsystems for interactive (TUI) mode:
 *   - MCP tools, vidhya-skills, dharma policy engine
 *   - CommHub, ActorSystem, Samiti, Lokapala, SandeshaRouter
 *   - KaalaBrahma, TrigunaActuator, NidraDaemon
 *   - SoulManager, AgentReflector, KarmaTracker
 *   - MessageBus, CheckpointManager, ApprovalGate
 */

import fs from "fs";
import path from "path";

import {
	getChitraguptaHome,
	createLogger,
} from "@chitragupta/core";
import type { AgentProfile, ThinkingLevel } from "@chitragupta/core";

import { KaalaBrahma } from "@chitragupta/anina";
import { SoulManager } from "@chitragupta/anina";
import { AgentReflector } from "@chitragupta/anina";
import type { MemoryBridge } from "@chitragupta/anina";
import type { AgentConfig, ToolHandler } from "@chitragupta/anina";

import { ApprovalGate } from "@chitragupta/dharma";
import { KarmaTracker } from "@chitragupta/dharma";
import { CheckpointManager } from "@chitragupta/smriti";
import { MessageBus } from "@chitragupta/sutra";
import { CommHub } from "@chitragupta/sutra";

import type { Session } from "@chitragupta/smriti/types";
import {
	listSessions,
	loadSession,
} from "@chitragupta/smriti/session-store";

import { getAllTools } from "@chitragupta/yantra";

import {
	getBuiltinTools,
	createEmbeddingProviderInstance,
	loadProjectMemory,
} from "./bootstrap.js";
import { allowLocalRuntimeFallback, createDaemonNidraProxy, type DaemonNidraProxyLike } from "./runtime-daemon-proxies.js";
import { createDaemonBackedMemoryBridge } from "./runtime-daemon-memory-bridge.js";
import { resolveAgentLimits } from "./agent-limits.js";

const log = createLogger("cli:main-tui");

/** Result of TUI infrastructure wiring. */
export interface TuiWiringResult {
	tools: ToolHandler[];
	mcpShutdown?: () => Promise<void>;
	skillContext?: string;
	shikshaController?: {
		detectGap(q: string, m: Array<{ score: number }>): boolean;
		learn(q: string): Promise<{
			success: boolean; executed: boolean; executionOutput?: string;
			skill?: { manifest: { name: string } }; autoApproved: boolean;
			quarantineId?: string; durationMs: number; error?: string;
		}>;
	};
	vidyaOrchestrator?: import("@chitragupta/vidhya-skills").VidyaOrchestrator;
	mcpSkillWatcherCleanups: Array<() => void>;
	policyAdapter?: AgentConfig["policyEngine"];
	rtaEngine?: import("@chitragupta/dharma").RtaEngine;
	commHub?: CommHub;
	commHubDestroy?: () => void;
	actorSystem?: import("@chitragupta/anina").MeshActorSystem;
	actorSystemShutdown?: () => void;
	samiti?: import("@chitragupta/anina").MeshSamiti;
	lokapala?: import("@chitragupta/anina").LokapalaGuardians;
	sandeshaRouter?: { destroy(): void };
	kaala?: InstanceType<typeof KaalaBrahma>;
	trigunaActuator?: import("@chitragupta/anina").TrigunaActuator;
	nidraDaemon?: DaemonNidraProxyLike;
	soulManager?: InstanceType<typeof SoulManager>;
	soulPrompt?: string;
	reflector?: InstanceType<typeof AgentReflector>;
	karmaTracker?: InstanceType<typeof KarmaTracker>;
	messageBus?: InstanceType<typeof MessageBus>;
	checkpointManager?: InstanceType<typeof CheckpointManager>;
	approvalGate?: InstanceType<typeof ApprovalGate>;
	memoryContext?: string;
	memoryBridge?: MemoryBridge;
	identityContext?: string;
}

/**
 * Wire all optional infrastructure for TUI (interactive) mode.
 *
 * Each subsystem is best-effort: failure to initialize one does not
 * block the others.
 */
export async function wireTuiInfrastructure(
	projectPath: string,
	profile: AgentProfile,
	noMemory?: boolean,
): Promise<TuiWiringResult> {
	const result: TuiWiringResult = {
		tools: getBuiltinTools(),
		mcpSkillWatcherCleanups: [],
	};

	void import("./modes/mcp-subsystems.js")
		.then(({ primeLucyScarlettRuntime }) => primeLucyScarlettRuntime())
		.catch(() => {
			// Best-effort: daemon-backed Lucy/Scarlett bridge should not block startup.
		});

	// ── MCP tools ──
	await wireMcpTools(result);

	// ── Vidhya-skills ──
	await wireVidhyaSkills(result, projectPath);

	// ── Dharma policy engine ──
	await wirePolicyEngine(result, projectPath);

	// ── RtaEngine ──
	await wireRtaEngine(result);

	// ── CommHub ──
	await wireCommHub(result);

	// ── ActorSystem ──
	await wireActorSystem(result);

	// ── Samiti ──
	await wireSamiti(result);

	// ── Lokapala ──
	await wireLokapala(result);

	// ── SandeshaRouter ──
	await wireSandeshaRouter(result);

	// ── KaalaBrahma ──
	wireKaalaBrahma(result);

	// ── TrigunaActuator ──
	await wireTrigunaActuator(result);

	// ── NidraDaemon ──
	await wireNidraDaemon(result, projectPath);

	// ── SoulManager ──
	wireSoulManager(result, profile);

	// ── AgentReflector ──
	wireAgentReflector(result);

	// ── KarmaTracker ──
	wireKarmaTracker(result);

	// ── MessageBus ──
	wireMessageBus(result);

	// ── CheckpointManager ──
	wireCheckpointManager(result);

	// ── ApprovalGate ──
	wireApprovalGate(result);

	// ── Memory ──
	await wireMemory(result, projectPath, noMemory);

	return result;
}

// ─── Individual wiring functions ────────────────────────────────────────────

async function wireMcpTools(result: TuiWiringResult): Promise<void> {
	try {
		const { loadMCPConfig, startMCPServers, importMCPTools, shutdownMCPServers } =
			await import("./mcp-loader.js");
		const mcpConfigs = loadMCPConfig();
		if (mcpConfigs.length > 0) {
			const registry = await startMCPServers(mcpConfigs);
			const mcpTools = importMCPTools(registry);
			for (const mcpTool of mcpTools) {
				result.tools.push(mcpTool as unknown as ToolHandler);
			}
			result.mcpShutdown = shutdownMCPServers;
		}
	} catch {
		// MCP loading is optional
	}
}

async function wireVidhyaSkills(result: TuiWiringResult, projectPath: string): Promise<void> {
	try {
		const {
			SkillRegistry, VidyaBridge, SurakshaScanner,
			SkillPipeline, SkillSandbox, PratikshaManager,
			ShikshaController, VidyaOrchestrator,
		} = await import("@chitragupta/vidhya-skills");

		const skillRegistry = new SkillRegistry();
		const bridge = new VidyaBridge(skillRegistry);
		const toolDefs = result.tools.map((t) => ({
			name: t.definition.name,
			description: t.definition.description,
			inputSchema: t.definition.inputSchema as Record<string, unknown>,
		}));
		bridge.registerToolsAsSkills(toolDefs);

		try {
			const { loadSkillTiers } = await import("./shared-factories.js");
			const tierResult = await loadSkillTiers({ projectPath, skillRegistry });
			result.mcpSkillWatcherCleanups.push(...tierResult.watcherCleanups);
		} catch { /* best-effort */ }

			let scanner: InstanceType<typeof SurakshaScanner> | undefined;
			try {
				scanner = new SurakshaScanner();
				const sandbox = new SkillSandbox();
				const staging = new PratikshaManager();
				const pipeline = new SkillPipeline({ scanner, sandbox, staging, registry: skillRegistry });
				result.shikshaController = new ShikshaController({ registry: skillRegistry, pipeline, scanner });
			} catch (err) {
				log.warn("Shiksha pipeline wiring failed; autonomous learning is disabled", {
					error: err instanceof Error ? err.message : String(err),
				});
			}

		const stateDir = projectPath ? (await import("node:path")).join(projectPath, ".chitragupta") : undefined;
			result.vidyaOrchestrator = new VidyaOrchestrator(
				{
					registry: skillRegistry,
					bridge,
					scanner: scanner as ConstructorParameters<typeof VidyaOrchestrator>[0]["scanner"],
					shiksha: result.shikshaController as ConstructorParameters<typeof VidyaOrchestrator>[0]["shiksha"],
				},
				{
					persistPath: stateDir ? `${stateDir}/vidya-state.json` : undefined,
					enableAutoLearn: Boolean(result.shikshaController),
					enableAutoComposition: true,
				},
			);
		await result.vidyaOrchestrator.initialize();

		if (skillRegistry.size > 0) {
			const skillLines: string[] = ["## Skill Discovery", "", `${skillRegistry.size} skills registered via Trait Vector Matching (TVM).`, "Skills are auto-matched to tasks by semantic fingerprinting — no need to memorize exact tool names."];
			const allSkills = skillRegistry.getAll();
			const tagCounts = new Map<string, number>();
			for (const skill of allSkills) { for (const tag of skill.tags) { tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1); } }
			const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag, count]) => `${tag} (${count})`);
			if (topTags.length > 0) { skillLines.push("", `Skill domains: ${topTags.join(", ")}`); }
			result.skillContext = skillLines.join("\n");
		}
	} catch (e) {
		log.debug("vidhya-skills unavailable", { error: String(e) });
	}
}

async function wirePolicyEngine(result: TuiWiringResult, projectPath: string): Promise<void> {
	try {
		const { createPolicyAdapter } = await import("./shared-factories.js");
		result.policyAdapter = await createPolicyAdapter({ sessionId: "cli", agentId: "root", projectPath });
	} catch (e) { log.debug("Dharma policy engine unavailable", { error: String(e) }); }
}

async function wireRtaEngine(result: TuiWiringResult): Promise<void> {
	try {
		const { RtaEngine } = await import("@chitragupta/dharma");
		result.rtaEngine = new RtaEngine();
	} catch { /* best-effort */ }
}

async function wireCommHub(result: TuiWiringResult): Promise<void> {
	try {
		result.commHub = new CommHub({ enableLogging: false });
		result.commHubDestroy = () => result.commHub!.destroy();
	} catch (e) { log.debug("CommHub unavailable", { error: String(e) }); }
}

async function wireActorSystem(result: TuiWiringResult): Promise<void> {
	try {
		const { ensureSharedMeshRuntime } = await import("./shared-mesh-runtime.js");
		const system = await ensureSharedMeshRuntime();
		result.actorSystem = system as unknown as import("@chitragupta/anina").MeshActorSystem;
	} catch (e) { log.debug("ActorSystem unavailable", { error: String(e) }); }
}

async function wireSamiti(result: TuiWiringResult): Promise<void> {
	try {
		const { Samiti } = await import("@chitragupta/sutra");
		result.samiti = new Samiti() as unknown as import("@chitragupta/anina").MeshSamiti;
	} catch (e) { log.debug("Samiti unavailable", { error: String(e) }); }
}

async function wireLokapala(result: TuiWiringResult): Promise<void> {
	try {
		const { LokapalaController } = await import("@chitragupta/anina");
		result.lokapala = new LokapalaController() as unknown as import("@chitragupta/anina").LokapalaGuardians;
	} catch (e) { log.debug("Lokapala unavailable", { error: String(e) }); }
}

async function wireSandeshaRouter(result: TuiWiringResult): Promise<void> {
	try {
		const { SandeshaRouter } = await import("@chitragupta/sutra");
		result.sandeshaRouter = new SandeshaRouter({ defaultTimeoutMs: 30_000, maxPendingRequests: 10, commHub: result.commHub });
	} catch (e) { log.debug("SandeshaRouter unavailable", { error: String(e) }); }
}

function wireKaalaBrahma(result: TuiWiringResult): void {
	try {
		const agentLimits = resolveAgentLimits();
		result.kaala = new KaalaBrahma({
			heartbeatInterval: 5000,
			staleThreshold: 30000,
			maxAgentDepth: agentLimits.maxDepth,
			maxSubAgents: agentLimits.maxSubAgents,
		});
		result.kaala.startMonitoring();
		if (result.samiti) {
			const samiti = result.samiti;
			result.kaala.onStatusChange((agentId, oldStatus, newStatus) => {
				try { samiti.broadcast("#alerts", { sender: "kaala-brahma", severity: newStatus === "error" ? "warning" : "info", category: "lifecycle", content: `Agent ${agentId}: ${oldStatus} → ${newStatus}` }); } catch { /* best-effort */ }
			});
		}
	} catch (e) { log.debug("KaalaBrahma unavailable", { error: String(e) }); }
}

async function wireTrigunaActuator(result: TuiWiringResult): Promise<void> {
	try {
		const { TrigunaActuator } = await import("@chitragupta/anina");
		result.trigunaActuator = new TrigunaActuator(
			result.kaala as unknown as import("@chitragupta/anina").KaalaLifecycle | null ?? null,
			result.samiti ?? null,
		);
	} catch { /* best-effort */ }
}

async function wireNidraDaemon(result: TuiWiringResult, projectPath: string): Promise<void> {
	try {
		const { getNidraStatusViaDaemon } = await import("./modes/daemon-bridge.js");
		await getNidraStatusViaDaemon();
		result.nidraDaemon = createDaemonNidraProxy();
		return;
	} catch {
		// Fall through to local best-effort owner when daemon is unavailable.
	}
	if (!allowLocalRuntimeFallback()) return;
	try {
		const { NidraDaemon: NidraCls } = await import("@chitragupta/anina");
		result.nidraDaemon = new NidraCls({
			idleTimeoutMs: 300_000, dreamDurationMs: 600_000,
			deepSleepDurationMs: 1_800_000, project: projectPath,
		}) as unknown as DaemonNidraProxyLike;

		result.nidraDaemon.onDream(async (progress) => {
			try {
				const { ConsolidationEngine } = await import("@chitragupta/smriti");
				progress("REPLAY", 0.1);
				const consolidator = new ConsolidationEngine();
				consolidator.load();
				progress("RECOMBINE", 0.3);
				const recentMetas = listSessions(projectPath).slice(0, 5);
				const recentSessions: Session[] = [];
				for (const meta of recentMetas) { try { const s = loadSession(meta.id, projectPath); if (s) recentSessions.push(s); } catch { /* skip */ } }
				if (recentSessions.length > 0) { progress("CRYSTALLIZE", 0.5); consolidator.consolidate(recentSessions); progress("PROCEDURALIZE", 0.7); consolidator.decayRules(); consolidator.pruneRules(); progress("COMPRESS", 0.9); consolidator.save(); }
				progress("COMPRESS", 1.0);
			} catch { /* best-effort */ }
		});

		result.nidraDaemon.onDeepSleep(async () => {
			try {
				const { DatabaseManager } = await import("@chitragupta/smriti");
				const dbm = DatabaseManager.instance();
				for (const dbName of ["agent", "graph", "vectors"] as const) { try { const db = dbm.get(dbName); db.pragma("wal_checkpoint(TRUNCATE)"); db.exec("VACUUM"); } catch { /* best-effort */ } }
				try { dbm.get("agent").exec(`INSERT INTO turns_fts(turns_fts) VALUES('optimize')`); } catch { /* best-effort */ }
				try { dbm.get("agent").exec(`DELETE FROM consolidation_log WHERE rowid NOT IN (SELECT rowid FROM consolidation_log ORDER BY created_at DESC LIMIT 100)`); } catch { /* best-effort */ }
				if (result.rtaEngine) {
					try { const { RtaEngine } = await import("@chitragupta/dharma"); if (result.rtaEngine instanceof RtaEngine) { result.rtaEngine.persistAuditLog(dbm.get("agent")); } } catch { /* best-effort */ }
				}
				log.debug("Deep sleep maintenance complete");
			} catch { /* best-effort */ }
		});
	} catch (e) { log.debug("NidraDaemon unavailable", { error: String(e) }); }
}

function wireSoulManager(result: TuiWiringResult, profile: AgentProfile): void {
	try {
		result.soulManager = new SoulManager({ persist: true });
		const archetypeMap: Record<string, string> = {
			kartru: "meticulous-craftsman", parikshaka: "vigilant-guardian",
			anveshi: "curious-scholar", shodhaka: "curious-scholar",
			parikartru: "meticulous-craftsman", lekhaka: "creative-explorer",
		};
		result.soulManager.create({
			id: "root", name: profile.name ?? "Chitragupta",
			archetype: archetypeMap[profile.id] ?? "wise-mediator",
			purpose: profile.personality ?? "AI agent orchestration platform",
		});
		result.soulPrompt = result.soulManager.buildSoulPrompt("root");
	} catch (e) { log.debug("SoulManager unavailable", { error: String(e) }); }
}

function wireAgentReflector(result: TuiWiringResult): void {
	try { result.reflector = new AgentReflector(); } catch (e) { log.debug("AgentReflector unavailable", { error: String(e) }); }
}

function wireKarmaTracker(result: TuiWiringResult): void {
	try { result.karmaTracker = new KarmaTracker(); } catch (e) { log.debug("KarmaTracker unavailable", { error: String(e) }); }
}

function wireMessageBus(result: TuiWiringResult): void {
	try { result.messageBus = new MessageBus(); } catch (e) { log.debug("MessageBus unavailable", { error: String(e) }); }
}

function wireCheckpointManager(result: TuiWiringResult): void {
	try {
		const checkpointDir = path.join(getChitraguptaHome(), "checkpoints");
		if (!fs.existsSync(checkpointDir)) { fs.mkdirSync(checkpointDir, { recursive: true }); }
		result.checkpointManager = new CheckpointManager({ checkpointDir });
	} catch (e) { log.debug("CheckpointManager unavailable", { error: String(e) }); }
}

function wireApprovalGate(result: TuiWiringResult): void {
	try { result.approvalGate = new ApprovalGate({ defaultTimeout: 30000 }); } catch (e) { log.debug("ApprovalGate unavailable", { error: String(e) }); }
}

async function wireMemory(result: TuiWiringResult, projectPath: string, noMemory?: boolean): Promise<void> {
	if (noMemory) return;
	result.memoryContext = loadProjectMemory(projectPath);
	try {
		const embeddingProvider = await createEmbeddingProviderInstance();
		result.memoryBridge = createDaemonBackedMemoryBridge({
			enabled: true, project: projectPath, enableSmaran: true,
			identityPath: projectPath, enableGraphRAG: true,
			enableHybridSearch: true, embeddingProvider,
		});
	} catch { /* best-effort */ }
	if (result.memoryBridge) {
		try {
			const identityCtx = result.memoryBridge.getIdentityContext();
			if (identityCtx) { result.identityContext = identityCtx.load(); }
		} catch { /* best-effort */ }
	}
}
