/**
 * @chitragupta/cli — Session handling and mode launch extracted from main.ts.
 *
 * Contains:
 *   - Session continuation/resume logic
 *   - Pratyabhijna recognition on session start
 *   - Interactive mode launch with full options wiring
 *   - Print mode launch with session persistence
 *   - Post-session consolidation (Samskaara)
 *   - Turiya state persistence
 *   - Cleanup/shutdown orchestration
 *   - replaySessionIntoAgent helper
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

import {
	getChitraguptaHome,
	createLogger,
} from "@chitragupta/core";
import type { AgentProfile, BudgetConfig, ThinkingLevel } from "@chitragupta/core";

import type { MargaPipeline } from "@chitragupta/swara";
import type { TuriyaRouter } from "@chitragupta/swara";
import type { Manas } from "@chitragupta/anina";
import { Agent } from "@chitragupta/anina";
import type { AgentConfig, AgentMessage } from "@chitragupta/anina";

import {
	createSession,
	listSessions,
	loadSession,
	addTurn,
} from "@chitragupta/smriti/session-store";
import type { Session } from "@chitragupta/smriti/types";

import type { ProviderRegistry } from "@chitragupta/swara/provider-registry";

import type { ProjectInfo } from "./project-detector.js";
import { runInteractiveMode } from "./modes/interactive.js";
import { runPrintMode } from "./modes/print.js";

import type { TuiWiringResult } from "./main-tui-wiring.js";

const log = createLogger("cli:main-session");

/** Params for session resolution. */
export interface SessionResolveParams {
	projectPath: string;
	profile: AgentProfile;
	modelId: string;
	agent: Agent;
	args: {
		continue?: boolean;
		resume?: boolean;
		prompt?: string;
	};
}

/**
 * Resolve or create a session based on CLI flags.
 *
 * Handles --continue (resume most recent), --resume (show picker),
 * and default (create new).
 */
export function resolveSession(params: SessionResolveParams): Session {
	const { projectPath, profile, modelId, agent, args } = params;

	if (args.continue) {
		const sessions = listSessions(projectPath);
		if (sessions.length > 0) {
			try {
				const session = loadSession(sessions[0].id, projectPath);
				replaySessionIntoAgent(agent, session);
				return session;
			} catch {
				process.stderr.write(`\nWarning: Could not load last session. Starting fresh.\n\n`);
			}
		}
	} else if (args.resume) {
		const sessions = listSessions(projectPath);
		if (sessions.length === 0) {
			process.stderr.write(`\nNo sessions found. Starting a new session.\n\n`);
		} else {
			process.stdout.write(`\nRecent sessions:\n\n`);
			const showCount = Math.min(sessions.length, 10);
			for (let i = 0; i < showCount; i++) {
				const s = sessions[i];
				process.stdout.write(`  ${i + 1}. ${s.title} (${s.id}) — ${s.updated}\n`);
			}
			process.stdout.write(`\nContinuing most recent session: ${sessions[0].title}\n\n`);

			try {
				const session = loadSession(sessions[0].id, projectPath);
				replaySessionIntoAgent(agent, session);
				return session;
			} catch {
				process.stderr.write(`\nWarning: Could not load session. Starting fresh.\n\n`);
			}
		}
	}

	return createSession({
		project: projectPath,
		agent: profile.id,
		model: modelId,
		title: args.prompt ? args.prompt.slice(0, 60) : "New Session",
	});
}

/**
 * Run Pratyabhijna (self-recognition) on session start.
 */
