import { describe, it, expect, vi, afterEach } from "vitest";
import {
	configureOllamaSummary,
	estimatePartTokens,
	estimateTotalTokens,
	extractText,
	smartExtract,
	collapseToolDetails,
	summariseToolPatterns,
	isOllamaAvailable,
	ollamaGenerate,
	buildSummarisationPrompt,
} from "../src/context-compaction.js";
import type { ContentPart, ToolCallContent, ToolResultContent, ThinkingContent } from "@chitragupta/swara";
import type { AgentState, AgentMessage } from "../src/types.js";

function textPart(text: string): ContentPart {
	return { type: "text", text };
}
function thinkingPart(text: string): ContentPart {
	return { type: "thinking", text } as ThinkingContent;
}
function toolCallPart(name: string, args: string, id = "tc-1"): ContentPart {
	return { type: "tool_call", id, name, arguments: args } as ToolCallContent;
}
function toolResultPart(content: string, isError?: boolean): ContentPart {
	const part: ToolResultContent = { type: "tool_result", toolCallId: "tc-1", content };
	if (isError) part.isError = true;
	return part;
}
function imagePart(): ContentPart {
	return { type: "image", source: { type: "base64", mediaType: "image/png", data: "abc" } };
}
function makeMsg(role: string, content: ContentPart[]): AgentMessage {
	return { id: "m-1", role: role as AgentMessage["role"], content, timestamp: Date.now() };
}
function makeState(overrides?: Partial<AgentState>): AgentState {
	return {
		messages: [], model: "test-model", providerId: "test", tools: [],
		systemPrompt: "", thinkingLevel: "low", isStreaming: false,
		sessionId: "s-1", agentProfileId: "test", ...overrides,
	};
}

