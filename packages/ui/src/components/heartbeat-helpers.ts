/**
 * Heartbeat monitor helpers — ECG waveform, status icons, and formatting.
 *
 * Extracted from heartbeat-monitor.ts for maintainability.
 *
 * @module heartbeat-helpers
 */

import { hexToAnsi, type Theme } from "../theme.js";
import type { HeartbeatEntry } from "./heartbeat-monitor.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * ECG PQRST waveform approximated as a sequence of Unicode box-drawing
 * characters. Reading left to right this traces:
 *
 *   -- -- ╮ ╰ -- ╯ ╭ ╮ ╰ ╯
 *
 * Which, when printed in a scrolling line, evokes the characteristic
 * P-wave dip, QRS spike, and T-wave of a real ECG trace.
 */
export const ECG_BEAT: readonly string[] = [
	"\u2500", "\u2500", "\u256E", "\u2570", "\u2500", "\u256F", "\u256D", "\u256E", "\u2570", "\u256F",
];

/** Flat-line character used for dead signals and gaps between beats. */
export const ECG_FLAT = "\u2500";

/** Heart icons per status. */
export const HEART_ALIVE = "\u2665";   // heart
export const HEART_STALE = "\u2661";   // empty heart
export const HEART_DEAD = "\u2715";    // X
export const HEART_DONE = "\u2713";    // checkmark
export const HEART_ERROR = "\u2620";   // skull

/** Tree-drawing characters. */
export const TREE_BRANCH = "\u251C\u2500"; // |-
export const TREE_END = "\u2514\u2500";    // L-
export const TREE_PIPE = "\u2502";         // |

/** Box-drawing separator. */
export const SEP = " \u2502 ";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Generate a single-row scrolling ECG trace string.
 *
 * @param status  - Agent status controlling the waveform shape.
 * @param width   - Number of characters wide the trace should be.
 * @param frame   - Current animation frame (incremented each tick).
 * @returns A plain string of box-drawing characters representing the trace.
 */
export function generateEcgTrace(
	status: HeartbeatEntry["status"],
	width: number,
	frame: number,
): string {
	// Dead / killed / error: flat-line.
	if (status === "dead" || status === "killed") {
		return ECG_FLAT.repeat(width);
	}

	// Completed: flat-line (no animation).
	if (status === "completed") {
		return ECG_FLAT.repeat(width);
	}

	// Error: erratic short spikes with tight spacing.
	if (status === "error") {
		const errBeat: readonly string[] = ["\u2500", "\u256E", "\u2570", "\u256F", "\u256D", "\u256E", "\u2570", "\u256F"];
		const errGap = 2;
		const errCycle = errBeat.length + errGap;
		const chars: string[] = [];
		for (let i = 0; i < width; i++) {
			const pos = (i + frame) % errCycle;
			chars.push(pos < errBeat.length ? errBeat[pos] : ECG_FLAT);
		}
		return chars.join("");
	}

	const beatLen = ECG_BEAT.length;
	// Stale agents have longer flat gaps between beats — looks weak.
	const gap = status === "stale" ? 12 : 3;
	const cycle = beatLen + gap;

	const chars: string[] = [];
	for (let i = 0; i < width; i++) {
		const pos = (i + frame) % cycle;
		chars.push(pos < beatLen ? ECG_BEAT[pos] : ECG_FLAT);
	}
	return chars.join("");
}

/**
 * Format a token count for compact display.
 * Values >= 1000 are shown as e.g. "45k", otherwise raw number.
 */
export function formatTokenCount(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
	return String(n);
}

/**
 * Format a millisecond duration as a human-readable age string.
 */
export function formatAge(ms: number): string {
	if (ms < 1_000) return `${ms}ms`;
	const seconds = ms / 1_000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const minutes = seconds / 60;
	if (minutes < 60) return `${minutes.toFixed(1)}m`;
	const hours = minutes / 60;
	return `${hours.toFixed(1)}h`;
}

/**
 * Pick the ANSI color string for a given agent status.
 */
export function statusColor(
	status: HeartbeatEntry["status"],
	theme: Theme,
): string {
	switch (status) {
		case "alive":
			return hexToAnsi(theme.colors.success);
		case "stale":
			return hexToAnsi(theme.colors.warning);
		case "dead":
		case "killed":
		case "error":
			return hexToAnsi(theme.colors.error);
		case "completed":
			return hexToAnsi(theme.colors.muted);
	}
}

/**
 * Pick the heart/status icon for a given agent status.
 */
export function statusIcon(status: HeartbeatEntry["status"]): string {
	switch (status) {
		case "alive":
			return HEART_ALIVE;
		case "stale":
			return HEART_STALE;
		case "dead":
		case "killed":
			return HEART_DEAD;
		case "completed":
			return HEART_DONE;
		case "error":
			return HEART_ERROR;
	}
}

/**
 * Pick a color for token budget usage ratio.
 */
export function budgetColor(usage: number, budget: number, theme: Theme): string {
	if (budget <= 0) return hexToAnsi(theme.colors.muted);
	const ratio = usage / budget;
	if (ratio > 0.8) return hexToAnsi(theme.colors.error);
	if (ratio > 0.6) return hexToAnsi(theme.colors.warning);
	return hexToAnsi(theme.colors.success);
}
