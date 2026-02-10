/**
 * @chitragupta/anina/lokapala — LokapalaController — Orchestrator.
 *
 * The council of guardians. Coordinates Rakshaka (security), Gati
 * (performance), and Satya (correctness), providing a unified API
 * for the agent runtime to feed observations and retrieve findings.
 *
 * The controller:
 * - Routes tool execution data to Rakshaka and Gati simultaneously
 * - Routes turn observations to Satya and Gati
 * - Aggregates findings across all guardians
 * - Broadcasts findings to registered listeners (Samiti integration hook)
 * - Provides domain-filtered and severity-filtered views
 *
 * ## Wiring
 *
 * The controller is designed to be wired into Agent.runAgentLoop():
 * - `afterToolExecution()` — called after each tool runs
 * - `afterTurn()` — called after each conversation turn
 *
 * @packageDocumentation
 */

import type {
	Finding,
	GuardianDomain,
	GuardianStats,
	LokapalaConfig,
	PerformanceMetrics,
	TurnObservation,
} from "./types.js";
import { resolveConfig } from "./types.js";
import { Rakshaka } from "./rakshaka.js";
import { Gati } from "./gati.js";
import { Satya } from "./satya.js";

// ─── LokapalaController ────────────────────────────────────────────────────

/**
 * Orchestrates the three guardian agents, providing a single entry point
 * for the agent runtime to report observations and retrieve findings.
 */
export class LokapalaController {
	/** Security Guardian — monitors for credentials, injections, traversals. */
	readonly rakshaka: Rakshaka;
	/** Performance Guardian — monitors tokens, latency, context usage. */
	readonly gati: Gati;
	/** Correctness Guardian — monitors errors, corrections, completeness. */
	readonly satya: Satya;

	private readonly listeners: Set<(finding: Finding) => void> = new Set();

	constructor(config?: Partial<LokapalaConfig>) {
		this.rakshaka = new Rakshaka(
			config?.security ? resolveConfig(config.security) : undefined,
		);
		this.gati = new Gati(
			config?.performance ? resolveConfig(config.performance) : undefined,
		);
		this.satya = new Satya(
			config?.correctness ? resolveConfig(config.correctness) : undefined,
		);
	}

	// ─── Lifecycle Hooks ───────────────────────────────────────────────────

	/**
	 * Called after each tool execution.
	 *
	 * Routes data to both Rakshaka (security scan of args + output) and
	 * Gati (latency and pattern tracking). Returns all findings from both.
	 */
	afterToolExecution(
		toolName: string,
		args: Record<string, unknown>,
		output: string,
		durationMs: number,
	): Finding[] {
		const allFindings: Finding[] = [];

		// Security scan
		const securityFindings = this.rakshaka.scanToolExecution(
			toolName,
			args,
			output,
		);
		allFindings.push(...securityFindings);

		// Performance observation (limited — no token or context data here)
		const perfFindings = this.gati.observe({
			tokensThisTurn: 0,
			toolName,
			toolDurationMs: durationMs,
			contextUsedPct: 0,
			turnNumber: 0,
		});
		allFindings.push(...perfFindings);

		// Broadcast
		this.broadcast(allFindings);

		return allFindings;
	}

	/**
	 * Called after each conversation turn.
	 *
	 * Routes data to Satya (correctness monitoring) and Gati
	 * (token/context tracking). Returns all findings from both.
	 */
	afterTurn(turn: TurnObservation, metrics: PerformanceMetrics): Finding[] {
		const allFindings: Finding[] = [];

		// Correctness observation
		const correctnessFindings = this.satya.observeTurn(turn);
		allFindings.push(...correctnessFindings);

		// Performance observation (full metrics from the turn)
		const perfFindings = this.gati.observe(metrics);
		allFindings.push(...perfFindings);

		// Broadcast
		this.broadcast(allFindings);

		return allFindings;
	}

	// ─── Query API ─────────────────────────────────────────────────────────

	/**
	 * Get all findings across all guardians, newest first.
	 *
	 * @param limit Maximum total findings to return.
	 */
	allFindings(limit?: number): Finding[] {
		const all = [
			...this.rakshaka.getFindings(),
			...this.gati.getFindings(),
			...this.satya.getFindings(),
		];

		// Sort newest first
		all.sort((a, b) => b.timestamp - a.timestamp);

		if (limit !== undefined) {
			return all.slice(0, limit);
		}
		return all;
	}

	/**
	 * Get findings filtered by domain.
	 */
	findingsByDomain(domain: GuardianDomain): Finding[] {
		switch (domain) {
			case "security":
				return this.rakshaka.getFindings();
			case "performance":
				return this.gati.getFindings();
			case "correctness":
				return this.satya.getFindings();
			default:
				return [];
		}
	}

	/**
	 * Get only critical-severity findings across all guardians.
	 */
	criticalFindings(): Finding[] {
		return this.allFindings().filter((f) => f.severity === "critical");
	}

	/**
	 * Get aggregate statistics for all guardians.
	 */
	stats(): Record<GuardianDomain, GuardianStats> {
		return {
			security: this.rakshaka.stats(),
			performance: this.gati.stats(),
			correctness: this.satya.stats(),
		};
	}

	// ─── Event Broadcasting ────────────────────────────────────────────────

	/**
	 * Register a callback to be invoked whenever a finding is produced.
	 *
	 * Returns an unsubscribe function.
	 *
	 * @param handler Callback receiving each finding.
	 * @returns Unsubscribe function.
	 */
	onFinding(handler: (finding: Finding) => void): () => void {
		this.listeners.add(handler);
		return () => {
			this.listeners.delete(handler);
		};
	}

	// ─── Internal ──────────────────────────────────────────────────────────

	/**
	 * Broadcast findings to all registered listeners.
	 */
	private broadcast(findings: Finding[]): void {
		if (this.listeners.size === 0) return;

		for (const finding of findings) {
			for (const listener of this.listeners) {
				try {
					listener(finding);
				} catch {
					// Listener errors must not crash the guardian pipeline
				}
			}
		}
	}
}
