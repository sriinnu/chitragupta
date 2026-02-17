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
import { parseKeypress, matchKey } from "@chitragupta/ui/keys";
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

// ─── Marga Pipeline type (soft dependency — avoid hard import) ───────────────

/**
 * Minimal interface for MargaPipeline.classify().
 * Avoids a hard import of @chitragupta/swara from the interactive module.
 */
interface MargaPipelineInstance {
	classify(
		context: { messages: Array<{ role: string; content: unknown }>; systemPrompt?: string },
		options?: Record<string, unknown>,
	): {
		taskType: string;
		complexity: string;
		providerId: string;
		modelId: string;
		rationale: string;
		confidence: number;
		skipLLM: boolean;
		temperature?: number;
	};
}

/**
 * Minimal interface for ProviderRegistry.get().
 * Avoids a hard import of @chitragupta/swara from the interactive module.
 */
interface ProviderRegistryInstance {
	get(id: string): { id: string; name: string; stream: unknown } | undefined;
}

// ─── Sandesha Input Routing ──────────────────────────────────────────────────

/**
 * Unwrap an InputRequest from potentially nested subagent:event wrappers.
 *
 * When a sub-agent emits `agent:input_request`, each parent wraps it in a
 * `subagent:event` envelope. This function recursively unwraps to find the
 * original InputRequest payload.
 *
 * @param event - The event type string.
 * @param data - The event payload.
 * @returns The InputRequest if found, or null.
 */
function unwrapInputRequest(event: string, data: unknown): InputRequest | null {
	if (event === "agent:input_request") {
		return data as InputRequest;
	}

	if (event === "subagent:event") {
		const envelope = data as Record<string, unknown>;
		const innerEvent = envelope.originalEvent as string | undefined;
		const innerData = envelope.data;
		if (innerEvent) {
			return unwrapInputRequest(innerEvent, innerData);
		}
	}

	return null;
}

export interface InteractiveModeOptions {
	agent: Agent;
	profile: AgentProfile;
	project?: ProjectInfo;
	initialPrompt?: string;
	budgetConfig?: BudgetConfig;
	session?: { id: string; project?: string };
	/**
	 * MargaPipeline instance for intelligent per-turn model routing.
	 * When present (and the user did not explicitly pick a model via --model),
	 * each turn is classified by intent + complexity to select the best model.
	 */
	margaPipeline?: MargaPipelineInstance;
	/** TuriyaRouter for contextual bandit model routing (replaces Marga when available). */
	turiyaRouter?: TuriyaRouterInstance;
	/** Manas zero-cost input classifier (feeds Turiya). */
	manas?: ManasInstance;
	/** SoulManager for personality-driven confidence and temperature. */
	soulManager?: SoulManagerInstance;
	/** AgentReflector for post-turn self-evaluation. */
	reflector?: ReflectorInstance;
	/** Provider registry for Marga-driven provider switching. */
	providerRegistry?: ProviderRegistryInstance;
	/** True when the user explicitly passed --model on the CLI. Disables Marga routing. */
	userExplicitModel?: boolean;
	/**
	 * KaalaBrahma agent tree accessor for HeartbeatMonitor display.
	 * When sub-agents are active, their vitals are rendered as an ECG waveform.
	 */
	kaala?: {
		getTree(): Array<{
			agentId: string;
			status: string;
			depth: number;
			parentId: string | null;
			purpose: string;
			lastBeatAge: number;
			tokenUsage: number;
			tokenBudget: number;
		}>;
	};
	onModelChange?: (model: string) => void;
	onThinkingChange?: (level: ThinkingLevel) => void;
	onTurnComplete?: (userMessage: string, assistantResponse: string) => void;
	/**
	 * Shiksha autonomous skill learning controller.
	 * When present, queries are checked for skill gaps before agent.prompt().
	 * If Shiksha can handle it (shell command), the LLM is bypassed entirely.
	 */
	shiksha?: ShikshaInstance;
	/**
	 * MemoryBridge for Smaran (explicit memory) and per-turn recall.
	 * When present:
	 *   - handleMemoryCommand() intercepts "remember"/"forget"/"recall" before the LLM
	 *   - recallForQuery() injects relevant memories as a system note per turn
	 */
	memoryBridge?: {
		handleMemoryCommand(userMessage: string, sessionId?: string): string | null;
		recallForQuery(query: string): string;
	};
	/** VidyaOrchestrator for /vidya slash command ecosystem dashboard. */
	vidyaOrchestrator?: {
		getEcosystemStats(): Record<string, unknown>;
		getSkillReport(name?: string): unknown;
		promoteSkill(name: string, reviewer?: string): boolean;
		deprecateSkill(name: string, reason?: string): boolean;
		evaluateLifecycles(): Record<string, unknown>;
	};
	/** NidraDaemon instance for /nidra slash command (duck-typed). */
	nidraDaemon?: {
		snapshot(): {
			state: string;
			lastStateChange: number;
			lastHeartbeat: number;
			lastConsolidationStart?: number;
			lastConsolidationEnd?: number;
			consolidationPhase?: string;
			consolidationProgress: number;
			uptime: number;
		};
		wake(): void;
	};
}

