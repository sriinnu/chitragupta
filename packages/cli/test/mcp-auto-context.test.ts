/**
 * Test: MCP auto-context injection
 *
 * Verifies that the McpSessionRecorder auto-injects provider context on the
 * first tool call (session creation), and doesn't double-inject on subsequent calls.
 *
 * Source-code analysis reads mcp-session.ts where McpSessionRecorder lives.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";

/** Read the McpSessionRecorder source and extract the ensureSession method body. */
function getEnsureSessionBody(): string {
	const source = fs.readFileSync(
		new URL("../src/modes/mcp-session.ts", import.meta.url),
		"utf-8",
	);
	const fnStart = source.indexOf("async ensureSession()");
	expect(fnStart).toBeGreaterThan(-1);
	// Method ends at the next top-level method (extractUserText)
	const fnEnd = source.indexOf("\textractUserText(", fnStart);
	return source.slice(fnStart, fnEnd);
}

describe("MCP auto-context injection", () => {
	it("ensureSession calls loadProviderContext on first session creation", () => {
		const fnBody = getEnsureSessionBody();

		// Should contain loadProviderContext call
		expect(fnBody).toContain("loadProviderContext");
		expect(fnBody).toContain("@chitragupta/smriti/provider-bridge");
	});

	it("has contextInjected guard to prevent double-injection", () => {
		const source = fs.readFileSync(
			new URL("../src/modes/mcp-session.ts", import.meta.url),
			"utf-8",
		);

		// contextInjected property should be declared in the class
		expect(source).toContain("contextInjected = false");

		// The guard should be in ensureSession
		const fnBody = getEnsureSessionBody();
		expect(fnBody).toContain("!this.contextInjected");
		expect(fnBody).toContain("this.contextInjected = true");
	});

	it("adds context as a system turn via addTurn", () => {
		const fnBody = getEnsureSessionBody();

		// Should add a turn with [system:context] prefix
		expect(fnBody).toContain("[system:context]");
		expect(fnBody).toContain("addTurn");
	});

	it("context injection is best-effort (wrapped in try/catch)", () => {
		const fnBody = getEnsureSessionBody();

		// The loadProviderContext block should be in a try/catch
		const contextStart = fnBody.indexOf("loadProviderContext");
		const beforeContext = fnBody.slice(0, contextStart);
		expect(beforeContext).toContain("try");
	});

	it("marks contextInjected only after context load path", () => {
		const fnBody = getEnsureSessionBody();

		const loadIdx = fnBody.indexOf("loadProviderContext");
		const markIdx = fnBody.indexOf("this.contextInjected = true");

		expect(loadIdx).toBeGreaterThan(-1);
		expect(markIdx).toBeGreaterThan(loadIdx);
	});
});
