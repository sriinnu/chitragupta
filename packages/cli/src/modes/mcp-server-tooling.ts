import type { McpToolHandler, ChitraguptaToolHandler } from "@chitragupta/tantra";
import type { ToolHandler } from "@chitragupta/core";
import { chitraguptaToolToMcp } from "@chitragupta/tantra";
import fs from "fs";
import path from "path";
import { getBuiltinTools } from "../bootstrap.js";
import {
	createMemorySearchTool,
	createSessionListTool,
	createSessionShowTool,
	createMargaDecideTool,
	createAgentPromptTool,
	createPromptStatusTool,
} from "./mcp-tools-core.js";
import {
	createSamitiChannelsTool,
	createSamitiBroadcastTool,
	createSabhaDeliberateTool,
	createAkashaTracesTool,
	createAkashaDepositTool,
} from "./mcp-tools-collective.js";
import {
	createVasanaTendenciesTool,
	createHealthStatusTool,
	createAtmanReportTool,
} from "./mcp-tools-introspection.js";
import { createCodingAgentTool } from "./mcp-tools-coding.js";
import {
	createHandoverTool,
	createDayShowTool,
	createDayListTool,
	createDaySearchTool,
	createContextTool,
} from "./mcp-tools-memory.js";
import { createHandoverSinceTool, createMemoryChangesSinceTool } from "./mcp-tools-delta.js";
import {
	createSyncStatusTool,
	createSyncExportTool,
	createSyncImportTool,
	createRecallTool,
	createVidhisTool,
	createConsolidateTool,
} from "./mcp-tools-sync.js";
import {
	createMeshStatusTool,
	createMeshSpawnTool,
	createMeshSendTool,
	createMeshAskTool,
	createMeshFindCapabilityTool,
	createMeshPeersTool,
	createMeshGossipTool,
	createMeshTopologyTool,
} from "./mcp-tools-mesh.js";
import {
	createSkillsFindTool,
	createSkillsListTool,
	createSkillsHealthTool,
	createSkillsLearnTool,
	createSkillsScanTool,
	createSkillsEcosystemTool,
	createSkillsRecommendTool,
} from "./mcp-tools-skills.js";
import { createCompletionTool } from "./mcp-tools-completion.js";
import { createRepoMapTool, createSemanticGraphQueryTool } from "./mcp-tools-netra.js";
import { createAstQueryTool } from "./mcp-tools-ast.js";
import { createEpisodicRecallTool, createEpisodicRecordTool } from "./mcp-tools-episodic.js";
import { createUIExtensionsTool, createWidgetDataTool } from "./mcp-tools-plugins.js";
import { CerebralExpansion, createCerebralExpansionTool } from "./cerebral-expansion.js";
import { McpSessionRecorder } from "./mcp-session.js";
import { createMcpBuddhiRecorder } from "./mcp-tool-guidance.js";

export function normalizeMcpProjectPath(input: string): string {
	const resolved = path.resolve(input);
	try {
		const real = fs.realpathSync.native(resolved);
		return path.normalize(real);
	} catch {
		return path.normalize(resolved);
	}
}

export const MCP_HANDLER_REF = Symbol("mcp-handler-ref");
export type ResolverTool = ToolHandler & { [MCP_HANDLER_REF]?: McpToolHandler };

function mcpResultToText(result: Awaited<ReturnType<McpToolHandler["execute"]>>): string {
	const chunks = result.content
		.map((part) => {
			if (part.type === "text") return part.text;
			if (part.type === "resource") return part.text ?? `[resource: ${part.uri}]`;
			if (part.type === "image") return `[image: ${part.mimeType}]`;
			return "";
		})
		.filter((text) => text.length > 0);
	return chunks.join("\n");
}

function wrapMcpToolForResolver(handler: McpToolHandler): ResolverTool {
	return {
		definition: handler.definition,
		[MCP_HANDLER_REF]: handler,
		async execute(args: Record<string, unknown>) {
			const result = await handler.execute(args);
			return {
				content: mcpResultToText(result),
				isError: result.isError,
				metadata: result._metadata,
			};
		},
	};
}

