/**
 * @chitragupta/ui — ECG-style ASCII heartbeat monitor.
 *
 * Visualizes agent heartbeats as a scrolling ECG/EKG waveform trace
 * in the terminal. Each agent gets its own line with a tree-indented
 * label, a live-scrolling waveform, status icon, beat age, and token
 * budget bar. Dead agents blink. The whole thing looks like you are
 * monitoring the vital signs of your agent swarm.
 */

import { bold, dim, reset } from "../ansi.js";
import { DEFAULT_THEME, type Theme, hexToAnsi } from "../theme.js";

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

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * ECG PQRST waveform approximated as a sequence of Unicode box-drawing
 * characters. Reading left to right this traces:
 *
 *   ─ ─ ╮ ╰ ─ ╯ ╭ ╮ ╰ ╯
 *
 * Which, when printed in a scrolling line, evokes the characteristic
 * P-wave dip, QRS spike, and T-wave of a real ECG trace.
 */
const ECG_BEAT: readonly string[] = [
	"─", "─", "╮", "╰", "─", "╯", "╭", "╮", "╰", "╯",
];

/** Flat-line character used for dead signals and gaps between beats. */
const ECG_FLAT = "─";

/** Heart icons per status. */
const HEART_ALIVE = "\u2665";   // ♥
const HEART_STALE = "\u2661";   // ♡
const HEART_DEAD = "\u2715";    // ✕
const HEART_DONE = "\u2713";    // ✓
const HEART_ERROR = "\u2620";   // ☠

/** Tree-drawing characters. */
const TREE_BRANCH = "\u251C\u2500"; // ├─
const TREE_END = "\u2514\u2500";    // └─
const TREE_PIPE = "\u2502";         // │

/** Box-drawing separator. */
const SEP = " \u2502 "; // │ with spaces

// ─── Default Config ─────────────────────────────────────────────────────────

