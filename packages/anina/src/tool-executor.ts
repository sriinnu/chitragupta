/**
 * ToolExecutor — manages tool handler registration and execution.
 *
 * Each tool is identified by its definition name. The executor provides
 * a clean interface for the agent loop to call tools by name and collect
 * structured results.
 */

import { ToolError } from "@chitragupta/core";
import type { ToolDefinition, ToolHandler, ToolContext, ToolResult } from "./types.js";

export class ToolExecutor {
	private handlers: Map<string, ToolHandler> = new Map();

	/**
	 * Register a tool handler. Throws if a handler with the same name
	 * is already registered.
	 */
	register(handler: ToolHandler): void {
		const name = handler.definition.name;
		if (this.handlers.has(name)) {
			throw new ToolError(
			`Tool "${name}" is already registered. Call unregister("${name}") first to replace it.`,
			name,
		);
		}
		this.handlers.set(name, handler);
	}

	/**
	 * Unregister a tool handler by name. No-op if the tool is not registered.
	 */
	unregister(name: string): void {
		this.handlers.delete(name);
	}

	/**
	 * Check if a tool handler is registered by name.
	 */
	has(name: string): boolean {
		return this.handlers.has(name);
	}

	/**
	 * Execute a tool call by name with the given arguments and context.
	 * Returns a ToolResult. If the tool is not found or throws, an error
	 * result is returned rather than throwing (the LLM needs to see errors).
	 */
	async execute(
		name: string,
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		const handler = this.handlers.get(name);

		if (!handler) {
			return {
				content: `Tool "${name}" not found. Available tools: ${[...this.handlers.keys()].join(", ")}`,
				isError: true,
			};
		}

		try {
			return await handler.execute(args, context);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				content: `Tool "${name}" failed: ${message}`,
				isError: true,
			};
		}
	}

	/**
	 * Get all registered tool definitions, suitable for sending to the LLM
	 * as the available tool set.
	 */
	getDefinitions(): ToolDefinition[] {
		return [...this.handlers.values()].map((h) => h.definition);
	}

	/**
	 * Get the number of registered tools.
	 */
	get size(): number {
		return this.handlers.size;
	}
}
