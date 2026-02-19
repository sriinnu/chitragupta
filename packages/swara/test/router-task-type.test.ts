import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
	classifyTaskType,
	RESOLUTION_MAP,
	LOCAL_BINDINGS,
	CLOUD_BINDINGS,
	HYBRID_BINDINGS,
} from "@chitragupta/swara";
import type { Context, TaskType } from "@chitragupta/swara";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ctx(text: string, opts?: { tools?: Array<{ name: string }>; images?: boolean }): Context {
	const content: Array<{ type: "text"; text: string } | { type: "image"; source: { type: "base64"; mediaType: string; data: string } }> = [
		{ type: "text", text },
	];
	if (opts?.images) {
		content.push({
			type: "image",
			source: { type: "base64", mediaType: "image/png", data: "abc123" },
		});
	}
	return {
		messages: [{ role: "user" as const, content }],
		tools: opts?.tools as Context["tools"],
	};
}

function loadFixture(name: string): string[] {
	const file = new URL(`./fixtures/${name}`, import.meta.url);
	return JSON.parse(readFileSync(file, "utf8")) as string[];
}

// ─── All 15 task types ───────────────────────────────────────────────────────

const ALL_TASK_TYPES: TaskType[] = [
	"chat", "code-gen", "reasoning", "search", "embedding", "vision",
	"tool-exec", "heartbeat", "smalltalk", "summarize", "translate", "memory",
	"file-op", "api-call", "compaction",
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("classifyTaskType (Pravritti)", () => {
	describe("heartbeat", () => {
		it("should classify 'ping' as heartbeat with local-compute resolution", () => {
			const result = classifyTaskType(ctx("ping"));
			expect(result.type).toBe("heartbeat");
			expect(result.resolution).toBe("local-compute");
		});
	});

	describe("smalltalk", () => {
		it("should classify check-ins as smalltalk with local-compute resolution", () => {
			const result = classifyTaskType(ctx("how are you doing today"));
			expect(result.type).toBe("smalltalk");
			expect(result.resolution).toBe("local-compute");
			expect(result.checkinSubtype).toBe("checkin");
		});

		it("should classify acknowledgements with ack subtype", () => {
			const result = classifyTaskType(ctx("thanks, got it"));
			expect(result.type).toBe("smalltalk");
			expect(result.checkinSubtype).toBe("ack");
		});
	});

	describe("embedding", () => {
		it("should classify 'embed this text' as embedding", () => {
			const result = classifyTaskType(ctx("embed this text"));
			expect(result.type).toBe("embedding");
			expect(result.resolution).toBe("embedding");
		});
	});

	describe("search", () => {
		it("should classify 'search for files containing X' as search with local-compute", () => {
			const result = classifyTaskType(ctx("search for files containing errors"));
			expect(result.type).toBe("search");
			expect(result.resolution).toBe("local-compute");
		});
	});

	describe("code-gen", () => {
		it("should classify 'implement a parser function' as code-gen with llm-with-tools", () => {
			const result = classifyTaskType(ctx("implement a parser function"));
			expect(result.type).toBe("code-gen");
			expect(result.resolution).toBe("llm-with-tools");
		});
	});

	describe("reasoning", () => {
		it("should classify 'analyze trade-offs between A and B' as reasoning with llm", () => {
			const result = classifyTaskType(ctx("analyze trade-offs between A and B"));
			expect(result.type).toBe("reasoning");
			expect(result.resolution).toBe("llm");
		});
	});

	describe("summarize", () => {
		it("should classify 'summarize this document' as summarize with llm", () => {
			const result = classifyTaskType(ctx("summarize this document"));
			expect(result.type).toBe("summarize");
			expect(result.resolution).toBe("llm");
		});
	});

	describe("translate", () => {
		it("should classify 'translate to Spanish' as translate with llm", () => {
			const result = classifyTaskType(ctx("translate to Spanish"));
			expect(result.type).toBe("translate");
			expect(result.resolution).toBe("llm");
		});
	});

	describe("tool-exec", () => {
		it("should classify 'run npm test' as tool-exec when tools present", () => {
			const result = classifyTaskType(ctx("run npm test", { tools: [{ name: "bash" }] }));
			expect(result.type).toBe("tool-exec");
			expect(result.resolution).toBe("tool-only");
		});
	});

	describe("memory", () => {
		it("should classify 'what did I say last session' as memory with local-compute", () => {
			const result = classifyTaskType(ctx("what did I say last session"));
			expect(result.type).toBe("memory");
			expect(result.resolution).toBe("local-compute");
		});
	});

	describe("file-op", () => {
		it("should classify 'read file src/main.ts' as file-op with tool-only", () => {
			const result = classifyTaskType(ctx("read file src/main.ts"));
			expect(result.type).toBe("file-op");
			expect(result.resolution).toBe("tool-only");
		});
	});

	describe("api-call", () => {
		it("should classify 'check my inbox' as api-call with tool-only", () => {
			const result = classifyTaskType(ctx("check my inbox"));
			expect(result.type).toBe("api-call");
			expect(result.resolution).toBe("tool-only");
		});

		it("should classify 'get my emails' as api-call with tool-only", () => {
			const result = classifyTaskType(ctx("get my emails"));
			expect(result.type).toBe("api-call");
			expect(result.resolution).toBe("tool-only");
		});
	});

	describe("compaction", () => {
		it("should classify 'compact the context' as compaction with local-compute", () => {
			const result = classifyTaskType(ctx("compact the context"));
			expect(result.type).toBe("compaction");
			expect(result.resolution).toBe("local-compute");
		});
	});

	describe("vision", () => {
		it("should classify messages with image content as vision", () => {
			const result = classifyTaskType(ctx("what is in this picture", { images: true }));
			expect(result.type).toBe("vision");
		});
	});

	describe("chat fallback", () => {
		it("should classify general chat as chat when no stronger signal fires", () => {
			const result = classifyTaskType(ctx("Tell me something interesting about stars"));
			expect(result.type).toBe("chat");
			expect(result.resolution).toBe("llm");
		});
	});

	describe("RESOLUTION_MAP completeness", () => {
		it("should have entries for all 15 task types", () => {
			for (const taskType of ALL_TASK_TYPES) {
				expect(RESOLUTION_MAP).toHaveProperty(taskType);
			}
			expect(Object.keys(RESOLUTION_MAP)).toHaveLength(ALL_TASK_TYPES.length);
		});
	});

	describe("binding arrays", () => {
		it("LOCAL_BINDINGS should be a non-empty array", () => {
			expect(Array.isArray(LOCAL_BINDINGS)).toBe(true);
			expect(LOCAL_BINDINGS.length).toBeGreaterThan(0);
		});

		it("CLOUD_BINDINGS should be a non-empty array", () => {
			expect(Array.isArray(CLOUD_BINDINGS)).toBe(true);
			expect(CLOUD_BINDINGS.length).toBeGreaterThan(0);
		});

		it("HYBRID_BINDINGS should be a non-empty array", () => {
			expect(Array.isArray(HYBRID_BINDINGS)).toBe(true);
			expect(HYBRID_BINDINGS.length).toBeGreaterThan(0);
		});
	});

	describe("confidence", () => {
		it("should always return confidence between 0.5 and 1.0", () => {
			const inputs = [
				"ping",
				"embed this",
				"search for files",
				"implement a parser",
				"summarize the report",
				"just chatting",
			];
			for (const text of inputs) {
				const result = classifyTaskType(ctx(text));
				expect(result.confidence).toBeGreaterThanOrEqual(0.5);
				expect(result.confidence).toBeLessThanOrEqual(1.0);
			}
		});
	});

	describe("multilingual fixtures", () => {
		it("should classify multilingual short greetings as smalltalk", () => {
			const phrases = loadFixture("multilingual-smalltalk.json");
			for (const phrase of phrases) {
				const result = classifyTaskType(ctx(phrase));
				expect(result.type).toBe("smalltalk");
			}
		});

		it("should avoid false-smalltalk captures for mixed action corpus", () => {
			const phrases = loadFixture("smalltalk-plus-actions.json");
			for (const phrase of phrases) {
				const result = classifyTaskType(ctx(phrase, { tools: [{ name: "bash" }] }));
				expect(result.type).not.toBe("smalltalk");
			}
		});
	});

	describe("secondary type", () => {
		it("should detect secondary type for ambiguous messages like 'analyze and implement'", () => {
			const result = classifyTaskType(ctx("analyze the architecture and implement the solution"));
			// The primary should be one of reasoning or code-gen, the other should be secondary
			expect(result.type).toBeDefined();
			expect(result.secondary).toBeDefined();
			expect(result.secondary).not.toBe(result.type);
		});
	});
});
