import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryBridge } from "../src/memory-bridge.js";
import type { MemoryBridgeConfig } from "../src/memory-bridge.js";

// ─── Mock @chitragupta/smriti ──────────────────────────────────────────────────

vi.mock("@chitragupta/smriti", () => ({
	createSession: vi.fn(() => ({
		meta: { id: "mock-session-id" },
		turns: [],
	})),
	loadSession: vi.fn(() => ({
		meta: { id: "sub-session-id" },
		turns: [
			{ role: "user", content: "do something" },
			{ role: "assistant", content: "I found the issue in src/main.ts" },
		],
	})),
	addTurn: vi.fn(),
	getMemory: vi.fn(() => null),
	appendMemory: vi.fn(),
	GraphRAGEngine: vi.fn().mockImplementation(function(this: any) {
		this.indexSession = vi.fn().mockResolvedValue(undefined);
	}),
	RecallEngine: vi.fn().mockImplementation(function(this: any) {
		this.indexSession = vi.fn().mockResolvedValue(undefined);
	}),
	HybridSearchEngine: vi.fn().mockImplementation(function(this: any) {
		this.search = vi.fn().mockResolvedValue([]);
		this.gatedSearch = vi.fn().mockResolvedValue([]);
	}),
	extractSignals: vi.fn().mockReturnValue({ identity: [], projects: [], tasks: [], flow: [] }),
	StreamManager: vi.fn().mockImplementation(function(this: any) {
		this.append = vi.fn();
		this.readContent = vi.fn().mockReturnValue("");
	}),
	configureRecallScoring: vi.fn(),
	EmbeddingService: vi.fn().mockImplementation(function(this: any) {
		this.getEmbedding = vi.fn().mockResolvedValue(new Array(384).fill(0));
		this.resetAvailability = vi.fn();
		this.clearCache = vi.fn();
	}),
	SmaranStore: vi.fn().mockImplementation(function(this: any) {
		this.remember = vi.fn().mockReturnValue({ id: "mem-1", content: "test", category: "fact", confidence: 1.0 });
		this.forget = vi.fn().mockReturnValue(true);
		this.forgetByContent = vi.fn().mockReturnValue(1);
		this.recall = vi.fn().mockReturnValue([]);
		this.listByCategory = vi.fn().mockReturnValue([]);
		this.listAll = vi.fn().mockReturnValue([]);
		this.buildContextSection = vi.fn().mockReturnValue("");
		this.decayConfidence = vi.fn();
		this.prune = vi.fn().mockReturnValue(0);
	}),
	detectMemoryIntent: vi.fn().mockReturnValue(null),
	IdentityContext: vi.fn().mockImplementation(function(this: any) {
		this.load = vi.fn().mockReturnValue("");
		this.loadUserPreferences = vi.fn().mockReturnValue("");
		this.hasIdentityFiles = vi.fn().mockReturnValue(false);
		this.getFoundPaths = vi.fn().mockReturnValue({});
		this.clearCache = vi.fn();
	}),
}));

import {
	createSession,
	loadSession,
	addTurn,
	getMemory,
	appendMemory,
} from "@chitragupta/smriti";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<MemoryBridgeConfig>): MemoryBridgeConfig {
	return {
		enabled: true,
		project: "/test/project",
		enableGraphRAG: false,
		enableHybridSearch: false,
		...overrides,
	};
}