/**
 * Minimal interface for ShikshaController (avoids hard import of @chitragupta/vidhya-skills).
 */
interface ShikshaInstance {
	detectGap(query: string, matches: Array<{ score: number }>): boolean;
	learn(query: string): Promise<{
		success: boolean;
		executed: boolean;
		executionOutput?: string;
		skill?: { manifest: { name: string } };
		autoApproved: boolean;
		quarantineId?: string;
		durationMs: number;
		error?: string;
		cloudRecipeDisplay?: string;
	}>;
}

/**
 * Minimal interfaces for Turiya/Manas/Soul/Reflector (avoid hard imports).
 */
interface TuriyaRouterInstance {
	extractContext(
		messages: Array<{ role: string; content: unknown }>,
		systemPrompt?: string,
		tools?: unknown[],
		memoryHits?: number,
	): Record<string, number>;
	classify(context: Record<string, number>): {
		tier: string;
		confidence: number;
		costEstimate: number;
		context: Record<string, number>;
		rationale: string;
		armIndex: number;
	};
	recordOutcome(decision: { tier: string; confidence: number; costEstimate: number; context: Record<string, number>; rationale: string; armIndex: number }, reward: number): void;
	getStats(): { totalRequests: number; savingsPercent: number; totalCost: number };
}

interface ManasInstance {
	classify(input: string): {
		intent: string;
		route: string;
		confidence: number;
		features: { hasCode: boolean; hasErrorStack: boolean; multiStep: boolean; wordCount: number };
		durationMs: number;
	};
}

interface SoulManagerInstance {
	updateConfidence(agentId: string, domain: string, success: boolean): void;
	addTrait(agentId: string, trait: string): void;
	getEffectiveTemperature(agentId: string, baseTemp: number): number;
}

interface ReflectorInstance {
	reflect(agentId: string, taskDescription: string, output: string): {
		score: number;
		confidence: number;
		strengths: string[];
		weaknesses: string[];
		improvements: string[];
	};
}

/** Reason the interactive session ended. */
export type ExitReason = "quit" | "sigint";

/**
 * Run the interactive TUI mode.
 *
 * Returns when the user quits (via /quit, /exit, Ctrl+C double-tap, or SIGINT),
 * allowing the caller to run post-session hooks (e.g. ConsolidationEngine)
 * before the process terminates.
 */
