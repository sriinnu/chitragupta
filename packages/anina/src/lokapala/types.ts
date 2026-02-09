/**
 * @chitragupta/anina/lokapala — Shared Types.
 *
 * In Vedic mythology, the Lokapalas (लोकपाल) are the eight guardian deities
 * who protect the cardinal directions. In Chitragupta, they are specialized
 * autonomous guardians that continuously monitor different quality dimensions
 * -- security, performance, and correctness -- broadcasting their findings
 * to Samiti channels.
 *
 * @packageDocumentation
 */

// ─── Domain & Severity ──────────────────────────────────────────────────────

/** Quality dimension monitored by a guardian. */
export type GuardianDomain = "security" | "performance" | "correctness";

/** Severity levels for findings, from informational to critical. */
export type FindingSeverity = "info" | "warning" | "critical";

// ─── Finding ────────────────────────────────────────────────────────────────

/** A single issue discovered by a guardian during scanning or observation. */
export interface Finding {
	/** Deterministic FNV-1a ID derived from guardian + title + location. */
	id: string;
	/** ID of the guardian that produced this finding. */
	guardianId: string;
	/** Quality domain this finding belongs to. */
	domain: GuardianDomain;
	/** Severity level. */
	severity: FindingSeverity;
	/** Short human-readable title. */
	title: string;
	/** Detailed description of the issue. */
	description: string;
	/** Location of the issue (file:line, tool:arg, etc.). */
	location?: string;
	/** Suggested auto-fix, if available. */
	suggestion?: string;
	/** Confidence in the finding, in [0, 1]. */
	confidence: number;
	/** Whether an automated fix can be applied. */
	autoFixable: boolean;
	/** Unix timestamp (ms) of when the finding was created. */
	timestamp: number;
}

// ─── Guardian Config ────────────────────────────────────────────────────────

/** Configuration for a single guardian. Two-tier: user config clamped by HARD_CEILINGS. */
export interface GuardianConfig {
	/** Whether this guardian is active. */
	enabled: boolean;
	/** Milliseconds between automatic scans (0 = on-demand only). */
	scanInterval: number;
	/** Minimum confidence for a finding to be reported. */
	confidenceThreshold: number;
	/** Minimum confidence for auto-fix to be applied. */
	autoFixThreshold: number;
	/** Maximum findings retained (ring buffer size). */
	maxFindings: number;
}

/** System-level hard ceilings that cannot be overridden by user config. */
export const HARD_CEILINGS = {
	maxFindings: 1000,
	minScanInterval: 1000,
	maxConfidenceThreshold: 1.0,
	minConfidenceThreshold: 0.1,
} as const;

/** Sensible defaults for guardian configuration. */
export const DEFAULT_GUARDIAN_CONFIG: GuardianConfig = {
	enabled: true,
	scanInterval: 0,
	confidenceThreshold: 0.5,
	autoFixThreshold: 0.9,
	maxFindings: 200,
};

// ─── Guardian Stats ─────────────────────────────────────────────────────────

/** Aggregate statistics for a guardian's activity. */
export interface GuardianStats {
	/** Total scans or observation rounds completed. */
	scansCompleted: number;
	/** Total findings produced. */
	findingsTotal: number;
	/** Breakdown of findings by severity. */
	findingsBySeverity: Record<string, number>;
	/** Number of auto-fixes applied. */
	autoFixesApplied: number;
	/** Unix timestamp of the last scan. */
	lastScanAt: number;
	/** Average scan duration in milliseconds. */
	avgScanDurationMs: number;
}

// ─── Scan Context ───────────────────────────────────────────────────────────

/** Context provided to Rakshaka for a security scan. */
export interface ScanContext {
	/** Recent tool executions with their outputs. */
	toolExecutions: Array<{
		toolName: string;
		args: Record<string, unknown>;
		output: string;
		durationMs: number;
	}>;
	/** File paths that changed recently. */
	fileChanges?: string[];
	/** Raw command outputs to scan. */
	commandOutputs?: string[];
}

// ─── Performance Metrics ────────────────────────────────────────────────────

