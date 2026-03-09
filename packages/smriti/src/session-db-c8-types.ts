export interface ToolUsageObservation {
	type: "tool_usage";
	sessionId: string;
	tool: string;
	argsHash?: string;
	durationMs?: number;
	success?: boolean;
	currentFile?: string;
	timestamp?: number;
}

export interface ErrorResolutionObservation {
	type: "error_resolution";
	sessionId: string;
	tool: string;
	errorMsg?: string;
	resolution?: string;
	timestamp?: number;
}

export interface EditPatternObservation {
	type: "edit_pattern";
	sessionId: string;
	files: string[];
	editType?: string;
	coEdited?: string[];
	timestamp?: number;
}

export interface UserCorrectionObservation {
	type: "user_correction";
	sessionId: string;
	originalHash?: string;
	correctedHash?: string;
	context?: string;
	timestamp?: number;
}

export interface PreferenceObservation {
	type: "preference";
	key: string;
	value: string;
	confidence?: number;
	frequency?: number;
	timestamp?: number;
}

export type ObservationEvent =
	| ToolUsageObservation
	| ErrorResolutionObservation
	| EditPatternObservation
	| UserCorrectionObservation
	| PreferenceObservation;

export interface ObservationBatchResult {
	accepted: number;
}

export interface DetectedPatternInput {
	type: string;
	pattern: unknown;
	confidence: number;
	occurrences?: number;
	timestamp?: number;
}

export interface DetectedPatternRow {
	id: number;
	type: string;
	pattern: unknown;
	confidence: number;
	occurrences: number;
	firstSeen: number | null;
	lastSeen: number | null;
}

export interface PatternQueryOptions {
	type?: string;
	minConfidence?: number;
	limit?: number;
}

export interface PredictNextOptions {
	sessionId?: string;
	currentTool?: string;
	currentFile?: string;
	limit?: number;
}

export interface NextStatePrediction {
	action: string;
	confidence: number;
	reasoning: string;
	count: number;
}

export type HealOutcome = "success" | "partial" | "failed";

export interface HealReportInput {
	anomalyType: string;
	actionTaken: string;
	outcome: HealOutcome;
	sessionId?: string;
	timestamp?: number;
}
