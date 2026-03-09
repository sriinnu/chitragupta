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

import path from "path";
import crypto from "crypto";

import {
	createLogger,
} from "@chitragupta/core";
import type { AgentProfile, BudgetConfig, ThinkingLevel } from "@chitragupta/core";

import type { MargaPipeline } from "@chitragupta/swara";
import type { TuriyaRouter } from "@chitragupta/swara";
import type { Manas } from "@chitragupta/anina";
import { Agent } from "@chitragupta/anina";
import type { AgentConfig, AgentMessage } from "@chitragupta/anina";

import {
	listSessions,
	loadSession,
} from "@chitragupta/smriti/session-store";
import type { Session } from "@chitragupta/smriti/types";

import type { ProviderRegistry } from "@chitragupta/swara/provider-registry";

import type { ProjectInfo } from "./project-detector.js";
import { runInteractiveMode } from "./modes/interactive.js";
import { runPrintMode } from "./modes/print.js";
import { applyLucyLiveGuidance } from "./nervous-system-wiring.js";
import {
	addTurn as addTurnViaDaemon,
	createSession as createSessionViaDaemon,
	listSessions as listSessionsViaDaemon,
	showSession as showSessionViaDaemon,
} from "./modes/daemon-bridge.js";
import type { TuiWiringResult } from "./main-tui-wiring.js";
import {
	buildShutdownFn,
	runPostSessionHooks,
	triggerSwapnaConsolidation,
} from "./main-session-hooks.js";

export {
	buildShutdownFn,
	runPostSessionHooks,
	triggerSwapnaConsolidation,
} from "./main-session-hooks.js";

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
export async function resolveSession(params: SessionResolveParams): Promise<Session> {
	const { projectPath, profile, modelId, agent, args } = params;

	if (args.continue) {
		const sessions = await listSessionsViaDaemon(projectPath);
		if (sessions.length > 0) {
			try {
				const session = await showSessionViaDaemon(String(sessions[0].id), projectPath) as unknown as Session;
				replaySessionIntoAgent(agent, session);
				return session;
			} catch {
				process.stderr.write(`\nWarning: Could not load last session. Starting fresh.\n\n`);
			}
		}
	} else if (args.resume) {
		const sessions = await listSessionsViaDaemon(projectPath);
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
				const session = await showSessionViaDaemon(String(sessions[0].id), projectPath) as unknown as Session;
				replaySessionIntoAgent(agent, session);
				return session;
			} catch {
				process.stderr.write(`\nWarning: Could not load session. Starting fresh.\n\n`);
			}
		}
	}

	const created = await createSessionViaDaemon({
		project: projectPath,
		agent: profile.id,
		model: modelId,
		title: args.prompt ? args.prompt.slice(0, 60) : "New Session",
		metadata: {
			consumer: "chitragupta",
			surface: "cli",
			channel: "terminal",
			actorId: `cli:${process.pid}`,
			sessionReusePolicy: "isolated",
		},
	});
	return await showSessionViaDaemon(created.id, projectPath) as unknown as Session;
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
		onTurnComplete: async (userMsg, assistantMsg) => {
			if (wiring.nidraDaemon) { try { await Promise.resolve(wiring.nidraDaemon.touch()); } catch { /* best-effort */ } }
			try {
				await addTurnViaDaemon(session.meta.id, projectPath, {
					turnNumber: 0,
					role: "user",
					content: userMsg,
					agent: profile.id,
					model: modelId,
				});
			} catch (e) {
				log.debug("user turn save failed", { error: String(e) });
			}
			const lastMsg = agent.getMessages().at(-1);
			const contentParts = lastMsg?.role === "assistant" ? lastMsg.content as unknown as Array<Record<string, unknown>> : undefined;
			try {
				await addTurnViaDaemon(session.meta.id, projectPath, {
					turnNumber: 0,
					role: "assistant",
					content: assistantMsg,
					contentParts,
					agent: profile.id,
					model: modelId,
				});
			} catch (e) {
				log.debug("assistant turn save failed", { error: String(e) });
			}
			if (wiring.checkpointManager && session) {
				try {
					await wiring.checkpointManager.save(session.meta.id, {
						version: 1, sessionId: session.meta.id, turns: [...agent.getMessages()],
						metadata: { model: modelId, profile: profile.id }, timestamp: Date.now(),
					});
				} catch (e) {
					log.debug("checkpoint save failed", { error: String(e) });
				}
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
	printPrompt = await applyLucyLiveGuidance(printPrompt, params.prompt, projectPath);

	const exitCode = await runPrintMode({ agent, prompt: printPrompt });

	// Save print-mode result to session
	try {
		await addTurnViaDaemon(session.meta.id, projectPath, {
			turnNumber: 0,
			role: "user",
			content: params.prompt,
			agent: profile.id,
			model: modelId,
		});
	} catch { /* best-effort */ }
	const lastMsg = agent.getMessages().at(-1);
	if (lastMsg) {
		const text = lastMsg.content
			.filter((p: { type: string }): p is { type: "text"; text: string } => p.type === "text")
			.map((p: { type: "text"; text: string }) => p.text)
			.join("");
		const contentParts = lastMsg.role === "assistant" ? lastMsg.content as unknown as Array<Record<string, unknown>> : undefined;
		try {
			await addTurnViaDaemon(session.meta.id, projectPath, {
				turnNumber: 0,
				role: "assistant",
				content: text,
				contentParts,
				agent: profile.id,
				model: modelId,
			});
		} catch { /* best-effort */ }
	}

	await shutdownAll();
	process.exit(exitCode);
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