export async function runPratyabhijna(
	agent: Agent,
	sessionId: string,
	projectPath: string,
): Promise<void> {
	try {
		const { Pratyabhijna: PratyabhijnaCls } = await import("@chitragupta/anina");
		const { DatabaseManager } = await import("@chitragupta/smriti");

		const pratyabhijna = new PratyabhijnaCls();
		const agentAny = agent as unknown as Record<string, (...a: unknown[]) => unknown>;
		const chetana = typeof agentAny.getChetana === "function" ? agentAny.getChetana() : undefined;
		const db = DatabaseManager.instance();
		const ctx = pratyabhijna.recognize(
			sessionId, projectPath, db,
			chetana as Parameters<typeof pratyabhijna.recognize>[3],
		);

		log.info(`Pratyabhijna: recognized self in ${ctx.warmupMs.toFixed(1)}ms`, {
			globalVasanas: ctx.globalVasanas.length,
			projectVasanas: ctx.projectVasanas.length,
			samskaras: ctx.activeSamskaras.length,
		});
	} catch {
		// Pratyabhijna recognition is best-effort
	}
}

/** Options for launching interactive mode with full wiring. */
export interface LaunchInteractiveParams {
	agent: Agent;
	profile: AgentProfile;
	project: ProjectInfo;
	session: Session;
	modelId: string;
	projectPath: string;
	args: { prompt?: string; model?: string };
	wiring: TuiWiringResult;
	margaPipeline?: MargaPipeline;
	turiyaRouter?: TuriyaRouter;
	manas?: Manas;
	registry: ProviderRegistry;
	settings: { budget?: BudgetConfig };
}

/**
 * Launch interactive mode with all infrastructure wired in.
 */
export async function launchInteractiveMode(params: LaunchInteractiveParams): Promise<void> {
	const { agent, profile, project, session, modelId, projectPath, args, wiring, margaPipeline, turiyaRouter, manas, registry, settings } = params;

	await runInteractiveMode({
		agent, profile, project,
		initialPrompt: args.prompt,
		budgetConfig: settings.budget,
		session: { id: session.meta.id, project: projectPath },
		margaPipeline,
		turiyaRouter: turiyaRouter as Parameters<typeof runInteractiveMode>[0]["turiyaRouter"],
		manas,
		soulManager: wiring.soulManager,
		reflector: wiring.reflector,
		providerRegistry: registry,
		userExplicitModel: Boolean(args.model),
		shiksha: wiring.shikshaController,
		memoryBridge: wiring.memoryBridge,
		kaala: wiring.kaala ? {
			getTree: () => {
				try {
					const health = wiring.kaala!.getTreeHealth();
					return health.agents.map((a) => ({
						agentId: a.id, status: a.status, depth: a.depth,
						parentId: a.parentId, purpose: a.purpose,
						lastBeatAge: a.lastBeatAge, tokenUsage: a.tokenUsage,
						tokenBudget: a.tokenBudget,
					}));
				} catch { return []; }
			},
		} : undefined,
		vidyaOrchestrator: wiring.vidyaOrchestrator as Parameters<typeof runInteractiveMode>[0]["vidyaOrchestrator"],
		nidraDaemon: wiring.nidraDaemon ? {
			snapshot: () => wiring.nidraDaemon!.snapshot(),
			wake: () => wiring.nidraDaemon!.wake(),
		} : undefined,
		onTurnComplete: (userMsg, assistantMsg) => {
			if (wiring.nidraDaemon) { try { wiring.nidraDaemon.touch(); } catch { /* best-effort */ } }
			try {
				addTurn(session.meta.id, projectPath, { turnNumber: 0, role: "user", content: userMsg, agent: profile.id, model: modelId })
					.catch((e) => { log.debug("user turn save failed", { error: String(e) }); });
				const lastMsg = agent.getMessages().at(-1);
				const contentParts = lastMsg?.role === "assistant" ? lastMsg.content as unknown as Array<Record<string, unknown>> : undefined;
				addTurn(session.meta.id, projectPath, { turnNumber: 0, role: "assistant", content: assistantMsg, contentParts, agent: profile.id, model: modelId })
					.catch((e) => { log.debug("assistant turn save failed", { error: String(e) }); });
			} catch { /* best-effort */ }
			if (wiring.checkpointManager && session) {
				try {
					wiring.checkpointManager.save(session.meta.id, {
						version: 1, sessionId: session.meta.id, turns: [...agent.getMessages()],
						metadata: { model: modelId, profile: profile.id }, timestamp: Date.now(),
					}).catch((e) => { log.debug("checkpoint save failed", { error: String(e) }); });
				} catch { /* best-effort */ }
			}
		},
	});
}

