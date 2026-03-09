import type { McpContent, McpToolHandler, McpToolResult } from "@chitragupta/tantra";
import {
	enrichFromVasana,
	getLucyLiveGuidanceBlock,
	wireBuddhiRecorder,
} from "../nervous-system-wiring.js";
import { allowLocalRuntimeFallback, createDaemonBuddhiProxy } from "../runtime-daemon-proxies.js";
import { packContextWithFallback } from "../context-packing.js";

interface McpToolCallInfo {
	tool: string;
	args: Record<string, unknown>;
	result: McpToolResult;
	elapsedMs: number;
}

interface McpToolGuidanceOptions {
	projectPath: string;
	sessionIdResolver: () => string | undefined;
}

const GUIDANCE_TEXT_ARG_KEYS = new Set([
	"prompt",
	"message",
	"messages",
	"text",
	"input",
	"query",
	"task",
	"instruction",
	"instructions",
	"goal",
	"request",
]);

const GUIDANCE_SKIP_VALUE_KEYS = new Set([
	"role",
	"name",
	"type",
	"path",
	"paths",
	"uri",
	"id",
	"sessionId",
]);

const GUIDANCE_PREFERRED_VALUE_KEYS = [
	"content",
	"text",
	"message",
	"prompt",
	"input",
	"query",
	"task",
	"instruction",
	"instructions",
	"request",
];

const GUIDANCE_SKIP_TOOLS = new Set([
	"chitragupta_record_conversation",
	"chitragupta_session_list",
	"chitragupta_session_show",
	"chitragupta_day_list",
	"chitragupta_day_show",
	"chitragupta_day_search",
	"chitragupta_handover",
	"chitragupta_handover_since",
	"chitragupta_context",
	"chitragupta_memory_changes_since",
	"mesh_status",
	"mesh_peers",
	"mesh_topology",
	"health_status",
	"atman_report",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectQueryParts(value: unknown, out: string[]): void {
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed) out.push(trimmed);
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectQueryParts(item, out);
		return;
	}
	if (isPlainObject(value)) {
		for (const [key, item] of Object.entries(value)) {
			if (["path", "paths", "uri", "id", "sessionId"].includes(key)) continue;
			collectQueryParts(item, out);
		}
	}
}

function deriveGuidanceQuery(toolName: string, args: Record<string, unknown>): string {
	const parts: string[] = [];
	collectQueryParts(args, parts);
	const joined = parts.join(" | ").slice(0, 600);
	return joined ? `${toolName}: ${joined}` : toolName;
}

function shouldInjectGuidance(toolName: string): boolean {
	if (GUIDANCE_SKIP_TOOLS.has(toolName)) return false;
	if (toolName.startsWith("sabha_")) return false;
	if (toolName.startsWith("samiti_")) return false;
	if (toolName.startsWith("akasha_")) return false;
	if (toolName.startsWith("skills_")) return false;
	return true;
}

function prependGuidance(result: McpToolResult, preamble: string): McpToolResult {
	if (!preamble.trim()) return result;
	const content: McpContent[] = [{ type: "text", text: preamble }, ...result.content];
	return { ...result, content };
}

function injectGuidanceIntoArgs(
	args: Record<string, unknown>,
	preamble: string,
): { args: Record<string, unknown>; injected: boolean } {
	if (!preamble.trim()) return { args, injected: false };
	const nextArgs: Record<string, unknown> = { ...args };
	for (const [key, value] of Object.entries(args)) {
		if (!GUIDANCE_TEXT_ARG_KEYS.has(key)) continue;
		const injectedValue = injectGuidanceIntoValue(value, preamble);
		if (!injectedValue.injected) continue;
		nextArgs[key] = injectedValue.value;
		return { args: nextArgs, injected: true };
	}
	return { args, injected: false };
}

