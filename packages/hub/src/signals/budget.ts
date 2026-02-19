/**
 * Budget and cost tracking signals for the Hub dashboard.
 *
 * Provides reactive state for session costs, daily costs, and budget history.
 * All data is fetched from the backend API and cached in Preact signals.
 * @module signals/budget
 */

import { signal, computed } from "@preact/signals";
import { apiGet } from "../api.js";

// ── Types ─────────────────────────────────────────────────────────

/** Budget status snapshot returned by the API. */
export interface BudgetStatusData {
	sessionCost: number;
	dailyCost: number;
	monthlyCost: number;
	sessionLimit: number;
	dailyLimit: number;
	warningThreshold: number;
	activeSessions: number;
}

/** A single day's cost entry for the history chart. */
export interface DailyCost {
	date: string;
	cost: number;
}

// ── Signals ───────────────────────────────────────────────────────

/** Current budget status data. `null` until the first fetch completes. */
export const budgetStatus = signal<BudgetStatusData | null>(null);

/** Array of daily cost entries for sparkline/bar charts. */
export const budgetHistory = signal<DailyCost[]>([]);

/** Whether a budget fetch is currently in-flight. */
export const budgetLoading = signal<boolean>(false);

// ── Computed ──────────────────────────────────────────────────────

/** Formatted daily cost string (e.g. "$0.0042"). */
export const dailyCostFormatted = computed<string>(
	() => `$${(budgetStatus.value?.dailyCost ?? 0).toFixed(4)}`,
);

/** Formatted session cost string. */
export const sessionCostFormatted = computed<string>(
	() => `$${(budgetStatus.value?.sessionCost ?? 0).toFixed(4)}`,
);

/** Formatted monthly cost string. */
export const monthlyCostFormatted = computed<string>(
	() => `$${(budgetStatus.value?.monthlyCost ?? 0).toFixed(2)}`,
);

// ── Fetchers ──────────────────────────────────────────────────────

/**
 * Fetch the current budget status from the API and update the signal.
 * Silently catches fetch errors to avoid crashing the dashboard.
 */
export async function fetchBudgetStatus(): Promise<void> {
	budgetLoading.value = true;
	try {
		const data = await apiGet<BudgetStatusData>("/api/budget/status");
		budgetStatus.value = data;
	} catch {
		// Budget status fetch is best-effort; signal retains last value
	} finally {
		budgetLoading.value = false;
	}
}

/**
 * Fetch the daily cost history (last 30 days) and update the signal.
 * Used by sparkline and bar chart components on the overview page.
 */
export async function fetchBudgetHistory(): Promise<void> {
	try {
		const data = await apiGet<DailyCost[]>("/api/budget/history");
		budgetHistory.value = data;
	} catch {
		// History fetch is best-effort; signal retains last value
	}
}