export async function runInteractiveMode(options: InteractiveModeOptions): Promise<ExitReason> {
	const { agent, profile, project, initialPrompt } = options;

	let inputBuffer = "";
	let cursorPos = 0;
	let isStreaming = false;
	let ctrlCCount = 0;
	let ctrlCTimer: ReturnType<typeof setTimeout> | null = null;
	let currentThinking: ThinkingLevel = (agent.getState().thinkingLevel as ThinkingLevel) ?? "medium";
	let currentModel = agent.getState().model;
	let budgetBlocked = false;
	let lastTuriyaDecision: ReturnType<TuriyaRouterInstance["classify"]> | undefined;

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
	let streamingText = "";
	let inThinking = false;
	let toolStartTime = 0;

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

	const handleAgentEvent = (event: AgentEventType, data: unknown) => {
		const eventData = data as Record<string, unknown>;

		switch (event) {
			case "stream:start":
				spinner.start();
				break;

			case "stream:text": {
				const text = eventData.text as string;
				spinner.stop();
				if (!streamingText && !inThinking) {
					printAssistantLabel(stdout, profile.name);
				}
				if (inThinking) {
					printThinkingEnd(stdout);
					inThinking = false;
				}
				stdout.write(text);
				streamingText += text;
				break;
			}

			case "stream:thinking": {
				const text = eventData.text as string;
				spinner.stop();
				if (!inThinking) {
					if (!streamingText) {
						printAssistantLabel(stdout, profile.name);
					}
					printThinkingStart(stdout);
					inThinking = true;
				}
				// Dimmed thinking text with violet left border
				stdout.write(`${THEME.thinking}\u2502${reset} ${dim(text)}`);
				break;
			}

			case "stream:tool_call": {
				const name = eventData.name as string;
				const args = eventData.input as string | undefined;
				if (inThinking) {
					stdout.write("\n");
					printThinkingEnd(stdout);
					inThinking = false;
				}
				toolStartTime = Date.now();
				printToolStart(stdout, name, args);
				break;
			}

			case "tool:start": {
				const name = eventData.name as string;
				spinner.setLabel(`Running ${name}...`);
				break;
			}

			case "tool:done": {
				const duration = toolStartTime > 0 ? Date.now() - toolStartTime : undefined;
				printToolEnd(stdout, "done", duration);
				toolStartTime = 0;
				break;
			}

			case "tool:error": {
				const errorMsg = eventData.error as string;
				const duration = toolStartTime > 0 ? Date.now() - toolStartTime : undefined;
				printToolEnd(stdout, "error", duration);
				printError(stdout, errorMsg);
				toolStartTime = 0;
				break;
			}

			case "stream:usage": {
				const usage = eventData.usage as TokenUsage;
				if (usage) {
					stats.totalInputTokens += usage.inputTokens;
					stats.totalOutputTokens += usage.outputTokens;
				}
				break;
			}

			case "stream:done": {
				spinner.stop();
				if (inThinking) {
					stdout.write("\n");
					printThinkingEnd(stdout);
					inThinking = false;
				}

				const cost = eventData.cost as CostBreakdown | undefined;
				if (cost) {
					stats.totalCost += cost.total;

					// Record cost in budget tracker and check for warnings/limits
					const budgetStatus = budgetTracker.recordCost(cost.total);
					if (budgetStatus.sessionWarning || budgetStatus.sessionExceeded ||
						budgetStatus.dailyWarning || budgetStatus.dailyExceeded) {
						printBudgetWarning(stdout, budgetStatus);
					}

					const proceed = budgetTracker.canProceed();
					if (!proceed.allowed) {
						budgetBlocked = true;
					}
				}

				const usage = eventData.usage as TokenUsage | undefined;
				if (usage) {
					const totalTokens = stats.totalInputTokens + stats.totalOutputTokens;
					stats.contextPercent = Math.min(100, (totalTokens / 200000) * 100);
				}

				break;
			}

			// ─── Sandesha: direct input request from agent ────────────────
			case "agent:input_request": {
				const request = eventData as unknown as InputRequest;
				spinner.stop();
				printInputRequest(stdout, request);
				pendingInputRequests.push(request);
				break;
			}

			// ─── Sandesha: unwrap nested subagent events for input requests ─
			case "subagent:event": {
				const inputReq = unwrapInputRequest(event, data);
				if (inputReq) {
					spinner.stop();
					printInputRequest(stdout, inputReq);
					pendingInputRequests.push(inputReq);
				}
				break;
			}
		}
	};

	// Inject event handler into agent
	agent.setOnEvent(handleAgentEvent);

	async function sendMessage(message: string): Promise<void> {
		if (!message.trim()) return;

		// Check budget limits before sending (slash commands still allowed)
		if (budgetBlocked && !message.startsWith("/")) {
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
				if (result.newModel) currentModel = result.newModel;
				if (result.newThinking) currentThinking = result.newThinking;
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
		streamingText = "";
		stats.turnCount++;

		// ─── Smaran: per-turn memory recall (inject relevant memories) ──
		let promptMessage = message;
		if (options.memoryBridge) {
			try {
				const recallContext = options.memoryBridge.recallForQuery(message);
				if (recallContext) {
					promptMessage = `[Recalled memories]\n${recallContext}\n\n[User message]\n${message}`;
				}
			} catch {
				// Memory recall failed — proceed without recall context
			}
		}

		// ─── Manas + Turiya: intelligent per-turn model routing ─────────
		lastTuriyaDecision = undefined;
		if (options.manas && options.turiyaRouter && !options.userExplicitModel) {
			try {
				const classification = options.manas.classify(message);

				// Build message array for Turiya context extraction
				const agentMessages = [...agent.getMessages()].map(m => ({
					role: (m as { role: string }).role,
					content: (m as { content: unknown }).content,
				}));
				agentMessages.push({ role: "user", content: [{ type: "text", text: message }] });

				const ctx = options.turiyaRouter.extractContext(agentMessages);
				const decision = options.turiyaRouter.classify(ctx);
				lastTuriyaDecision = decision;

				// Map tier to model ID — search current provider for a matching model
				const tierModelHints: Record<string, string[]> = {
					"haiku": ["haiku", "claude-haiku", "gpt-4o-mini", "gemini-flash"],
					"sonnet": ["sonnet", "claude-sonnet", "gpt-4o", "gemini-pro"],
					"opus": ["opus", "claude-opus", "gpt-4", "o1", "gemini-ultra"],
				};
				const hints = tierModelHints[decision.tier];
				if (hints && decision.tier !== "no-llm") {
					// Try to find a model matching the tier in the current model string
					const currentLower = currentModel.toLowerCase();
					const alreadyMatchesTier = hints.some(h => currentLower.includes(h));
					if (!alreadyMatchesTier) {
						// Try Marga for actual model resolution if available
						if (options.margaPipeline) {
							try {
								const margaDecision = options.margaPipeline.classify({
									messages: [{ role: "user", content: [{ type: "text", text: message }] }],
									systemPrompt: undefined,
								});
								if (margaDecision.modelId && margaDecision.modelId !== currentModel) {
									if (options.providerRegistry) {
										const newProvider = options.providerRegistry.get(margaDecision.providerId);
										if (newProvider) {
											agent.setProvider(newProvider as Parameters<typeof agent.setProvider>[0]);
										}
									}
									agent.setModel(margaDecision.modelId);
									currentModel = margaDecision.modelId;
								}
							} catch {
								// Marga fallback failed — keep current model
							}
						}
					}
				}

				stdout.write(
					dim(`  [${classification.intent} → ${decision.tier} (${(decision.confidence * 100).toFixed(0)}%) ~$${decision.costEstimate.toFixed(4)}]\n`),
				);
			} catch {
				// Manas/Turiya classification failed — continue with current model
			}
		} else if (options.margaPipeline && !options.userExplicitModel) {
			// Fallback: pure Marga routing when Turiya is unavailable
			try {
				const decision = options.margaPipeline.classify({
					messages: [{ role: "user", content: [{ type: "text", text: message }] }],
					systemPrompt: undefined,
				});
				if (decision.modelId && decision.modelId !== currentModel) {
					if (options.providerRegistry) {
						const newProvider = options.providerRegistry.get(decision.providerId);
						if (newProvider) {
							agent.setProvider(newProvider as Parameters<typeof agent.setProvider>[0]);
						}
					}
					agent.setModel(decision.modelId);
					currentModel = decision.modelId;
					stdout.write(
						dim(`  [marga: ${decision.taskType}/${decision.complexity} → ${decision.modelId}]\n`),
					);
				}
			} catch {
				// Marga classification failed — continue with current model
			}
		}

		// ─── Shiksha: pre-prompt skill gap detection ────────────────────
		if (options.shiksha) {
			try {
				if (options.shiksha.detectGap(message, [])) {
					const result = await options.shiksha.learn(message);
					if (result.success && result.executed && result.executionOutput) {
						stdout.write(dim(`  [shiksha: learned "${result.skill?.manifest.name}" in ${result.durationMs.toFixed(0)}ms]\n`));
						stdout.write("\n" + result.executionOutput + "\n");
						isStreaming = false;

						if (options.onTurnComplete) {
							options.onTurnComplete(message, result.executionOutput);
						}

						renderStatusBar();
						stdout.write("\n");
						renderPrompt();
						return;
					}
					// Cloud recipe display — show recipe, skip LLM
					if (result.success && result.cloudRecipeDisplay) {
						stdout.write(dim(`  [shiksha: cloud recipe found in ${result.durationMs.toFixed(0)}ms]\n`));
						stdout.write("\n" + result.cloudRecipeDisplay + "\n");
						isStreaming = false;

						if (options.onTurnComplete) {
							options.onTurnComplete(message, result.cloudRecipeDisplay);
						}

						renderStatusBar();
						stdout.write("\n");
						renderPrompt();
						return;
					}
					// Not executed (quarantined or failed) — fall through to agent
				}
			} catch {
				// Shiksha failed — fall through to agent silently
			}
		}

		try {
			await agent.prompt(promptMessage);

			// Ensure we end with a newline after streaming
			if (streamingText && !streamingText.endsWith("\n")) {
				stdout.write("\n");
			}

			// Process follow-ups
			await agent.processFollowUps();

			// ─── Post-turn: Turiya learning ─────────────────────────────
			if (options.turiyaRouter && lastTuriyaDecision) {
				try {
					// Compute reward: 0.8 baseline, boost for substantive response, penalize for very short
					let reward = 0.8;
					if (streamingText.length > 500) reward = 0.9;
					if (streamingText.length > 2000) reward = 0.95;
					if (streamingText.length < 20) reward = 0.3;
					options.turiyaRouter.recordOutcome(lastTuriyaDecision, reward);
				} catch {
					// Turiya learning is best-effort
				}
			}

			// ─── Post-turn: Soul confidence update ──────────────────────
			if (options.soulManager && options.manas) {
				try {
					const intent = options.manas.classify(message).intent;
					options.soulManager.updateConfidence("root", intent, streamingText.length > 50);
				} catch {
					// Soul update is best-effort
				}
			}

			// ─── Post-turn: Self-reflection ─────────────────────────────
			if (options.reflector && streamingText.length > 0) {
				try {
					const reflection = options.reflector.reflect("root", message, streamingText);
					if (reflection.score < 5 && reflection.weaknesses.length > 0) {
						stdout.write(
							dim(`  [reflect: score=${reflection.score.toFixed(1)} — ${reflection.weaknesses[0]}]\n`),
						);
					}
				} catch {
					// Reflection is best-effort
				}
			}

			// Notify caller of completed turn for session persistence
			if (options.onTurnComplete) {
				options.onTurnComplete(message, streamingText);
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

	function handleKeypress(data: Buffer): void {
		const key = parseKeypress(data);

		// Ctrl+C: clear or quit
		if (matchKey(key, "ctrl+c")) {
			if (isStreaming) {
				agent.abort();
				return;
			}

			if (inputBuffer.length > 0) {
				inputBuffer = "";
				cursorPos = 0;
				ctrlCCount = 0;
				renderPrompt();
				return;
			}

			ctrlCCount++;
			if (ctrlCCount >= 2) {
				stdout.write(dim("\n\n  Goodbye.\n\n"));
				cleanup();
				resolveSession("quit");
				return;
			}

			stdout.write(dim("\n  Press Ctrl+C again to quit.\n"));
			renderPrompt();

			if (ctrlCTimer) clearTimeout(ctrlCTimer);
			ctrlCTimer = setTimeout(() => {
				ctrlCCount = 0;
			}, 2000);

			return;
		}

		// Reset Ctrl+C counter on any other key
		ctrlCCount = 0;

		if (matchKey(key, "escape")) {
			if (isStreaming) {
				agent.abort();
			}
			return;
		}

		if (matchKey(key, "ctrl+l")) {
			stdout.write(dim(`\n  Current model: ${currentModel}\n`));
			stdout.write(dim("  Use /model <id> to switch.\n\n"));
			renderPrompt();
			return;
		}

		if (matchKey(key, "shift+tab")) {
			const currentIdx = THINKING_LEVELS.indexOf(currentThinking);
			const nextIdx = (currentIdx + 1) % THINKING_LEVELS.length;
			currentThinking = THINKING_LEVELS[nextIdx];
			agent.setThinkingLevel(currentThinking);

			stdout.write(dim(`  Thinking: ${bold(currentThinking)}\n`));
			renderPrompt();
			return;
		}

		if (matchKey(key, "tab")) {
			if (inputBuffer.startsWith("/")) {
				const result = completeSlashCommand(inputBuffer, stdout, renderPrompt);
				if (result) {
					inputBuffer = result.newBuffer;
					cursorPos = result.newCursorPos;
					renderPrompt();
				}
			}
			return;
		}

		if (matchKey(key, "return")) {
			if (isStreaming) return;

			const message = inputBuffer.trim();
			inputBuffer = "";
			cursorPos = 0;

			// Sandesha: if there are pending input requests, resolve the oldest one
			if (message && pendingInputRequests.length > 0) {
				const pendingReq = pendingInputRequests.shift()!;
				stdout.write("\n");
				stdout.write(dim(`  [responding to ${pendingReq.agentId.slice(0, 8)}] `) + message + "\n");

				// Find the agent that owns this request and resolve it.
				// For the root agent or direct children, use findAgent on the root.
				const targetAgent = agent.findAgent(pendingReq.agentId);
				if (targetAgent) {
					targetAgent.resolveInput(pendingReq.requestId, message);
				} else {
					// Fallback: resolve on the root agent (it will be a no-op if ID doesn't match)
					agent.resolveInput(pendingReq.requestId, message);
				}

				if (pendingInputRequests.length > 0) {
					stdout.write(dim(`  [${pendingInputRequests.length} more pending input request(s)]\n`));
				}

				renderPrompt();
				return;
			}

			if (message) {
				stdout.write("\n");
				sendMessage(message);
			} else {
				renderPrompt();
			}
			return;
		}

		if (matchKey(key, "backspace")) {
			if (cursorPos > 0) {
				inputBuffer = inputBuffer.slice(0, cursorPos - 1) + inputBuffer.slice(cursorPos);
				cursorPos--;
				renderPrompt();
			}
			return;
		}

		if (key.name === "delete") {
			if (cursorPos < inputBuffer.length) {
				inputBuffer = inputBuffer.slice(0, cursorPos) + inputBuffer.slice(cursorPos + 1);
				renderPrompt();
			}
			return;
		}

		if (key.name === "left") {
			if (cursorPos > 0) cursorPos--;
			return;
		}
		if (key.name === "right") {
			if (cursorPos < inputBuffer.length) cursorPos++;
			return;
		}
		if (key.name === "home") {
			cursorPos = 0;
			return;
		}
		if (key.name === "end") {
			cursorPos = inputBuffer.length;
			return;
		}

		if (matchKey(key, "ctrl+a")) {
			cursorPos = 0;
			return;
		}

		if (matchKey(key, "ctrl+e")) {
			cursorPos = inputBuffer.length;
			return;
		}

		if (matchKey(key, "ctrl+u")) {
			inputBuffer = "";
			cursorPos = 0;
			renderPrompt();
			return;
		}

		if (matchKey(key, "ctrl+w")) {
			if (cursorPos > 0) {
				const before = inputBuffer.slice(0, cursorPos);
				const after = inputBuffer.slice(cursorPos);
				const trimmed = before.replace(/\S+\s*$/, "");
				inputBuffer = trimmed + after;
				cursorPos = trimmed.length;
				renderPrompt();
			}
			return;
		}

		if (key.sequence && !key.ctrl && !key.meta && key.sequence.length > 0 && key.name !== "unknown") {
			const ch = key.sequence;
			const code = ch.charCodeAt(0);
			if (code >= 32 || code >= 128) {
				inputBuffer = inputBuffer.slice(0, cursorPos) + ch + inputBuffer.slice(cursorPos);
				cursorPos += ch.length;
				renderPrompt();
			}
		}
	}

	// ─── Welcome ────────────────────────────────────────────────────────────

	const welcome = buildWelcomeMessage(profile, project);
	// Themed Chitragupta star in primary amethyst
	stdout.write(`\n${THEME.primary}  \u2605 ${bold("Chitragupta")}${reset}\n\n`);
	stdout.write(dim(welcome) + "\n\n");
	renderStatusBar();
	stdout.write("\n");

	// Set up stdin listener
	stdin.on("data", (data: Buffer | string) => {
		const buffer = typeof data === "string" ? Buffer.from(data) : data;
		handleKeypress(buffer);
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
