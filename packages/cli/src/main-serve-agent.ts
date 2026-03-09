/**
 * @chitragupta/cli — Serve-mode server agent construction.
 */

import type { AgentConfig, ToolHandler } from "@chitragupta/anina";
import { Agent } from "@chitragupta/anina";
import type { AgentProfile, ChitraguptaSettings } from "@chitragupta/core";
import { createLogger, DEFAULT_FALLBACK_MODEL } from "@chitragupta/core";
import type { ProviderDefinition } from "@chitragupta/swara";
import { getAllTools } from "@chitragupta/yantra";
import type { ProjectInfo } from "./project-detector.js";
import { loadProjectMemory } from "./bootstrap.js";
import { loadContextFiles } from "./context-files.js";
import { buildSystemPrompt } from "./personality.js";
import { createDaemonBackedMemoryBridge } from "./runtime-daemon-memory-bridge.js";
import { createToolNotFoundResolver, createSabhaProvider } from "./shared-factories.js";
import {
	wireSkillGapRecorder,
	resolveLearningPersistPath,
	createTrigunaHandler,
	enrichFromTranscendence,
	wireBuddhiRecorder,
	enrichFromVasana,
} from "./nervous-system-wiring.js";
import type { ServePhaseModules } from "./main-serve-types.js";

const log = createLogger("cli:main-serve-agent");

export interface CreateServerAgentParams {
	servResolved: { providerId: string; provider: ProviderDefinition };
	profile: AgentProfile;
	settings: ChitraguptaSettings;
	project: ProjectInfo;
	projectPath: string;
	modules: ServePhaseModules;
	args: { model?: string };
	sessionIdResolver?: () => string | undefined;
}

export interface ServerAgentRefs {
	kaalaRef?: { dispose(): void };
	actorShutdownRef?: () => void;
	commHubDestroyRef?: () => void;
}