export function collectMcpTools(projectPath: string, enableAgent: boolean): {
	builtinTools: ToolHandler[];
	mcpTools: McpToolHandler[];
	cerebralExpansion: CerebralExpansion;
	recorder: McpSessionRecorder;
	buddhiRecorder: ReturnType<typeof createMcpBuddhiRecorder>;
} {
	const mcpTools: McpToolHandler[] = [];
	const builtinTools: ToolHandler[] = getBuiltinTools();
	const recorder = new McpSessionRecorder(projectPath);
	for (const tool of builtinTools) {
		mcpTools.push(chitraguptaToolToMcp(tool as unknown as ChitraguptaToolHandler));
	}

	mcpTools.push(createMemorySearchTool(projectPath));
	mcpTools.push(createSessionListTool(projectPath));
	mcpTools.push(createSessionShowTool(projectPath));
	mcpTools.push(createMargaDecideTool());
	if (enableAgent) {
		mcpTools.push(createAgentPromptTool());
		mcpTools.push(createPromptStatusTool());
	}

	mcpTools.push(createHandoverTool(projectPath));
	mcpTools.push(createHandoverSinceTool(projectPath));
	mcpTools.push(createMemoryChangesSinceTool(projectPath));
	mcpTools.push(createDayShowTool());
	mcpTools.push(createDayListTool());
	mcpTools.push(createDaySearchTool());
	mcpTools.push(createContextTool(projectPath));
	mcpTools.push(createCodingAgentTool(projectPath, {
		sessionIdResolver: () => recorder.activeSessionId ?? undefined,
		consumer: "mcp:coding_agent",
	}));

	mcpTools.push(createSamitiChannelsTool());
	mcpTools.push(createSamitiBroadcastTool());
	mcpTools.push(createSabhaDeliberateTool());
	mcpTools.push(createAkashaTracesTool());
	mcpTools.push(createAkashaDepositTool());

	mcpTools.push(createVasanaTendenciesTool(projectPath));
	mcpTools.push(createHealthStatusTool());
	mcpTools.push(createAtmanReportTool());

	mcpTools.push(createSyncStatusTool());
	mcpTools.push(createSyncExportTool(projectPath));
	mcpTools.push(createSyncImportTool());
	mcpTools.push(createRecallTool());
	mcpTools.push(createVidhisTool(projectPath));
	mcpTools.push(createConsolidateTool(projectPath));

	mcpTools.push(createMeshStatusTool());
	mcpTools.push(createMeshSpawnTool());
	mcpTools.push(createMeshSendTool());
	mcpTools.push(createMeshAskTool());
	mcpTools.push(createMeshFindCapabilityTool());
	mcpTools.push(createMeshPeersTool());
	mcpTools.push(createMeshGossipTool());
	mcpTools.push(createMeshTopologyTool());

	mcpTools.push(createSkillsFindTool());
	mcpTools.push(createSkillsListTool());
	mcpTools.push(createSkillsHealthTool());
	mcpTools.push(createSkillsLearnTool());
	mcpTools.push(createSkillsScanTool());
	mcpTools.push(createSkillsEcosystemTool());
	mcpTools.push(createSkillsRecommendTool());

	mcpTools.push(createCompletionTool());
	mcpTools.push(createUIExtensionsTool());
	mcpTools.push(createWidgetDataTool());
	mcpTools.push(createRepoMapTool(projectPath));
	mcpTools.push(createSemanticGraphQueryTool(projectPath));
	mcpTools.push(createAstQueryTool(projectPath));
	mcpTools.push(createEpisodicRecallTool(projectPath));
	mcpTools.push(createEpisodicRecordTool(projectPath));

	const cerebralExpansion = new CerebralExpansion();
	mcpTools.push(createCerebralExpansionTool(
		cerebralExpansion,
		() => import("./mcp-subsystems.js").then((m) => m.getAkasha()),
		() => import("./mcp-subsystems.js").then((m) => m.getSkillRegistry()),
	));

	mcpTools.push(recorder.createRecordConversationTool());
	const buddhiRecorder = createMcpBuddhiRecorder(
		projectPath,
		() => recorder.activeSessionId ?? undefined,
	);

	return { builtinTools, mcpTools, cerebralExpansion, recorder, buddhiRecorder };
}

export function buildResolverTools(
	builtinTools: ToolHandler[],
	finalTools: McpToolHandler[],
): ResolverTool[] {
	const resolverTools: ResolverTool[] = [...(builtinTools as ResolverTool[])];
	const resolverNames = new Set(resolverTools.map((tool) => tool.definition.name));
	for (const handler of finalTools) {
		const name = handler.definition.name;
		if (resolverNames.has(name)) continue;
		resolverNames.add(name);
		resolverTools.push(wrapMcpToolForResolver(handler));
	}
	return resolverTools;
}
