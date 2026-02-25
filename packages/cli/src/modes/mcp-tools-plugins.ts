/**
 * MCP Tools — UI Extension Plugin Registry.
 *
 * Tool factories for querying UI extensions contributed by skills.
 * Exposes the centralized {@link UIExtensionRegistry} to MCP clients
 * so TUI consumers can discover available widgets, keybinds, and panels
 * without manual plugin configuration.
 *
 * **Tool 1: `chitragupta_ui_extensions`**
 *   — Lists all registered UI extensions, optionally filtered by type.
 *
 * **Tool 2: `chitragupta_widget_data`**
 *   — Returns the latest widget data for a given widget ID.
 *
 * @module
 */

import type { McpToolHandler, McpToolResult } from "@chitragupta/tantra";
import {
	UIExtensionRegistry,
	type UIExtension,
} from "@chitragupta/tantra";

// ─── Singleton Registry & Widget Data Store ─────────────────────────────────

let _registry: UIExtensionRegistry | undefined;

/**
 * Get the shared UIExtensionRegistry singleton.
 *
 * Lazily created on first access. Skills register their UI contributions
 * here during discovery; MCP tools query it on behalf of TUI consumers.
 */
export function getUIExtensionRegistry(): UIExtensionRegistry {
	if (!_registry) {
		_registry = new UIExtensionRegistry();
	}
	return _registry;
}

/** Reset the singleton (for testing). */
export function resetUIExtensionRegistry(): void {
	_registry = undefined;
	_widgetDataStore.clear();
}

/**
 * In-memory store for the latest widget data keyed by widget ID.
 *
 * Skills push widget data here; the `chitragupta_widget_data` tool reads it.
 * Each entry holds the most recent content string for a given widget.
 */
const _widgetDataStore = new Map<string, WidgetDataEntry>();

/** A stored widget data entry. */
interface WidgetDataEntry {
	/** The widget ID. */
	widgetId: string;
	/** The skill that produced this data. */
	skillName: string;
	/** The latest content payload. */
	content: string;
	/** Format hint for the TUI renderer. */
	format: string;
	/** When this data was last updated (epoch ms). */
	updatedAt: number;
}

/**
 * Store widget data for retrieval by `chitragupta_widget_data`.
 *
 * Called by skill integrations when a widget produces new content.
 */
export function setWidgetData(
	widgetId: string,
	skillName: string,
	content: string,
	format = "plain",
): void {
	_widgetDataStore.set(widgetId, {
		widgetId,
		skillName,
		content,
		format,
		updatedAt: Date.now(),
	});
}

/** Get stored widget data by widget ID. */
export function getWidgetData(widgetId: string): WidgetDataEntry | undefined {
	return _widgetDataStore.get(widgetId);
}

// ─── Filter type guard ──────────────────────────────────────────────────────

/** Valid filter types for the ui_extensions tool. */
type ExtensionFilterType = "widgets" | "keybinds" | "panels";

const VALID_FILTER_TYPES = new Set<string>(["widgets", "keybinds", "panels"]);

/** Check if a string is a valid filter type. */
function isValidFilterType(value: string): value is ExtensionFilterType {
	return VALID_FILTER_TYPES.has(value);
}

// ─── Serialization Helpers ──────────────────────────────────────────────────

/** Serialize an extension for MCP text output. */
function formatExtension(ext: UIExtension, index: number): string {
	const parts: string[] = [
		`[${index + 1}] ${ext.skillName} v${ext.version}`,
	];

	if (ext.widgets.length > 0) {
		parts.push(`  Widgets (${ext.widgets.length}):`);
		for (const w of ext.widgets) {
			const pos = w.position ? ` [${w.position}]` : "";
			const refresh = w.refreshMs ? ` (refresh: ${w.refreshMs}ms)` : "";
			parts.push(`    - ${w.id}: "${w.label}"${pos}${refresh}`);
		}
	}

	if (ext.keybinds.length > 0) {
		parts.push(`  Keybinds (${ext.keybinds.length}):`);
		for (const k of ext.keybinds) {
			parts.push(`    - ${k.key}: "${k.description}" → ${k.command}`);
		}
	}

	if (ext.panels.length > 0) {
		parts.push(`  Panels (${ext.panels.length}):`);
		for (const p of ext.panels) {
			parts.push(`    - ${p.id}: "${p.title}" (${p.type})`);
		}
	}

	return parts.join("\n");
}

// ─── chitragupta_ui_extensions ──────────────────────────────────────────────

/**
 * Create the `chitragupta_ui_extensions` tool.
 *
 * Returns all registered UI extensions, optionally filtered by contribution
 * type (widgets, keybinds, or panels). This is the primary discovery surface
 * for TUI consumers.
 */
