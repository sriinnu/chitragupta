/**
 * Test: MCP auto-context injection
 *
 * Verifies that the MCP server auto-injects provider context on the first
 * tool call (session creation), and doesn't double-inject on subsequent calls.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";

describe("MCP auto-context injection", () => {
	it("ensureSession calls loadProviderContext on first session creation", () => {
		const source = fs.readFileSync(
			new URL("../src/modes/mcp-server.ts", import.meta.url),
			"utf-8",
		);

		// Find the ensureSession function
		const fnStart = source.indexOf("const ensureSession = async () => {");
		expect(fnStart).toBeGreaterThan(-1);

		const fnEnd = source.indexOf("};", fnStart + 100);
		const fnBody = source.slice(fnStart, fnEnd + 2);

		// Should contain loadProviderContext call
		expect(fnBody).toContain("loadProviderContext");
		expect(fnBody).toContain("@chitragupta/smriti/provider-bridge");
	});

	it("has contextInjected guard to prevent double-injection", () => {
		const source = fs.readFileSync(
			new URL("../src/modes/mcp-server.ts", import.meta.url),
			"utf-8",
		);

		// contextInjected variable should be declared
		expect(source).toContain("let contextInjected = false");

		// The guard should be in ensureSession
		const fnStart = source.indexOf("const ensureSession = async () => {");
		const fnEnd = source.indexOf("};", fnStart + 100);
		const fnBody = source.slice(fnStart, fnEnd + 2);

		expect(fnBody).toContain("if (!contextInjected");
		expect(fnBody).toContain("contextInjected = true");
	});

	it("adds context as a system turn via addTurn", () => {
		const source = fs.readFileSync(
			new URL("../src/modes/mcp-server.ts", import.meta.url),
			"utf-8",
		);

		const fnStart = source.indexOf("const ensureSession = async () => {");
		const fnEnd = source.indexOf("};", fnStart + 100);
		const fnBody = source.slice(fnStart, fnEnd + 2);

		// Should add a turn with [system:context] prefix
		expect(fnBody).toContain("[system:context]");
		expect(fnBody).toContain("addTurn");
	});

	it("context injection is best-effort (wrapped in try/catch)", () => {
		const source = fs.readFileSync(
			new URL("../src/modes/mcp-server.ts", import.meta.url),
			"utf-8",
		);

		const fnStart = source.indexOf("const ensureSession = async () => {");
		const fnEnd = source.indexOf("};", fnStart + 100);
		const fnBody = source.slice(fnStart, fnEnd + 2);

		// The loadProviderContext block should be in a try/catch
		const contextStart = fnBody.indexOf("loadProviderContext");
		const beforeContext = fnBody.slice(0, contextStart);
		expect(beforeContext).toContain("try");
	});
});
