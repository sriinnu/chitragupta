/**
 * @chitragupta/ui -- ECG-style ASCII heartbeat monitor.
 *
 * Visualizes agent heartbeats as a scrolling ECG/EKG waveform trace
 * in the terminal. Each agent gets its own line with a tree-indented
 * label, a live-scrolling waveform, status icon, beat age, and token
 * budget bar. Dead agents blink. The whole thing looks like you are
 * monitoring the vital signs of your agent swarm.
 */

import { bold, dim, reset } from "../ansi.js";
import { DEFAULT_THEME, type Theme, hexToAnsi } from "../theme.js";
import {
	generateEcgTrace,
	formatTokenCount,
	formatAge,
	statusColor,
	statusIcon,
	budgetColor,
	HEART_ALIVE,
	HEART_STALE,
	HEART_DEAD,
	HEART_DONE,
	HEART_ERROR,
	TREE_BRANCH,
	TREE_END,
	TREE_PIPE,
	SEP,
} from "./heartbeat-helpers.js";

// Re-export helpers and constants for backward compatibility
export {
	generateEcgTrace,
	formatTokenCount,
	formatAge,
	statusColor,
	statusIcon,
	budgetColor,
	ECG_BEAT,
	ECG_FLAT,
	HEART_ALIVE,
	HEART_STALE,
	HEART_DEAD,
	HEART_DONE,
	HEART_ERROR,
	TREE_BRANCH,
	TREE_END,
	TREE_PIPE,
	SEP,
} from "./heartbeat-helpers.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** A single agent entry in the heartbeat monitor. */
export interface HeartbeatEntry {
	agentId: string;
	status: "alive" | "stale" | "dead" | "killed" | "completed" | "error";
	depth: number;
	purpose: string;
	lastBeatAge: number;
	tokenUsage: number;
	tokenBudget: number;
}

/** Configuration for the HeartbeatMonitor component. */
export interface HeartbeatMonitorConfig {
	/** Waveform width in characters (default 30). */
	width: number;
	/** Show tree hierarchy indentation (default true). */
	showTree: boolean;
	/** Show token budget bar (default true). */
	showBudget: boolean;
	/** Blink dead/killed agents (default true). */
	blinkDead: boolean;
	/** Auto-refresh interval in ms (default 500). */
	refreshInterval: number;
}

// ─── Default Config ─────────────────────────────────────────────────────────

const DEFAULT_CONFIG: HeartbeatMonitorConfig = {
	width: 30,
	showTree: true,
	showBudget: true,
	blinkDead: true,
	refreshInterval: 500,
};

// ─── HeartbeatMonitor ───────────────────────────────────────────────────────

export class HeartbeatMonitor {
	private config: HeartbeatMonitorConfig;
	private theme: Theme;
	private agents: HeartbeatEntry[] = [];
	private frame = 0;
	private intervalId: ReturnType<typeof setInterval> | null = null;
	private running = false;