const DEFAULT_CONFIG: HeartbeatMonitorConfig = {
	width: 30,
	showTree: true,
	showBudget: true,
	blinkDead: true,
	refreshInterval: 500,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Generate a single-row scrolling ECG trace string.
 *
 * @param status  - Agent status controlling the waveform shape.
 * @param width   - Number of characters wide the trace should be.
 * @param frame   - Current animation frame (incremented each tick).
 * @returns A plain string of box-drawing characters representing the trace.
 */
function generateEcgTrace(
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
		const errBeat: readonly string[] = ["─", "╮", "╰", "╯", "╭", "╮", "╰", "╯"];
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
function formatTokenCount(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
	return String(n);
}

/**
 * Format a millisecond duration as a human-readable age string.
 */
function formatAge(ms: number): string {
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
function statusColor(
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
function statusIcon(status: HeartbeatEntry["status"]): string {
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
function budgetColor(usage: number, budget: number, theme: Theme): string {
	if (budget <= 0) return hexToAnsi(theme.colors.muted);
	const ratio = usage / budget;
	if (ratio > 0.8) return hexToAnsi(theme.colors.error);
	if (ratio > 0.6) return hexToAnsi(theme.colors.warning);
	return hexToAnsi(theme.colors.success);
}

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
	 * No ANSI cursor manipulation is used — just returns a styled string
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
	 * Example: `♥ 3/5 alive │ ♡ 1 stale │ ✕ 1 dead`
	 */
	renderCompact(): string {
		const counts = { alive: 0, stale: 0, dead: 0, completed: 0, error: 0 };
		const total = this.agents.length;

		for (const a of this.agents) {
			switch (a.status) {
				case "alive":
					counts.alive++;
					break;
				case "stale":
					counts.stale++;
					break;
				case "dead":
				case "killed":
					counts.dead++;
					break;
				case "completed":
					counts.completed++;
					break;
				case "error":
					counts.error++;
					break;
			}
		}

		const successColor = hexToAnsi(this.theme.colors.success);
		const warningColor = hexToAnsi(this.theme.colors.warning);
		const errorColor = hexToAnsi(this.theme.colors.error);
		const mutedColor = hexToAnsi(this.theme.colors.muted);

		const parts: string[] = [];

		if (counts.alive > 0) {
			parts.push(`${successColor}${HEART_ALIVE} ${counts.alive}/${total} alive${reset}`);
		}
		if (counts.stale > 0) {
			parts.push(`${warningColor}${HEART_STALE} ${counts.stale} stale${reset}`);
		}
		if (counts.dead > 0) {
			parts.push(`${errorColor}${HEART_DEAD} ${counts.dead} dead${reset}`);
		}
		if (counts.error > 0) {
			parts.push(`${errorColor}${HEART_ERROR} ${counts.error} error${reset}`);
		}
		if (counts.completed > 0) {
			parts.push(`${mutedColor}${HEART_DONE} ${counts.completed} done${reset}`);
		}

		if (parts.length === 0) {
			return `${mutedColor}No agents${reset}`;
		}

		return parts.join(` ${mutedColor}\u2502${reset} `);
	}

	// ─── Internal Rendering ────────────────────────────────────────────

	/** Render the header line with column labels. */
	private renderHeader(): string {
		const mutedColor = hexToAnsi(this.theme.colors.muted);
		const primaryColor = hexToAnsi(this.theme.colors.primary);

		// Build a top border with a subtle label
		const topBorder = `${mutedColor}${dim("╔══")}${primaryColor}${dim(" Agent Vitals ")}${mutedColor}${dim("═".repeat(Math.max(0, this.config.width + 20)))}${reset}`;
		return topBorder;
	}

	/**
	 * Determine if an agent at `index` is the last sibling at its depth.
	 * This controls whether we use └─ (last) or ├─ (not last).
	 */
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

		// 1. Tree indent
		const treePrefix = this.config.showTree
			? this.buildTreePrefix(agent.depth, isLast)
			: "  ";

		// 2. Agent label: id (truncated) + purpose in brackets
		const truncId = agent.agentId.length > 10
			? agent.agentId.slice(0, 10)
			: agent.agentId;
		const purposeText = agent.purpose.length > 20
			? agent.purpose.slice(0, 19) + "\u2026"
			: agent.purpose;

		const labelRaw = `${truncId} [${purposeText}]`;
		const label = isDimmed
			? dim(labelRaw)
			: `${bold(truncId)}${mutedColor} [${purposeText}]${reset}`;

		// 3. ECG waveform trace
		const traceRaw = generateEcgTrace(agent.status, this.config.width, this.frame);
		const trace = isDimmed
			? `${mutedColor}${dim(traceRaw)}${reset}`
			: `${color}${traceRaw}${reset}`;

		// 4. Heart icon + age
		const icon = statusIcon(agent.status);
		const age = formatAge(agent.lastBeatAge);
		const heartSection = isDimmed
			? dim(`${icon} ${age} ago`)
			: `${color}${icon}${reset} ${mutedColor}${age} ago${reset}`;

		// 5. Token budget
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

		// Assemble the line
		const sep = isDimmed ? dim(" \u2502 ") : `${mutedColor}${SEP}${reset}`;

		return `${mutedColor}${treePrefix}${reset}${label} ${trace}${sep}${heartSection}${budgetSection}`;
	}

	/**
	 * Build the tree-drawing prefix for a given depth.
	 *
	 * At depth 0: no prefix (root-level agent).
	 * At depth N: pipe characters for each ancestor level, then branch/end.
	 */
	private buildTreePrefix(depth: number, isLast: boolean): string {
		if (depth === 0) {
			return "  ";
		}

		let prefix = "  ";
		for (let d = 1; d < depth; d++) {
			prefix += `${TREE_PIPE}  `;
		}
		prefix += isLast ? `${TREE_END} ` : `${TREE_BRANCH} `;
		return prefix;
	}
}
