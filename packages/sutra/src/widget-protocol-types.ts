/**
 * Widget Data Protocol — Type definitions.
 *
 * Defines the contract between Chitragupta's widget execution layer
 * and TUI consumers (Takumi). Widgets are data sources that produce
 * periodic or event-driven updates rendered by the TUI.
 *
 * @module widget-protocol-types
 */

// ─── Widget Source ───────────────────────────────────────────────────────────

/** Configuration for a widget data source. */
export interface WidgetSource {
	/** Unique widget ID matching the skill's contribution ID. */
	id: string;
	/** Human-readable label. */
	label: string;
	/** Script/command to execute for data (split into command + args internally). */
	script?: string;
	/** Samiti channel for event-driven updates. */
	channel?: string;
	/** Refresh interval in ms (0 = event-driven only). */
	refreshMs: number;
	/** Output format. */
	format: "plain" | "ansi" | "json";
	/** Maximum execution time for script in ms. */
	timeoutMs?: number;
}

// ─── Widget Update ───────────────────────────────────────────────────────────

/** A single widget data update delivered to subscribers. */
export interface WidgetUpdate {
	/** Widget ID. */
	widgetId: string;
	/** Rendered content (string for plain/ansi, serialized for json). */
	content: string;
	/** Epoch ms when this update was produced. */
	timestamp: number;
	/** Whether the script execution succeeded. */
	ok: boolean;
	/** Error message if ok=false. */
	error?: string;
}

// ─── Widget Subscription ─────────────────────────────────────────────────────

/** Widget subscription request from a TUI consumer. */
export interface WidgetSubscription {
	/** Widget IDs to subscribe to. */
	widgetIds: string[];
	/** Callback for updates. */
	onUpdate: (update: WidgetUpdate) => void;
}

// ─── Stream Configuration ────────────────────────────────────────────────────

/** Default values for WidgetDataStream configuration. */
export const WIDGET_DEFAULTS = {
	maxConcurrentScripts: 4,
	defaultTimeoutMs: 10_000,
	maxWidgets: 50,
	maxBuffer: 65_536, // 64KB
} as const;

/** Configuration for the WidgetDataStream. */
export interface WidgetDataStreamConfig {
	/** Maximum concurrent script executions. Default: 4. */
	maxConcurrentScripts?: number;
	/** Default script timeout in ms. Default: 10000. */
	defaultTimeoutMs?: number;
	/** Maximum number of registered widgets. Default: 50. */
	maxWidgets?: number;
}
