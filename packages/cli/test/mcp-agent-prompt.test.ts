/**
 * Tests for MCP Agent Prompt — module exports and type validation.
 *
 * Behavioral tests are in mcp-agent-prompt-fallback.test.ts (10 tests).
 * This file covers module-level exports and type contracts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

describe("mcp-agent-prompt", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it("should export runAgentPromptWithFallback", async () => {
		const mod = await import("../src/modes/mcp-agent-prompt.js");
		expect(mod.runAgentPromptWithFallback).toBeDefined();
		expect(typeof mod.runAgentPromptWithFallback).toBe("function");
	});

	it("should export SmartPromptDeps type (module loads cleanly)", async () => {
		const mod = await import("../src/modes/mcp-agent-prompt.js");
		expect(mod).toBeDefined();
		// SmartPromptDeps is a type — just verify the module loads
	});
});
