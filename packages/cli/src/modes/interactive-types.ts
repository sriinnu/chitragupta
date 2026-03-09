/**
 * @chitragupta/cli — Interactive mode type definitions.
 *
 * Soft-dependency interfaces that avoid hard imports of @chitragupta/swara,
 * @chitragupta/vidhya-skills, and other optional subsystem packages.
 */

import type { Agent } from "@chitragupta/anina";
import type { AgentProfile, BudgetConfig, InputRequest, ThinkingLevel } from "@chitragupta/core";
import type { ProjectInfo } from "../project-detector.js";

// ─── Marga Pipeline type (soft dependency — avoid hard import) ───────────────

/**
 * Minimal interface for MargaPipeline.classify().
 * Avoids a hard import of @chitragupta/swara from the interactive module.
 */
export interface MargaPipelineInstance {
	classify(
		context: { messages: Array<{ role: string; content: unknown }>; systemPrompt?: string },
		options?: {
			maxTokens?: number;
			temperature?: number;
			topP?: number;
			stopSequences?: string[];
			thinking?: { enabled: boolean; budgetTokens?: number };
			signal?: AbortSignal;
			routingInfluence?: {
				minimumComplexity?: "trivial" | "simple" | "medium" | "complex" | "expert";
				avoidSkipLLM?: boolean;
				rationale?: string;
			};
		},
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
export interface ProviderRegistryInstance {
	get(id: string): { id: string; name: string; stream: unknown } | undefined;
}

/**
 * Minimal interface for ShikshaController (avoids hard import of @chitragupta/vidhya-skills).
 */
export interface ShikshaInstance {
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

/** Minimal interface for Turiya contextual bandit router. */
export interface TuriyaRouterInstance {
	extractContext(
		messages: Array<{ role: string; content: unknown }>,
		systemPrompt?: string,
		tools?: unknown[],
		memoryHits?: number,
	): Record<string, number>;
	classify(context: Record<string, number>, preference?: {
		costWeight?: number;
		costWeightBias?: number;
		minimumTier?: string;
		maximumTier?: string;
	}): {
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

/** Manas zero-cost input classifier. */
export interface ManasInstance {
	classify(input: string): {
		intent: string;
		route: string;
		confidence: number;
		features: { hasCode: boolean; hasErrorStack: boolean; multiStep: boolean; wordCount: number };
		durationMs: number;
	};
}

/** SoulManager for personality-driven confidence and temperature. */
export interface SoulManagerInstance {
	updateConfidence(agentId: string, domain: string, success: boolean): void;
	addTrait(agentId: string, trait: string): void;
	getEffectiveTemperature(agentId: string, baseTemp: number): number;
}

/** AgentReflector for post-turn self-evaluation. */
export interface ReflectorInstance {
	reflect(agentId: string, taskDescription: string, output: string): {
		score: number;
		confidence: number;
		strengths: string[];
		weaknesses: string[];
		improvements: string[];
	};
}

/** Interactive mode configuration options. */
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
	onTurnComplete?: (userMessage: string, assistantResponse: string) => void | Promise<void>;
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
		} | Promise<{
			state: string;
			lastStateChange: number;
			lastHeartbeat: number;
			lastConsolidationStart?: number;
			lastConsolidationEnd?: number;
			consolidationPhase?: string;
			consolidationProgress: number;
			uptime: number;
		}>;
		wake(): void | Promise<void>;
	};
}

/** Reason the interactive session ended. */
export type ExitReason = "quit" | "sigint";
