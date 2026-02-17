import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	exportSessionToJson,
	exportSessionToMarkdown,
	importSessionFromJson,
	detectExportFormat,
} from "@chitragupta/smriti";
import type { Session, SessionMeta, SessionTurn, SessionToolCall } from "@chitragupta/smriti";
import type { ExportedSession } from "@chitragupta/smriti";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const baseMeta: SessionMeta = {
	id: "s-export-001",
	title: "Export Test Session",
	created: "2025-06-01T08:00:00.000Z",
	updated: "2025-06-01T09:30:00.000Z",
	model: "claude-sonnet-4-5-20250929",
	agent: "chitragupta",
	project: "/home/user/project",
	parent: null,
	branch: null,
	tags: ["testing", "export"],
	totalCost: 0.1234,
	totalTokens: 4200,
};

const userTurn: SessionTurn = {
	turnNumber: 1,
	role: "user",
	content: "Please read the config file.",
};

const assistantTurn: SessionTurn = {
	turnNumber: 2,
	role: "assistant",
	content: "Here is the config file content.",
	agent: "chitragupta",
	model: "claude-sonnet-4-5-20250929",
};

const assistantTurnWithTools: SessionTurn = {
	turnNumber: 3,
	role: "assistant",
	content: "Let me read that for you.",
	agent: "chitragupta",
	model: "claude-sonnet-4-5-20250929",
	toolCalls: [
		{
			name: "read_file",
			input: '{"path": "/etc/config.json"}',
			result: '{"debug": true}',
		},
		{
			name: "run_command",
			input: '{"command": "ls -la"}',
			result: "Permission denied",
			isError: true,
		},
	],
};

function makeSession(overrides?: Partial<Session>): Session {
	return {
		meta: { ...baseMeta },
		turns: [userTurn, assistantTurn],
		...overrides,
	};
}

// ─── exportSessionToJson ────────────────────────────────────────────────────

describe("exportSessionToJson", () => {
	it("produces valid JSON with version 1", () => {
		const session = makeSession();
		const exported = exportSessionToJson(session);

		expect(exported.version).toBe(1);
		expect(typeof exported.exportedAt).toBe("string");
		// exportedAt should be a valid ISO date
		expect(new Date(exported.exportedAt).toISOString()).toBe(exported.exportedAt);
	});

	it("includes correct metadata fields", () => {
		const session = makeSession();
		const exported = exportSessionToJson(session);

		expect(exported.session.id).toBe("s-export-001");
		expect(exported.session.title).toBe("Export Test Session");
		expect(exported.session.createdAt).toBe("2025-06-01T08:00:00.000Z");
		expect(exported.session.updatedAt).toBe("2025-06-01T09:30:00.000Z");
		expect(exported.session.model).toBe("claude-sonnet-4-5-20250929");
		expect(exported.session.agent).toBe("chitragupta");
		expect(exported.session.project).toBe("/home/user/project");
		expect(exported.session.parent).toBeNull();
		expect(exported.session.branch).toBeNull();
		expect(exported.session.tags).toEqual(["testing", "export"]);
	});

	it("serializes messages with correct roles and content", () => {
		const session = makeSession();
		const exported = exportSessionToJson(session);

		expect(exported.session.messages).toHaveLength(2);
		expect(exported.session.messages[0].role).toBe("user");
		expect(exported.session.messages[0].content).toBe("Please read the config file.");
		expect(exported.session.messages[0].turnNumber).toBe(1);
		expect(exported.session.messages[1].role).toBe("assistant");
		expect(exported.session.messages[1].content).toBe("Here is the config file content.");
		expect(exported.session.messages[1].turnNumber).toBe(2);
	});

	it("includes agent and model on assistant messages", () => {
		const session = makeSession();
		const exported = exportSessionToJson(session);

		// User turn has no agent/model
		expect(exported.session.messages[0].agent).toBeUndefined();
		expect(exported.session.messages[0].model).toBeUndefined();
		// Assistant turn carries them
		expect(exported.session.messages[1].agent).toBe("chitragupta");
		expect(exported.session.messages[1].model).toBe("claude-sonnet-4-5-20250929");
	});

	it("includes tool calls in messages", () => {
		const session = makeSession({ turns: [userTurn, assistantTurnWithTools] });
		const exported = exportSessionToJson(session);

		const msg = exported.session.messages[1];
		expect(msg.toolCalls).toHaveLength(2);
		expect(msg.toolCalls![0].name).toBe("read_file");
		expect(msg.toolCalls![0].input).toBe('{"path": "/etc/config.json"}');
		expect(msg.toolCalls![0].result).toBe('{"debug": true}');
		expect(msg.toolCalls![0].isError).toBeUndefined();

		expect(msg.toolCalls![1].name).toBe("run_command");
		expect(msg.toolCalls![1].isError).toBe(true);
	});

	it("omits toolCalls when turn has no tool calls", () => {
		const session = makeSession({ turns: [userTurn] });
		const exported = exportSessionToJson(session);

		expect(exported.session.messages[0].toolCalls).toBeUndefined();
	});

	it("computes stats correctly", () => {
		const session = makeSession();
		const exported = exportSessionToJson(session);

		expect(exported.stats.turnCount).toBe(2);
		expect(exported.stats.totalCost).toBe(0.1234);
		expect(exported.stats.totalTokens).toBe(4200);
	});

	it("computes turnCount as zero for empty session", () => {
		const session = makeSession({ turns: [] });
		const exported = exportSessionToJson(session);

		expect(exported.stats.turnCount).toBe(0);
	});

	it("copies tags by value (no shared reference)", () => {
		const session = makeSession();
		const exported = exportSessionToJson(session);

		session.meta.tags.push("mutated");
		expect(exported.session.tags).not.toContain("mutated");
	});

	it("preserves parent and branch when set", () => {
		const session = makeSession({
			meta: { ...baseMeta, parent: "s-parent-001", branch: "experiment" },
		});
		const exported = exportSessionToJson(session);

		expect(exported.session.parent).toBe("s-parent-001");
		expect(exported.session.branch).toBe("experiment");
	});
});

