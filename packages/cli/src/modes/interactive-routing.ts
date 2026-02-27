/**
 * @chitragupta/cli — Interactive mode model routing.
 *
 * Handles intelligent per-turn model routing using Manas, Turiya,
 * Marga, and Shiksha subsystems. Extracted from the main interactive
 * module to keep file sizes under 450 LOC.
 */

import type { Agent } from "@chitragupta/anina";
import { createLogger } from "@chitragupta/core";
import { dim } from "@chitragupta/ui/ansi";
import type {
	InteractiveModeOptions,
	TuriyaRouterInstance,
} from "./interactive-types.js";
import { buildNoLlmTemplateResponse } from "./no-llm-template.js";

const log = createLogger("cli:interactive-routing");

/** Mutable routing state shared across turns. */
export interface RoutingState {
	currentModel: string;
	lastTuriyaDecision: ReturnType<TuriyaRouterInstance["classify"]> | undefined;
	lastUserMessage: string;
}

/**
 * Simple word overlap ratio between two strings.
 * Used for rephrase detection — high overlap (>0.6) suggests
 * the user is rephrasing a previous query.
 */
export function wordOverlap(a: string, b: string): number {
	const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
	const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
	if (wordsA.size === 0 || wordsB.size === 0) return 0;
	let shared = 0;
	for (const w of wordsA) {
		if (wordsB.has(w)) shared++;
	}
	return shared / Math.max(wordsA.size, wordsB.size);
}

/**
 * Apply per-turn memory recall via the MemoryBridge.
 * Wraps the user message with recalled context if available.
 *
 * @param message - The raw user message.
 * @param options - Interactive mode options (memoryBridge).
 * @returns The (possibly augmented) prompt message.
 */
export function applyMemoryRecall(
	message: string,
	options: InteractiveModeOptions,
): string {
	if (!options.memoryBridge) return message;
	try {
		const recallContext = options.memoryBridge.recallForQuery(message);
		if (recallContext) {
			return `[Recalled memories]\n${recallContext}\n\n[User message]\n${message}`;
		}
	} catch {
		// Memory recall failed — proceed without recall context
	}
	return message;
}

/**
 * Apply retroactive rephrase penalty to the previous Turiya decision.
 * Called before routing the current turn.
 *
 * @param message - Current user message.
 * @param routing - Mutable routing state.
 * @param options - Interactive mode options (turiyaRouter).
 */
export function applyRephrasePenalty(
	message: string,
	routing: RoutingState,
	options: InteractiveModeOptions,
): void {
	if (!options.turiyaRouter || !routing.lastTuriyaDecision || !routing.lastUserMessage) return;
	const overlap = wordOverlap(routing.lastUserMessage, message);
	if (overlap > 0.6) {
		try {
			options.turiyaRouter.recordOutcome(routing.lastTuriyaDecision, 0.2);
		} catch { /* best-effort */ }
	}
}

/**
 * Perform per-turn model routing using Manas + Turiya or Marga fallback.
 * Modifies the agent model/provider as needed.
 *
 * @param message - The user's message for this turn.
 * @param agent - The Agent instance to modify.
 * @param routing - Mutable routing state (updated in place).
 * @param options - Interactive mode options.
 * @param stdout - Write stream for status output.
 */
