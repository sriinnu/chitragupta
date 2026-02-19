/**
 * Test: MCP double extraction fix
 *
 * Verifies that fact extraction from user content happens only once per tool call
 * in the recordToolCall path (McpSessionRecorder), NOT duplicated in autoExtractEvents().
 *
 * Source-code analysis reads mcp-session.ts where McpSessionRecorder lives.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";

describe("MCP double extraction fix", () => {
	it("autoExtractEvents does not contain duplicate fact extraction", () => {
		const source = fs.readFileSync(
			new URL("../src/modes/mcp-session.ts", import.meta.url),
			"utf-8",
		);

		// Find the autoExtractEvents method body (class method)
		const fnStart = source.indexOf("private async autoExtractEvents(");
		expect(fnStart).toBeGreaterThan(-1);

		// Get the method body (until the next method: createRecordConversationTool)
		const fnEnd = source.indexOf("\tcreateRecordConversationTool(", fnStart);
		const fnBody = source.slice(fnStart, fnEnd > -1 ? fnEnd : undefined);

		// Should NOT contain getFactExtractor call (that's the duplication)
		expect(fnBody).not.toContain("getFactExtractor");
		expect(fnBody).not.toContain("extractAndSave");
	});

	it("recordToolCall contains exactly one extractAndSave call", () => {
		const source = fs.readFileSync(
			new URL("../src/modes/mcp-session.ts", import.meta.url),
			"utf-8",
		);

		// Find the recordToolCall method (class method)
		const fnStart = source.indexOf("async recordToolCall(");
		expect(fnStart).toBeGreaterThan(-1);
		const fnEnd = source.indexOf("private async autoExtractEvents(", fnStart);
		const fnBody = source.slice(fnStart, fnEnd);

		// Should contain exactly one extractAndSave call
		const matches = fnBody.match(/extractAndSave/g);
		expect(matches).toBeTruthy();
		expect(matches!.length).toBe(1);
	});
});
