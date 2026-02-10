/**
 * E2E: Persistence Round-Trip Tests.
 *
 * Verifies that the full persistence pipeline works correctly:
 *   createSession -> addTurn -> saveSession -> loadSession
 *   memory-store: updateMemory -> getMemory, appendMemory -> getMemory
 *
 * Focuses on edge cases: special characters, backticks in tool results,
 * YAML-like content in turns, --- separators, ## Turn N patterns, etc.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── In-Memory Virtual Filesystem ────────────────────────────────────────────

vi.mock("fs", () => {
	const store = new Map<string, string>();
	const dirs = new Set<string>();

	return {
		default: {
			existsSync: vi.fn((p: string) => store.has(p) || dirs.has(p)),
			readFileSync: vi.fn((p: string) => {
				if (!store.has(p)) throw new Error(`ENOENT: no such file or directory, open '${p}'`);
				return store.get(p)!;
			}),
			writeFileSync: vi.fn((p: string, data: string) => {
				store.set(p, data);
			}),
			appendFileSync: vi.fn((p: string, data: string) => {
				const existing = store.get(p) ?? "";
				store.set(p, existing + data);
			}),
			mkdirSync: vi.fn((p: string, _opts?: any) => {
				dirs.add(p);
				let parent = p;
				while (true) {
					const next = parent.substring(0, parent.lastIndexOf("/"));
					if (!next || next === parent) break;
					dirs.add(next);
					parent = next;
				}
			}),
			readdirSync: vi.fn((dirPath: string, opts?: any) => {
				const files: any[] = [];
				for (const key of store.keys()) {
					if (key.startsWith(dirPath + "/") && key.endsWith(".md")) {
						const relative = key.slice(dirPath.length + 1);
						if (!relative.includes("/")) {
							if (opts?.withFileTypes) {
								files.push({
									name: relative,
									isDirectory: () => false,
								});
							} else {
								files.push(relative);
							}
						}
					}
				}
				for (const d of dirs) {
					if (d.startsWith(dirPath + "/")) {
						const relative = d.slice(dirPath.length + 1);
						const topLevel = relative.split("/")[0];
						if (opts?.withFileTypes) {
							if (!files.some((f: any) => f.name === topLevel)) {
								files.push({
									name: topLevel,
									isDirectory: () => true,
								});
							}
						}
					}
				}
				return files;
			}),
			unlinkSync: vi.fn((p: string) => {
				store.delete(p);
			}),
			rmdirSync: vi.fn((p: string) => {
				dirs.delete(p);
			}),
		},
		__store: store,
		__dirs: dirs,
	};
});

import {
	createSession,
	saveSession,
	loadSession,
	addTurn,
	writeSessionMarkdown,
	parseSessionMarkdown,
	getMemory,
	updateMemory,
	appendMemory,
	deleteMemory,
} from "@chitragupta/smriti";
import type { Session, SessionTurn, SessionMeta, MemoryScope } from "@chitragupta/smriti";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getVfs(): Promise<{ store: Map<string, string>; dirs: Set<string> }> {
	const fsModule = await import("fs") as any;
	return { store: fsModule.__store, dirs: fsModule.__dirs };
}

function makeMeta(overrides?: Partial<SessionMeta>): SessionMeta {
	return {
		id: "test-001",
		title: "Test Session",
		created: "2026-01-01T00:00:00Z",
		updated: "2026-01-01T00:00:00Z",
		agent: "chitragupta",
		model: "claude-3",
		project: "/test",
		parent: null,
		branch: null,
		tags: [],
		totalCost: 0,
		totalTokens: 0,
		...overrides,
	};
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe("Persistence E2E", () => {
	beforeEach(async () => {
		const { store, dirs } = await getVfs();
		store.clear();
		dirs.clear();
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 1. Full Session Lifecycle
	// ═══════════════════════════════════════════════════════════════════════

	describe("Full session lifecycle", () => {
		it("should create -> add 3 turns -> save -> load and preserve everything", async () => {
			const session = createSession({
				project: "/my/project",
				title: "Full Lifecycle Test",
				agent: "chitragupta",
				model: "claude-opus-4",
				tags: ["test", "lifecycle"],
			});

			await addTurn(session.meta.id, "/my/project", {
				turnNumber: 0,
				role: "user",
				content: "How do I use TypeScript generics?",
			});

			await addTurn(session.meta.id, "/my/project", {
				turnNumber: 0,
				role: "assistant",
				content: "TypeScript generics allow you to create reusable components.",
				agent: "chitragupta",
				model: "claude-opus-4",
				toolCalls: [
					{
						name: "read_file",
						input: '{"path": "/src/types.ts"}',
						result: "export interface Generic<T> { value: T; }",
					},
				],
			});

			await addTurn(session.meta.id, "/my/project", {
				turnNumber: 0,
				role: "user",
				content: "Can you show me a more complex example?",
			});

			const loaded = loadSession(session.meta.id, "/my/project");

			// Metadata
			expect(loaded.meta.id).toBe(session.meta.id);
			expect(loaded.meta.title).toBe("Full Lifecycle Test");
			expect(loaded.meta.agent).toBe("chitragupta");
			expect(loaded.meta.model).toBe("claude-opus-4");
			expect(loaded.meta.tags).toEqual(["test", "lifecycle"]);
			expect(loaded.meta.project).toBe("/my/project");

			// Turns
			expect(loaded.turns).toHaveLength(3);
			expect(loaded.turns[0].turnNumber).toBe(1);
			expect(loaded.turns[0].role).toBe("user");
			expect(loaded.turns[0].content).toBe("How do I use TypeScript generics?");

			expect(loaded.turns[1].turnNumber).toBe(2);
			expect(loaded.turns[1].role).toBe("assistant");
			expect(loaded.turns[1].agent).toBe("chitragupta");
			expect(loaded.turns[1].model).toBe("claude-opus-4");
			expect(loaded.turns[1].toolCalls).toHaveLength(1);
			expect(loaded.turns[1].toolCalls![0].name).toBe("read_file");
			expect(loaded.turns[1].toolCalls![0].input).toBe('{"path": "/src/types.ts"}');
			expect(loaded.turns[1].toolCalls![0].result).toBe("export interface Generic<T> { value: T; }");

			expect(loaded.turns[2].turnNumber).toBe(3);
			expect(loaded.turns[2].role).toBe("user");
			expect(loaded.turns[2].content).toBe("Can you show me a more complex example?");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 2. Special Characters in Content
	// ═══════════════════════════════════════════════════════════════════════

	describe("Special characters in content", () => {
		it("should preserve content with --- separator lines", async () => {
			const session = createSession({ project: "/test/dashes" });

			await addTurn(session.meta.id, "/test/dashes", {
				turnNumber: 1,
				role: "user",
				content: "Here is a separator:\n---\nAnd more text after it.",
			});

			const loaded = loadSession(session.meta.id, "/test/dashes");
			// The --- inside content gets escaped during write and unescaped during parse
			expect(loaded.turns[0].content).toContain("---");
			expect(loaded.turns[0].content).toContain("And more text after it.");
		});

		it("should preserve content with ## Turn N patterns", async () => {
			const session = createSession({ project: "/test/turn-pattern" });

			await addTurn(session.meta.id, "/test/turn-pattern", {
				turnNumber: 1,
				role: "user",
				content: "Example:\n## Turn 5 \u2014 user\nJust example text, not a real turn.",
			});

			const loaded = loadSession(session.meta.id, "/test/turn-pattern");
			expect(loaded.turns).toHaveLength(1);
			expect(loaded.turns[0].content).toContain("## Turn 5");
			expect(loaded.turns[0].content).toContain("Just example text");
		});

		it("should preserve content with </details> and </summary> HTML tags", async () => {
			const session = createSession({ project: "/test/html-tags" });

			await addTurn(session.meta.id, "/test/html-tags", {
				turnNumber: 1,
				role: "user",
				content: "Example HTML:\n<details>\n<summary>Click me</summary>\nHidden content\n</details>",
			});

			const loaded = loadSession(session.meta.id, "/test/html-tags");
			expect(loaded.turns[0].content).toContain("</details>");
			expect(loaded.turns[0].content).toContain("</summary>");
		});

		it("should preserve content with code blocks and backticks", async () => {
			const session = createSession({ project: "/test/code" });

			const codeContent = [
				"Here is some code:",
				"",
				"```typescript",
				"function add(a: number, b: number): number {",
				"  return a + b;",
				"}",
				"```",
				"",
				"And more explanation.",
			].join("\n");

			await addTurn(session.meta.id, "/test/code", {
				turnNumber: 1,
				role: "user",
				content: codeContent,
			});

			const loaded = loadSession(session.meta.id, "/test/code");
			expect(loaded.turns[0].content).toContain("function add(a: number, b: number)");
			expect(loaded.turns[0].content).toContain("return a + b;");
		});

		it("should preserve title with double quotes", () => {
			const session = createSession({
				project: "/test/title-quotes",
				title: 'Debug "session" with special chars',
			});

			const loaded = loadSession(session.meta.id, "/test/title-quotes");
			expect(loaded.meta.title).toBe('Debug "session" with special chars');
		});

		it("should preserve title with colons", () => {
			const session = createSession({
				project: "/test/title-colon",
				title: "Step 1: Configure the server",
			});

			const loaded = loadSession(session.meta.id, "/test/title-colon");
			expect(loaded.meta.title).toBe("Step 1: Configure the server");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 3. Tool Call Edge Cases
	// ═══════════════════════════════════════════════════════════════════════

	describe("Tool call edge cases", () => {
		it("should preserve tool call with multiline JSON input", async () => {
			const session = createSession({ project: "/test/tool-json" });

			const jsonInput = JSON.stringify({
				path: "/src/app.ts",
				content: "const x = 1;\nconst y = 2;",
			}, null, 2);

			await addTurn(session.meta.id, "/test/tool-json", {
				turnNumber: 1,
				role: "assistant",
				content: "Writing the file.",
				toolCalls: [{
					name: "write_file",
					input: jsonInput,
					result: "File written successfully.",
				}],
			});

			const loaded = loadSession(session.meta.id, "/test/tool-json");
			expect(loaded.turns[0].toolCalls).toHaveLength(1);
			expect(loaded.turns[0].toolCalls![0].input).toContain("/src/app.ts");
			expect(loaded.turns[0].toolCalls![0].result).toBe("File written successfully.");
		});

		it("should preserve error tool call flag", async () => {
			const session = createSession({ project: "/test/tool-error" });

			await addTurn(session.meta.id, "/test/tool-error", {
				turnNumber: 1,
				role: "assistant",
				content: "Running command.",
				toolCalls: [{
					name: "bash",
					input: '{"command": "invalid"}',
					result: "bash: invalid: command not found",
					isError: true,
				}],
			});

			const loaded = loadSession(session.meta.id, "/test/tool-error");
			expect(loaded.turns[0].toolCalls![0].isError).toBe(true);
			expect(loaded.turns[0].toolCalls![0].result).toContain("command not found");
		});

		it("should preserve multiple tool calls in one turn", async () => {
			const session = createSession({ project: "/test/multi-tool" });

			await addTurn(session.meta.id, "/test/multi-tool", {
				turnNumber: 1,
				role: "assistant",
				content: "Running multiple tools.",
				toolCalls: [
					{ name: "read_file", input: '{"path": "a.ts"}', result: "file a content" },
					{ name: "grep", input: '{"pattern": "error"}', result: "no matches" },
					{ name: "bash", input: '{"cmd": "ls"}', result: "file1\nfile2\nfile3" },
				],
			});

			const loaded = loadSession(session.meta.id, "/test/multi-tool");
			expect(loaded.turns[0].toolCalls).toHaveLength(3);
			expect(loaded.turns[0].toolCalls![0].name).toBe("read_file");
			expect(loaded.turns[0].toolCalls![1].name).toBe("grep");
			expect(loaded.turns[0].toolCalls![2].name).toBe("bash");
			expect(loaded.turns[0].toolCalls![2].result).toContain("file1\nfile2\nfile3");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 4. Markdown Writer -> Parser Roundtrip (unit-level)
	// ═══════════════════════════════════════════════════════════════════════

	describe("Markdown writer/parser roundtrip edge cases", () => {
		it("should roundtrip title with escaped double quotes", () => {
			const session: Session = {
				meta: makeMeta({ title: 'He said "hello" and left' }),
				turns: [],
			};

			const md = writeSessionMarkdown(session);
			const parsed = parseSessionMarkdown(md);
			expect(parsed.meta.title).toBe('He said "hello" and left');
		});

		it("should roundtrip session with zero cost and zero tokens", () => {
			const session: Session = {
				meta: makeMeta({ totalCost: 0, totalTokens: 0 }),
				turns: [],
			};

			const md = writeSessionMarkdown(session);
			const parsed = parseSessionMarkdown(md);
			expect(parsed.meta.totalCost).toBe(0);
			expect(parsed.meta.totalTokens).toBe(0);
		});

		it("should roundtrip session with fractional cost", () => {
			const session: Session = {
				meta: makeMeta({ totalCost: 0.000123, totalTokens: 42 }),
				turns: [],
			};

			const md = writeSessionMarkdown(session);
			const parsed = parseSessionMarkdown(md);
			expect(parsed.meta.totalCost).toBeCloseTo(0.000123, 6);
			expect(parsed.meta.totalTokens).toBe(42);
		});

		it("should roundtrip parent and branch fields when set", () => {
			const session: Session = {
				meta: makeMeta({
					parent: "s-parent-abc123",
					branch: "experiment-v2",
				}),
				turns: [],
			};

			const md = writeSessionMarkdown(session);
			const parsed = parseSessionMarkdown(md);
			expect(parsed.meta.parent).toBe("s-parent-abc123");
			expect(parsed.meta.branch).toBe("experiment-v2");
		});

		it("should roundtrip null parent and null branch", () => {
			const session: Session = {
				meta: makeMeta({ parent: null, branch: null }),
				turns: [],
			};

			const md = writeSessionMarkdown(session);
			const parsed = parseSessionMarkdown(md);
			expect(parsed.meta.parent).toBeNull();
			expect(parsed.meta.branch).toBeNull();
		});

		it("should roundtrip a 10-turn session", () => {
			const turns: SessionTurn[] = [];
			for (let i = 1; i <= 10; i++) {
				turns.push({
					turnNumber: i,
					role: i % 2 === 1 ? "user" : "assistant",
					content: `Message ${i} with some content.`,
				});
			}

			const session: Session = {
				meta: makeMeta({ totalTokens: 5000, totalCost: 0.25 }),
				turns,
			};

			const md = writeSessionMarkdown(session);
			const parsed = parseSessionMarkdown(md);
			expect(parsed.turns).toHaveLength(10);
			for (let i = 0; i < 10; i++) {
				expect(parsed.turns[i].turnNumber).toBe(i + 1);
				expect(parsed.turns[i].content).toBe(`Message ${i + 1} with some content.`);
			}
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 5. Memory Store Round-Trip
	// ═══════════════════════════════════════════════════════════════════════

	describe("Memory store persistence", () => {
		it("should persist and retrieve global memory", async () => {
			const scope: MemoryScope = { type: "global" };
			await updateMemory(scope, "# Global Memory\n\nUser prefers dark mode.");
			const content = getMemory(scope);
			expect(content).toBe("# Global Memory\n\nUser prefers dark mode.");
		});

		it("should persist and retrieve project memory", async () => {
			const scope: MemoryScope = { type: "project", path: "/my/project" };
			await updateMemory(scope, "# Project Memory\n\nThis project uses React + TypeScript.");
			const content = getMemory(scope);
			expect(content).toBe("# Project Memory\n\nThis project uses React + TypeScript.");
		});

		it("should persist and retrieve agent memory", async () => {
			const scope: MemoryScope = { type: "agent", agentId: "chitragupta" };
			await updateMemory(scope, "# Agent Memory\n\nAgent prefers concise responses.");
			const content = getMemory(scope);
			expect(content).toBe("# Agent Memory\n\nAgent prefers concise responses.");
		});

		it("should overwrite memory on update", async () => {
			const scope: MemoryScope = { type: "global" };
			await updateMemory(scope, "Version 1");
			await updateMemory(scope, "Version 2");
			expect(getMemory(scope)).toBe("Version 2");
		});

		it("should append to existing memory", async () => {
			const scope: MemoryScope = { type: "global" };
			await updateMemory(scope, "# Global Memory\n\nInitial content.");
			await appendMemory(scope, "Appended entry.");
			const content = getMemory(scope);
			expect(content).toContain("Initial content.");
			expect(content).toContain("Appended entry.");
			expect(content).toContain("---"); // separator
		});

		it("should return empty string for non-existent memory", () => {
			expect(getMemory({ type: "global" })).toBe("");
			expect(getMemory({ type: "project", path: "/nonexistent" })).toBe("");
			expect(getMemory({ type: "agent", agentId: "ghost" })).toBe("");
		});

		it("should delete memory and confirm it is gone", async () => {
			const scope: MemoryScope = { type: "global" };
			await updateMemory(scope, "To be deleted");
			expect(getMemory(scope)).toBe("To be deleted");
			deleteMemory(scope);
			expect(getMemory(scope)).toBe("");
		});

		it("should isolate project memories by path", async () => {
			const scope1: MemoryScope = { type: "project", path: "/project/alpha" };
			const scope2: MemoryScope = { type: "project", path: "/project/beta" };

			await updateMemory(scope1, "Alpha memory");
			await updateMemory(scope2, "Beta memory");

			expect(getMemory(scope1)).toBe("Alpha memory");
			expect(getMemory(scope2)).toBe("Beta memory");
		});

		it("should isolate agent memories by agentId", async () => {
			const scope1: MemoryScope = { type: "agent", agentId: "chitragupta" };
			const scope2: MemoryScope = { type: "agent", agentId: "custom" };

			await updateMemory(scope1, "Chitragupta memory");
			await updateMemory(scope2, "Custom memory");

			expect(getMemory(scope1)).toBe("Chitragupta memory");
			expect(getMemory(scope2)).toBe("Custom memory");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 6. Title with Colon in YAML Frontmatter
	// ═══════════════════════════════════════════════════════════════════════

	describe("YAML frontmatter edge cases", () => {
		it("should handle project path with colons (Windows-style)", () => {
			const session: Session = {
				meta: makeMeta({ project: "C:\\Users\\test\\project" }),
				turns: [],
			};

			const md = writeSessionMarkdown(session);
			const parsed = parseSessionMarkdown(md);
			// The project path has a colon — the YAML parser splits on first colon
			// so "C" would be the key. Let's verify how this behaves.
			expect(parsed.meta.project).toBe("C:\\Users\\test\\project");
		});

		it("should handle ISO timestamps in created/updated fields", () => {
			const session: Session = {
				meta: makeMeta({
					created: "2026-02-07T14:30:00.123Z",
					updated: "2026-02-07T15:45:00.456Z",
				}),
				turns: [],
			};

			const md = writeSessionMarkdown(session);
			const parsed = parseSessionMarkdown(md);
			expect(parsed.meta.created).toBe("2026-02-07T14:30:00.123Z");
			expect(parsed.meta.updated).toBe("2026-02-07T15:45:00.456Z");
		});
	});
});
