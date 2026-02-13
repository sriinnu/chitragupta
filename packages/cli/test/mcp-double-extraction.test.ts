/**
 * Test: MCP double extraction fix
 *
 * Verifies that fact extraction from user content happens only once per tool call
 * in the recordToolCall path, NOT duplicated in autoExtractEvents().
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";

describe("MCP double extraction fix", () => {
	it("autoExtractEvents does not contain duplicate fact extraction", () => {
		// Read the mcp-server.ts source
		const source = fs.readFileSync(
			new URL("../src/modes/mcp-server.ts", import.meta.url),
			"utf-8",
		);

		// Find the autoExtractEvents function body
		const fnStart = source.indexOf("const autoExtractEvents = async (");
		expect(fnStart).toBeGreaterThan(-1);

		// Get the function body (until the next top-level const/function)
		const fnBody = source.slice(fnStart, source.indexOf("\n\t// ─── 3.", fnStart));

		// Should NOT contain getFactExtractor call (that's the duplication)
		expect(fnBody).not.toContain("getFactExtractor");
		expect(fnBody).not.toContain("extractAndSave");

		// The comment about handling in recordToolCall should be present
		expect(fnBody).toContain("Fact extraction from user content is already handled in recordToolCall");
	});

	it("recordToolCall contains exactly one extractAndSave call", () => {
		const source = fs.readFileSync(
			new URL("../src/modes/mcp-server.ts", import.meta.url),
			"utf-8",
		);

		// Find the recordToolCall function
		const fnStart = source.indexOf("const recordToolCall = async (");
		const fnEnd = source.indexOf("const autoExtractEvents", fnStart);
		const fnBody = source.slice(fnStart, fnEnd);

		// Should contain exactly one extractAndSave call
		const matches = fnBody.match(/extractAndSave/g);
		expect(matches).toBeTruthy();
		expect(matches!.length).toBe(1);
	});
});
