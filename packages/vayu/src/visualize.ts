/**
 * @chitragupta/vayu — ASCII DAG visualization.
 *
 * Renders workflow DAGs as ASCII art with color-coded status indicators
 * and dependency arrows.
 */

import type { Workflow, WorkflowExecution, WorkflowStep, StepExecution } from "./types.js";
import { getExecutionLevels } from "./dag.js";

// ─── Status Indicators ─────────────────────────────────────────────────────

const STATUS_ICONS: Record<string, string> = {
	completed: "\u2713",
	running: "\u25CF",
	failed: "\u2717",
	pending: "\u25CB",
	skipped: "\u2014",
	cancelled: "\u2205",
};

// ANSI color codes
const COLORS = {
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	red: "\x1b[31m",
	gray: "\x1b[90m",
	cyan: "\x1b[36m",
	magenta: "\x1b[35m",
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
} as const;

function colorForStatus(status: string): string {
	switch (status) {
		case "completed": return COLORS.green;
		case "running": return COLORS.yellow;
		case "failed": return COLORS.red;
		case "skipped": return COLORS.dim;
		case "cancelled": return COLORS.gray;
		case "pending":
		default:
			return COLORS.gray;
	}
}

function getStatusIcon(status: string): string {
	return STATUS_ICONS[status] ?? STATUS_ICONS.pending;
}

// ─── Simple Linear Rendering ────────────────────────────────────────────────

/**
 * Render a simple linear chain of steps (for single-path DAGs).
 *
 * Example:
 *   [lint] ──→ [test] ──→ [build] ──→ [review] ──→ [deploy]
 *     ✓          ✓          ●           ○             ○
 */
function renderLinear(
	steps: WorkflowStep[],
	execMap: Map<string, StepExecution>,
): string {
	const boxes: string[] = [];
	const statuses: string[] = [];

	for (const step of steps) {
		const exec = execMap.get(step.id);
		const status = exec?.status ?? "pending";
		const icon = getStatusIcon(status);
		const color = colorForStatus(status);

		const label = `[${step.id}]`;
		boxes.push(label);
		// Pad status icon to center under the box
		const padding = Math.max(0, Math.floor((label.length - 1) / 2));
		statuses.push(" ".repeat(padding) + `${color}${icon}${COLORS.reset}`);
	}

	const arrow = ` \u2500\u2500\u2192 `;
	const topLine = boxes.join(arrow);
	const bottomLine = statuses.join("     ");

	return `${topLine}\n${bottomLine}`;
}

// ─── Multi-Level Rendering ──────────────────────────────────────────────────

/**
 * Render a multi-level DAG with parallel branches.
 *
 * Example:
 *            ┌─→ [unit-tests] ─┐
 *   [lint] ──┤                  ├─→ [build] ──→ [deploy]
 *            └─→ [e2e-tests] ──┘
 */
