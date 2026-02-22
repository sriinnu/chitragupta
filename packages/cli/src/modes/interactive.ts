/**
 * @chitragupta/cli — Interactive TUI mode.
 *
 * Premium terminal UI with Nakshatram-themed streaming output:
 *   - Violet thinking blocks with pulsing diamond
 *   - Gold tool calls with gear icon and duration
 *   - Agent-colored assistant labels with left border
 *   - Rich status bar with model, cost, tokens, git, context pressure
 *   - Braille spinner animation from theme symbols
 */

import type { Agent, AgentEventType } from "@chitragupta/anina";
import type { AgentProfile, BudgetConfig, InputRequest, ThinkingLevel, CostBreakdown, TokenUsage } from "@chitragupta/core";
import { bold, dim, gray, green, cyan, yellow, red, reset, showCursor } from "@chitragupta/ui/ansi";
import type { ProjectInfo } from "../project-detector.js";
import { buildWelcomeMessage } from "../personality.js";
import { BudgetTracker } from "../budget-tracker.js";
import {
	type SessionStats,
	THEME,
	renderPrompt as renderPromptHelper,
	renderStatusBar as renderStatusBarHelper,
	printAssistantLabel,
	printUserLabel,
	printThinkingStart,
	printThinkingEnd,
	printToolStart,
	printToolEnd,
	printError,
	printInputRequest,
	printBudgetWarning,
	createSpinner,
	runSimpleInteractive,
} from "./interactive-render.js";
import {
	THINKING_LEVELS,
	completeSlashCommand,
	handleSlashCommand,
} from "./interactive-commands.js";
import type {
	InteractiveModeOptions,
	TuriyaRouterInstance,
	ShikshaInstance,
	ManasInstance,
	SoulManagerInstance,
	ReflectorInstance,
	MargaPipelineInstance,
	ProviderRegistryInstance,
} from "./interactive-types.js";
export type { InteractiveModeOptions, ExitReason } from "./interactive-types.js";
import {
	type RoutingState,
	applyMemoryRecall,
	applyRephrasePenalty,
	routeModelForTurn,
	tryShikshaIntercept,
	runPostTurnHooks,
} from "./interactive-routing.js";
import {
	type EventHandlerState,
	createAgentEventHandler,
	unwrapInputRequest,
} from "./interactive-events.js";
import {
	type KeypressState,
	handleKeypress as processKeypress,
} from "./interactive-keypress.js";