	constructor(config?: Partial<HeartbeatMonitorConfig>, theme?: Theme) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.theme = theme ?? DEFAULT_THEME;
	}

	// ─── Public API ────────────────────────────────────────────────────

	/** Replace the full agent list. Call this whenever heartbeats update. */
	update(agents: HeartbeatEntry[]): void {
		this.agents = agents;
	}

	/** Start auto-refresh. Advances the animation frame at `refreshInterval`. */
	start(): void {
		if (this.running) return;
		this.running = true;
		this.intervalId = setInterval(() => {
			this.frame++;
		}, this.config.refreshInterval);
	}

	/** Stop auto-refresh. */
	stop(): void {
		if (!this.running) return;
		this.running = false;
		if (this.intervalId !== null) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	/** Manually advance one animation frame (useful if you drive your own loop). */
	tick(): void {
		this.frame++;
	}

	/** Whether the monitor is currently auto-refreshing. */
	get isRunning(): boolean {
		return this.running;
	}

	/** Current animation frame counter. */
	get currentFrame(): number {
		return this.frame;
	}

	// ─── Full Render ───────────────────────────────────────────────────

	/**
	 * Render the full heartbeat monitor as a multi-line string.
	 *
	 * No ANSI cursor manipulation is used -- just returns a styled string
	 * that the caller can print however they like.
	 */
	render(): string {
		if (this.agents.length === 0) {
			const mutedColor = hexToAnsi(this.theme.colors.muted);
			return `${mutedColor}${dim("  No agents running.")}${reset}`;
		}

		const lines: string[] = [];
		const headerLine = this.renderHeader();
		if (headerLine) lines.push(headerLine);

		for (let i = 0; i < this.agents.length; i++) {
			const agent = this.agents[i];
			const isLast = this.isLastAtDepth(i);
			lines.push(this.renderAgentLine(agent, isLast));
		}

		return lines.join("\n");
	}

	/**
	 * Render a compact single-line summary.
	 *
	 * Example: `heart 3/5 alive | heart 1 stale | X 1 dead`
	 */
	renderCompact(): string {
		const counts = { alive: 0, stale: 0, dead: 0, completed: 0, error: 0 };
		const total = this.agents.length;

		for (const a of this.agents) {
			switch (a.status) {
				case "alive": counts.alive++; break;
				case "stale": counts.stale++; break;
				case "dead": case "killed": counts.dead++; break;
				case "completed": counts.completed++; break;
				case "error": counts.error++; break;
			}
		}

		const successColor = hexToAnsi(this.theme.colors.success);
		const warningColor = hexToAnsi(this.theme.colors.warning);
		const errorColor = hexToAnsi(this.theme.colors.error);
		const mutedColor = hexToAnsi(this.theme.colors.muted);

		const parts: string[] = [];
		if (counts.alive > 0) parts.push(`${successColor}${HEART_ALIVE} ${counts.alive}/${total} alive${reset}`);
		if (counts.stale > 0) parts.push(`${warningColor}${HEART_STALE} ${counts.stale} stale${reset}`);
		if (counts.dead > 0) parts.push(`${errorColor}${HEART_DEAD} ${counts.dead} dead${reset}`);
		if (counts.error > 0) parts.push(`${errorColor}${HEART_ERROR} ${counts.error} error${reset}`);
		if (counts.completed > 0) parts.push(`${mutedColor}${HEART_DONE} ${counts.completed} done${reset}`);

		if (parts.length === 0) return `${mutedColor}No agents${reset}`;
		return parts.join(` ${mutedColor}\u2502${reset} `);
	}

	// ─── Internal Rendering ────────────────────────────────────────────

	/** Render the header line with column labels. */
	private renderHeader(): string {
		const mutedColor = hexToAnsi(this.theme.colors.muted);
		const primaryColor = hexToAnsi(this.theme.colors.primary);
		return `${mutedColor}${dim("\u2554\u2550\u2550")}${primaryColor}${dim(" Agent Vitals ")}${mutedColor}${dim("\u2550".repeat(Math.max(0, this.config.width + 20)))}${reset}`;
	}

	/** Check if an agent at `index` is the last sibling at its depth. */
	private isLastAtDepth(index: number): boolean {
		const depth = this.agents[index].depth;
		for (let j = index + 1; j < this.agents.length; j++) {
			if (this.agents[j].depth < depth) return true;
			if (this.agents[j].depth === depth) return false;
		}
		return true;
	}

	/** Render a single agent line with tree indent, waveform, and stats. */
	private renderAgentLine(agent: HeartbeatEntry, isLast: boolean): string {
		const color = statusColor(agent.status, this.theme);
		const mutedColor = hexToAnsi(this.theme.colors.muted);
		const isDimmed = this.config.blinkDead
			&& (agent.status === "dead" || agent.status === "killed")
			&& this.frame % 2 === 1;

		const treePrefix = this.config.showTree ? this.buildTreePrefix(agent.depth, isLast) : "  ";
		const truncId = agent.agentId.length > 10 ? agent.agentId.slice(0, 10) : agent.agentId;
		const purposeText = agent.purpose.length > 20 ? agent.purpose.slice(0, 19) + "\u2026" : agent.purpose;
		const labelRaw = `${truncId} [${purposeText}]`;
		const label = isDimmed ? dim(labelRaw) : `${bold(truncId)}${mutedColor} [${purposeText}]${reset}`;
		const traceRaw = generateEcgTrace(agent.status, this.config.width, this.frame);
		const trace = isDimmed ? `${mutedColor}${dim(traceRaw)}${reset}` : `${color}${traceRaw}${reset}`;
		const icon = statusIcon(agent.status);
		const age = formatAge(agent.lastBeatAge);
		const heartSection = isDimmed ? dim(`${icon} ${age} ago`) : `${color}${icon}${reset} ${mutedColor}${age} ago${reset}`;

		let budgetSection = "";
		if (this.config.showBudget && agent.tokenBudget > 0) {
			const bColor = budgetColor(agent.tokenUsage, agent.tokenBudget, this.theme);
			const usageStr = formatTokenCount(agent.tokenUsage);
			const budgetStr = formatTokenCount(agent.tokenBudget);
			const ratio = agent.tokenUsage / agent.tokenBudget;
			const barWidth = 8;
			const filled = Math.round(ratio * barWidth);
			const bar = isDimmed
				? dim("\u2588".repeat(filled) + "\u2591".repeat(barWidth - filled))
				: `${bColor}${"\u2588".repeat(filled)}${mutedColor}${"\u2591".repeat(barWidth - filled)}${reset}`;
			budgetSection = isDimmed
				? dim(` ${usageStr}/${budgetStr}`)
				: `${SEP}${bar} ${bColor}${usageStr}${mutedColor}/${budgetStr}${reset}`;
		}

		const sep = isDimmed ? dim(" \u2502 ") : `${mutedColor}${SEP}${reset}`;
		return `${mutedColor}${treePrefix}${reset}${label} ${trace}${sep}${heartSection}${budgetSection}`;
	}

	/** Build the tree-drawing prefix for a given depth. */
	private buildTreePrefix(depth: number, isLast: boolean): string {
		if (depth === 0) return "  ";
		let prefix = "  ";
		for (let d = 1; d < depth; d++) {
			prefix += `${TREE_PIPE}  `;
		}
		prefix += isLast ? `${TREE_END} ` : `${TREE_BRANCH} `;
		return prefix;
	}
}