function renderMultiLevel(
	workflow: Workflow,
	levels: string[][],
	execMap: Map<string, StepExecution>,
): string {
	const stepMap = new Map<string, WorkflowStep>();
	for (const step of workflow.steps) {
		stepMap.set(step.id, step);
	}

	const lines: string[] = [];

	// Header
	lines.push(`${COLORS.bold}Workflow: ${workflow.name}${COLORS.reset} (${workflow.id})`);
	lines.push(`${COLORS.dim}${"─".repeat(50)}${COLORS.reset}`);
	lines.push("");

	for (let levelIdx = 0; levelIdx < levels.length; levelIdx++) {
		const level = levels[levelIdx];
		const isParallel = level.length > 1;

		if (isParallel) {
			// Render parallel group with branches
			const prevLevel = levelIdx > 0 ? levels[levelIdx - 1] : [];
			const nextLevel = levelIdx < levels.length - 1 ? levels[levelIdx + 1] : [];

			// Find the common source (from previous level)
			const sources = new Set<string>();
			for (const stepId of level) {
				const step = stepMap.get(stepId)!;
				for (const dep of step.dependsOn) {
					sources.add(dep);
				}
			}

			// Find common target (in next level)
			const targets = new Set<string>();
			for (const nextId of nextLevel) {
				const nextStep = stepMap.get(nextId)!;
				for (const dep of nextStep.dependsOn) {
					if (level.includes(dep)) {
						targets.add(nextId);
					}
				}
			}

			const sourceLabel = sources.size > 0 ? `[${Array.from(sources)[0]}]` : "";
			const targetLabel = targets.size > 0 ? `[${Array.from(targets)[0]}]` : "";

			// Measure the widest parallel step name
			let maxLabelWidth = 0;
			for (const stepId of level) {
				maxLabelWidth = Math.max(maxLabelWidth, stepId.length + 2); // +2 for []
			}

			const indent = sourceLabel ? " ".repeat(sourceLabel.length + 1) : "  ";

			for (let i = 0; i < level.length; i++) {
				const stepId = level[i];
				const exec = execMap.get(stepId);
				const status = exec?.status ?? "pending";
				const color = colorForStatus(status);
				const icon = getStatusIcon(status);

				const label = `[${stepId}]`;
				const paddedLabel = label.padEnd(maxLabelWidth);
				const statusStr = ` ${color}${icon}${COLORS.reset}`;

				if (i === 0) {
					// Top branch
					const connector = sourceLabel
						? `${indent}\u250C\u2500\u2192 `
						: "  \u250C\u2500\u2192 ";
					const endConn = targetLabel ? ` \u2500\u2510` : "";
					lines.push(`${connector}${color}${paddedLabel}${COLORS.reset}${statusStr}${endConn}`);
				} else if (i === level.length - 1) {
					// Bottom branch — also show the source label on this middle line
					if (i === 1 && sourceLabel) {
						// Only two branches: put source on a middle connector line
						const srcExec = execMap.get(Array.from(sources)[0] ?? "");
						const srcStatus = srcExec?.status ?? "pending";
						const srcColor = colorForStatus(srcStatus);
						const srcIcon = getStatusIcon(srcStatus);

						// But first, render the middle line with source
						// This is already done below
					}
					const connector = sourceLabel
						? `${indent}\u2514\u2500\u2192 `
						: "  \u2514\u2500\u2192 ";
					const endConn = targetLabel ? ` \u2500\u2518` : "";
					lines.push(`${connector}${color}${paddedLabel}${COLORS.reset}${statusStr}${endConn}`);
				} else {
					// Middle branch
					const connector = `${indent}\u251C\u2500\u2192 `;
					const endConn = targetLabel ? ` \u2500\u2524` : "";
					lines.push(`${connector}${color}${paddedLabel}${COLORS.reset}${statusStr}${endConn}`);
				}
			}
		} else {
			// Single step at this level
			const stepId = level[0];
			const exec = execMap.get(stepId);
			const status = exec?.status ?? "pending";
			const color = colorForStatus(status);
			const icon = getStatusIcon(status);

			const hasNext = levelIdx < levels.length - 1;
			const arrow = hasNext ? ` \u2500\u2500\u2192` : "";

			lines.push(`  ${color}[${stepId}]${COLORS.reset} ${color}${icon}${COLORS.reset}${arrow}`);
		}
	}

	return lines.join("\n");
}

// ─── Summary Table ──────────────────────────────────────────────────────────

/**
 * Render a summary table of step statuses.
 */