/** Params for launching print mode. */
export interface LaunchPrintParams {
	agent: Agent;
	profile: AgentProfile;
	session: Session;
	modelId: string;
	projectPath: string;
	prompt: string;
	wiring: TuiWiringResult;
	shutdownAll: () => Promise<void>;
}

/**
 * Launch print mode, save results, and exit.
 */
export async function launchPrintMode(params: LaunchPrintParams): Promise<void> {
	const { agent, profile, session, modelId, projectPath, wiring, shutdownAll } = params;
	let printPrompt = params.prompt;

	// Smaran: inject recalled memories
	if (wiring.memoryBridge) {
		try {
			const memResponse = wiring.memoryBridge.handleMemoryCommand(printPrompt, session.meta.id);
			if (memResponse !== null) {
				process.stdout.write(memResponse + "\n");
				await shutdownAll();
				process.exit(0);
			}
			const recallContext = wiring.memoryBridge.recallForQuery(printPrompt);
			if (recallContext) {
				printPrompt = `[Recalled memories]\n${recallContext}\n\n[User message]\n${printPrompt}`;
			}
		} catch { /* best-effort */ }
	}

	const exitCode = await runPrintMode({ agent, prompt: printPrompt });

	// Save print-mode result to session
	try {
		await addTurn(session.meta.id, projectPath, { turnNumber: 0, role: "user", content: params.prompt, agent: profile.id, model: modelId });
		const lastMsg = agent.getMessages().at(-1);
		if (lastMsg) {
			const text = lastMsg.content.filter((p: { type: string }): p is { type: "text"; text: string } => p.type === "text").map((p: { type: "text"; text: string }) => p.text).join("");
			const contentParts = lastMsg.role === "assistant" ? lastMsg.content as unknown as Array<Record<string, unknown>> : undefined;
			await addTurn(session.meta.id, projectPath, { turnNumber: 0, role: "assistant", content: text, contentParts, agent: profile.id, model: modelId });
		}
	} catch { /* best-effort */ }

	await shutdownAll();
	process.exit(exitCode);
}

/**
 * Run post-session hooks: Turiya state persistence, Samskaara consolidation,
 * and Svapna dream-cycle consolidation (fire-and-forget).
 */
export async function runPostSessionHooks(
	turiyaRouter: TuriyaRouter | undefined,
	projectPath: string,
): Promise<void> {
	// Persist Turiya state
	if (turiyaRouter) {
		try {
			const turiyaStatePath = path.join(getChitraguptaHome(), "turiya-state.json");
			fs.writeFileSync(turiyaStatePath, JSON.stringify(turiyaRouter.serialize()), "utf8");
			const stats = turiyaRouter.getStats();
			if (stats.totalRequests > 0) {
				log.info("Turiya state saved", { requests: stats.totalRequests, savings: `${stats.savingsPercent.toFixed(1)}%` });
			}
		} catch { /* best-effort */ }
	}

	// Samskaara consolidation (synchronous, bounded by timeout)
	const CONSOLIDATION_TIMEOUT_MS = 5_000;
	try {
		const consolidationWork = async () => {
			const { ConsolidationEngine } = await import("@chitragupta/smriti");
			const consolidator = new ConsolidationEngine();
			consolidator.load();
			const recentMetas = listSessions(projectPath).slice(0, 5);
			const recentSessions: Session[] = [];
			for (const meta of recentMetas) { try { const s = loadSession(meta.id, projectPath); if (s) recentSessions.push(s); } catch { /* skip */ } }
			if (recentSessions.length > 0) {
				const result = consolidator.consolidate(recentSessions);
				consolidator.decayRules();
				consolidator.pruneRules();
				consolidator.save();
				if (result.newRules.length > 0) {
					process.stderr.write(`\n  \u2726 Samskaara: Learned ${result.newRules.length} new rule${result.newRules.length > 1 ? "s" : ""} from this session.\n`);
				}
			}
		};
		await Promise.race([consolidationWork(), new Promise<void>((resolve) => setTimeout(resolve, CONSOLIDATION_TIMEOUT_MS))]);
	} catch { /* best-effort */ }

	// Svapna dream-cycle consolidation (fire-and-forget, non-blocking).
	// Runs the 5-phase cycle (replay, recombine, crystallize, proceduralize, compress)
	// in the background so session exit is never delayed.
	triggerSvapnaConsolidation(projectPath);
}

