/**
 * Interactive command registry — shared types, constants, and helpers.
 *
 * Exports the slash command registry, tab completion, and display helpers
 * used by all interactive-cmd-*.ts handler modules.
 *
 * @module
 */

import type { Agent } from "@chitragupta/anina";
import type { ThinkingLevel } from "@chitragupta/core";
import { cyan, dim, green, yellow, red } from "@chitragupta/ui/ansi";
import type { SessionStats } from "./interactive-render.js";

// ─── Slash command registry for tab completion ──────────────────────────────

export const SLASH_COMMANDS: Array<{ name: string; description: string }> = [
	{ name: "/help", description: "Show this help" },
	{ name: "/model", description: "Switch model" },
	{ name: "/thinking", description: "Set thinking level" },
	{ name: "/compact", description: "Compact conversation context" },
	{ name: "/memory", description: "Show project memory (or /memory search <query>)" },
	{ name: "/clear", description: "Clear conversation" },
	{ name: "/status", description: "Show session stats" },
	{ name: "/agents", description: "Show agent tree" },
	{ name: "/delegate", description: "Spawn a sub-agent with a task" },
	{ name: "/cost", description: "Show cost breakdown" },
	{ name: "/code", description: "Spawn a coding agent for a task" },
	{ name: "/review", description: "Spawn a review agent on files or changes" },
	{ name: "/debug", description: "Spawn a debug agent to investigate errors" },
	{ name: "/research", description: "Spawn a research agent for codebase questions" },
	{ name: "/refactor", description: "Spawn a refactor agent for code transformations" },
	{ name: "/docs", description: "Spawn a docs agent for documentation tasks" },
	{ name: "/diff", description: "Show recent file changes" },
	{ name: "/mcp", description: "Show MCP server status" },
	{ name: "/branch", description: "Branch the current session" },
	{ name: "/tree", description: "Show session tree" },
	{ name: "/skill", description: "Import/export/convert skills (Setu porter)" },
	{ name: "/skills", description: "Skill security pipeline (pending/approve/reject/scan/learn)" },
	{ name: "/learn", description: "Learn a new skill autonomously (Shiksha)" },
	{ name: "/chetana", description: "Show consciousness/cognitive state" },
	{ name: "/vidya", description: "Show Vidya skill ecosystem dashboard" },
	{ name: "/stats", description: "Show codebase power stats" },
	{ name: "/power", description: "Alias for /stats" },
	{ name: "/vasana", description: "List or inspect crystallized tendencies" },
	{ name: "/nidra", description: "Nidra daemon status (sleep cycle)" },
	{ name: "/vidhi", description: "List or inspect learned procedures" },
	{ name: "/pratyabhijna", description: "Show self-recognition identity narrative" },
	{ name: "/turiya", description: "Show Turiya model routing stats" },
	{ name: "/health", description: "Show Triguna health status (sattva/rajas/tamas)" },
	{ name: "/rta", description: "Show Rta invariant rules and audit log" },
	{ name: "/buddhi", description: "Show decisions with Nyaya reasoning" },
	{ name: "/samiti", description: "Show Samiti ambient channel dashboard" },
	{ name: "/sabha", description: "Show Sabha deliberation protocol status" },
	{ name: "/lokapala", description: "Show Lokapala guardian agent status" },
	{ name: "/akasha", description: "Show Akasha shared knowledge field" },
	{ name: "/kartavya", description: "Show Kartavya auto-execution pipeline" },
	{ name: "/kala", description: "Show Kala Chakra temporal awareness" },
	{ name: "/atman", description: "Show complete agent soul report" },
	{ name: "/workflow", description: "Vayu DAG workflows (list/run/show/history)" },
	{ name: "/quit", description: "Exit Chitragupta" },
];

// ─── Thinking levels for cycling ────────────────────────────────────────────