// ─── exportSessionToMarkdown ────────────────────────────────────────────────

describe("exportSessionToMarkdown", () => {
	it("starts with session title heading", () => {
		const session = makeSession();
		const md = exportSessionToMarkdown(session);

		expect(md.startsWith("# Session: Export Test Session")).toBe(true);
	});

	it("contains metadata fields", () => {
		const session = makeSession();
		const md = exportSessionToMarkdown(session);

		expect(md).toContain("**ID**: s-export-001");
		expect(md).toContain("**Created**: 2025-06-01T08:00:00.000Z");
		expect(md).toContain("**Updated**: 2025-06-01T09:30:00.000Z");
		expect(md).toContain("**Model**: claude-sonnet-4-5-20250929");
		expect(md).toContain("**Agent**: chitragupta");
		expect(md).toContain("**Project**: /home/user/project");
		expect(md).toContain("**Turns**: 2");
		expect(md).toContain("**Cost**: $0.1234");
		expect(md).toContain("**Tokens**: 4200");
	});

	it("contains tags when present", () => {
		const session = makeSession();
		const md = exportSessionToMarkdown(session);

		expect(md).toContain("**Tags**: testing, export");
	});

	it("omits tags line when empty", () => {
		const session = makeSession({ meta: { ...baseMeta, tags: [] } });
		const md = exportSessionToMarkdown(session);

		expect(md).not.toContain("**Tags**:");
	});

	it("shows parent when set", () => {
		const session = makeSession({
			meta: { ...baseMeta, parent: "s-parent-001" },
		});
		const md = exportSessionToMarkdown(session);

		expect(md).toContain("**Parent**: s-parent-001");
	});

	it("omits parent when null", () => {
		const session = makeSession();
		const md = exportSessionToMarkdown(session);

		expect(md).not.toContain("**Parent**:");
	});

	it("shows branch when set", () => {
		const session = makeSession({
			meta: { ...baseMeta, branch: "feature-x" },
		});
		const md = exportSessionToMarkdown(session);

		expect(md).toContain("**Branch**: feature-x");
	});

	it("renders user messages under ## User heading", () => {
		const session = makeSession();
		const md = exportSessionToMarkdown(session);

		expect(md).toContain("## User");
		expect(md).toContain("Please read the config file.");
	});

	it("renders assistant messages under ## Assistant heading", () => {
		const session = makeSession();
		const md = exportSessionToMarkdown(session);

		expect(md).toContain("## Assistant");
		expect(md).toContain("Here is the config file content.");
	});

	it("renders tool calls with name, input code block, and result code block", () => {
		const session = makeSession({ turns: [assistantTurnWithTools] });
		const md = exportSessionToMarkdown(session);

		expect(md).toContain("### Tool: read_file");
		expect(md).toContain("**Input:**");
		expect(md).toContain("```json");
		expect(md).toContain('{"path": "/etc/config.json"}');
		expect(md).toContain("**Result:**");
		expect(md).toContain('{"debug": true}');
	});

	it("marks error tool calls with (error) tag", () => {
		const session = makeSession({ turns: [assistantTurnWithTools] });
		const md = exportSessionToMarkdown(session);

		expect(md).toContain("### Tool: run_command (error)");
	});

	it("maintains correct message order", () => {
		const turns: SessionTurn[] = [
			{ turnNumber: 1, role: "user", content: "First" },
			{ turnNumber: 2, role: "assistant", content: "Second" },
			{ turnNumber: 3, role: "user", content: "Third" },
		];
		const session = makeSession({ turns });
		const md = exportSessionToMarkdown(session);

		const firstIdx = md.indexOf("First");
		const secondIdx = md.indexOf("Second");
		const thirdIdx = md.indexOf("Third");
		expect(firstIdx).toBeLessThan(secondIdx);
		expect(secondIdx).toBeLessThan(thirdIdx);
	});

	it("contains horizontal rule separators between turns", () => {
		const session = makeSession();
		const md = exportSessionToMarkdown(session);

		// There should be a --- separator between header and turns, and after each turn
		const separators = md.split("\n").filter((line) => line.trim() === "---");
		expect(separators.length).toBeGreaterThanOrEqual(2);
	});

	it("handles session with no turns", () => {
		const session = makeSession({ turns: [] });
		const md = exportSessionToMarkdown(session);

		expect(md).toContain("# Session: Export Test Session");
		expect(md).toContain("**Turns**: 0");
		expect(md).not.toContain("## User");
		expect(md).not.toContain("## Assistant");
	});
});

