/**
 * @module ui-contribution-types
 * @description UI contribution points that skills can declare in their SKILL.md frontmatter.
 *
 * These types define the contract between a skill and a TUI consumer (e.g. "Takumi").
 * A skill declares widgets, keybinds, and panels; the TUI renders them.
 * Updates flow either via polling (refreshMs + script) or push (Samiti channel).
 *
 * @packageDocumentation
 */

// ─── Widget Contributions ───────────────────────────────────────────────────

/** Output format hint for widget/panel data. */
export type UIOutputFormat = "plain" | "ansi" | "json" | "markdown";

/** A status bar widget provided by a skill. */
export interface SkillWidgetContribution {
	/** Unique widget ID (e.g., "gcp-status", "git-branch"). */
	readonly id: string;
	/** Human-readable label shown in the status bar. */
	readonly label: string;
	/** Widget position preference. */
	readonly position?: "left" | "center" | "right";
	/** Update interval in milliseconds (0 = event-driven only). */
	readonly refreshMs?: number;
	/** Script or command that produces the widget data. */
	readonly script?: string;
	/** Samiti channel to subscribe for live updates (e.g., "#gcp-status"). */
	readonly channel?: string;
	/** Output format hint. */
	readonly format?: UIOutputFormat;
}

// ─── Keybind Contributions ──────────────────────────────────────────────────

/** A keybind contribution from a skill. */
export interface SkillKeybindContribution {
	/** Key combination (e.g., "ctrl+g", "alt+s"). */
	readonly key: string;
	/** Human-readable action description. */
	readonly description: string;
	/** Command/tool to invoke when triggered. */
	readonly command: string;
	/** Arguments to pass to the command. */
	readonly args?: Record<string, unknown>;
}

// ─── Panel Contributions ────────────────────────────────────────────────────

/** Panel type/location in the TUI. */
export type PanelType = "sidebar" | "modal" | "overlay" | "tab";

/** A panel contribution from a skill (sidebar, modal, etc.). */
export interface SkillPanelContribution {
	/** Unique panel ID. */
	readonly id: string;
	/** Panel title. */
	readonly title: string;
	/** Panel type/location. */
	readonly type: PanelType;
	/** Script or command that produces panel content. */
	readonly script?: string;
	/** Samiti channel for live panel data. */
	readonly channel?: string;
	/** Output format. */
	readonly format?: UIOutputFormat;
}

// ─── Aggregate UI Contributions ─────────────────────────────────────────────

/** All UI contributions a skill can declare. */
export interface SkillUIContributions {
	/** Status bar widgets. */
	readonly widgets?: SkillWidgetContribution[];
	/** Keyboard shortcuts. */
	readonly keybinds?: SkillKeybindContribution[];
	/** Custom panels. */
	readonly panels?: SkillPanelContribution[];
}