export const THINKING_LEVELS: ThinkingLevel[] = ["none", "low", "medium", "high"];

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SlashCommandContext {
	agent: Agent;
	stdout: NodeJS.WriteStream;
	stats: SessionStats;
	currentModel: string;
	currentThinking: ThinkingLevel;
	cleanup: () => void;
	onModelChange?: (model: string) => void;
	onThinkingChange?: (level: ThinkingLevel) => void;
	/** VidyaOrchestrator for /vidya command (duck-typed to avoid hard dep). */
	vidyaOrchestrator?: {
		getEcosystemStats(): Record<string, unknown>;
		getSkillReport(name?: string): unknown;
		promoteSkill(name: string, reviewer?: string): boolean;
		deprecateSkill(name: string, reason?: string): boolean;
		evaluateLifecycles(): Record<string, unknown>;
	};
	/** Project path for /stats and other commands that need to scan the codebase. */
	projectPath?: string;
	/** NidraDaemon instance for /nidra command (duck-typed to avoid hard dep). */
	nidraDaemon?: {
		snapshot(): {
			state: string;
			lastStateChange: number;
			lastHeartbeat: number;
			lastConsolidationStart?: number;
			lastConsolidationEnd?: number;
			consolidationPhase?: string;
			consolidationProgress: number;
			uptime: number;
		};
		wake(): void;
	};
}

export interface SlashCommandResult {
	handled: boolean;
	newModel?: string;
	newThinking?: ThinkingLevel;
	/** When true, the user requested to exit the session. */
	exit?: boolean;
}

// ─── Tab completion ─────────────────────────────────────────────────────────

/** Complete a partial slash command from the input buffer. */
export function completeSlashCommand(
	inputBuffer: string,
	stdout: NodeJS.WriteStream,
	renderPrompt: () => void,
): { newBuffer: string; newCursorPos: number } | null {
	if (!inputBuffer.startsWith("/")) return null;

	const prefix = inputBuffer.toLowerCase();
	const matches = SLASH_COMMANDS.filter((c) => c.name.startsWith(prefix));

	if (matches.length === 1) {
		const newBuffer = matches[0].name + " ";
		renderPrompt();
		return { newBuffer, newCursorPos: newBuffer.length };
	} else if (matches.length > 1) {
		stdout.write("\n");
		for (const m of matches) {
			stdout.write("  " + cyan(m.name) + "  " + dim(m.description) + "\n");
		}
		let common = matches[0].name;
		for (let i = 1; i < matches.length; i++) {
			while (!matches[i].name.startsWith(common)) {
				common = common.slice(0, -1);
			}
		}
		if (common.length > inputBuffer.length) {
			return { newBuffer: common, newCursorPos: common.length };
		}
	}

	return null;
}

// ─── Display helpers ────────────────────────────────────────────────────────

/** Render a mini horizontal bar for affect dimensions. */
export function renderMiniBar(
	value: number, min: number, max: number, width: number,
	negColor: (s: string) => string, posColor: (s: string) => string,
): string {
	const range = max - min;
	const normalized = Math.max(0, Math.min(1, (value - min) / range));
	const filled = Math.round(normalized * width);
	const bar = "\u2588".repeat(filled) + "\u2591".repeat(width - filled);
	return normalized >= 0.5 ? posColor(bar) : negColor(bar);
}

/** Render a simple progress bar. */
export function renderProgressBar(value: number, width: number): string {
	const clamped = Math.max(0, Math.min(1, value));
	const filled = Math.round(clamped * width);
	return green("\u2588".repeat(filled)) + dim("\u2591".repeat(width - filled));
}

/** Format a millisecond duration as a human-readable string (e.g. "2h 15m"). */
export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const secs = Math.floor(ms / 1000);
	if (secs < 60) return `${secs}s`;
	const mins = Math.floor(secs / 60);
	if (mins < 60) return `${mins}m ${secs % 60}s`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ${mins % 60}m`;
	const days = Math.floor(hrs / 24);
	return `${days}d ${hrs % 24}h`;
}

/** Format a timestamp as "Xm ago" relative age. */
export function formatAge(ts: number): string {
	const delta = Date.now() - ts;
	if (delta < 1000) return "just now";
	if (delta < 60_000) return `${Math.floor(delta / 1000)}s`;
	if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
	if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
	return `${Math.floor(delta / 86_400_000)}d`;
}