// ─── importSessionFromJson ──────────────────────────────────────────────────

describe("importSessionFromJson", () => {
	function makeExportedJson(overrides?: Partial<ExportedSession>): ExportedSession {
		return {
			version: 1,
			exportedAt: "2025-06-01T10:00:00.000Z",
			session: {
				id: "s-import-001",
				title: "Imported Session",
				createdAt: "2025-06-01T08:00:00.000Z",
				updatedAt: "2025-06-01T09:30:00.000Z",
				model: "claude-sonnet-4-5-20250929",
				agent: "chitragupta",
				project: "/test/project",
				parent: null,
				branch: null,
				tags: ["imported"],
				messages: [
					{ role: "user", content: "Hello", turnNumber: 1 },
					{ role: "assistant", content: "Hi there!", turnNumber: 2, agent: "chitragupta", model: "claude-sonnet-4-5-20250929" },
				],
			},
			stats: {
				turnCount: 2,
				totalCost: 0.05,
				totalTokens: 1500,
			},
			...overrides,
		};
	}

	it("restores all metadata fields from valid JSON string", () => {
		const json = JSON.stringify(makeExportedJson());
		const session = importSessionFromJson(json);

		expect(session.meta.id).toBe("s-import-001");
		expect(session.meta.title).toBe("Imported Session");
		expect(session.meta.created).toBe("2025-06-01T08:00:00.000Z");
		expect(session.meta.updated).toBe("2025-06-01T09:30:00.000Z");
		expect(session.meta.model).toBe("claude-sonnet-4-5-20250929");
		expect(session.meta.agent).toBe("chitragupta");
		expect(session.meta.project).toBe("/test/project");
		expect(session.meta.parent).toBeNull();
		expect(session.meta.branch).toBeNull();
		expect(session.meta.tags).toEqual(["imported"]);
		expect(session.meta.totalCost).toBe(0.05);
		expect(session.meta.totalTokens).toBe(1500);
	});

	it("restores turns from messages array", () => {
		const json = JSON.stringify(makeExportedJson());
		const session = importSessionFromJson(json);

		expect(session.turns).toHaveLength(2);
		expect(session.turns[0].role).toBe("user");
		expect(session.turns[0].content).toBe("Hello");
		expect(session.turns[0].turnNumber).toBe(1);
		expect(session.turns[1].role).toBe("assistant");
		expect(session.turns[1].content).toBe("Hi there!");
		expect(session.turns[1].agent).toBe("chitragupta");
		expect(session.turns[1].model).toBe("claude-sonnet-4-5-20250929");
	});

	it("restores tool calls with isError flag", () => {
		const exported = makeExportedJson();
		exported.session.messages.push({
			role: "assistant",
			content: "Running tool...",
			turnNumber: 3,
			toolCalls: [
				{ name: "bash", input: '{"cmd": "ls"}', result: "file.txt" },
				{ name: "write", input: '{}', result: "Error", isError: true },
			],
		});
		const session = importSessionFromJson(JSON.stringify(exported));

		const turn = session.turns[2];
		expect(turn.toolCalls).toHaveLength(2);
		expect(turn.toolCalls![0].name).toBe("bash");
		expect(turn.toolCalls![0].isError).toBeUndefined();
		expect(turn.toolCalls![1].name).toBe("write");
		expect(turn.toolCalls![1].isError).toBe(true);
	});

	it("accepts a pre-parsed ExportedSession object", () => {
		const exported = makeExportedJson();
		const session = importSessionFromJson(exported);

		expect(session.meta.id).toBe("s-import-001");
		expect(session.turns).toHaveLength(2);
	});

	it("throws on invalid version", () => {
		const bad = { ...makeExportedJson(), version: 2 } as any;
		expect(() => importSessionFromJson(JSON.stringify(bad))).toThrow(
			"Unsupported export version",
		);
	});

	it("throws on missing version", () => {
		const bad = { session: { id: "x", title: "x", createdAt: "x", messages: [] } } as any;
		expect(() => importSessionFromJson(JSON.stringify(bad))).toThrow(
			"Unsupported export version",
		);
	});

	it("throws on malformed JSON string", () => {
		expect(() => importSessionFromJson("{not valid json")).toThrow(
			"Invalid JSON",
		);
	});

	it("throws on missing session object", () => {
		const bad = { version: 1 } as any;
		expect(() => importSessionFromJson(JSON.stringify(bad))).toThrow(
			"missing 'session' object",
		);
	});

	it("throws on missing session.id", () => {
		const bad = {
			version: 1,
			session: { title: "x", createdAt: "x", messages: [] },
		} as any;
		expect(() => importSessionFromJson(JSON.stringify(bad))).toThrow(
			"session.id is required",
		);
	});

	it("throws on non-string session.title", () => {
		const bad = {
			version: 1,
			session: { id: "x", title: 123, createdAt: "x", messages: [] },
		} as any;
		expect(() => importSessionFromJson(JSON.stringify(bad))).toThrow(
			"session.title must be a string",
		);
	});

	it("throws on missing session.createdAt", () => {
		const bad = {
			version: 1,
			session: { id: "x", title: "x", messages: [] },
		} as any;
		expect(() => importSessionFromJson(JSON.stringify(bad))).toThrow(
			"session.createdAt must be a string",
		);
	});

	it("throws on non-array messages", () => {
		const bad = {
			version: 1,
			session: { id: "x", title: "x", createdAt: "x", messages: "not-array" },
		} as any;
		expect(() => importSessionFromJson(JSON.stringify(bad))).toThrow(
			"session.messages must be an array",
		);
	});

	it("throws on invalid message role", () => {
		const bad = {
			version: 1,
			session: {
				id: "x",
				title: "x",
				createdAt: "x",
				messages: [{ role: "system", content: "hi" }],
			},
		} as any;
		expect(() => importSessionFromJson(JSON.stringify(bad))).toThrow(
			'session.messages[0].role must be "user" or "assistant"',
		);
	});

	it("throws on non-string message content", () => {
		const bad = {
			version: 1,
			session: {
				id: "x",
				title: "x",
				createdAt: "x",
				messages: [{ role: "user", content: 42 }],
			},
		} as any;
		expect(() => importSessionFromJson(JSON.stringify(bad))).toThrow(
			"session.messages[0].content must be a string",
		);
	});

	it("defaults totalCost and totalTokens to 0 when stats missing", () => {
		const exported = makeExportedJson();
		delete (exported as any).stats;
		const session = importSessionFromJson(exported);

		expect(session.meta.totalCost).toBe(0);
		expect(session.meta.totalTokens).toBe(0);
	});

	it("defaults tags to empty array when missing", () => {
		const exported = makeExportedJson();
		delete (exported.session as any).tags;
		const session = importSessionFromJson(exported);

		expect(session.meta.tags).toEqual([]);
	});

	it("defaults parent and branch to null when missing", () => {
		const exported = makeExportedJson();
		delete (exported.session as any).parent;
		delete (exported.session as any).branch;
		const session = importSessionFromJson(exported);

		expect(session.meta.parent).toBeNull();
		expect(session.meta.branch).toBeNull();
	});
});