/** Metrics observed by Gati on each turn or tool execution. */
export interface PerformanceMetrics {
	/** Tokens consumed in this turn. */
	tokensThisTurn: number;
	/** Tool that was executed (if any). */
	toolName?: string;
	/** Duration of the tool execution in ms. */
	toolDurationMs?: number;
	/** Percentage of context window used (0-100). */
	contextUsedPct: number;
	/** Current turn number. */
	turnNumber: number;
}

// ─── Turn Observation ───────────────────────────────────────────────────────

/** Observation data for Satya's correctness monitoring. */
export interface TurnObservation {
	/** Who produced this turn. */
	role: "user" | "assistant";
	/** Text content of the turn. */
	content: string;
	/** Tool results from this turn (if any). */
	toolResults?: Array<{
		name: string;
		success: boolean;
		error?: string;
	}>;
	/** Current turn number. */
	turnNumber: number;
}

// ─── Controller Config ─────────────────────────────────────────────────────

/** Top-level configuration for the LokapalaController. */
export interface LokapalaConfig {
	/** Configuration for Rakshaka (security guardian). */
	security: Partial<GuardianConfig>;
	/** Configuration for Gati (performance guardian). */
	performance: Partial<GuardianConfig>;
	/** Configuration for Satya (correctness guardian). */
	correctness: Partial<GuardianConfig>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** FNV-1a 32-bit offset basis. */
const FNV_OFFSET = 0x811c9dc5;

/** FNV-1a 32-bit prime. */
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a 32-bit hash.
 *
 * Produces a deterministic hex string from arbitrary input.
 * Used to generate stable, reproducible Finding IDs.
 */
export function fnv1a(input: string): string {
	let hash = FNV_OFFSET;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, FNV_PRIME) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

/**
 * Clamp a value to [min, max].
 */
export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/**
 * Merge user-supplied partial config with defaults, then clamp against HARD_CEILINGS.
 */
export function resolveConfig(partial?: Partial<GuardianConfig>): GuardianConfig {
	const merged: GuardianConfig = { ...DEFAULT_GUARDIAN_CONFIG, ...partial };

	// Clamp against hard ceilings
	merged.maxFindings = Math.min(merged.maxFindings, HARD_CEILINGS.maxFindings);
	if (merged.scanInterval > 0) {
		merged.scanInterval = Math.max(merged.scanInterval, HARD_CEILINGS.minScanInterval);
	}
	merged.confidenceThreshold = clamp(
		merged.confidenceThreshold,
		HARD_CEILINGS.minConfidenceThreshold,
		HARD_CEILINGS.maxConfidenceThreshold,
	);
	merged.autoFixThreshold = clamp(
		merged.autoFixThreshold,
		HARD_CEILINGS.minConfidenceThreshold,
		HARD_CEILINGS.maxConfidenceThreshold,
	);

	return merged;
}

/**
 * Ring buffer for findings — fixed capacity, oldest evicted on overflow.
 *
 * Zero-allocation in the hot path (no array resizing); uses a circular
 * index with modular arithmetic.
 */
export class FindingRing {
	private readonly buffer: Array<Finding | undefined>;
	private head: number = 0;
	private count: number = 0;

	constructor(readonly capacity: number) {
		this.buffer = new Array(capacity);
	}

	/** Push a finding into the ring. Evicts oldest if at capacity. */
	push(finding: Finding): void {
		this.buffer[this.head] = finding;
		this.head = (this.head + 1) % this.capacity;
		if (this.count < this.capacity) this.count++;
	}

	/** Return findings ordered newest-first (most recent at index 0). */
	toArray(limit?: number): Finding[] {
		const results: Finding[] = [];
		const n = limit ? Math.min(limit, this.count) : this.count;
		for (let i = 0; i < n; i++) {
			const idx = ((this.head - 1 - i) % this.capacity + this.capacity) % this.capacity;
			const f = this.buffer[idx];
			if (f) results.push(f);
		}
		return results;
	}

	/** Current number of findings stored. */
	get size(): number {
		return this.count;
	}

	/** Clear all findings. */
	clear(): void {
		this.buffer.fill(undefined);
		this.head = 0;
		this.count = 0;
	}
}
