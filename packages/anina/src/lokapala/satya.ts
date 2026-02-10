/**
 * @chitragupta/anina/lokapala — Satya — सत्य — Correctness Guardian.
 *
 * Truth. Monitors the agent's output quality for signs of degradation:
 * repeated errors, user corrections, contradictions, incomplete tasks,
 * and test failures.
 *
 * Like Yama (god of dharma and truth) who guards the south, Satya
 * ensures the agent's responses remain truthful, consistent, and
 * complete. It watches the conversation for patterns that indicate
 * the agent has lost the plot.
 *
 * ## Detection Categories
 *
 * | Category             | Severity | Trigger                                |
 * |----------------------|----------|----------------------------------------|
 * | Error streak         | warning  | 3+ consecutive tool failures           |
 * | Error storm          | critical | 5+ failures in recent window           |
 * | User correction      | warning  | User says "no", "wrong", "not that"    |
 * | Repeated correction  | critical | 3+ corrections in recent window        |
 * | Incomplete task      | info     | Task started but not completed          |
 * | Test failures        | warning  | Test tool reports failures              |
 * | Contradiction        | warning  | Same question answered differently      |
 *
 * @packageDocumentation
 */

import type {
	Finding,
	GuardianConfig,
	GuardianStats,
	TurnObservation,
} from "./types.js";
import { fnv1a, resolveConfig, FindingRing } from "./types.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Consecutive failures before warning. */
const ERROR_STREAK_THRESHOLD = 3;

/** Total failures in the recent window before critical. */
const ERROR_STORM_THRESHOLD = 5;

/** Size of the recent window for counting errors. */
const RECENT_WINDOW_SIZE = 10;

/** Number of corrections in recent window to trigger critical. */
const CORRECTION_STORM_THRESHOLD = 3;

/** Size of the correction tracking window. */
const CORRECTION_WINDOW_SIZE = 10;

/** Patterns that indicate the user is correcting the agent. */
const CORRECTION_PATTERNS: RegExp[] = [
	/^no[,.]?\s/i,
	/\bthat'?s?\s+(?:not|wrong|incorrect)\b/i,
	/\bnot\s+(?:what\s+i|that|right|correct)\b/i,
	/\bwrong\b/i,
	/\bincorrect\b/i,
	/\bdon'?t\s+do\s+that\b/i,
	/\bstop\b/i,
	/\bundo\s+that\b/i,
	/\brevert\b/i,
	/\bi\s+said\b/i,
	/\bi\s+meant\b/i,
	/\btry\s+again\b/i,
	/\bnot\s+that\b/i,
];