function renderSummary(
	workflow: Workflow,
	execMap: Map<string, StepExecution>,
): string {
	const lines: string[] = [];

	lines.push("");
	lines.push(`${COLORS.dim}${"─".repeat(50)}${COLORS.reset}`);
	lines.push(`${COLORS.bold}Step Summary:${COLORS.reset}`);
	lines.push("");

	// Find the longest step name for alignment
	let maxNameLen = 0;
	for (const step of workflow.steps) {
		maxNameLen = Math.max(maxNameLen, step.name.length);
	}

	for (const step of workflow.steps) {
		const exec = execMap.get(step.id);
		const status = exec?.status ?? "pending";
		const color = colorForStatus(status);
		const icon = getStatusIcon(status);
		const paddedName = step.name.padEnd(maxNameLen);

		let durationStr = "";
		if (exec?.duration) {
			if (exec.duration < 1000) {
				durationStr = `${COLORS.dim}(${exec.duration}ms)${COLORS.reset}`;
			} else {
				durationStr = `${COLORS.dim}(${(exec.duration / 1000).toFixed(1)}s)${COLORS.reset}`;
			}
		}

		const retryStr = exec && exec.retryCount > 0
			? ` ${COLORS.dim}[retry ${exec.retryCount}]${COLORS.reset}`
			: "";

		const errorStr = exec?.error
			? `\n${" ".repeat(maxNameLen + 6)}${COLORS.red}${exec.error}${COLORS.reset}`
			: "";

		lines.push(`  ${color}${icon}${COLORS.reset} ${paddedName} ${color}${status}${COLORS.reset} ${durationStr}${retryStr}${errorStr}`);
	}

	return lines.join("\n");
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Render a workflow DAG as ASCII art with ANSI color-coded status indicators.
 *
 * If an execution is provided, steps are color-coded by their status:
 * - Green checkmark = completed
 * - Yellow circle = running
 * - Red cross = failed
 * - Gray empty circle = pending
 * - Dim dash = skipped
 * - Gray empty set = cancelled
 *
 * For simple linear DAGs (up to 8 steps), renders a compact single-line format.
 * For complex DAGs with parallel branches, renders a multi-level layout with
 * branch connectors.
 *
 * @param workflow - The workflow definition to render.
 * @param execution - Optional execution state for status coloring.
 * @returns Multi-line string with ANSI escape codes for terminal display.
 *
 * @example
 * ```ts
 * const output = renderDAG(workflow, execution);
 * process.stdout.write(output + "\n");
 * ```
 */
export function renderDAG(
	workflow: Workflow,
	execution?: WorkflowExecution,
): string {
	const execMap = execution?.steps ?? new Map<string, StepExecution>();

	// Get execution levels to determine layout
	let levels: string[][];
	try {
		levels = getExecutionLevels(workflow.steps);
	} catch {
		// If we can't compute levels (e.g. cycle), fall back to listing
		const lines = [`${COLORS.bold}Workflow: ${workflow.name}${COLORS.reset} (${workflow.id})`];
		lines.push(`${COLORS.red}Error: Could not compute execution levels (possible cycle in DAG)${COLORS.reset}`);
		for (const step of workflow.steps) {
			const exec = execMap.get(step.id);
			const status = exec?.status ?? "pending";
			const color = colorForStatus(status);
			const icon = getStatusIcon(status);
			lines.push(`  ${color}${icon}${COLORS.reset} [${step.id}] ${step.name}`);
		}
		return lines.join("\n");
	}

	const isSimpleLinear = levels.every((level) => level.length === 1);

	let output: string;

	if (isSimpleLinear && workflow.steps.length <= 8) {
		// Simple linear chain — compact rendering
		const orderedSteps = levels.map((level) => {
			const stepId = level[0];
			return workflow.steps.find((s) => s.id === stepId)!;
		});

		output = `${COLORS.bold}${workflow.name}${COLORS.reset}\n\n`;
		output += renderLinear(orderedSteps, execMap);
	} else {
		// Complex DAG with parallel branches
		output = renderMultiLevel(workflow, levels, execMap);
	}

	// Append summary table
	output += renderSummary(workflow, execMap);

	// Workflow-level status
	if (execution) {
		const statusColor = colorForStatus(execution.status);
		const duration = execution.endTime
			? `${((execution.endTime - execution.startTime) / 1000).toFixed(1)}s`
			: "running...";

		output += `\n\n${COLORS.bold}Status:${COLORS.reset} ${statusColor}${execution.status}${COLORS.reset}`;
		output += ` ${COLORS.dim}(${duration})${COLORS.reset}`;
	}

	return output;
}