describe("MemoryBridge", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ── initSession ─────────────────────────────────────────────────────

	describe("initSession", () => {
		it("returns session ID when enabled", async () => {
			const bridge = new MemoryBridge(makeConfig());
			const id = await bridge.initSession("agent-1", "chitragupta", "claude-3", "/project");
			expect(id).toBe("mock-session-id");
		});

		it("returns empty string when disabled", async () => {
			const bridge = new MemoryBridge(makeConfig({ enabled: false }));
			const id = await bridge.initSession("agent-1", "chitragupta", "claude-3", "/project");
			expect(id).toBe("");
		});

		it("calls createSession with correct params", async () => {
			const bridge = new MemoryBridge(makeConfig());
			await bridge.initSession("agent-1", "chitragupta", "claude-3", "/project");
			expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
				project: "/project",
				agent: "agent-1",
				model: "claude-3",
			}));
		});

		it("sets internal sessionId accessible via getSessionId", async () => {
			const bridge = new MemoryBridge(makeConfig());
			await bridge.initSession("agent-1", "chitragupta", "claude-3", "/project");
			expect(bridge.getSessionId()).toBe("mock-session-id");
		});

		it("resets turn counter on each init", async () => {
			const bridge = new MemoryBridge(makeConfig());
			await bridge.initSession("agent-1", "chitragupta", "claude-3", "/project");
			await bridge.recordUserTurn("mock-session-id", "hi");
			await bridge.initSession("agent-2", "chitragupta", "claude-3", "/project");
			await bridge.recordUserTurn("mock-session-id", "hello");
			const calls = (addTurn as ReturnType<typeof vi.fn>).mock.calls;
			expect(calls[calls.length - 1][2].turnNumber).toBe(1);
		});
	});

	// ── recordUserTurn ──────────────────────────────────────────────────

	describe("recordUserTurn", () => {
		it("calls addTurn with user role", async () => {
			const bridge = new MemoryBridge(makeConfig());
			await bridge.initSession("a", "p", "m", "/proj");
			await bridge.recordUserTurn("mock-session-id", "Hello");
			expect(addTurn).toHaveBeenCalledWith("mock-session-id", "/test/project", expect.objectContaining({
				role: "user",
				content: "Hello",
				turnNumber: 1,
			}));
		});

		it("does nothing when disabled", async () => {
			const bridge = new MemoryBridge(makeConfig({ enabled: false }));
			await bridge.recordUserTurn("sid", "Hello");
			expect(addTurn).not.toHaveBeenCalled();
		});

		it("does nothing with empty sessionId", async () => {
			const bridge = new MemoryBridge(makeConfig());
			await bridge.recordUserTurn("", "Hello");
			expect(addTurn).not.toHaveBeenCalled();
		});

		it("increments turn counter", async () => {
			const bridge = new MemoryBridge(makeConfig());
			await bridge.initSession("a", "p", "m", "/proj");
			await bridge.recordUserTurn("mock-session-id", "First");
			await bridge.recordUserTurn("mock-session-id", "Second");
			const calls = (addTurn as ReturnType<typeof vi.fn>).mock.calls;
			expect(calls[0][2].turnNumber).toBe(1);
			expect(calls[1][2].turnNumber).toBe(2);
		});
	});

	// ── recordAssistantTurn ─────────────────────────────────────────────

	describe("recordAssistantTurn", () => {
		it("calls addTurn with assistant role", async () => {
			const bridge = new MemoryBridge(makeConfig());
			await bridge.initSession("a", "p", "m", "/proj");
			await bridge.recordAssistantTurn("mock-session-id", "I can help.");
			expect(addTurn).toHaveBeenCalledWith("mock-session-id", "/test/project", expect.objectContaining({
				role: "assistant",
				content: "I can help.",
			}));
		});

		it("does nothing when disabled", async () => {
			const bridge = new MemoryBridge(makeConfig({ enabled: false }));
			await bridge.recordAssistantTurn("sid", "Response");
			expect(addTurn).not.toHaveBeenCalled();
		});

		it("passes tool calls when provided", async () => {
			const bridge = new MemoryBridge(makeConfig());
			await bridge.initSession("a", "p", "m", "/proj");
			const toolCalls = [{ name: "read_file", input: '{"path":"/a"}', result: "content", isError: false }];
			await bridge.recordAssistantTurn("mock-session-id", "Done.", toolCalls);
			const call = (addTurn as ReturnType<typeof vi.fn>).mock.calls[0];
			expect(call[2].toolCalls).toHaveLength(1);
			expect(call[2].toolCalls[0].name).toBe("read_file");
		});

		it("handles tool calls with isError", async () => {
			const bridge = new MemoryBridge(makeConfig());
			await bridge.initSession("a", "p", "m", "/proj");
			const toolCalls = [{ name: "bash", input: '{"cmd":"rm"}', result: "permission denied", isError: true }];
			await bridge.recordAssistantTurn("mock-session-id", "Failed.", toolCalls);
			const call = (addTurn as ReturnType<typeof vi.fn>).mock.calls[0];
			expect(call[2].toolCalls[0].isError).toBe(true);
		});

		it("works without tool calls", async () => {
			const bridge = new MemoryBridge(makeConfig());
			await bridge.initSession("a", "p", "m", "/proj");
			await bridge.recordAssistantTurn("mock-session-id", "Just text.");
			const call = (addTurn as ReturnType<typeof vi.fn>).mock.calls[0];
			expect(call[2].toolCalls).toBeUndefined();
		});
	});

	// ── search ──────────────────────────────────────────────────────────

	describe("search", () => {
		it("returns empty array when no hybrid search engine", async () => {
			const bridge = new MemoryBridge(makeConfig());
			const results = await bridge.search("query");
			expect(results).toEqual([]);
		});

		it("delegates to hybridSearch when enabled", async () => {
			const bridge = new MemoryBridge(makeConfig({ enableGraphRAG: true, enableHybridSearch: true }));
			const results = await bridge.search("query");
			expect(results).toEqual([]);
		});
	});

	// ── gatedSearch ─────────────────────────────────────────────────────

	describe("gatedSearch", () => {
		it("returns empty array when no hybrid search engine", async () => {
			const bridge = new MemoryBridge(makeConfig());
			const results = await bridge.gatedSearch("query");
			expect(results).toEqual([]);
		});

		it("delegates to hybridSearch.gatedSearch when enabled", async () => {
			const bridge = new MemoryBridge(makeConfig({ enableGraphRAG: true, enableHybridSearch: true }));
			const results = await bridge.gatedSearch("query");
			expect(results).toEqual([]);
		});
	});

	// ── loadMemoryContext ────────────────────────────────────────────────

	describe("loadMemoryContext", () => {
		it("returns empty string when disabled", async () => {
			const bridge = new MemoryBridge(makeConfig({ enabled: false }));
			const ctx = await bridge.loadMemoryContext("/proj", "agent-1");
			expect(ctx).toBe("");
		});

		it("returns only memory capabilities when all memory scopes are null", async () => {
			const bridge = new MemoryBridge(makeConfig());
			const ctx = await bridge.loadMemoryContext("/proj", "agent-1");
			// With Smaran enabled (default), Memory Capabilities instructions are always appended
			expect(ctx).toContain("## Memory Capabilities");
		});

		it("returns empty string when disabled and all memory scopes null", async () => {
			const bridge = new MemoryBridge(makeConfig({ enableSmaran: false }));
			const ctx = await bridge.loadMemoryContext("/proj", "agent-1");
			expect(ctx).toBe("");
		});

		it("includes global memory when available", async () => {
			(getMemory as ReturnType<typeof vi.fn>).mockImplementation((scope: { type: string }) => {
				if (scope.type === "global") return "I prefer tabs.";
				return null;
			});
			const bridge = new MemoryBridge(makeConfig());
			const ctx = await bridge.loadMemoryContext("/proj", "agent-1");
			expect(ctx).toContain("### Global Knowledge");
			expect(ctx).toContain("I prefer tabs.");
		});

		it("includes project memory when available", async () => {
			(getMemory as ReturnType<typeof vi.fn>).mockImplementation((scope: { type: string }) => {
				if (scope.type === "project") return "Architecture: microservices";
				return null;
			});
			const bridge = new MemoryBridge(makeConfig());
			const ctx = await bridge.loadMemoryContext("/proj", "agent-1");
			expect(ctx).toContain("### Project Knowledge");
			expect(ctx).toContain("Architecture: microservices");
		});

		it("includes agent memory when available", async () => {
			(getMemory as ReturnType<typeof vi.fn>).mockImplementation((scope: { type: string }) => {
				if (scope.type === "agent") return "Previous findings: X";
				return null;
			});
			const bridge = new MemoryBridge(makeConfig());
			const ctx = await bridge.loadMemoryContext("/proj", "agent-1");
			expect(ctx).toContain("### Agent Notes");
			expect(ctx).toContain("Previous findings: X");
		});

		it("includes 4-stream memory sections when streamManager has content", async () => {
			// Need a bridge with streamManager that returns content.
			// The mock StreamManager.readContent always returns "", so by default no stream sections.
			const bridge = new MemoryBridge(makeConfig());
			// Make at least one getMemory return something so we don't get empty.
			(getMemory as ReturnType<typeof vi.fn>).mockReturnValue("something");
			const ctx = await bridge.loadMemoryContext("/proj", "agent-1");
			expect(ctx).toContain("## Memory Context");
		});
	});

	// ── createSubSession ────────────────────────────────────────────────

	describe("createSubSession", () => {
		it("returns sub-session ID", async () => {
			const bridge = new MemoryBridge(makeConfig());
			const id = await bridge.createSubSession("parent-1", "code review", "sub-1", "claude-3", "/proj");
			expect(id).toBe("mock-session-id");
		});

		it("returns empty string when disabled", async () => {
			const bridge = new MemoryBridge(makeConfig({ enabled: false }));
			const id = await bridge.createSubSession("parent-1", "review", "sub-1", "claude-3", "/proj");
			expect(id).toBe("");
		});

		it("passes parentSessionId to createSession", async () => {
			const bridge = new MemoryBridge(makeConfig());
			await bridge.createSubSession("parent-1", "review", "sub-1", "claude-3", "/proj");
			expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
				parentSessionId: "parent-1",
			}));
		});
	});

	// ── bubbleUpFindings ────────────────────────────────────────────────

	describe("bubbleUpFindings", () => {
		it("does nothing when disabled", async () => {
			const bridge = new MemoryBridge(makeConfig({ enabled: false }));
			await bridge.bubbleUpFindings("sub-1", "parent-1", "/proj");
			expect(loadSession).not.toHaveBeenCalled();
		});

		it("does nothing with empty subSessionId", async () => {
			const bridge = new MemoryBridge(makeConfig());
			await bridge.bubbleUpFindings("", "parent-1", "/proj");
			expect(loadSession).not.toHaveBeenCalled();
		});

		it("loads sub-session and appends findings to project memory", async () => {
			const bridge = new MemoryBridge(makeConfig());
			await bridge.bubbleUpFindings("sub-1", "parent-1", "/proj");
			expect(loadSession).toHaveBeenCalledWith("sub-1", "/proj");
			expect(appendMemory).toHaveBeenCalledWith(
				{ type: "project", path: "/proj" },
				expect.stringContaining("Sub-agent finding"),
			);
		});

		it("includes last assistant content in findings", async () => {
			const bridge = new MemoryBridge(makeConfig());
			await bridge.bubbleUpFindings("sub-1", "parent-1", "/proj");
			expect(appendMemory).toHaveBeenCalledWith(
				expect.anything(),
				expect.stringContaining("I found the issue in src/main.ts"),
			);
		});
	});

	// ── getSessionId ────────────────────────────────────────────────────

	describe("getSessionId", () => {
		it("returns null before init", () => {
			const bridge = new MemoryBridge(makeConfig());
			expect(bridge.getSessionId()).toBeNull();
		});

		it("returns session ID after init", async () => {
			const bridge = new MemoryBridge(makeConfig());
			await bridge.initSession("a", "p", "m", "/proj");
			expect(bridge.getSessionId()).toBe("mock-session-id");
		});
	});
});