/** Create the server agent with full mesh infrastructure. */
export async function createServerAgent(params: CreateServerAgentParams): Promise<{ result: Agent; refs: ServerAgentRefs }> {
	const { servResolved, profile, settings, project, projectPath, modules, args } = params;
	const { providerId, provider } = servResolved;
	const modelId = args.model ?? profile.preferredModel ?? settings.defaultModel ?? DEFAULT_FALLBACK_MODEL;
	const tools = getAllTools();
	const memoryBridge = createDaemonBackedMemoryBridge({
		enabled: true,
		project: projectPath,
		enableSmaran: true,
		identityPath: projectPath,
	});

	const contextFiles = loadContextFiles(projectPath);
	const projectMemory = loadProjectMemory(projectPath);
	const bridgedMemory = await memoryBridge.loadMemoryContext(projectPath, "serve");
	const memory = projectMemory && bridgedMemory
		? `${projectMemory}\n\n${bridgedMemory}`
		: bridgedMemory || projectMemory;
	let systemPrompt = buildSystemPrompt({ profile, project, contextFiles, memoryContext: memory ?? undefined, tools });

	systemPrompt += await enrichFromVasana(modules.vasanaEngine, projectPath);
	systemPrompt += await enrichFromTranscendence(projectPath);

	const { createPolicyAdapter, createMeshInfrastructure } = await import("./shared-factories.js");
	const mesh = await createMeshInfrastructure();

	let commHub: AgentConfig["commHub"];
	let commHubDestroy: (() => void) | undefined;
	try {
		const { CommHub } = await import("@chitragupta/sutra");
		const h = new CommHub({ enableLogging: false });
		commHub = h as unknown as AgentConfig["commHub"];
		commHubDestroy = () => h.destroy();
	} catch {
		/* best-effort */
	}

	const policyEngine = await createPolicyAdapter({ sessionId: "coding-serve", agentId: "kartru", projectPath });
	const skillGapFn = wireSkillGapRecorder(modules.servAkasha, modules.servVidyaOrchestrator);
	const buddhiFn = wireBuddhiRecorder(
		modules.servBuddhi,
		modules.servDatabase,
		projectPath,
		params.sessionIdResolver,
	);
	const trigunaFn = await createTrigunaHandler(mesh.kaala as AgentConfig["kaala"], modules.servSamiti);

	const agentConfig: AgentConfig = {
		profile,
		providerId,
		model: modelId,
		tools,
		systemPrompt,
		thinkingLevel: profile.preferredThinking ?? settings.thinkingLevel ?? "medium",
		workingDirectory: projectPath,
		policyEngine,
		commHub,
		actorSystem: mesh.actorSystem,
		samiti: modules.servSamiti as unknown as import("@chitragupta/anina").MeshSamiti | undefined,
		lokapala: modules.servLokapala as unknown as import("@chitragupta/anina").LokapalaGuardians | undefined,
		kaala: mesh.kaala as unknown as AgentConfig["kaala"],
		enableLearning: true,
		enableAutonomy: true,
		enableMemory: true,
		memoryBridge,
		chetanaConfig: { triguna: { enabled: true } },
		project: projectPath,
		onSkillGap: skillGapFn,
		learningPersistPath: resolveLearningPersistPath(projectPath),
		onEvent: buddhiFn || trigunaFn ? (ev: string, data: unknown) => {
			buddhiFn?.(ev, data);
			trigunaFn?.(ev, data);
		} : undefined,
		onToolNotFound: createToolNotFoundResolver({
			tools,
			vidyaOrchestrator: modules.servVidyaOrchestrator as
				| { bridge?: { getSkillForTool(toolName: string): { name: string } | null }; recommend?(query: string): Array<{ skill?: { name?: string }; score?: number }> }
				| undefined,
			onGap: skillGapFn,
		}),
	};

	const agent = new Agent(agentConfig);
	agent.setProvider(provider);

	if (mesh.kaala) {
		try {
			(mesh.kaala as unknown as { registerAgent(info: Record<string, unknown>): void }).registerAgent({
				agentId: agent.id,
				lastBeat: Date.now(),
				startedAt: Date.now(),
				turnCount: 0,
				tokenUsage: 0,
				status: "alive",
				parentId: null,
				depth: 0,
				purpose: "HTTP server agent",
				tokenBudget: 200_000,
			});
			(mesh.kaala as unknown as { startMonitoring(): void }).startMonitoring();
			if (modules.servSamiti) {
				(
					mesh.kaala as unknown as { onStatusChange(cb: (id: string, o: string, n: string) => void): () => void }
				).onStatusChange((id, o, n) => {
					try {
						(modules.servSamiti as unknown as { broadcast(ch: string, msg: Record<string, unknown>): void }).broadcast(
							"#alerts",
							{
								sender: "kaala-brahma",
								severity: n === "error" ? "warning" : "info",
								category: "lifecycle",
								content: `Agent ${id}: ${o} → ${n}`,
							},
						);
					} catch {
						/* best-effort */
					}
				});
			}
		} catch {
			/* best-effort */
		}
	}

	if (modules.servNidraDaemon) {
		try {
			(modules.servNidraDaemon as { onDeepSleep(cb: () => Promise<void>): void }).onDeepSleep(async () => {
				try {
					const { DatabaseManager } = await import("@chitragupta/smriti");
					const dbm = DatabaseManager.instance();
					for (const dbName of ["agent", "graph", "vectors"] as const) {
						try {
							const d = dbm.get(dbName);
							d.pragma("wal_checkpoint(TRUNCATE)");
							d.exec("VACUUM");
						} catch {
							/* best-effort */
						}
					}
					try {
						dbm.get("agent").exec(`INSERT INTO turns_fts(turns_fts) VALUES('optimize')`);
					} catch {
						/* best-effort */
					}
					try {
						dbm.get("agent").exec(`DELETE FROM consolidation_log WHERE rowid NOT IN (SELECT rowid FROM consolidation_log ORDER BY created_at DESC LIMIT 100)`);
					} catch {
						/* best-effort */
					}
				} catch {
					/* best-effort */
				}
			});
		} catch {
			/* best-effort */
		}
	}

	log.info("Server agent created", { providerId, model: modelId });

	return {
		result: agent,
		refs: {
			kaalaRef: mesh.kaala ? (mesh.kaala as unknown as { dispose(): void }) : undefined,
			actorShutdownRef: mesh.actorSystemShutdown,
			commHubDestroyRef: commHubDestroy,
		},
	};
}
