/**
 * Interactive render helpers — budget warnings and input request rendering.
 *
 * Extracted from interactive-render.ts for maintainability.
 *
 * @module interactive-render-helpers
 */

import type { BudgetStatus, InputRequest } from "@chitragupta/core";
import {
	bold,
	dim,
	yellow,
	red,
	reset,
} from "@chitragupta/ui/ansi";
import { THEME } from "./interactive-render.js";

// ─── Sandesha Input Request Rendering ────────────────────────────────────────

/**
 * Render an input request from a sub-agent.
 * Shows a themed prompt with optional choices, default value, and timeout.
 */
export function printInputRequest(
	stdout: NodeJS.WriteStream,
	request: InputRequest,
): void {
	// Header: diamond + agent ID
	stdout.write(
		`\n${THEME.primary}\u27D0 Input requested by agent ${bold(request.agentId.slice(0, 8))}${reset}\n`,
	);

	// Prompt text
	stdout.write(`  ${request.prompt}\n`);

	// Numbered choices
	if (request.choices && request.choices.length > 0) {
		for (let i = 0; i < request.choices.length; i++) {
			stdout.write(`  ${THEME.secondary}${i + 1}.${reset} ${request.choices[i]}\n`);
		}
	}

	// Default value
	if (request.defaultValue !== undefined) {
		stdout.write(`  ${dim(`default: ${request.defaultValue}`)}\n`);
	}

	// Timeout
	if (request.timeoutMs !== undefined) {
		const seconds = Math.ceil(request.timeoutMs / 1000);
		stdout.write(`  ${dim(`timeout: ${seconds}s`)}\n`);
	}

	// Input hint
	stdout.write(`  ${dim("Type your response and press Enter:")}\n`);
}

// ─── Budget Warnings ────────────────────────────────────────────────────────

/**
 * Print a budget warning or hard-stop message.
 *
 * - Yellow warning at threshold: "Budget warning: $X.XX / $Y.YY (Z%)"
 * - Red hard stop: "Budget exceeded: $X.XX / $Y.YY -- session paused"
 */
export function printBudgetWarning(
	stdout: NodeJS.WriteStream,
	status: BudgetStatus,
): void {
	// Session budget alerts
	if (status.sessionExceeded) {
		const pct = status.sessionLimit > 0
			? Math.round((status.sessionCost / status.sessionLimit) * 100)
			: 0;
		stdout.write(
			`\n${red(bold("  Budget exceeded"))}: ` +
			`$${status.sessionCost.toFixed(4)} / $${status.sessionLimit.toFixed(2)} ` +
			`(${pct}%) ${red("\u2014 session paused")}${reset}\n`,
		);
	} else if (status.sessionWarning) {
		const pct = status.sessionLimit > 0
			? Math.round((status.sessionCost / status.sessionLimit) * 100)
			: 0;
		stdout.write(
			`\n${yellow("  Budget warning")}: ` +
			`$${status.sessionCost.toFixed(4)} / $${status.sessionLimit.toFixed(2)} ` +
			`(${pct}%)${reset}\n`,
		);
	}

	// Daily budget alerts
	if (status.dailyExceeded) {
		const pct = status.dailyLimit > 0
			? Math.round((status.dailyCost / status.dailyLimit) * 100)
			: 0;
		stdout.write(
			`\n${red(bold("  Daily budget exceeded"))}: ` +
			`$${status.dailyCost.toFixed(4)} / $${status.dailyLimit.toFixed(2)} ` +
			`(${pct}%) ${red("\u2014 session paused")}${reset}\n`,
		);
	} else if (status.dailyWarning) {
		const pct = status.dailyLimit > 0
			? Math.round((status.dailyCost / status.dailyLimit) * 100)
			: 0;
		stdout.write(
			`\n${yellow("  Daily budget warning")}: ` +
			`$${status.dailyCost.toFixed(4)} / $${status.dailyLimit.toFixed(2)} ` +
			`(${pct}%)${reset}\n`,
		);
	}
}