export function routeModelForTurn(
	message: string,
	agent: Agent,
	routing: RoutingState,
	options: InteractiveModeOptions,
	stdout: NodeJS.WriteStream,
): { noLlmTemplateResponse?: string } {
	routing.lastTuriyaDecision = undefined;
	let noLlmTemplateResponse: string | undefined;

	// Path 1: Manas + Turiya (preferred)
	if (options.manas && options.turiyaRouter && !options.userExplicitModel) {
		try {
			const classification = options.manas.classify(message);
			const agentMessages = [...agent.getMessages()].map(m => ({
				role: (m as { role: string }).role,
				content: (m as { content: unknown }).content,
			}));
			agentMessages.push({ role: "user", content: [{ type: "text", text: message }] });

				const ctx = options.turiyaRouter.extractContext(agentMessages);
				const decision = options.turiyaRouter.classify(ctx);
				routing.lastTuriyaDecision = decision;
				if (decision.tier === "no-llm") {
					noLlmTemplateResponse = buildNoLlmTemplateResponse(message, classification.intent);
				} else {
					const tierModelHints: Record<string, string[]> = {
						"haiku": ["haiku", "claude-haiku", "gpt-4o-mini", "gemini-flash"],
						"sonnet": ["sonnet", "claude-sonnet", "gpt-4o", "gemini-pro"],
						"opus": ["opus", "claude-opus", "gpt-4", "o1", "gemini-ultra"],
					};
					const hints = tierModelHints[decision.tier];
					if (hints) {
						const currentLower = routing.currentModel.toLowerCase();
						const alreadyMatchesTier = hints.some(h => currentLower.includes(h));
						if (!alreadyMatchesTier && options.margaPipeline) {
							try {
								const margaDecision = options.margaPipeline.classify({
									messages: [{ role: "user", content: [{ type: "text", text: message }] }],
									systemPrompt: undefined,
								});
								if (margaDecision.modelId && margaDecision.modelId !== routing.currentModel) {
									if (options.providerRegistry) {
										const newProvider = options.providerRegistry.get(margaDecision.providerId);
										if (newProvider) {
											agent.setProvider(newProvider as Parameters<typeof agent.setProvider>[0]);
										}
									}
									agent.setModel(margaDecision.modelId);
									routing.currentModel = margaDecision.modelId;
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
			return { noLlmTemplateResponse };
		}

	// Path 2: Pure Marga fallback
	if (options.margaPipeline && !options.userExplicitModel) {
		try {
			const decision = options.margaPipeline.classify({
				messages: [{ role: "user", content: [{ type: "text", text: message }] }],
				systemPrompt: undefined,
			});
			if (decision.skipLLM) {
				noLlmTemplateResponse = buildNoLlmTemplateResponse(message, decision.taskType);
				stdout.write(
					dim(`  [marga: ${decision.taskType}/${decision.complexity} → no-llm]\n`),
				);
				return { noLlmTemplateResponse };
			}
			if (decision.modelId && decision.modelId !== routing.currentModel) {
				if (options.providerRegistry) {
					const newProvider = options.providerRegistry.get(decision.providerId);
					if (newProvider) {
						agent.setProvider(newProvider as Parameters<typeof agent.setProvider>[0]);
					}
				}
				agent.setModel(decision.modelId);
				routing.currentModel = decision.modelId;
				stdout.write(
					dim(`  [marga: ${decision.taskType}/${decision.complexity} → ${decision.modelId}]\n`),
				);
			}
		} catch {
			// Marga classification failed — continue with current model
		}
	}
	return { noLlmTemplateResponse };
}

/**
 * Attempt pre-prompt skill gap detection via Shiksha.
 * Returns true if Shiksha handled the query (skip LLM), false otherwise.
 *
 * @param message - The user's message.
 * @param options - Interactive mode options.
 * @param stdout - Write stream for output.
 * @returns Object indicating whether Shiksha handled the query and any output text.
 */
export async function tryShikshaIntercept(
	message: string,
	options: InteractiveModeOptions,
	stdout: NodeJS.WriteStream,
): Promise<{ handled: boolean; output?: string }> {
	if (!options.shiksha) return { handled: false };
	try {
		if (!options.shiksha.detectGap(message, [])) return { handled: false };
		const result = await options.shiksha.learn(message);
		if (result.success && result.executed && result.executionOutput) {
			stdout.write(dim(`  [shiksha: learned "${result.skill?.manifest.name}" in ${result.durationMs.toFixed(0)}ms]\n`));
			stdout.write(`\n${result.executionOutput}\n`);
			return { handled: true, output: result.executionOutput };
		}
		if (result.success && result.cloudRecipeDisplay) {
			stdout.write(dim(`  [shiksha: cloud recipe found in ${result.durationMs.toFixed(0)}ms]\n`));
			stdout.write(`\n${result.cloudRecipeDisplay}\n`);
			return { handled: true, output: result.cloudRecipeDisplay };
		}
	} catch (err) {
		log.warn("Shiksha intercept failed; falling back to agent", {
			error: err instanceof Error ? err.message : String(err),
		});
	}
	return { handled: false };
}

/**
 * Run post-turn hooks: Turiya learning, Soul confidence, self-reflection.
 *
 * @param message - The user's original message.
 * @param responseText - The assistant's streamed response text.
 * @param routing - Routing state with last Turiya decision.
 * @param options - Interactive mode options.
 * @param stdout - Write stream for reflection output.
 */
export function runPostTurnHooks(
	message: string,
	responseText: string,
	routing: RoutingState,
	options: InteractiveModeOptions,
	stdout: NodeJS.WriteStream,
): void {
	// Turiya learning
	if (options.turiyaRouter && routing.lastTuriyaDecision) {
		try {
			let reward = 0.8;
			if (responseText.length > 500) reward = 0.9;
			if (responseText.length > 2000) reward = 0.95;
			if (responseText.length < 20) reward = 0.3;
			options.turiyaRouter.recordOutcome(routing.lastTuriyaDecision, reward);
		} catch { /* best-effort */ }
	}

	// Soul confidence update
	if (options.soulManager && options.manas) {
		try {
			const intent = options.manas.classify(message).intent;
			options.soulManager.updateConfidence("root", intent, responseText.length > 50);
		} catch { /* best-effort */ }
	}

	// Self-reflection
	if (options.reflector && responseText.length > 0) {
		try {
			const reflection = options.reflector.reflect("root", message, responseText);
			if (reflection.score < 5 && reflection.weaknesses.length > 0) {
				stdout.write(
					dim(`  [reflect: score=${reflection.score.toFixed(1)} — ${reflection.weaknesses[0]}]\n`),
				);
			}
		} catch { /* best-effort */ }
	}

	// Track for next-turn rephrase detection
	routing.lastUserMessage = message;
}
