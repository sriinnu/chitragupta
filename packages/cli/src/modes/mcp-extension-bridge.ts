/**
 * @chitragupta/cli — MCP Extension Bridge.
 *
 * Wires the ExtensionLoader (tantra) into the MCP server lifecycle.
 * Creates the loader, discovers extensions, registers tools into the
 * ToolRegistry, and dispatches lifecycle hooks via HookRegistry.
 *
 * Extracted from mcp-server.ts to stay under the 450 LOC limit.
 *
 * @module
 */

import type { McpToolHandler, ToolRegistry, ToolCallContext } from "@chitragupta/tantra";
import { ExtensionLoader, HookRegistry } from "@chitragupta/tantra";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Options for wiring extensions into the MCP server. */
export interface ExtensionBridgeOptions {
	/** Project path for project-local extension discovery. */
	projectPath: string;
	/** ToolRegistry to register extension-contributed tools into. */
	toolRegistry: ToolRegistry;
	/** Enable hot-reload of extensions via file watchers. Default: true */
	hotReload?: boolean;
	/** Callback invoked when a tool call is intercepted by an extension hook. */
	onToolCall?: (info: { tool: string; args: Record<string, unknown> }) => void;
}

/** Result of wiring extensions — exposes loader and hooks for server use. */
export interface ExtensionBridge {
	/** The underlying extension loader (for dispose, status, etc.). */
	loader: ExtensionLoader;
	/** Hook registry for dispatching lifecycle events to extensions. */
	hookRegistry: HookRegistry;
	/** Tools discovered from static extension manifests (pre-activate). */
	staticTools: McpToolHandler[];
	/** Count of extensions loaded. */
	loadedCount: number;
	/** Errors encountered during loading. */
	errors: string[];
}

// ─── Main Wiring Function ──────────────────────────────────────────────────

/**
 * Wire the extension system into the MCP server.
 *
 * 1. Creates an ExtensionLoader scoped to the project
 * 2. Attaches the ToolRegistry so runtime tools flow into the server
 * 3. Loads all extensions (global + project-local)
 * 4. Registers static extension tools into the ToolRegistry
 * 5. Wires onToolCall hook dispatch
 * 6. Enables hot-reload if configured
 *
 * @param options - Bridge configuration
 * @returns The extension bridge with loader, hooks, and discovered tools
 */
export async function wireExtensionsToMcp(
	options: ExtensionBridgeOptions,
): Promise<ExtensionBridge> {
	const {
		projectPath,
		toolRegistry,
		hotReload = true,
		onToolCall,
	} = options;

	const projectExtDir = `${projectPath}/.chitragupta/extensions`;
	const hookRegistry = new HookRegistry();

	const loader = new ExtensionLoader(
		{
			projectDir: projectExtDir,
			hotReload,
		},
		hookRegistry,
	);

	// Attach ToolRegistry so activate()-time tools flow into the server
	loader.setToolRegistry(toolRegistry);

	// Discover and load all extensions
	const { loaded, errors } = await loader.loadAll();

	// Register static tools (from manifest.tools[]) into the ToolRegistry
	const staticTools = loader.getRegisteredTools();
	for (const tool of staticTools) {
		try {
			toolRegistry.registerTool(tool);
		} catch {
			// Collision with existing tool — skip silently (already registered via activate)
		}
	}

	// Wire onToolCall dispatch so extensions can observe tool invocations
	if (onToolCall) {
		hookRegistry.registerHooks("__mcp_bridge__", {
			onToolCall: (ctx: ToolCallContext) => {
				onToolCall({ tool: ctx.toolName, args: ctx.args });
			},
		});
	}

	if (loaded > 0 || errors.length > 0) {
		process.stderr.write(
			`[extensions] Loaded: ${loaded}, tools: ${staticTools.length}, errors: ${errors.length}\n`,
		);
	}

	return {
		loader,
		hookRegistry,
		staticTools,
		loadedCount: loaded,
		errors,
	};
}
