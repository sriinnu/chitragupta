/**
 * @chitragupta/tantra — MCP Server request handlers (extracted).
 *
 * Resource and prompt request handling extracted from server.ts
 * to keep the main server file under the 450 LOC limit.
 */

import type {
	JsonRpcResponse,
	McpResourceHandler,
	McpPromptHandler,
} from "./types.js";
import {
	createResponse,
	createErrorResponse,
	INVALID_PARAMS,
	INTERNAL_ERROR,
} from "./jsonrpc.js";

/**
 * Handle "resources/list" — return all resource definitions.
 *
 * @param id - JSON-RPC request id.
 * @param resources - Map of registered resource handlers.
 */
export function handleResourcesList(
	id: string | number,
	resources: Map<string, McpResourceHandler>,
): JsonRpcResponse {
	const list = Array.from(resources.values()).map((h) => h.definition);
	return createResponse(id, { resources: list });
}

/**
 * Handle "resources/read" — read a resource by URI.
 *
 * Tries exact URI match first, then falls back to template prefix matching.
 *
 * @param id - JSON-RPC request id.
 * @param params - Request params containing `uri`.
 * @param resources - Map of registered resource handlers.
 */
export async function handleResourcesRead(
	id: string | number,
	params: Record<string, unknown> | undefined,
	resources: Map<string, McpResourceHandler>,
): Promise<JsonRpcResponse> {
	if (!params || typeof params.uri !== "string") {
		return createErrorResponse(id, INVALID_PARAMS, "Missing required param: uri");
	}

	const uri = params.uri as string;

	// Try exact match first
	let handler = resources.get(uri);

	// If no exact match, try matching templates
	if (!handler) {
		for (const [, h] of resources) {
			if ("uriTemplate" in h.definition) {
				const template = h.definition.uriTemplate;
				const prefix = template.split("{")[0];
				if (prefix && uri.startsWith(prefix)) {
					handler = h;
					break;
				}
			}
		}
	}

	if (!handler) {
		return createErrorResponse(id, INVALID_PARAMS, `Unknown resource: ${uri}`);
	}

	try {
		const content = await handler.read(uri);
		return createResponse(id, { contents: content });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return createErrorResponse(id, INTERNAL_ERROR, message);
	}
}

/**
 * Handle "prompts/list" — return all prompt definitions.
 *
 * @param id - JSON-RPC request id.
 * @param prompts - Map of registered prompt handlers.
 */
export function handlePromptsList(
	id: string | number,
	prompts: Map<string, McpPromptHandler>,
): JsonRpcResponse {
	const list = Array.from(prompts.values()).map((h) => h.definition);
	return createResponse(id, { prompts: list });
}

/**
 * Handle "prompts/get" — get a prompt by name.
 *
 * @param id - JSON-RPC request id.
 * @param params - Request params containing `name` and optional `arguments`.
 * @param prompts - Map of registered prompt handlers.
 */
export async function handlePromptsGet(
	id: string | number,
	params: Record<string, unknown> | undefined,
	prompts: Map<string, McpPromptHandler>,
): Promise<JsonRpcResponse> {
	if (!params || typeof params.name !== "string") {
		return createErrorResponse(id, INVALID_PARAMS, "Missing required param: name");
	}

	const promptName = params.name as string;
	const handler = prompts.get(promptName);

	if (!handler) {
		return createErrorResponse(id, INVALID_PARAMS, `Unknown prompt: ${promptName}`);
	}

	const args = (params.arguments as Record<string, string>) ?? {};

	try {
		const contentItems = await handler.get(args);
		// MCP spec: each message.content is a single object, not an array.
		const messages = contentItems.map((item) => ({
			role: "user" as const,
			content: item,
		}));
		return createResponse(id, {
			description: handler.definition.description,
			messages,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return createErrorResponse(id, INTERNAL_ERROR, message);
	}
}