export function createUIExtensionsTool(): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_ui_extensions",
			description:
				"List all registered UI extensions from skills. " +
				"Returns widgets, keybinds, and panels contributed by discovered skills. " +
				"TUI consumers call this on startup to know what UI elements are available. " +
				"Optionally filter by type: 'widgets', 'keybinds', or 'panels'.",
			inputSchema: {
				type: "object",
				properties: {
					type: {
						type: "string",
						enum: ["widgets", "keybinds", "panels"],
						description:
							"Optional filter: return only extensions with this contribution type.",
					},
				},
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			try {
				const registry = getUIExtensionRegistry();
				const filterType = args.type != null ? String(args.type) : undefined;

				// Validate filter type if provided
				if (filterType !== undefined && !isValidFilterType(filterType)) {
					return {
						content: [{
							type: "text",
							text: `Error: invalid type "${filterType}". Must be one of: widgets, keybinds, panels.`,
						}],
						isError: true,
					};
				}

				// Get extensions based on filter
				let extensions: UIExtension[];
				if (filterType === "widgets") {
					extensions = registry.getWidgetExtensions();
				} else if (filterType === "keybinds") {
					extensions = registry.getKeybindExtensions();
				} else if (filterType === "panels") {
					extensions = registry.getPanelExtensions();
				} else {
					extensions = registry.getAvailableUIExtensions();
				}

				if (extensions.length === 0) {
					const filterHint = filterType
						? ` with ${filterType}`
						: "";
					return {
						content: [{
							type: "text",
							text: `No UI extensions registered${filterHint}. ` +
								"Skills with UI contributions are auto-registered on discovery.",
						}],
						_metadata: {
							typed: { extensions: [], count: 0, filter: filterType ?? null },
						},
					};
				}

				const formatted = extensions
					.map((ext, i) => formatExtension(ext, i))
					.join("\n\n");

				const summary = filterType
					? `UI Extensions with ${filterType} (${extensions.length}):`
					: `UI Extensions (${extensions.length}):`;

				return {
					content: [{
						type: "text",
						text: `${summary}\n\n${formatted}`,
					}],
					_metadata: {
						typed: {
							extensions: extensions.map((ext) => ({
								skillName: ext.skillName,
								version: ext.version,
								widgetCount: ext.widgets.length,
								keybindCount: ext.keybinds.length,
								panelCount: ext.panels.length,
								registeredAt: ext.registeredAt,
							})),
							count: extensions.length,
							filter: filterType ?? null,
						},
					},
				};
			} catch (err) {
				return {
					content: [{
						type: "text",
						text: `Failed to list UI extensions: ${err instanceof Error ? err.message : String(err)}`,
					}],
					isError: true,
				};
			}
		},
	};
}

// ─── chitragupta_widget_data ────────────────────────────────────────────────

/**
 * Create the `chitragupta_widget_data` tool.
 *
 * Returns the latest data for a specific widget by ID. Skills push
 * data via {@link setWidgetData}; TUI consumers read it here.
 */
export function createWidgetDataTool(): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_widget_data",
			description:
				"Get the latest data for a specific UI widget. " +
				"Returns the most recent content pushed by the skill that owns the widget. " +
				"If no data is available yet, returns an error.",
			inputSchema: {
				type: "object",
				properties: {
					widgetId: {
						type: "string",
						description: "The widget ID to fetch data for.",
					},
				},
				required: ["widgetId"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const widgetId = String(args.widgetId ?? "");

			if (!widgetId) {
				return {
					content: [{ type: "text", text: "Error: widgetId is required" }],
					isError: true,
				};
			}

			try {
				// First verify the widget exists in the registry
				const registry = getUIExtensionRegistry();
				const found = registry.findWidget(widgetId);

				if (!found) {
					return {
						content: [{
							type: "text",
							text: `Widget "${widgetId}" not found in any registered extension. ` +
								"Use chitragupta_ui_extensions to see available widgets.",
						}],
						isError: true,
						_metadata: { typed: { ok: false, error: "Widget not found" } },
					};
				}

				// Check for stored data
				const data = getWidgetData(widgetId);

				if (!data) {
					return {
						content: [{
							type: "text",
							text: `No data available yet for widget "${widgetId}" ` +
								`(from skill "${found.extension.skillName}"). ` +
								"The skill has not pushed any content for this widget.",
						}],
						_metadata: {
							typed: {
								ok: false,
								error: "No data available",
								widgetId,
								skillName: found.extension.skillName,
								widgetLabel: found.widget.label,
							},
						},
					};
				}

				return {
					content: [{
						type: "text",
						text: data.content,
					}],
					_metadata: {
						typed: {
							ok: true,
							widgetId: data.widgetId,
							skillName: data.skillName,
							format: data.format,
							updatedAt: data.updatedAt,
						},
					},
				};
			} catch (err) {
				return {
					content: [{
						type: "text",
						text: `Failed to get widget data: ${err instanceof Error ? err.message : String(err)}`,
					}],
					isError: true,
				};
			}
		},
	};
}