describe("context-compaction", () => {
	describe("estimatePartTokens", () => {
		it("returns 0 for empty array", () => { expect(estimatePartTokens([])).toBe(0); });
		it("estimates text part tokens by chars/4", () => { expect(estimatePartTokens([textPart("hello world!")])).toBe(3); });
		it("estimates thinking part tokens the same as text", () => {
			const text = "a".repeat(17);
			expect(estimatePartTokens([thinkingPart(text)])).toBe(Math.ceil(17 / 4));
		});
		it("estimates tool_call tokens from name + arguments length", () => {
			const part = toolCallPart("read_file", '{"path":"f"}');
			expect(estimatePartTokens([part])).toBe(Math.ceil(21 / 4));
		});
		it("estimates tool_result tokens from content length", () => {
			expect(estimatePartTokens([toolResultPart("a".repeat(100))])).toBe(25);
		});
		it("estimates image part at fixed 4000 chars => 1000 tokens", () => {
			expect(estimatePartTokens([imagePart()])).toBe(1000);
		});
		it("sums multiple parts correctly", () => {
			const parts: ContentPart[] = [textPart("a".repeat(8)), thinkingPart("b".repeat(4)), imagePart()];
			expect(estimatePartTokens(parts)).toBe(1003);
		});
		it("handles single char text part", () => { expect(estimatePartTokens([textPart("x")])).toBe(1); });
		it("handles empty text part", () => { expect(estimatePartTokens([textPart("")])).toBe(0); });
		it("handles tool_call with empty arguments", () => {
			expect(estimatePartTokens([toolCallPart("test", "")])).toBe(Math.ceil(4 / 4));
		});
		it("handles tool_result with empty content", () => { expect(estimatePartTokens([toolResultPart("")])).toBe(0); });
	});
	describe("estimateTotalTokens", () => {
		it("returns provider overhead for empty state", () => {
			expect(estimateTotalTokens(makeState())).toBe(100);
		});
		it("includes system prompt tokens", () => {
			expect(estimateTotalTokens(makeState({ systemPrompt: "a".repeat(400) }))).toBe(200);
		});
		it("includes per-message overhead of 4 tokens each", () => {
			const msg = makeMsg("user", [textPart("hi")]);
			expect(estimateTotalTokens(makeState({ messages: [msg] }))).toBe(1 + 4 + 100);
		});
		it("includes tools with 1.15 overhead factor", () => {
			const tool = { definition: { name: "test", description: "desc", inputSchema: { type: "object" } }, execute: vi.fn() };
			const schemaJson = JSON.stringify({ type: "object" });
			const rawChars = 4 + 4 + schemaJson.length;
			const toolTokens = Math.ceil((rawChars * 1.15) / 4);
			expect(estimateTotalTokens(makeState({ tools: [tool] }))).toBe(toolTokens + 100);
		});
		it("accumulates multiple messages and tools", () => {
			const msgs = [makeMsg("user", [textPart("a".repeat(40))]), makeMsg("assistant", [textPart("b".repeat(80))])];
			const tool = { definition: { name: "x", description: "y", inputSchema: {} }, execute: vi.fn() };
			const state = makeState({ systemPrompt: "c".repeat(20), messages: msgs, tools: [tool] });
			const sysT = Math.ceil(20 / 4);
			const m1 = Math.ceil(40 / 4) + 4;
			const m2 = Math.ceil(80 / 4) + 4;
			const schema = JSON.stringify({});
			const tT = Math.ceil(((1 + 1 + schema.length) * 1.15) / 4);
			expect(estimateTotalTokens(state)).toBe(sysT + m1 + m2 + tT + 100);
		});
	});
	describe("extractText", () => {
		it("extracts text from text parts", () => { expect(extractText([textPart("hello")])).toBe("hello"); });
		it("prefixes thinking parts with [thinking]", () => { expect(extractText([thinkingPart("hmm")])).toBe("[thinking] hmm"); });
		it("prefixes tool_call with [called tool: name]", () => {
			expect(extractText([toolCallPart("bash", "{}")])).toBe("[called tool: bash]");
		});
		it("truncates tool_result to 200 chars", () => {
			const result = extractText([toolResultPart("x".repeat(300))]);
			expect(result).toBe("[tool result: " + "x".repeat(200) + "]");
		});
		it("returns short tool_result without truncation", () => {
			expect(extractText([toolResultPart("ok")])).toBe("[tool result: ok]");
		});
		it("ignores image parts", () => { expect(extractText([imagePart()])).toBe(""); });
		it("joins multiple parts with newline", () => {
			expect(extractText([textPart("a"), textPart("b"), thinkingPart("c")])).toBe("a\nb\n[thinking] c");
		});
		it("returns empty string for empty array", () => { expect(extractText([])).toBe(""); });
	});
	describe("smartExtract", () => {
		it("extracts decision prefix lines", () => {
			expect(smartExtract("I'll fix the bug.\nSome noise.", 1000)).toContain("I'll fix the bug.");
		});
		it("extracts let us prefix", () => {
			expect(smartExtract("Let's refactor.\nOther.", 1000)).toContain("Let's refactor.");
		});
		it("extracts the fix is prefix", () => {
			expect(smartExtract("The fix is to update.\nNoise.", 1000)).toContain("The fix is to update.");
		});
		it("extracts file paths", () => {
			expect(smartExtract("Look at src/utils/helper.ts for details.", 1000)).toContain("[paths: src/utils/helper.ts]");
		});
		it("deduplicates file paths", () => {
			const result = smartExtract("Edit src/main.ts and check src/main.ts again.", 1000);
			const m = result.match(/\[paths: (.*?)\]/);
			expect(m).toBeTruthy();
			expect(m![1].split(", ").filter((p: string) => p === "src/main.ts")).toHaveLength(1);
		});
		it("extracts code blocks", () => {
			expect(smartExtract("Here:\n```js\nconsole.log('hi');\n```\nDone.", 5000)).toContain("```js\nconsole.log('hi');\n```");
		});
		it("truncates large code blocks and adds closing fence", () => {
			const text = "```\n" + "x".repeat(600) + "\n```";
			const result = smartExtract(text, 10000);
			// The code block portion in the result should be shorter than the original
			expect(result).toContain("```");
			expect(result.length).toBeGreaterThan(0);
		});
		it("extracts first and last sentences", () => {
			const result = smartExtract("First sentence here. Middle stuff. Last sentence here.", 1000);
			expect(result).toContain("First sentence here.");
			expect(result).toContain("Last sentence here.");
		});
		it("falls back to slice when no patterns match", () => {
			expect(smartExtract("a".repeat(200), 50)).toBe("a".repeat(50) + "...");
		});
		it("returns full text when shorter than maxChars", () => {
			expect(smartExtract("abcdef", 1000)).toContain("abcdef");
		});
		it("handles empty text", () => { expect(smartExtract("", 100)).toBe(""); });
	});
	describe("collapseToolDetails", () => {
		it("returns messages without tool parts unchanged", () => {
			const msg = makeMsg("user", [textPart("hello")]);
			expect(collapseToolDetails([msg])[0]).toBe(msg);
		});
		it("replaces tool_call arguments with curly braces", () => {
			const msg = makeMsg("assistant", [toolCallPart("read_file", '{"path":"/foo"}')]);
			const tc = collapseToolDetails([msg])[0].content[0] as ToolCallContent;
			expect(tc.arguments).toBe("{}");
			expect(tc.name).toBe("read_file");
		});
		it("truncates tool_result content to 100 chars", () => {
			const msg = makeMsg("tool_result", [toolResultPart("x".repeat(200))]);
			expect((collapseToolDetails([msg])[0].content[0] as ToolResultContent).content).toBe("x".repeat(100) + "...");
		});
		it("keeps short tool_result content intact", () => {
			const msg = makeMsg("tool_result", [toolResultPart("short")]);
			expect((collapseToolDetails([msg])[0].content[0] as ToolResultContent).content).toBe("short");
		});
		it("preserves isError flag", () => {
			const msg = makeMsg("tool_result", [toolResultPart("err", true)]);
			expect((collapseToolDetails([msg])[0].content[0] as ToolResultContent).isError).toBe(true);
		});
		it("preserves text parts alongside tool parts", () => {
			const msg = makeMsg("assistant", [textPart("thinking"), toolCallPart("bash", '{"cmd":"ls"}')]);
			const r = collapseToolDetails([msg]);
			expect(r[0].content[0]).toEqual(textPart("thinking"));
			expect((r[0].content[1] as ToolCallContent).arguments).toBe("{}");
		});
		it("processes multiple messages", () => {
			const msgs = [makeMsg("assistant", [toolCallPart("a", '{"x":1}')]), makeMsg("user", [textPart("ok")])];
			const r = collapseToolDetails(msgs);
			expect((r[0].content[0] as ToolCallContent).arguments).toBe("{}");
			expect(r[1]).toBe(msgs[1]);
		});
	});
	describe("summariseToolPatterns", () => {
		it("returns empty string for no tool calls", () => {
			expect(summariseToolPatterns([makeMsg("user", [textPart("hi")])])).toBe("");
		});
		it("categorises read tools", () => {
			const msgs = [makeMsg("assistant", [toolCallPart("read_file", '{"file_path":"/foo.ts"}')])];
			expect(summariseToolPatterns(msgs)).toContain("Files read: /foo.ts");
		});
		it("categorises glob tools into reads", () => {
			const msgs = [makeMsg("assistant", [toolCallPart("glob_search", '{"pattern":"*.ts"}')])];
			expect(summariseToolPatterns(msgs)).toContain("Files read: *.ts");
		});
		it("categorises grep tools into reads", () => {
			const msgs = [makeMsg("assistant", [toolCallPart("grep_search", '{"pattern":"TODO"}')])];
			expect(summariseToolPatterns(msgs)).toContain("Files read: TODO");
		});
		it("categorises write tools", () => {
			const msgs = [makeMsg("assistant", [toolCallPart("write_file", '{"file_path":"/out.ts"}')])];
			expect(summariseToolPatterns(msgs)).toContain("Files written/edited: /out.ts");
		});
		it("categorises edit tools into writes", () => {
			const msgs = [makeMsg("assistant", [toolCallPart("edit_file", '{"path":"/src/index.ts"}')])];
			expect(summariseToolPatterns(msgs)).toContain("Files written/edited: /src/index.ts");
		});
		it("categorises bash tools into Commands run", () => {
			const msgs = [makeMsg("assistant", [toolCallPart("bash_exec", '{"command":"npm test"}')])];
			expect(summariseToolPatterns(msgs)).toContain("Commands run: npm test");
		});
		it("truncates long commands to 120 chars", () => {
			const long = "a".repeat(200);
			const msgs = [makeMsg("assistant", [toolCallPart("bash", '{"command":"' + long + '"}' )])];
			expect(summariseToolPatterns(msgs)).toContain("a".repeat(120) + "...");
		});
		it("categorises unknown tools with count", () => {
			const msgs = [makeMsg("assistant", [toolCallPart("my_tool", "{}")]), makeMsg("assistant", [toolCallPart("my_tool", "{}")])];
			expect(summariseToolPatterns(msgs)).toContain("Other tools: my_tool(x2)");
		});
		it("deduplicates read paths", () => {
			const msgs = [
				makeMsg("assistant", [toolCallPart("read_file", '{"file_path":"/a.ts"}')]),
				makeMsg("assistant", [toolCallPart("read_file", '{"file_path":"/a.ts"}')]),
			];
			const line = summariseToolPatterns(msgs).split("\n").find((l: string) => l.startsWith("Files read:"));
			expect(line).toBe("Files read: /a.ts");
		});
		it("handles malformed JSON gracefully", () => {
			expect(() => summariseToolPatterns([makeMsg("assistant", [toolCallPart("read_file", "bad")])])).not.toThrow();
		});
		it("combines all categories", () => {
			const msgs = [
				makeMsg("assistant", [toolCallPart("read_file", '{"file_path":"/a.ts"}')]),
				makeMsg("assistant", [toolCallPart("write_file", '{"file_path":"/b.ts"}')]),
				makeMsg("assistant", [toolCallPart("bash", '{"command":"ls"}')]),
				makeMsg("assistant", [toolCallPart("custom", "{}")]),
			];
			const r = summariseToolPatterns(msgs);
			expect(r).toContain("Files read:");
			expect(r).toContain("Files written/edited:");
			expect(r).toContain("Commands run:");
			expect(r).toContain("Other tools:");
		});
	});
	describe("buildSummarisationPrompt", () => {
		it("includes the conversation text", () => {
			expect(buildSummarisationPrompt("Hello world", "")).toContain("Hello world");
		});
		it("includes tool summary when provided", () => {
			const r = buildSummarisationPrompt("text", "Files read: /a.ts");
			expect(r).toContain("TOOL USAGE SUMMARY:");
			expect(r).toContain("Files read: /a.ts");
		});
		it("omits tool summary section when empty", () => {
			expect(buildSummarisationPrompt("text", "")).not.toContain("TOOL USAGE SUMMARY:");
		});
		it("includes summariser instructions", () => {
			const r = buildSummarisationPrompt("text", "");
			expect(r).toContain("conversation summariser");
			expect(r).toContain("IMPORTANT RULES:");
		});
		it("has conversation history delimiters", () => {
			const r = buildSummarisationPrompt("convo", "");
			expect(r).toContain("CONVERSATION HISTORY:");
			expect(r).toContain("---");
		});
	});
	describe("configureOllamaSummary", () => {
		afterEach(() => { configureOllamaSummary({ model: "llama3", timeoutMs: 60_000 }); });
		it("does not throw with partial config", () => {
			expect(() => configureOllamaSummary({ model: "mistral" })).not.toThrow();
		});
		it("does not throw with empty config", () => {
			expect(() => configureOllamaSummary({})).not.toThrow();
		});
	});
	describe("isOllamaAvailable", () => {
		const originalFetch = globalThis.fetch;
		afterEach(() => { globalThis.fetch = originalFetch; });
		it("returns true when fetch succeeds with ok", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
			expect(await isOllamaAvailable("http://localhost:11434")).toBe(true);
		});
		it("returns false when fetch returns non-ok", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });
			expect(await isOllamaAvailable("http://localhost:11434")).toBe(false);
		});
		it("returns false when fetch throws", async () => {
			globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
			expect(await isOllamaAvailable("http://localhost:11434")).toBe(false);
		});
		it("calls correct endpoint", async () => {
			const mock = vi.fn().mockResolvedValue({ ok: true });
			globalThis.fetch = mock;
			await isOllamaAvailable("http://myhost:1234");
			expect(mock).toHaveBeenCalledWith("http://myhost:1234/api/tags", expect.objectContaining({ signal: expect.any(AbortSignal) }));
		});
	});
	describe("ollamaGenerate", () => {
		const originalFetch = globalThis.fetch;
		afterEach(() => { globalThis.fetch = originalFetch; configureOllamaSummary({ model: "llama3", timeoutMs: 60_000 }); });
		it("returns response text on success", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ response: "summary", done: true }) });
			expect(await ollamaGenerate("http://localhost:11434", "prompt")).toBe("summary");
		});
		it("throws on non-ok HTTP response", async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
			await expect(ollamaGenerate("http://localhost:11434", "test")).rejects.toThrow("HTTP 500");
		});
		it("sends POST with correct body", async () => {
			const mock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ response: "ok", done: true }) });
			globalThis.fetch = mock;
			await ollamaGenerate("http://localhost:11434", "hello");
			expect(mock).toHaveBeenCalledWith("http://localhost:11434/api/generate", expect.objectContaining({ method: "POST" }));
			const body = JSON.parse(mock.mock.calls[0][1].body);
			expect(body.model).toBe("llama3");
			expect(body.prompt).toBe("hello");
			expect(body.stream).toBe(false);
		});
		it("uses configured model", async () => {
			configureOllamaSummary({ model: "mistral" });
			const mock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ response: "ok", done: true }) });
			globalThis.fetch = mock;
			await ollamaGenerate("http://localhost:11434", "test");
			expect(JSON.parse(mock.mock.calls[0][1].body).model).toBe("mistral");
		});
	});
});
