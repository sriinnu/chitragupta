/**
 * @chitragupta/anina/chetana — ChetanaController — चेतना — Consciousness Orchestrator.
 *
 * The conductor of the four cognitive subsystems — Bhava (Affect), Dhyana
 * (Attention), Atma-Darshana (Self-Model), and Sankalpa (Intention). Each
 * subsystem operates independently, but the controller weaves their outputs
 * into a unified ChetanaContext that steers the agent's behavior on every turn.
 *
 * ## Lifecycle per Turn
 *
 * ```
 * beforeTurn(userMessage?)
 *   → extract intentions (Sankalpa)
 *   → track concepts (Dhyana)
 *   → produce ChetanaContext with steering suggestions
 *
 * afterToolExecution(toolName, success, latencyMs, resultContent, isUserCorrection?)
 *   → update affect (Bhava)
 *   → update attention (Dhyana)
 *   → update self-model (Atma-Darshana)
 *   → advance goals (Sankalpa)
 *
 * afterTurn()
 *   → decay affect (Bhava)
 *   → refresh salience (Dhyana)
 *   → advance stale counters (Sankalpa)
 * ```
 *
 * @packageDocumentation
 */

import type {
	ChetanaConfig,
	ChetanaContext,
	ChetanaState,
	CognitiveReport,
	AffectiveState,
} from "./types.js";
import { DEFAULT_CHETANA_CONFIG } from "./types.js";
import { BhavaSystem } from "./bhava.js";
import { DhyanaSystem } from "./dhyana.js";
import { AtmaDarshana } from "./atma-darshana.js";
import { SankalpaSystem } from "./sankalpa.js";

// ─── ChetanaController ──────────────────────────────────────────────────────

/**
 * Orchestrates the four cognitive subsystems of the Chetana consciousness
 * layer and produces unified context for agent steering.
 */
export class ChetanaController {
	private bhava: BhavaSystem;
	private dhyana: DhyanaSystem;
	private atma: AtmaDarshana;
	private sankalpa: SankalpaSystem;
	private config: ChetanaConfig;
	private onEvent?: (event: string, data: unknown) => void;

	constructor(
		config?: Partial<ChetanaConfig>,
		onEvent?: (event: string, data: unknown) => void,
	) {
		this.config = { ...DEFAULT_CHETANA_CONFIG, ...config };
		this.onEvent = onEvent;

		this.bhava = new BhavaSystem(this.config, onEvent);
		this.dhyana = new DhyanaSystem(this.config);
		this.atma = new AtmaDarshana(this.config, onEvent);
		this.sankalpa = new SankalpaSystem(this.config, onEvent);
	}

	// ─── Per-Turn Lifecycle ─────────────────────────────────────────────────

	/**
	 * Called before each turn. Returns cognitive context for steering.
	 *
	 * 1. Extracts intentions from the user message (if provided)
	 * 2. Tracks concepts in the attention system
	 * 3. Registers the message for salience tracking
	 * 4. Builds steering suggestions from the current cognitive state
	 */
	beforeTurn(userMessage?: string): ChetanaContext {
		// 1. Extract intentions from user message
		if (userMessage) {
			this.sankalpa.extractFromMessage(userMessage);
		}

		// 2. Track concepts for attention
		if (userMessage) {
			this.dhyana.trackConcepts(userMessage);
		}

		// 3. Register message in attention system
		this.dhyana.addMessage(crypto.randomUUID(), false, false);

		// 4. Build cognitive context with steering suggestions
		const affect = this.bhava.getState();
		const attention = this.dhyana.getWeights();
		const selfAssessment = this.atma.getSelfAssessment();
		const activeIntentions = this.sankalpa.getActiveIntentions();
		const steeringSuggestions = this.computeSteeringSuggestions(affect, activeIntentions);

		return {
			affect: { ...affect },
			attention,
			selfAssessment,
			activeIntentions,
			steeringSuggestions,
		};
	}

	/**
	 * Called after each turn completes.
	 *
	 * Applies temporal decay to affect, refreshes attention salience,
	 * and increments stale counters on intentions.
	 */
	afterTurn(): void {
		this.bhava.decayTurn();
		this.dhyana.refreshSalience();
		this.sankalpa.endTurn();
	}

	/**
	 * Called after each tool execution within a turn.
	 *
	 * Updates all four subsystems with the tool outcome.
	 */
	afterToolExecution(
		toolName: string,
		success: boolean,
		latencyMs: number,
		resultContent: string,
		isUserCorrection?: boolean,
	): void {
		// Bhava: update affect (bhava expects isError, not success)
		this.bhava.onToolResult(toolName, !success, isUserCorrection ?? false);

		// Dhyana: update tool attention
		this.dhyana.onToolUsed(toolName, success, success ? 0.8 : 0.2);

		// Atma-Darshana: record tool result for mastery tracking
		this.atma.recordToolResult(toolName, success, latencyMs);

		// Sankalpa: check if tool result advances any intention
		this.sankalpa.onToolResult(toolName, resultContent);
	}

