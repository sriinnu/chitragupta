/**
 * @chitragupta/anina/chetana — चेतना — Consciousness Layer Types.
 *
 * Shared interfaces for the four cognitive subsystems:
 * Bhava (Affect), Dhyana (Attention), Atma-Darshana (Self-Model), Sankalpa (Intention).
 */

// ─── Bhava (Affect / Emotional State) ────────────────────────────────────────

/** The agent's current emotional/affective state across four dimensions. */
export interface AffectiveState {
	/** Emotional polarity: negative (-1) ↔ positive (+1). */
	valence: number;
	/** Activation level: calm (0) ↔ excited (1). */
	arousal: number;
	/** Self-assessed certainty: uncertain (0) ↔ certain (1). */
	confidence: number;
	/** Accumulated frustration from errors: calm (0) ↔ frustrated (1). */
	frustration: number;
}

// ─── Dhyana (Attention / Salience) ───────────────────────────────────────────

/** Attention weights across messages, concepts, and tools. */
export interface AttentionWeights {
	/** Message ID → salience score [0, 1]. */
	messages: Map<string, number>;
	/** Concept (keyword) → current focus weight [0, 1]. */
	concepts: Map<string, number>;
	/** Tool name → attention priority [0, 1]. */
	tools: Map<string, number>;
}

// ─── Atma-Darshana (Self-Model / Metacognition) ─────────────────────────────

/** Per-tool competence assessment with statistical rigor. */
export interface ToolMastery {
	/** Success rate [0, 1]. */
	successRate: number;
	/** Average execution latency in ms. */
	avgLatency: number;
	/** Wilson score confidence interval [lower, upper]. */
	confidenceInterval: [number, number];
	/** Timestamp of last improvement. */
	lastImproved: number;
	/** Directional trend based on sliding window. */
	trend: "improving" | "stable" | "declining";
	/** Total number of invocations. */
	totalInvocations: number;
	/** Total successes. */
	successes: number;
}

/** The agent's self-model: capability awareness and behavioral fingerprint. */
export interface SelfModel {
	/** Per-tool competence tracking. */
	toolMastery: Map<string, ToolMastery>;
	/** Learned limitations discovered during operation. */
	knownLimitations: string[];
	/** Calibration ratio: predicted success / actual success. ≈1.0 = well-calibrated. */
	calibration: number;
	/** Rate of improvement (sliding window derivative). */
	learningVelocity: number;
	/** Behavioral tendency fingerprint as normalized dimensions. */
	styleFingerprint: Map<string, number>;
}

// ─── Sankalpa (Intention / Goal Persistence) ─────────────────────────────────

/** Priority level for an intention/goal. */
export type IntentionPriority = "critical" | "high" | "normal" | "low";

/** Lifecycle status of an intention. */
export type IntentionStatus = "active" | "paused" | "achieved" | "abandoned";

/** A persistent goal that survives across turns and sessions. */
export interface Intention {
	/** Unique intention ID (FNV-1a hash of goal text). */
	id: string;
	/** Natural language description of the goal. */
	goal: string;
	/** Priority level. */
	priority: IntentionPriority;
	/** Current lifecycle status. */
	status: IntentionStatus;
	/** Progress toward completion [0, 1]. */
	progress: number;
	/** Timestamp when this intention was created. */
	createdAt: number;
	/** Timestamp when progress was last advanced. */
	lastAdvancedAt: number;
	/** Evidence of progress: tool calls/results that advanced this goal. */
	evidence: string[];
	/** Decomposed sub-steps. */
	subgoals: string[];
	/** Number of turns with no progress. */
	staleTurns: number;
	/** Number of times the user mentioned this goal. */
	mentionCount: number;
}

// ─── ChetanaController Orchestration ─────────────────────────────────────────

/** Combined cognitive context produced by ChetanaController.beforeTurn(). */
export interface ChetanaContext {
	/** Current affective state (mood/emotion). */
	affect: AffectiveState;
	/** Attention weights for context prioritization. */
	attention: AttentionWeights;
	/** Self-assessment summary (natural language). */
	selfAssessment: string;
	/** Active intentions for goal-directed behavior. */
	activeIntentions: Intention[];
	/** Steering suggestions based on cognitive state. */
	steeringSuggestions: string[];
}

/** Formatted cognitive report for the /chetana command. */
export interface CognitiveReport {
	/** Section: Affect (Bhava). */
	affect: AffectiveState;
	/** Section: Top attention concepts. */
	topConcepts: Array<{ concept: string; weight: number }>;
	/** Section: Top attention tools. */
	topTools: Array<{ tool: string; weight: number }>;
	/** Section: Self-model summary. */
	selfSummary: {
		calibration: number;
		learningVelocity: number;
		topTools: Array<{ tool: string; mastery: ToolMastery }>;
		limitations: string[];
		style: Map<string, number>;
	};
	/** Section: Active intentions. */
	intentions: Intention[];
}

