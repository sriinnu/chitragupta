/**
 * MCP Resources — OS Integration Surface.
 *
 * Exposes Chitragupta's platform state as queryable MCP resources.
 * Any MCP consumer (Takumi, Vaayu, etc.) can read these to discover
 * system metrics, active plugins, configuration, and recent tool history.
 *
 * Resources:
 *   - chitragupta://system/metrics   — heap, RSS, uptime, tool count
 *   - chitragupta://ecosystem/plugins — aggregated skill + UI extension data
 *   - chitragupta://system/config     — transport, features, runtime flags
 *   - chitragupta://tools/recent      — last 50 tool calls from ring buffer
 *
 * @module
 */

import type { McpResourceHandler, McpContent, ToolCallRecord } from "@chitragupta/tantra";
import { getSkillRegistry, type SkillRegistryLike } from "./mcp-subsystems.js";
import { getUIExtensionRegistry } from "./mcp-tools-plugins.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Callback providing live server context for the metrics resource. */
export interface MetricsContext {
	/** Number of registered MCP tools. */
	toolCount: number;
	/** Number of registered plugins (optional). */
	pluginCount?: number;
}

/** Callback providing live server context for recent calls resource. */
export type RecentCallsProvider = () => ToolCallRecord[];

// ─── Resource 1: System Metrics ─────────────────────────────────────────────

/**
 * Create the `chitragupta://system/metrics` resource.
 *
 * Returns process-level metrics: heap usage, RSS, uptime, tool count,
 * PID, Node version, and platform. Consumers render status bars from this.
 *
 * @param getContext - Callback returning live tool/plugin counts.
 */
export function createSystemMetricsResource(
	getContext: () => MetricsContext,
): McpResourceHandler {
	return {
		definition: {
			uri: "chitragupta://system/metrics",
			name: "System Metrics",
			description:
				"Process-level system metrics: memory, uptime, tool count, platform. " +
				"Use for status bars, dashboards, and health monitoring.",
			mimeType: "application/json",
		},
		async read(): Promise<McpContent[]> {
			const mem = process.memoryUsage();
			const ctx = getContext();
			const metrics = {
				heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100,
				heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100,
				rssMB: Math.round(mem.rss / 1024 / 1024 * 100) / 100,
				uptimeS: Math.round(process.uptime() * 100) / 100,
				toolCount: ctx.toolCount,
				pluginCount: ctx.pluginCount ?? 0,
				pid: process.pid,
				nodeVersion: process.version,
				platform: process.platform,
				arch: process.arch,
			};
			return [{ type: "text", text: JSON.stringify(metrics, null, 2) }];
		},
	};
}

// ─── Resource 2: Ecosystem Plugins ──────────────────────────────────────────

/** Skill summary shape for the plugin resource. */
interface PluginSkillInfo {
	name: string;
	description: string;
	tags: string[];
	capabilities: string[];
	uiContributions?: PluginUiSummary;
}

/** UI contribution summary shape for plugin ecosystem output. */
interface PluginUiSummary {
	source: "ui-extension-registry" | "skill-manifest";
	widgets: string[];
	keybinds: string[];
	panels: string[];
	widgetCount: number;
	keybindCount: number;
	panelCount: number;
}

/**
 * Create the `chitragupta://ecosystem/plugins` resource.
 *
 * Aggregates data from the skill registry and UI extension registry,
 * returning a unified view of all plugins, their tools, and UI contributions.
 */
export function createPluginEcosystemResource(): McpResourceHandler {
	return {
		definition: {
			uri: "chitragupta://ecosystem/plugins",
			name: "Plugin Ecosystem",
			description:
				"All registered skills and UI extensions with capabilities, tags, " +
				"and UI contributions (widgets, keybinds, panels). " +
				"Use for plugin browsers, autocomplete, and help menus.",
			mimeType: "application/json",
		},
		async read(): Promise<McpContent[]> {
			const plugins: PluginSkillInfo[] = [];
			const uiBySkill = new Map<string, PluginUiSummary>();

			try {
				const registry = getUIExtensionRegistry();
				const uiExtensions = registry.getAvailableUIExtensions() as Array<Record<string, unknown>>;
				for (const ext of uiExtensions) {
					const skillName = String(ext.skillName ?? "").trim();
					if (!skillName) continue;

					const widgets = Array.isArray(ext.widgets)
						? (ext.widgets as Array<Record<string, unknown>>).map((w) => String(w.id ?? "")).filter((v) => v.length > 0)
						: [];
					const keybinds = Array.isArray(ext.keybinds)
						? (ext.keybinds as Array<Record<string, unknown>>).map((k) => String(k.key ?? "")).filter((v) => v.length > 0)
						: [];
					const panels = Array.isArray(ext.panels)
						? (ext.panels as Array<Record<string, unknown>>).map((p) => String(p.id ?? "")).filter((v) => v.length > 0)
						: [];

					uiBySkill.set(skillName, {
						source: "ui-extension-registry",
						widgets,
						keybinds,
						panels,
						widgetCount: widgets.length,
						keybindCount: keybinds.length,
						panelCount: panels.length,
					});
				}
			} catch {
				// UI extension subsystem is optional.
			}

			try {
				const registry = await getSkillRegistry();
				const skills = registry.getAll();
				for (const skill of skills) {
					plugins.push(buildPluginInfo(skill, registry, uiBySkill));
				}
			} catch {
				// Skills subsystem not available — return empty list
			}

			const result = {
				count: plugins.length,
				uiExtensionCount: uiBySkill.size,
				plugins,
			};
			return [{ type: "text", text: JSON.stringify(result, null, 2) }];
		},
	};
}

