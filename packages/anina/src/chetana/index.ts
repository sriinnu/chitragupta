/**
 * @chitragupta/anina/chetana — चेतना — Consciousness Layer.
 *
 * Re-exports all four cognitive subsystems and the orchestrating controller.
 */

// ─── Subsystems ──────────────────────────────────────────────────────────────
export { BhavaSystem } from "./bhava.js";
export { DhyanaSystem } from "./dhyana.js";
export { AtmaDarshana } from "./atma-darshana.js";
export { SankalpaSystem } from "./sankalpa.js";
export { Triguna } from "./triguna.js";
export { NavaRasa } from "./nava-rasa.js";

// ─── Controller ──────────────────────────────────────────────────────────────
export { ChetanaController } from "./controller.js";

// ─── Types ───────────────────────────────────────────────────────────────────
export type {
	AffectiveState,
	AttentionWeights,
	SelfModel,
	ToolMastery,
	Intention,
	IntentionPriority,
	IntentionStatus,
	ChetanaContext,
	CognitiveReport,
	ChetanaConfig,
	CognitivePriors,
	ChetanaState,
} from "./types.js";

export type {
	GunaState,
	TrigunaObservation,
	GunaSnapshot,
	GunaTrend,
	TrendDirection,
	GunaLabel,
	TrigunaEventType,
	TrigunaConfig,
	TrigunaSerializedState,
} from "./triguna.js";

export type {
	RasaType,
	RasaState,
	RasaObservation,
	RasaSnapshot,
	AutonomyLevel,
	VerbosityStyle,
	RasaBehavioralAdaptation,
	NavaRasaEventType,
	NavaRasaConfig,
	NavaRasaSerializedState,
} from "./nava-rasa.js";

// ─── Constants ───────────────────────────────────────────────────────────────
export {
	DEFAULT_CHETANA_CONFIG,
	SYSTEM_MAX_INTENTIONS,
	SYSTEM_MAX_LIMITATIONS,
	SYSTEM_MAX_EVIDENCE,
	SYSTEM_MAX_FOCUS_WINDOW,
	SYSTEM_MAX_CALIBRATION_WINDOW,
} from "./types.js";

export {
	DEFAULT_TRIGUNA_CONFIG,
	SYSTEM_MAX_TRIGUNA_HISTORY,
	ilrForward,
	ilrInverse,
} from "./triguna.js";

export {
	RASA_LABELS,
	DEFAULT_NAVA_RASA_CONFIG,
	SYSTEM_MAX_NAVA_RASA_HISTORY,
} from "./nava-rasa.js";