export async function runInteractiveMode(options: InteractiveModeOptions): Promise<ExitReason> {
	const { agent, profile, project, initialPrompt } = options;

	
	let currentThinking: ThinkingLevel = (agent.getState().thinkingLevel as ThinkingLevel) ?? "medium";
	let currentModel = agent.getState().model;
	let isStreaming = false;
	const routing: RoutingState = { currentModel: currentModel, lastTuriyaDecision: undefined, lastUserMessage: "" };

	const budgetTracker = new BudgetTracker(options.budgetConfig);

	// Resolver for the session lifetime promise — called on any exit path
	// to return control to the caller instead of calling process.exit().
	let resolveSession: (reason: ExitReason) => void;

	const stats: SessionStats = {
		totalCost: 0,
		totalInputTokens: 0,
		totalOutputTokens: 0,
		contextPercent: 0,
		turnCount: 0,
	};

	/** FIFO queue of pending input requests from sub-agents (Sandesha pattern). */
	const pendingInputRequests: InputRequest[] = [];

	const stdin = process.stdin;
	const stdout = process.stdout;

	if (!stdin.isTTY) {
		// Not a terminal -- fall back to simple readline mode
		await runSimpleInteractive({ agent, profile, initialPrompt });
		return "quit";
	}

	stdin.setRawMode(true);
	stdin.resume();
	stdin.setEncoding("utf-8");

	// Show cursor and clean up on exit
	const cleanup = () => {
		stdout.write(showCursor());
		if (stdin.isTTY) {
			stdin.setRawMode(false);
		}
		stdin.pause();
	};

	process.on("exit", cleanup);
	process.on("SIGINT", () => {
		cleanup();
		resolveSession("sigint");
	});

	function renderPrompt(): void {
		renderPromptHelper(stdout, inputBuffer);
	}

	function renderStatusBar(): void {
		renderStatusBarHelper(stdout, currentModel, currentThinking, stats);
	}

	const spinner = createSpinner(stdout);

	// ─── HeartbeatMonitor (ECG waveform for sub-agent vitals) ────────────
	let heartbeatMonitor: InstanceType<typeof import("@chitragupta/ui").HeartbeatMonitor> | undefined;
	try {
		const { HeartbeatMonitor } = await import("@chitragupta/ui");
		heartbeatMonitor = new HeartbeatMonitor({
			width: 60,
			showTree: true,
			showBudget: true,
			blinkDead: true,
			refreshInterval: 500,
		});
	} catch {
		// Silently skip — @chitragupta/ui HeartbeatMonitor is optional
	}

	/**
	 * Render the HeartbeatMonitor if sub-agents are active.
	 * Called after streaming completes and during status bar renders.
	 */
	function renderHeartbeat(): void {
		if (!heartbeatMonitor || !options.kaala) return;

		const agents = options.kaala.getTree();
		// Only render if there are sub-agents (depth > 0)
		const subAgents = agents.filter((a) => a.depth > 0);
		if (subAgents.length === 0) return;

		heartbeatMonitor.update(
			agents.map((a) => ({
				agentId: a.agentId,
				status: a.status as "alive" | "stale" | "dead" | "killed" | "completed" | "error",
				depth: a.depth,
				purpose: a.purpose,
				lastBeatAge: a.lastBeatAge,
				tokenUsage: a.tokenUsage,
				tokenBudget: a.tokenBudget,
			})),
		);
		heartbeatMonitor.tick();

		const display = heartbeatMonitor.render();
		process.stderr.write("\n" + display + "\n");
	}

	// ─── Agent Event Handler (extracted to interactive-events.ts) ─────
	const eventState: EventHandlerState = {
		spinner,
		stats,
		budgetTracker,
		stdout,
		profileName: profile.name,
		pendingInputRequests,
		budgetBlocked,
		streamingText: "",
		inThinking: false,
		toolStartTime: 0,
	};
	const handleAgentEvent = createAgentEventHandler(eventState);
	agent.setOnEvent(handleAgentEvent);

	async function sendMessage(message: string): Promise<void> {
		if (!message.trim()) return;

		// Check budget limits before sending (slash commands still allowed)
		if (eventState.budgetBlocked && !message.startsWith("/")) {
			const proceed = budgetTracker.canProceed();
			stdout.write(red("\n  " + (proceed.reason ?? "Budget exceeded") + "\n"));
			stdout.write(dim("  Use /cost to see details. Start a new session to continue.\n\n"));
			renderPrompt();
			return;
		}

		// Check for slash commands
		if (message.startsWith("/")) {
			const result = await handleSlashCommand(message, {
				agent,
				stdout,
				stats,
				currentModel,
				currentThinking,
				cleanup,
				onModelChange: options.onModelChange,
				onThinkingChange: options.onThinkingChange,
				vidyaOrchestrator: options.vidyaOrchestrator,
				projectPath: options.project?.path,
				nidraDaemon: options.nidraDaemon,
			});
			if (result.handled) {
				if (result.exit) {
					resolveSession("quit");
					return;
				}
				if (result.newModel) { currentModel = result.newModel; routing.currentModel = result.newModel; kpState.currentModel = result.newModel; }
				if (result.newThinking) { currentThinking = result.newThinking; kpState.currentThinking = result.newThinking; }
				renderPrompt();
				return;
			}
		}

		// ─── Smaran: intercept explicit memory commands (zero-cost) ─────
		if (options.memoryBridge) {
			try {
				const sessionId = options.session?.id;
				const memoryResponse = options.memoryBridge.handleMemoryCommand(message, sessionId);
				if (memoryResponse !== null) {
					printUserLabel(stdout);
					stdout.write("  " + message + "\n");
					printAssistantLabel(stdout, profile.name);
					stdout.write(memoryResponse + "\n");

					if (options.onTurnComplete) {
						options.onTurnComplete(message, memoryResponse);
					}

					renderStatusBar();
					stdout.write("\n");
					renderPrompt();
					return;
				}
			} catch {
				// Memory command handling failed — fall through to LLM
			}
		}

		printUserLabel(stdout);
		stdout.write("  " + message + "\n");

		isStreaming = true;
		kpState.isStreaming = true;
		eventState.streamingText = "";
		stats.turnCount++;

		// ─── Smaran: per-turn memory recall (inject relevant memories) ──
		const promptMessage = applyMemoryRecall(message, options);

		// ─── Turiya: retroactive rephrase penalty for previous decision ──
		applyRephrasePenalty(message, routing, options);

		// ─── Model routing (Manas + Turiya / Marga) ─────────────────────
		routeModelForTurn(message, agent, routing, options, stdout);

		// ─── Shiksha: pre-prompt skill gap detection ────────────────────
		const shikshaResult = await tryShikshaIntercept(message, options, stdout);
		if (shikshaResult.handled) {
			isStreaming = false;
			kpState.isStreaming = false;
		kpState.isStreaming = false;
			if (options.onTurnComplete && shikshaResult.output) {
				options.onTurnComplete(message, shikshaResult.output);
			}
			renderStatusBar();
			stdout.write("\n");
			renderPrompt();
			return;
		}

		try {
			await agent.prompt(promptMessage);

			// Ensure we end with a newline after streaming
			if (eventState.streamingText && !eventState.streamingText.endsWith("\n")) {
				stdout.write("\n");
			}

			// Process follow-ups
			await agent.processFollowUps();

			// ─── Post-turn hooks (Turiya, Soul, Reflection) ────────────
			runPostTurnHooks(message, eventState.streamingText, routing, options, stdout);

			// Notify caller of completed turn for session persistence
			if (options.onTurnComplete) {
				options.onTurnComplete(message, eventState.streamingText);
			}

		} catch (error) {
			spinner.stop();
			if ((error as Error).name === "AbortError") {
				stdout.write(`\n\n${THEME.warning}  [aborted]${reset}\n`);
			} else {
				const errorMsg = error instanceof Error ? error.message : String(error);
				printError(stdout, errorMsg);
			}
		} finally {
			spinner.stop();
			isStreaming = false;
			kpState.isStreaming = false;
		kpState.isStreaming = false;
		}

		// Auto-compact if context pressure exceeds 80%
		if (stats.contextPercent > 80) {
			const ctxManager = agent.getContextManager();
			if (ctxManager) {
				const state = agent.getState();
				const compacted = ctxManager.compact(state);
				agent.replaceState(compacted);
				stdout.write(dim("  [auto-compacted: context pressure was " + Math.round(stats.contextPercent) + "%]\n"));
			}
		}

		renderStatusBar();
		renderHeartbeat();
		stdout.write("\n");
		renderPrompt();
	}


	// ─── Welcome ────────────────────────────────────────────────────────────

	const welcome = buildWelcomeMessage(profile, project);
	// Themed Chitragupta star in primary amethyst
	stdout.write(`\n${THEME.primary}  \u2605 ${bold("Chitragupta")}${reset}\n\n`);
	stdout.write(dim(welcome) + "\n\n");
	renderStatusBar();
	stdout.write("\n");

	// Set up stdin listener
	// Keypress state — shared with the keypress handler module
	const kpState: KeypressState = {
		inputBuffer: "",
		cursorPos: 0,
		isStreaming: false,
		ctrlCCount: 0,
		ctrlCTimer: null,
		currentThinking,
		currentModel,
		pendingInputRequests,
	};

	// Set up stdin listener
	stdin.on("data", (data: Buffer | string) => {
		const buffer = typeof data === "string" ? Buffer.from(data) : data;
		processKeypress(buffer, kpState, {
			renderPrompt,
			sendMessage,
			cleanup,
			resolveSession,
			agent,
			stdout,
		});
	});

	// Handle initial prompt if provided
	if (initialPrompt) {
		await sendMessage(initialPrompt);
	} else {
		renderPrompt();
	}

	// Keep the process alive until an exit path resolves the session promise.
	// Control returns to the caller (main.ts) so post-session hooks can run.
	const exitReason = await new Promise<ExitReason>((resolve) => {
		resolveSession = resolve;
	});

	return exitReason;
}