// ─── Configuration ───────────────────────────────────────────────────────────

/** Configuration for the Chetana consciousness layer. */
export interface ChetanaConfig {
	/** Whether chetana is enabled. Default: true. */
	enabled: boolean;
	/** Rate at which affect dimensions drift toward neutral per turn. Default: 0.02. */
	affectDecayRate: number;
	/** Number of top messages kept "in focus". Default: 20. */
	attentionFocusWindow: number;
	/** Whether to persist self-model to disk. Default: true. */
	selfModelPersistence: boolean;
	/** Turns with no progress before a goal is paused. Default: 15. */
	goalAbandonmentThreshold: number;
	/** Frustration increment per tool error. Default: 0.15. */
	frustrationPerError: number;
	/** Frustration decrement per tool success. Default: 0.05. */
	frustrationDecayPerSuccess: number;
	/** Frustration increment per user correction. Default: 0.25. */
	frustrationPerCorrection: number;
	/** Frustration level that triggers "frustrated" event. Default: 0.7. */
	frustrationAlertThreshold: number;
	/** Confidence level that allows more autonomy. Default: 0.8. */
	confidenceAutonomyThreshold: number;
	/** Recency decay lambda for attention scoring. Default: 0.1. */
	attentionRecencyLambda: number;
	/** Salience boost for messages near errors. Default: 0.3. */
	attentionErrorBoost: number;
	/** Salience boost for user corrections. Default: 0.5. */
	attentionCorrectionBoost: number;
	/** Number of recent tool results in the calibration window. Default: 50. */
	calibrationWindow: number;
	/** Maximum number of known limitations to track. Default: 20. */
	maxLimitations: number;
	/** Maximum number of active intentions. Default: 10. */
	maxIntentions: number;
	/** Maximum evidence entries per intention. Default: 20. */
	maxEvidencePerIntention: number;
}

/** Cognitive priors on an AgentProfile — tunable personality knobs. */
export interface CognitivePriors {
	/** Baseline arousal level [0, 1]. Default: 0.3. */
	baseArousal?: number;
	/** How strongly affect reacts to events [0, 1]. Default: 0.5. */
	emotionalReactivity?: number;
	/** How strongly goals drive behavior [0, 1]. Default: 0.5. */
	goalOrientedness?: number;
	/** How strongly self-model influences decisions [0, 1]. Default: 0.5. */
	selfAwareness?: number;
}

// ─── System Ceilings ─────────────────────────────────────────────────────────

/** Absolute system ceiling: maximum intentions. Cannot exceed this. */
export const SYSTEM_MAX_INTENTIONS = 50;

/** Absolute system ceiling: maximum known limitations. */
export const SYSTEM_MAX_LIMITATIONS = 100;

/** Absolute system ceiling: maximum evidence per intention. */
export const SYSTEM_MAX_EVIDENCE = 100;

/** Absolute system ceiling: maximum focus window size. */
export const SYSTEM_MAX_FOCUS_WINDOW = 200;

/** Absolute system ceiling: maximum calibration window size. */
export const SYSTEM_MAX_CALIBRATION_WINDOW = 500;

// ─── Defaults ────────────────────────────────────────────────────────────────

/** Default configuration for the Chetana consciousness layer. */
export const DEFAULT_CHETANA_CONFIG: ChetanaConfig = {
	enabled: true,
	affectDecayRate: 0.02,
	attentionFocusWindow: 20,
	selfModelPersistence: true,
	goalAbandonmentThreshold: 15,
	frustrationPerError: 0.15,
	frustrationDecayPerSuccess: 0.05,
	frustrationPerCorrection: 0.25,
	frustrationAlertThreshold: 0.7,
	confidenceAutonomyThreshold: 0.8,
	attentionRecencyLambda: 0.1,
	attentionErrorBoost: 0.3,
	attentionCorrectionBoost: 0.5,
	calibrationWindow: 50,
	maxLimitations: 20,
	maxIntentions: 10,
	maxEvidencePerIntention: 20,
};

// ─── Serialization ───────────────────────────────────────────────────────────

/** Serializable state for the entire Chetana system. */
export interface ChetanaState {
	affect: AffectiveState;
	attention: {
		concepts: Array<[string, number]>;
		tools: Array<[string, number]>;
	};
	selfModel: {
		toolMastery: Array<[string, ToolMastery]>;
		knownLimitations: string[];
		calibration: number;
		learningVelocity: number;
		styleFingerprint: Array<[string, number]>;
	};
	intentions: Intention[];
}