/**
 * Build a plugin info object from a skill record.
 *
 * @param skill - Raw skill record from the registry.
 * @param _registry - The skill registry (unused currently, reserved for enrichment).
 */
function buildPluginInfo(
	skill: Record<string, unknown>,
	_registry: SkillRegistryLike,
	uiBySkill: Map<string, PluginUiSummary>,
): PluginSkillInfo {
	const caps: string[] = [];
	const rawCaps = skill.capabilities as Array<{ name?: string } | string> | undefined;
	if (Array.isArray(rawCaps)) {
		for (const cap of rawCaps) {
			if (typeof cap === "string") caps.push(cap);
			else if (typeof cap === "object" && cap.name) caps.push(cap.name);
		}
	}

	const skillName = String(skill.name ?? "unnamed");
	let uiContributions = uiBySkill.get(skillName);

	if (!uiContributions) {
		const rawUi = skill.ui;
		if (typeof rawUi === "object" && rawUi !== null) {
			const ui = rawUi as Record<string, unknown>;
			const widgets = Array.isArray(ui.widgets)
				? (ui.widgets as Array<Record<string, unknown>>).map((w) => String(w.id ?? "")).filter((v) => v.length > 0)
				: [];
			const keybinds = Array.isArray(ui.keybinds)
				? (ui.keybinds as Array<Record<string, unknown>>).map((k) => String(k.key ?? "")).filter((v) => v.length > 0)
				: [];
			const panels = Array.isArray(ui.panels)
				? (ui.panels as Array<Record<string, unknown>>).map((p) => String(p.id ?? "")).filter((v) => v.length > 0)
				: [];
			if (widgets.length > 0 || keybinds.length > 0 || panels.length > 0) {
				uiContributions = {
					source: "skill-manifest",
					widgets,
					keybinds,
					panels,
					widgetCount: widgets.length,
					keybindCount: keybinds.length,
					panelCount: panels.length,
				};
			}
		}
	}

	return {
		name: skillName,
		description: String(skill.description ?? ""),
		tags: Array.isArray(skill.tags) ? (skill.tags as string[]).map(String) : [],
		capabilities: caps,
		...(uiContributions ? { uiContributions } : {}),
	};
}

// ─── Resource 3: System Config ──────────────────────────────────────────────

/**
 * Create the `chitragupta://system/config` resource.
 *
 * Returns current runtime configuration: transport mode, project path,
 * active features, and subsystem status. Consumers use this for
 * self-discovery of available capabilities.
 *
 * @param projectPath - The project directory path.
 */
export function createSystemConfigResource(
	projectPath: string,
): McpResourceHandler {
	return {
		definition: {
			uri: "chitragupta://system/config",
			name: "System Configuration",
			description:
				"Runtime configuration: transport, project path, active features, " +
				"and subsystem availability. Use for consumer self-discovery.",
			mimeType: "application/json",
		},
		async read(): Promise<McpContent[]> {
			const features: string[] = [
				"memory",
				"sessions",
				"skills",
				"mesh",
				"collective-intelligence",
				"introspection",
			];

			const config = {
				transport: "stdio",
				projectPath,
				features,
				traceEnabled: true,
				nodeVersion: process.version,
				platform: process.platform,
			};
			return [{ type: "text", text: JSON.stringify(config, null, 2) }];
		},
	};
}

// ─── Resource 4: Recent Tool Calls ──────────────────────────────────────────

/**
 * Create the `chitragupta://tools/recent` resource.
 *
 * Returns the last N tool calls from the server's in-memory ring buffer.
 * Each entry includes tool name, trace/span IDs, duration, and error status.
 * Consumers render execution history panels and latency sparklines.
 *
 * @param getRecentCalls - Callback returning the ring buffer contents.
 */
export function createRecentToolCallsResource(
	getRecentCalls: RecentCallsProvider,
): McpResourceHandler {
	return {
		definition: {
			uri: "chitragupta://tools/recent",
			name: "Recent Tool Calls",
			description:
				"Last 50 tool executions with trace IDs, durations, and error status. " +
				"Use for execution history, latency monitoring, and debugging.",
			mimeType: "application/json",
		},
		async read(): Promise<McpContent[]> {
			const calls = getRecentCalls();
			const result = {
				count: calls.length,
				maxSize: 50,
				calls,
			};
			return [{ type: "text", text: JSON.stringify(result, null, 2) }];
		},
	};
}
