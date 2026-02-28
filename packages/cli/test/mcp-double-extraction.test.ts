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

		// Should NOT contain direct fact extraction (that's the duplication)
		expect(fnBody).not.toContain("getFactExtractor");
		expect(fnBody).not.toContain("extractAndSave");
		expect(fnBody).not.toContain("extractFacts");
	});

	it("recordToolCall contains exactly one extractFacts call via daemon bridge", () => {
		const source = fs.readFileSync(
			new URL("../src/modes/mcp-session.ts", import.meta.url),
			"utf-8",
		);

		// Find the recordToolCall method (class method)
		const fnStart = source.indexOf("async recordToolCall(");
		expect(fnStart).toBeGreaterThan(-1);
		const fnEnd = source.indexOf("private async autoExtractEvents(", fnStart);
		const fnBody = source.slice(fnStart, fnEnd);

		// Should route fact extraction through daemon bridge (single-writer)
		const matches = fnBody.match(/bridge\.extractFacts/g);
		expect(matches).toBeTruthy();
		expect(matches!.length).toBe(1);

		// Should NOT use direct smriti fact extraction
		expect(fnBody).not.toContain("getFactExtractor");
		expect(fnBody).not.toContain("extractAndSave");
	});
});