// ─── Roundtrip: export → import ─────────────────────────────────────────────

describe("roundtrip: exportSessionToJson → importSessionFromJson", () => {
	it("preserves all metadata through roundtrip", () => {
		const original = makeSession();
		const exported = exportSessionToJson(original);
		const restored = importSessionFromJson(JSON.stringify(exported));

		expect(restored.meta.id).toBe(original.meta.id);
		expect(restored.meta.title).toBe(original.meta.title);
		expect(restored.meta.created).toBe(original.meta.created);
		expect(restored.meta.updated).toBe(original.meta.updated);
		expect(restored.meta.model).toBe(original.meta.model);
		expect(restored.meta.agent).toBe(original.meta.agent);
		expect(restored.meta.project).toBe(original.meta.project);
		expect(restored.meta.parent).toBe(original.meta.parent);
		expect(restored.meta.branch).toBe(original.meta.branch);
		expect(restored.meta.tags).toEqual(original.meta.tags);
		expect(restored.meta.totalCost).toBe(original.meta.totalCost);
		expect(restored.meta.totalTokens).toBe(original.meta.totalTokens);
	});

	it("preserves turns through roundtrip", () => {
		const original = makeSession();
		const exported = exportSessionToJson(original);
		const restored = importSessionFromJson(JSON.stringify(exported));

		expect(restored.turns).toHaveLength(original.turns.length);
		for (let i = 0; i < original.turns.length; i++) {
			expect(restored.turns[i].role).toBe(original.turns[i].role);
			expect(restored.turns[i].content).toBe(original.turns[i].content);
			expect(restored.turns[i].turnNumber).toBe(original.turns[i].turnNumber);
		}
	});

	it("preserves tool calls through roundtrip", () => {
		const original = makeSession({ turns: [userTurn, assistantTurnWithTools] });
		const exported = exportSessionToJson(original);
		const restored = importSessionFromJson(JSON.stringify(exported));

		const restoredTools = restored.turns[1].toolCalls!;
		const originalTools = assistantTurnWithTools.toolCalls!;

		expect(restoredTools).toHaveLength(originalTools.length);
		expect(restoredTools[0].name).toBe(originalTools[0].name);
		expect(restoredTools[0].input).toBe(originalTools[0].input);
		expect(restoredTools[0].result).toBe(originalTools[0].result);
		expect(restoredTools[1].isError).toBe(true);
	});

	it("preserves parent and branch through roundtrip", () => {
		const original = makeSession({
			meta: { ...baseMeta, parent: "s-parent-001", branch: "experiment" },
		});
		const exported = exportSessionToJson(original);
		const restored = importSessionFromJson(JSON.stringify(exported));

		expect(restored.meta.parent).toBe("s-parent-001");
		expect(restored.meta.branch).toBe("experiment");
	});
});