function injectGuidanceIntoValue(
	value: unknown,
	preamble: string,
): { value: unknown; injected: boolean } {
	if (typeof value === "string") {
		if (value.trim().length === 0) return { value, injected: false };
		return { value: `${preamble}\n\n${value}`, injected: true };
	}
	if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i += 1) {
			const injectedItem = injectGuidanceIntoValue(value[i], preamble);
			if (injectedItem.injected) {
				const next = value.slice();
				next[i] = injectedItem.value;
				return { value: next, injected: true };
			}
		}
		return { value, injected: false };
	}
	if (isPlainObject(value)) {
		for (const key of GUIDANCE_PREFERRED_VALUE_KEYS) {
			if (!(key in value) || GUIDANCE_SKIP_VALUE_KEYS.has(key)) continue;
			const injectedInner = injectGuidanceIntoValue(value[key], preamble);
			if (injectedInner.injected) {
				return {
					value: { ...value, [key]: injectedInner.value },
					injected: true,
				};
			}
		}
		for (const [key, inner] of Object.entries(value)) {
			if (GUIDANCE_SKIP_VALUE_KEYS.has(key)) continue;
			const injectedInner = injectGuidanceIntoValue(inner, preamble);
			if (injectedInner.injected) {
				return {
					value: { ...value, [key]: injectedInner.value },
					injected: true,
				};
			}
		}
	}
	return { value, injected: false };
}

async function buildGuidancePreamble(
	toolName: string,
	args: Record<string, unknown>,
	projectPath: string,
): Promise<string> {
	if (!shouldInjectGuidance(toolName)) return "";
	const guidanceQuery = deriveGuidanceQuery(toolName, args);
	const blocks: string[] = [];

	const lucy = await getLucyLiveGuidanceBlock(guidanceQuery, projectPath);
	if (lucy) blocks.push(lucy);

	try {
		const { getVasana } = await import("./mcp-subsystems.js");
		const vasana = await getVasana();
		const vasanaBlock = await enrichFromVasana(vasana, projectPath);
		if (vasanaBlock) blocks.push(vasanaBlock);
	} catch {
		/* best-effort */
	}

	if (blocks.length === 0) return "";
	const combined = blocks.join("\n\n");
	const packed = await packContextWithFallback(combined);
	if (packed) {
		return `[Nervous system context for ${toolName} | packed via ${packed.runtime} | savings=${packed.savings}% | original=${packed.originalLength}]\n${packed.packedText}`;
	}
	return `[Nervous system context for ${toolName}]\n${combined}`;
}

export function createMcpBuddhiRecorder(
	projectPath: string,
	sessionIdResolver: () => string | undefined,
): ((event: string, data: unknown) => void) | undefined {
	return wireBuddhiRecorder(
		createDaemonBuddhiProxy(),
		undefined,
		projectPath,
		sessionIdResolver,
	);
}

export async function updateMcpTriguna(info: McpToolCallInfo): Promise<void> {
	try {
		const { getTriguna } = await import("./mcp-subsystems.js");
		const triguna = await getTriguna();
		const elapsed = Number.isFinite(info.elapsedMs) ? Math.max(0, info.elapsedMs) : 0;
		const isError = info.result.isError === true;
		const argSize = JSON.stringify(info.args).length;
		triguna.update({
			errorRate: isError ? 1 : 0,
			tokenVelocity: Math.min(1, argSize / 4000),
			loopCount: Math.min(1, 0.25 + (elapsed / 10_000)),
			latency: Math.min(1, elapsed / 15_000),
			successRate: isError ? 0 : 1,
			userSatisfaction: isError ? 0.2 : 0.8,
		});
	} catch {
		/* best-effort */
	}
}

export function wrapMcpToolWithNervousSystem(
	handler: McpToolHandler,
	options: McpToolGuidanceOptions,
): McpToolHandler {
	return {
		...handler,
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const preamble = await buildGuidancePreamble(
				handler.definition.name,
				args,
				options.projectPath,
			);
			const prepared = injectGuidanceIntoArgs(args, preamble);
			const result = await handler.execute(prepared.args);
			if (prepared.injected) {
				return prependGuidance(
					result,
					`[Nervous system context applied pre-execution for ${handler.definition.name}]`,
				);
			}
			return prependGuidance(result, preamble);
		},
	};
}

export function wrapMcpToolsWithNervousSystem(
	handlers: McpToolHandler[],
	options: McpToolGuidanceOptions,
): McpToolHandler[] {
	return handlers.map((handler) => wrapMcpToolWithNervousSystem(handler, options));
}