	// ─── External Signals ───────────────────────────────────────────────────

	/** Called when a sub-agent is spawned (arousal spike). */
	onSubAgentSpawn(): void {
		this.bhava.onSubAgentSpawn();
	}

	/** Update confidence from external LearningLoop data. */
	updateConfidence(successRate: number): void {
		this.bhava.updateConfidence(successRate);
	}

	/** Mark a tool as disabled by the autonomy layer. */
	markToolDisabled(toolName: string, reason: string): void {
		this.atma.markToolDisabled(toolName, reason);
	}

	// ─── Cognitive Report ───────────────────────────────────────────────────

	/**
	 * Get a formatted cognitive report for inspection/debugging.
	 *
	 * Assembles data from all four subsystems into a single
	 * CognitiveReport suitable for the /chetana command.
	 */
	getCognitiveReport(): CognitiveReport {
		const affect = this.bhava.getState();
		const weights = this.dhyana.getWeights();
		const selfModel = this.atma.getModel();
		const intentions = this.sankalpa.getIntentions();

		// Top 10 concepts sorted by weight descending
		const topConcepts = [...weights.concepts.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.map(([concept, weight]) => ({ concept, weight }));

		// Top 10 tools by attention weight descending
		const topTools = [...weights.tools.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.map(([tool, weight]) => ({ tool, weight }));

		// Top tools by mastery for self-summary
		const topMasteryTools = [...selfModel.toolMastery.entries()]
			.sort((a, b) => b[1].successRate - a[1].successRate)
			.slice(0, 10)
			.map(([tool, mastery]) => ({ tool, mastery }));

		return {
			affect: { ...affect },
			topConcepts,
			topTools,
			selfSummary: {
				calibration: selfModel.calibration,
				learningVelocity: selfModel.learningVelocity,
				topTools: topMasteryTools,
				limitations: [...selfModel.knownLimitations],
				style: new Map(selfModel.styleFingerprint),
			},
			intentions,
		};
	}

	// ─── Serialization ──────────────────────────────────────────────────────

	/** Serialize the full consciousness state for persistence. */
	serialize(): ChetanaState {
		return {
			affect: this.bhava.serialize(),
			attention: this.dhyana.serialize(),
			selfModel: this.atma.serialize(),
			intentions: this.sankalpa.serialize(),
		};
	}

	/**
	 * Restore a ChetanaController from a previously serialized state.
	 *
	 * Creates a new controller and replaces all subsystems with
	 * deserialized instances, preserving the full cognitive state.
	 */
	static deserialize(
		state: ChetanaState,
		config?: Partial<ChetanaConfig>,
		onEvent?: (event: string, data: unknown) => void,
	): ChetanaController {
		const mergedConfig = { ...DEFAULT_CHETANA_CONFIG, ...config };
		const controller = new ChetanaController(config, onEvent);

		// Replace subsystems with deserialized instances
		controller.bhava = BhavaSystem.deserialize(state.affect, mergedConfig, onEvent);
		controller.dhyana = DhyanaSystem.deserialize(state.attention, mergedConfig);
		controller.atma = AtmaDarshana.deserialize(state.selfModel, mergedConfig, onEvent);
		controller.sankalpa = SankalpaSystem.deserialize(state.intentions, mergedConfig, onEvent);

		return controller;
	}

	// ─── Internal ───────────────────────────────────────────────────────────

	/**
	 * Compute steering suggestions based on the current cognitive state.
	 *
	 * Examines frustration, confidence, calibration, and intention
	 * staleness to produce actionable suggestions for the agent.
	 */
	private computeSteeringSuggestions(
		affect: Readonly<AffectiveState>,
		activeIntentions: readonly { staleTurns: number; goal: string }[],
	): string[] {
		const suggestions: string[] = [];

		// Frustration alert
		if (affect.frustration >= this.config.frustrationAlertThreshold) {
			suggestions.push("Consider a simpler approach — frustration is high");
		}

		// Confidence allows autonomy
		if (affect.confidence >= this.config.confidenceAutonomyThreshold) {
			suggestions.push("High confidence — can proceed autonomously");
		}

		// Stalling goals
		const halfThreshold = this.config.goalAbandonmentThreshold / 2;
		for (const intention of activeIntentions) {
			if (intention.staleTurns > halfThreshold) {
				suggestions.push(`Goal '${intention.goal}' may be stalling — refocus?`);
			}
		}

		// Calibration warnings
		const calibration = this.atma.getModel().calibration;
		if (calibration > 1.3) {
			suggestions.push("May be overconfident — verify assumptions");
		}
		if (calibration < 0.7) {
			suggestions.push("Underconfident — trust your capabilities more");
		}

		return suggestions;
	}
}