// ─── detectExportFormat ─────────────────────────────────────────────────────

describe("detectExportFormat", () => {
	it('detects JSON when content is a valid exported session', () => {
		const session = makeSession();
		const exported = exportSessionToJson(session);
		const json = JSON.stringify(exported);

		expect(detectExportFormat(json)).toBe("json");
	});

	it('detects JSON even with leading whitespace', () => {
		const session = makeSession();
		const exported = exportSessionToJson(session);
		const json = "  \n  " + JSON.stringify(exported);

		expect(detectExportFormat(json)).toBe("json");
	});

	it('returns unknown for JSON without version/session keys', () => {
		const json = JSON.stringify({ foo: "bar" });
		expect(detectExportFormat(json)).toBe("unknown");
	});

	it('returns unknown for invalid JSON starting with {', () => {
		expect(detectExportFormat("{not valid json}")).toBe("unknown");
	});

	it('detects markdown when content starts with # Session:', () => {
		const session = makeSession();
		const md = exportSessionToMarkdown(session);

		expect(detectExportFormat(md)).toBe("markdown");
	});

	it('detects markdown when content starts with YAML frontmatter (---)', () => {
		const content = "---\ntitle: test\n---\n\nSome content";
		expect(detectExportFormat(content)).toBe("markdown");
	});

	it('returns unknown for arbitrary text', () => {
		expect(detectExportFormat("Hello, world!")).toBe("unknown");
	});

	it('returns unknown for empty string', () => {
		expect(detectExportFormat("")).toBe("unknown");
	});

	it('returns unknown for whitespace-only string', () => {
		expect(detectExportFormat("   \n\t  ")).toBe("unknown");
	});

	it('detects markdown with leading whitespace before # Session:', () => {
		expect(detectExportFormat("  \n# Session: Test")).toBe("markdown");
	});
});
