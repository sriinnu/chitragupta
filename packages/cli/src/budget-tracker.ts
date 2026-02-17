/**
 * @chitragupta/cli — Budget tracker.
 *
 * Tracks token costs per session and per day.
 * Warns at configurable thresholds, hard-stops at limits.
 *
 * Daily cost is persisted to ~/.chitragupta/daily-cost.json so that
 * it survives process restarts within the same calendar day.
 * The file auto-resets when the date changes.
 *
 * All file I/O errors are swallowed — the budget tracker must never
 * crash the application.
 */

import fs from "fs";
import path from "path";
import { getChitraguptaHome } from "@chitragupta/core";
import type { BudgetConfig, BudgetStatus } from "@chitragupta/core";

/** Shape of the daily cost persistence file. */
interface DailyCostFile {
	date: string;
	cost: number;
}

/**
 * Tracks session and daily token costs against configurable limits.
 *
 * - Records cost after each LLM turn.
 * - Provides a budget status snapshot for rendering.
 * - Gates the next turn via `canProceed()`.
 */
export class BudgetTracker {
	private readonly maxSessionCost: number;
	private readonly maxDailyCost: number;
	private readonly warningThreshold: number;
	private readonly dailyCostPath: string;

	private sessionCost = 0;

	constructor(config: BudgetConfig = {}) {
		this.maxSessionCost = config.maxSessionCost ?? 0;
		this.maxDailyCost = config.maxDailyCost ?? 0;
		this.warningThreshold = Math.max(0, Math.min(1, config.warningThreshold ?? 0.8));
		this.dailyCostPath = path.join(getChitraguptaHome(), "daily-cost.json");
	}

	/**
	 * Record a cost from a completed turn. Returns the updated budget status.
	 */
	recordCost(cost: number): BudgetStatus {
		if (cost <= 0) return this.getStatus();

		this.sessionCost += cost;

		// Update daily cost on disk
		const dailyCost = this.loadDailyCost() + cost;
		this.saveDailyCost(dailyCost);

		return this.getStatus();
	}

	/**
	 * Get current budget status.
	 */
	getStatus(): BudgetStatus {
		const dailyCost = this.loadDailyCost();
		const sessionLimit = this.maxSessionCost;
		const dailyLimit = this.maxDailyCost;

		const sessionWarning = sessionLimit > 0 &&
			this.sessionCost >= sessionLimit * this.warningThreshold &&
			this.sessionCost < sessionLimit;
		const sessionExceeded = sessionLimit > 0 && this.sessionCost >= sessionLimit;

		const dailyWarning = dailyLimit > 0 &&
			dailyCost >= dailyLimit * this.warningThreshold &&
			dailyCost < dailyLimit;
		const dailyExceeded = dailyLimit > 0 && dailyCost >= dailyLimit;

		return {
			sessionCost: this.sessionCost,
			dailyCost,
			sessionLimit,
			dailyLimit,
			sessionWarning,
			sessionExceeded,
			dailyWarning,
			dailyExceeded,
		};
	}

	/**
	 * Check if we can proceed with another turn.
	 */
	canProceed(): { allowed: boolean; reason?: string } {
		const status = this.getStatus();

		if (status.sessionExceeded) {
			return {
				allowed: false,
				reason: `Session budget exceeded: $${status.sessionCost.toFixed(4)} / $${status.sessionLimit.toFixed(2)}`,
			};
		}

		if (status.dailyExceeded) {
			return {
				allowed: false,
				reason: `Daily budget exceeded: $${status.dailyCost.toFixed(4)} / $${status.dailyLimit.toFixed(2)}`,
			};
		}

		return { allowed: true };
	}

	/**
	 * Load today's accumulated cost from disk. Returns 0 on any error
	 * or if the stored date does not match today.
	 */
	private loadDailyCost(): number {
		try {
			if (!fs.existsSync(this.dailyCostPath)) return 0;
			const raw = fs.readFileSync(this.dailyCostPath, "utf-8");
			const data = JSON.parse(raw) as DailyCostFile;
			const today = new Date().toISOString().split("T")[0];
			if (data.date === today && typeof data.cost === "number" && data.cost >= 0) {
				return data.cost;
			}
			// Date mismatch — new day, reset
			return 0;
		} catch {
			return 0;
		}
	}

	/**
	 * Save today's cost to disk. Errors are silently ignored.
	 */
	private saveDailyCost(cost: number): void {
		try {
			const dir = path.dirname(this.dailyCostPath);
			fs.mkdirSync(dir, { recursive: true });
			const today = new Date().toISOString().split("T")[0];
			const data: DailyCostFile = { date: today, cost };
			fs.writeFileSync(this.dailyCostPath, JSON.stringify(data, null, "\t"), "utf-8");
		} catch {
			// Budget tracking must never crash the app
		}
	}
}
