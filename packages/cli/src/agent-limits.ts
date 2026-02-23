import { loadGlobalSettings } from "@chitragupta/core";

interface AgentLimitsSettingsShape {
	agents?: {
		maxDepth?: number;
		maxSubAgents?: number;
	};
}

export interface AgentLimits {
	maxDepth: number;
	maxSubAgents: number;
}

const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_SUB_AGENTS = 12;

/**
 * Resolve KaalaBrahma limits from global settings with legacy-safe fallback.
 *
 * Some workspaces may run with older @chitragupta/core builds that don't expose
 * the `agents` field in generated typings yet. We read settings through a narrow
 * shape to avoid hard compile coupling while preserving runtime behavior.
 */
export function resolveAgentLimits(): AgentLimits {
	const settings = loadGlobalSettings() as unknown as AgentLimitsSettingsShape;
	return {
		maxDepth: settings.agents?.maxDepth ?? DEFAULT_MAX_DEPTH,
		maxSubAgents: settings.agents?.maxSubAgents ?? DEFAULT_MAX_SUB_AGENTS,
	};
}