/**
 * Fire-and-forget Svapna (dream-cycle) consolidation.
 *
 * Spawns the 5-phase consolidation asynchronously via setImmediate so it
 * does not block the caller. The returned timer is unref'd so Node can
 * exit even if the cycle is still running.
 *
 * @param projectPath - The project directory to consolidate sessions for.
 */
export function triggerSvapnaConsolidation(projectPath: string): void {
	const timer = setTimeout(() => {
		(async () => {
			try {
				const { SvapnaConsolidation } = await import("@chitragupta/smriti");
				const svapna = new SvapnaConsolidation({ project: projectPath });
				const result = await svapna.run();
				log.info("Svapna consolidation complete", {
					cycleId: result.cycleId,
					durationMs: Math.round(result.totalDurationMs),
					vasanas: result.phases.crystallize.vasanasCreated,
					vidhis: result.phases.proceduralize.vidhisCreated,
				});
			} catch (err) {
				log.debug("Svapna consolidation failed (best-effort)", {
					error: err instanceof Error ? err.message : String(err),
				});
			}
		})();
	}, 0);
	// unref so the timer does not keep the process alive
	timer.unref();
}

/**
 * Build the shutdown function that cleans up all resources.
 */
export function buildShutdownFn(
	agent: Agent,
	wiring: TuiWiringResult,
): () => Promise<void> {
	return async () => {
		for (const fn of wiring.mcpSkillWatcherCleanups) { try { fn(); } catch { /* best-effort */ } }
		if (wiring.nidraDaemon) { try { await wiring.nidraDaemon.stop(); } catch { /* best-effort */ } }
		if (wiring.rtaEngine) {
			try { const { DatabaseManager } = await import("@chitragupta/smriti"); wiring.rtaEngine.persistAuditLog(DatabaseManager.instance().get("agent")); } catch { /* best-effort */ }
		}
		try { agent.dispose(); } catch { /* best-effort */ }
		wiring.sandeshaRouter?.destroy();
		wiring.commHubDestroy?.();
		wiring.actorSystemShutdown?.();
		wiring.kaala?.dispose();
		wiring.messageBus?.destroy();
		if (wiring.mcpShutdown) await wiring.mcpShutdown();
	};
}

/**
 * Replay session turns into the agent's state to resume a conversation.
 *
 * Converts each session turn into an AgentMessage and pushes it into
 * the agent's internal message history.
 */
export function replaySessionIntoAgent(agent: Agent, session: Session): void {
	for (const turn of session.turns) {
		const role = turn.role === "user" ? "user" : "assistant";
		const content = turn.contentParts?.length
			? turn.contentParts
			: [{ type: "text" as const, text: turn.content }];

		agent.pushMessage({
			id: crypto.randomUUID(),
			role: role as "user" | "assistant",
			content: content as unknown as AgentMessage["content"],
			timestamp: Date.now(),
			agentId: turn.agent,
			model: turn.model,
		});
	}
}