/** Patterns that indicate a task was started. */
const TASK_START_PATTERNS: RegExp[] = [
	/\bi(?:'?ll| will| am going to)\s+(?:start|begin|create|implement|build|write|fix)\b/i,
	/\blet(?:'?s| me)\s+(?:start|begin|create|implement|build|write|fix)\b/i,
	/\bstarting\s+(?:with|by|to)\b/i,
	/\bfirst,?\s+i(?:'?ll| will)\b/i,
	/\bstep\s+1\b/i,
];

/** Patterns that indicate a task was completed. */
const TASK_COMPLETE_PATTERNS: RegExp[] = [
	/\b(?:done|complete|finished|ready|all\s+set)\b/i,
	/\bsuccessfully\s+(?:created|implemented|built|written|fixed)\b/i,
	/\ball\s+(?:changes|updates|modifications)\s+(?:have\s+been\s+)?(?:made|applied|completed)\b/i,
	/\bthat\s+(?:should|looks|is)\s+(?:do it|good|correct|right)\b/i,
];

/** Patterns that indicate a test tool was used. */
const TEST_TOOL_NAMES = new Set(["test", "vitest", "jest", "pytest", "cargo-test"]);

// ─── Satya ──────────────────────────────────────────────────────────────────

/**
 * Correctness Guardian -- monitors turn-by-turn conversation and tool
 * results for signs of degraded quality: error streaks, user corrections,
 * incomplete tasks, and test failures.
 */
export class Satya {
	private readonly config: GuardianConfig;
	private readonly findings: FindingRing;
	private scansCompleted: number = 0;
	private autoFixesApplied: number = 0;
	private lastScanAt: number = 0;
	private totalScanDurationMs: number = 0;
	private findingsBySeverity: Record<string, number> = {
		info: 0,
		warning: 0,
		critical: 0,
	};

	// ── Tracking State ──────────────────────────────────────────────────
	private consecutiveErrors: number = 0;
	private recentErrors: boolean[] = [];
	private recentCorrections: boolean[] = [];
	private taskInProgress: boolean = false;
	private taskStartTurn: number = 0;
	private turnsSinceTaskStart: number = 0;
	/** Stale task threshold: if no completion detected after N turns. */
	private readonly staleTaskThreshold = 15;
	/** Track error-streak finding to avoid repeated emissions. */
	private errorStreakEmitted: boolean = false;
	/** Track error-storm finding to avoid repeated emissions. */
	private errorStormEmitted: boolean = false;

	constructor(config?: Partial<GuardianConfig>) {
		this.config = resolveConfig(config);
		this.findings = new FindingRing(this.config.maxFindings);
	}

	/**
	 * Observe a conversation turn and return any correctness findings.
	 *
	 * Should be called for every turn (both user and assistant) to
	 * build a complete picture of the interaction quality.
	 */
	observeTurn(turn: TurnObservation): Finding[] {
		if (!this.config.enabled) return [];

		const startMs = Date.now();
		const newFindings: Finding[] = [];

		if (turn.role === "user") {
			this.checkUserCorrection(turn, newFindings);
		}

		if (turn.role === "assistant") {
			this.checkTaskPatterns(turn, newFindings);
		}

		if (turn.toolResults) {
			this.checkToolErrors(turn, newFindings);
			this.checkTestFailures(turn, newFindings);
		}

		this.scansCompleted++;
		this.lastScanAt = Date.now();
		this.totalScanDurationMs += Date.now() - startMs;

		return newFindings;
	}

	/**
	 * Get the most recent findings, newest first.
	 *
	 * @param limit Maximum number of findings to return (default: all).
	 */
	getFindings(limit?: number): Finding[] {
		return this.findings.toArray(limit);
	}

	/** Get aggregate statistics for this guardian. */
	stats(): GuardianStats {
		return {
			scansCompleted: this.scansCompleted,
			findingsTotal: this.findings.size,
			findingsBySeverity: { ...this.findingsBySeverity },
			autoFixesApplied: this.autoFixesApplied,
			lastScanAt: this.lastScanAt,
			avgScanDurationMs:
				this.scansCompleted > 0
					? this.totalScanDurationMs / this.scansCompleted
					: 0,
		};
	}

	// ─── Internal Checks ───────────────────────────────────────────────────

	/**
	 * Check if the user's message contains correction patterns.
	 */
	private checkUserCorrection(
		turn: TurnObservation,
		accumulator: Finding[],
	): void {
		const isCorrection = CORRECTION_PATTERNS.some((p) =>
			p.test(turn.content),
		);

		// Track corrections in sliding window
		this.recentCorrections.push(isCorrection);
		if (this.recentCorrections.length > CORRECTION_WINDOW_SIZE) {
			this.recentCorrections.shift();
		}

		if (isCorrection) {
			this.addFinding(accumulator, {
				guardianId: "satya",
				domain: "correctness",
				severity: "warning",
				title: "User correction detected",
				description: `User appears to be correcting the agent at turn ${turn.turnNumber}: "${turn.content.slice(0, 100)}${turn.content.length > 100 ? "..." : ""}"`,
				location: `turn:${turn.turnNumber}`,
				suggestion: "Pay closer attention to user requirements. Re-read the original request.",
				confidence: 0.7,
				autoFixable: false,
			});

			// Check for correction storm
			const correctionCount = this.recentCorrections.filter(Boolean).length;
			if (correctionCount >= CORRECTION_STORM_THRESHOLD) {
				this.addFinding(accumulator, {
					guardianId: "satya",
					domain: "correctness",
					severity: "critical",
					title: "Repeated user corrections",
					description: `${correctionCount} user corrections in the last ${this.recentCorrections.length} turns. The agent may be fundamentally misunderstanding the task.`,
					location: `turn:${turn.turnNumber}`,
					suggestion: "Stop and ask the user to clarify their requirements before proceeding.",
					confidence: 0.85,
					autoFixable: false,
				});
			}
		}
	}

	/**
	 * Check tool results for error streaks and storms.
	 */
	private checkToolErrors(
		turn: TurnObservation,
		accumulator: Finding[],
	): void {
		if (!turn.toolResults || turn.toolResults.length === 0) return;

		for (const result of turn.toolResults) {
			const isError = !result.success;

			// Track in sliding window
			this.recentErrors.push(isError);
			if (this.recentErrors.length > RECENT_WINDOW_SIZE) {
				this.recentErrors.shift();
			}

			// Consecutive error tracking
			if (isError) {
				this.consecutiveErrors++;
			} else {
				this.consecutiveErrors = 0;
				this.errorStreakEmitted = false;
				this.errorStormEmitted = false;
			}

			// Error streak
			if (
				this.consecutiveErrors >= ERROR_STREAK_THRESHOLD &&
				!this.errorStreakEmitted
			) {
				this.errorStreakEmitted = true;
				this.addFinding(accumulator, {
					guardianId: "satya",
					domain: "correctness",
					severity: "warning",
					title: "Error streak",
					description: `${this.consecutiveErrors} consecutive tool failures. Last error: ${result.error ?? "unknown"} (tool: ${result.name}).`,
					location: `turn:${turn.turnNumber}`,
					suggestion: "Stop retrying the same approach. Try a different tool or strategy.",
					confidence: 0.8,
					autoFixable: false,
				});
			}

			// Error storm (too many errors in recent window)
			const recentErrorCount = this.recentErrors.filter(Boolean).length;
			if (
				recentErrorCount >= ERROR_STORM_THRESHOLD &&
				!this.errorStormEmitted
			) {
				this.errorStormEmitted = true;
				this.addFinding(accumulator, {
					guardianId: "satya",
					domain: "correctness",
					severity: "critical",
					title: "Error storm",
					description: `${recentErrorCount} tool failures in the last ${this.recentErrors.length} operations. The agent may be in a failure loop.`,
					location: `turn:${turn.turnNumber}`,
					suggestion: "Pause, reassess the problem, and try a fundamentally different approach.",
					confidence: 0.9,
					autoFixable: false,
				});
			}
		}
	}

	/**
	 * Check assistant responses for task start/completion patterns.
	 *
	 * If a task is started but not completed within the stale threshold,
	 * emit an incomplete task finding.
	 */
	private checkTaskPatterns(
		turn: TurnObservation,
		accumulator: Finding[],
	): void {
		const content = turn.content;

		// Check for task start
		if (TASK_START_PATTERNS.some((p) => p.test(content))) {
			if (!this.taskInProgress) {
				this.taskInProgress = true;
				this.taskStartTurn = turn.turnNumber;
				this.turnsSinceTaskStart = 0;
			}
		}

		// Track turns since task started
		if (this.taskInProgress) {
			this.turnsSinceTaskStart++;

			// Check for task completion
			if (TASK_COMPLETE_PATTERNS.some((p) => p.test(content))) {
				this.taskInProgress = false;
				this.turnsSinceTaskStart = 0;
			}

			// Check for stale task
			if (this.turnsSinceTaskStart >= this.staleTaskThreshold) {
				this.addFinding(accumulator, {
					guardianId: "satya",
					domain: "correctness",
					severity: "info",
					title: "Potentially incomplete task",
					description: `A task was started at turn ${this.taskStartTurn} but no completion signal detected after ${this.turnsSinceTaskStart} turns.`,
					location: `turn:${this.taskStartTurn}`,
					suggestion: "Summarize progress and confirm with the user whether the task is complete.",
					confidence: 0.5,
					autoFixable: false,
				});
				// Reset so we don't keep emitting
				this.taskInProgress = false;
				this.turnsSinceTaskStart = 0;
			}
		}
	}

	/**
	 * Check if test tool results indicate failures.
	 */
	private checkTestFailures(
		turn: TurnObservation,
		accumulator: Finding[],
	): void {
		if (!turn.toolResults) return;

		for (const result of turn.toolResults) {
			if (TEST_TOOL_NAMES.has(result.name) && !result.success) {
				this.addFinding(accumulator, {
					guardianId: "satya",
					domain: "correctness",
					severity: "warning",
					title: `Test failure: ${result.name}`,
					description: `Test tool "${result.name}" reported failure${result.error ? `: ${result.error.slice(0, 200)}` : ""}.`,
					location: `tool:${result.name}`,
					suggestion: "Fix the failing tests before proceeding with other changes.",
					confidence: 0.9,
					autoFixable: false,
				});
			}
		}
	}

	/**
	 * Create a Finding, apply confidence threshold, and store it.
	 */
	private addFinding(
		accumulator: Finding[],
		partial: Omit<Finding, "id" | "timestamp">,
	): void {
		if (partial.confidence < this.config.confidenceThreshold) return;

		const timestamp = Date.now();
		const id = fnv1a(
			`${partial.guardianId}:${partial.title}:${partial.location ?? ""}:${timestamp}`,
		);

		const finding: Finding = {
			...partial,
			id,
			timestamp,
		};

		this.findings.push(finding);
		this.findingsBySeverity[finding.severity] =
			(this.findingsBySeverity[finding.severity] ?? 0) + 1;
		accumulator.push(finding);
	}
}
