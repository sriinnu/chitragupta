/**
 * E2E: Session Lifecycle Flow Tests.
 *
 * Exercises the FULL information flow through:
 *   session-store.ts -> markdown-writer.ts -> filesystem -> markdown-parser.ts -> session-store.ts
 *
 * Mock strategy: mock `fs` with an in-memory virtual filesystem so no real disk I/O occurs,
 * letting the real markdown writer/parser run against the virtual store.
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
			appendFileSync: vi.fn((p: string, data: string) => {
				const existing = store.get(p) ?? "";
				store.set(p, existing + data);
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
	listSessions,
	deleteSession,
	addTurn,
	DatabaseManager,
} from "@chitragupta/smriti";
import { _resetDbInit } from "@chitragupta/smriti/session-store";
import { branchSession, getSessionTree } from "@chitragupta/smriti";
import { SessionError } from "@chitragupta/core";
import type { Session, SessionTurn } from "@chitragupta/smriti";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Get the virtual filesystem store for inspection. */
async function getVfs(): Promise<{ store: Map<string, string>; dirs: Set<string> }> {
	const fsModule = await import("fs") as any;
	return { store: fsModule.__store, dirs: fsModule.__dirs };
}

/** Small delay to ensure timestamps differ between operations. */
function tick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 15));
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe("E2E: Session Lifecycle", () => {
	beforeEach(async () => {
		DatabaseManager.reset();
		_resetDbInit();
		const { store, dirs } = await getVfs();
		store.clear();
		dirs.clear();
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 1. Create-Save-Load Roundtrip
	// ═══════════════════════════════════════════════════════════════════════

	describe("Create-Save-Load roundtrip", () => {
		it("should create a session with auto-generated ID and persist to disk", async () => {
			const session = createSession({
				project: "/test/project",
				title: "Debug Session",
				agent: "chitragupta",
				model: "claude-sonnet",
			});

			expect(session.meta.id).toMatch(/^session-\d{4}-\d{2}-\d{2}/);
			expect(session.meta.title).toBe("Debug Session");
			expect(session.meta.project).toBe("/test/project");
			expect(session.turns).toEqual([]);

			// Verify the file was written to the virtual filesystem
			const { store } = await getVfs();
			const files = [...store.keys()].filter((k) => k.endsWith(".md"));
			expect(files.length).toBe(1);
		});

		it("should load a saved session with identical metadata", async () => {
			const created = createSession({
				project: "/test/roundtrip",
				title: "Roundtrip Test",
				agent: "chitragupta",
				model: "claude-opus",
				tags: ["test", "e2e"],
			});

			const loaded = loadSession(created.meta.id, "/test/roundtrip");

			expect(loaded.meta.id).toBe(created.meta.id);
			expect(loaded.meta.title).toBe("Roundtrip Test");
			expect(loaded.meta.agent).toBe("chitragupta");
			expect(loaded.meta.model).toBe("claude-opus");
			expect(loaded.meta.project).toBe("/test/roundtrip");
			expect(loaded.meta.tags).toEqual(["test", "e2e"]);
			expect(loaded.meta.parent).toBeNull();
			expect(loaded.meta.branch).toBeNull();
			expect(loaded.turns).toEqual([]);
		});

		it("should preserve totalCost and totalTokens through roundtrip", () => {
			const session = createSession({
				project: "/test/costs",
				title: "Cost Test",
			});

			session.meta.totalCost = 0.0523;
			session.meta.totalTokens = 4200;
			saveSession(session);

			const loaded = loadSession(session.meta.id, "/test/costs");
			expect(loaded.meta.totalCost).toBe(0.0523);
			expect(loaded.meta.totalTokens).toBe(4200);
		});

		it("should use defaults when optional fields are omitted", () => {
			const session = createSession({ project: "/test/defaults" });

			expect(session.meta.title).toBe("New Session");
			expect(session.meta.agent).toBe("chitragupta");
			expect(session.meta.model).toBe("unknown");
			expect(session.meta.tags).toEqual([]);
			expect(session.meta.totalCost).toBe(0);
			expect(session.meta.totalTokens).toBe(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 2. Turn Recording Flow
	// ═══════════════════════════════════════════════════════════════════════

	describe("Turn recording flow", () => {
		it("should persist a single user turn and load it back", async () => {
			const session = createSession({
				project: "/test/turns",
				title: "Turn Test",
			});

			await addTurn(session.meta.id, "/test/turns", {
				turnNumber: 1,
				role: "user",
				content: "Hello, can you help me?",
			});

			const loaded = loadSession(session.meta.id, "/test/turns");
			expect(loaded.turns).toHaveLength(1);
			expect(loaded.turns[0].role).toBe("user");
			expect(loaded.turns[0].content).toBe("Hello, can you help me?");
			expect(loaded.turns[0].turnNumber).toBe(1);
		});

		it("should auto-assign turn numbers when not provided", async () => {
			const session = createSession({
				project: "/test/autonum",
				title: "Auto Number",
			});

			await addTurn(session.meta.id, "/test/autonum", {
				turnNumber: 0,
				role: "user",
				content: "First message",
			});
			await addTurn(session.meta.id, "/test/autonum", {
				turnNumber: 0,
				role: "assistant",
				content: "First response",
			});

			const loaded = loadSession(session.meta.id, "/test/autonum");
			expect(loaded.turns).toHaveLength(2);
			expect(loaded.turns[0].turnNumber).toBe(1);
			expect(loaded.turns[1].turnNumber).toBe(2);
		});

		it("should preserve agent and model metadata on turns", async () => {
			const session = createSession({
				project: "/test/turnmeta",
				title: "Turn Meta",
			});

			await addTurn(session.meta.id, "/test/turnmeta", {
				turnNumber: 1,
				role: "assistant",
				content: "Response with metadata",
				agent: "custom-agent",
				model: "claude-opus-4",
			});

			const loaded = loadSession(session.meta.id, "/test/turnmeta");
			expect(loaded.turns[0].agent).toBe("custom-agent");
			expect(loaded.turns[0].model).toBe("claude-opus-4");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 3. Multi-Turn Session
	// ═══════════════════════════════════════════════════════════════════════

	describe("Multi-turn session", () => {
		it("should preserve order of multiple user + assistant turns", async () => {
			const session = createSession({
				project: "/test/multi",
				title: "Multi-Turn",
			});

			const turns: SessionTurn[] = [
				{ turnNumber: 1, role: "user", content: "What is TypeScript?" },
				{ turnNumber: 2, role: "assistant", content: "TypeScript is a typed superset of JavaScript." },
				{ turnNumber: 3, role: "user", content: "How do I use generics?" },
				{ turnNumber: 4, role: "assistant", content: "Generics allow parameterized types." },
			];

			for (const turn of turns) {
				await addTurn(session.meta.id, "/test/multi", turn);
			}

			const loaded = loadSession(session.meta.id, "/test/multi");
			expect(loaded.turns).toHaveLength(4);

			for (let i = 0; i < turns.length; i++) {
				expect(loaded.turns[i].turnNumber).toBe(turns[i].turnNumber);
				expect(loaded.turns[i].role).toBe(turns[i].role);
				expect(loaded.turns[i].content).toBe(turns[i].content);
			}
		});

		it("should preserve tool calls through the roundtrip", async () => {
			const session = createSession({
				project: "/test/tools",
				title: "Tool Calls",
			});

			await addTurn(session.meta.id, "/test/tools", {
				turnNumber: 1,
				role: "user",
				content: "Read the config file",
			});

			await addTurn(session.meta.id, "/test/tools", {
				turnNumber: 2,
				role: "assistant",
				content: "Let me read that file for you.",
				toolCalls: [
					{
						name: "read_file",
						input: '{"path": "/etc/config.json"}',
						result: '{"debug": true}',
					},
				],
			});

			const loaded = loadSession(session.meta.id, "/test/tools");
			expect(loaded.turns).toHaveLength(2);
			expect(loaded.turns[1].toolCalls).toBeDefined();
			expect(loaded.turns[1].toolCalls).toHaveLength(1);
			expect(loaded.turns[1].toolCalls![0].name).toBe("read_file");
			expect(loaded.turns[1].toolCalls![0].input).toBe('{"path": "/etc/config.json"}');
			expect(loaded.turns[1].toolCalls![0].result).toBe('{"debug": true}');
		});

		it("should preserve tool call error flag through roundtrip", async () => {
			const session = createSession({
				project: "/test/toolerr",
				title: "Tool Error",
			});

			await addTurn(session.meta.id, "/test/toolerr", {
				turnNumber: 1,
				role: "assistant",
				content: "Attempting file read.",
				toolCalls: [
					{
						name: "bash",
						input: "cat /missing",
						result: "cat: /missing: No such file or directory",
						isError: true,
					},
				],
			});

			const loaded = loadSession(session.meta.id, "/test/toolerr");
			expect(loaded.turns[0].toolCalls![0].isError).toBe(true);
		});

		it("should handle assistant turn with multiple tool calls", async () => {
			const session = createSession({
				project: "/test/multitools",
				title: "Multi Tools",
			});

			await addTurn(session.meta.id, "/test/multitools", {
				turnNumber: 1,
				role: "assistant",
				content: "Running multiple tools.",
				toolCalls: [
					{ name: "read", input: '{"file":"a.ts"}', result: "content-a" },
					{ name: "grep", input: '{"pattern":"foo"}', result: "line 42: foo" },
					{ name: "write", input: '{"file":"b.ts"}', result: "written" },
				],
			});

			const loaded = loadSession(session.meta.id, "/test/multitools");
			expect(loaded.turns[0].toolCalls).toHaveLength(3);
			expect(loaded.turns[0].toolCalls!.map((tc) => tc.name)).toEqual(["read", "grep", "write"]);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 4. Session Branching Flow
	// ═══════════════════════════════════════════════════════════════════════

	describe("Session branching flow", () => {
		it("should create a branch with parent reference and inherited turns", async () => {
			const parent = createSession({
				project: "/test/branch",
				title: "Parent Session",
				agent: "chitragupta",
				model: "claude-opus",
				tags: ["original"],
			});

			await addTurn(parent.meta.id, "/test/branch", {
				turnNumber: 1,
				role: "user",
				content: "Start of conversation",
			});
			await addTurn(parent.meta.id, "/test/branch", {
				turnNumber: 2,
				role: "assistant",
				content: "I understand.",
			});

			const branch = branchSession(parent.meta.id, "/test/branch", "experiment");

			expect(branch.meta.parent).toBe(parent.meta.id);
			expect(branch.meta.branch).toBe("experiment");
			expect(branch.meta.title).toContain("branch: experiment");
			expect(branch.meta.tags).toContain("branch:experiment");
			expect(branch.meta.tags).toContain("original");
			expect(branch.turns).toHaveLength(2);
			expect(branch.turns[0].content).toBe("Start of conversation");
			expect(branch.turns[1].content).toBe("I understand.");
		});

		it("should branch from a specific turn number", async () => {
			const parent = createSession({
				project: "/test/branch-from",
				title: "Branch From Turn",
			});

			await addTurn(parent.meta.id, "/test/branch-from", {
				turnNumber: 1,
				role: "user",
				content: "Turn 1",
			});
			await addTurn(parent.meta.id, "/test/branch-from", {
				turnNumber: 2,
				role: "assistant",
				content: "Turn 2",
			});
			await addTurn(parent.meta.id, "/test/branch-from", {
				turnNumber: 3,
				role: "user",
				content: "Turn 3",
			});

			const branch = branchSession(parent.meta.id, "/test/branch-from", "from-t2", 2);

			expect(branch.turns).toHaveLength(2);
			expect(branch.turns[0].content).toBe("Turn 1");
			expect(branch.turns[1].content).toBe("Turn 2");
		});

		it("should deep-clone turns so modifying branch does not affect parent", async () => {
			const parent = createSession({
				project: "/test/deepclone",
				title: "Deep Clone Test",
			});

			await addTurn(parent.meta.id, "/test/deepclone", {
				turnNumber: 1,
				role: "user",
				content: "Original content",
			});

			const branch = branchSession(parent.meta.id, "/test/deepclone", "clone");

			// Add a turn to the branch
			await addTurn(branch.meta.id, "/test/deepclone", {
				turnNumber: 2,
				role: "assistant",
				content: "Branch-only content",
			});

			// Parent should still have only 1 turn
			const parentReloaded = loadSession(parent.meta.id, "/test/deepclone");
			expect(parentReloaded.turns).toHaveLength(1);

			const branchReloaded = loadSession(branch.meta.id, "/test/deepclone");
			expect(branchReloaded.turns).toHaveLength(2);
		});

		it("should persist branch session to disk and reload correctly", async () => {
			const parent = createSession({
				project: "/test/branch-persist",
				title: "Branch Persist",
			});

			await addTurn(parent.meta.id, "/test/branch-persist", {
				turnNumber: 1,
				role: "user",
				content: "Hello",
			});

			const branch = branchSession(parent.meta.id, "/test/branch-persist", "v2");
			const loaded = loadSession(branch.meta.id, "/test/branch-persist");

			expect(loaded.meta.parent).toBe(parent.meta.id);
			expect(loaded.meta.branch).toBe("v2");
			expect(loaded.turns).toHaveLength(1);
			expect(loaded.turns[0].content).toBe("Hello");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 5. Session Tree
	// ═══════════════════════════════════════════════════════════════════════

	describe("Session tree", () => {
		it("should build a tree with parent and branch child", async () => {
			const parent = createSession({
				project: "/test/tree",
				title: "Tree Root",
			});

			await addTurn(parent.meta.id, "/test/tree", {
				turnNumber: 1,
				role: "user",
				content: "Root turn",
			});

			const branch = branchSession(parent.meta.id, "/test/tree", "leaf");

			const tree = getSessionTree("/test/tree");

			// The tree root should be the parent session
			expect(tree.root.session.id).toBe(parent.meta.id);
			expect(tree.root.children).toHaveLength(1);
			expect(tree.root.children[0].session.id).toBe(branch.meta.id);
		});

		it("should handle multiple branches from the same parent", async () => {
			const parent = createSession({
				project: "/test/multibranch",
				title: "Multi Branch Root",
			});

			await addTurn(parent.meta.id, "/test/multibranch", {
				turnNumber: 1,
				role: "user",
				content: "Root",
			});

			const b1 = branchSession(parent.meta.id, "/test/multibranch", "b1");
			const b2 = branchSession(parent.meta.id, "/test/multibranch", "b2");

			const tree = getSessionTree("/test/multibranch");

			expect(tree.root.session.id).toBe(parent.meta.id);
			expect(tree.root.children).toHaveLength(2);
			const childIds = tree.root.children.map((c) => c.session.id).sort();
			expect(childIds).toContain(b1.meta.id);
			expect(childIds).toContain(b2.meta.id);
		});

		it("should return synthetic root for empty project", () => {
			const tree = getSessionTree("/test/empty-tree");
			expect(tree.root.session.id).toBe("__root__");
			expect(tree.root.children).toHaveLength(0);
		});

		it("should wrap multiple roots under synthetic root", async () => {
			createSession({ project: "/test/multi-root", title: "Root A" });
			await tick();
			createSession({ project: "/test/multi-root", title: "Root B" });

			const tree = getSessionTree("/test/multi-root");

			expect(tree.root.session.id).toBe("__root__");
			expect(tree.root.children).toHaveLength(2);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 6. Listing Flow
	// ═══════════════════════════════════════════════════════════════════════

	describe("Listing flow", () => {
		it("should list all sessions for a project sorted by updated desc", async () => {
			const s1 = createSession({ project: "/test/list", title: "Session 1" });
			await tick();
			const s2 = createSession({ project: "/test/list", title: "Session 2" });
			await tick();
			const s3 = createSession({ project: "/test/list", title: "Session 3" });

			const metas = listSessions("/test/list");

			expect(metas).toHaveLength(3);
			// Most recently updated first
			expect(metas[0].id).toBe(s3.meta.id);
			// All IDs present
			const ids = metas.map((m) => m.id);
			expect(ids).toContain(s1.meta.id);
			expect(ids).toContain(s2.meta.id);
			expect(ids).toContain(s3.meta.id);
		});

		it("should return empty array for non-existent project", () => {
			const metas = listSessions("/test/nonexistent");
			expect(metas).toEqual([]);
		});

		it("should include branched sessions in listing", async () => {
			const parent = createSession({ project: "/test/list-branch", title: "Parent" });
			await addTurn(parent.meta.id, "/test/list-branch", {
				turnNumber: 1,
				role: "user",
				content: "Hello",
			});
			branchSession(parent.meta.id, "/test/list-branch", "b1");

			const metas = listSessions("/test/list-branch");
			expect(metas).toHaveLength(2);
		});

		it("should update listing order after addTurn modifies updated timestamp", async () => {
			const s1 = createSession({ project: "/test/order", title: "Older" });
			await tick();
			const s2 = createSession({ project: "/test/order", title: "Newer" });

			// s2 is most recent. Now add turn to s1, making it most recent.
			await tick();
			await addTurn(s1.meta.id, "/test/order", {
				turnNumber: 1,
				role: "user",
				content: "Updating s1",
			});

			const metas = listSessions("/test/order");
			expect(metas[0].id).toBe(s1.meta.id);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 7. Delete Flow
	// ═══════════════════════════════════════════════════════════════════════

	describe("Delete flow", () => {
		it("should delete a session and remove it from listing", () => {
			const session = createSession({ project: "/test/delete", title: "To Delete" });

			expect(listSessions("/test/delete")).toHaveLength(1);

			deleteSession(session.meta.id, "/test/delete");

			expect(listSessions("/test/delete")).toHaveLength(0);
		});

		it("should throw SessionError when loading a deleted session", () => {
			const session = createSession({ project: "/test/delete-load", title: "Delete Me" });
			deleteSession(session.meta.id, "/test/delete-load");

			expect(() => loadSession(session.meta.id, "/test/delete-load")).toThrow(SessionError);
		});

		it("should throw SessionError when deleting a non-existent session", () => {
			expect(() => deleteSession("s-nonexistent", "/test/delete-missing")).toThrow(SessionError);
		});

		it("should not affect other sessions in the same project", () => {
			const s1 = createSession({ project: "/test/delete-partial", title: "Keep" });
			const s2 = createSession({ project: "/test/delete-partial", title: "Remove" });

			deleteSession(s2.meta.id, "/test/delete-partial");

			const remaining = listSessions("/test/delete-partial");
			expect(remaining).toHaveLength(1);
			expect(remaining[0].id).toBe(s1.meta.id);

			// s1 should still be loadable
			const loaded = loadSession(s1.meta.id, "/test/delete-partial");
			expect(loaded.meta.title).toBe("Keep");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 8. Markdown Roundtrip Fidelity
	// ═══════════════════════════════════════════════════════════════════════

	describe("Markdown roundtrip fidelity", () => {
		it("should preserve title with special characters", () => {
			const session = createSession({
				project: "/test/special",
				title: 'Debug "session" with <html> & quotes',
			});

			const loaded = loadSession(session.meta.id, "/test/special");
			// The title should roundtrip (quotes are escaped in YAML)
			expect(loaded.meta.title).toContain("Debug");
			expect(loaded.meta.title).toContain("session");
		});

		it("should preserve multi-line content in turns", async () => {
			const session = createSession({ project: "/test/multiline", title: "Multiline" });

			const multiLineContent = [
				"Here is some code:",
				"",
				"```typescript",
				"function hello() {",
				'  console.log("hello");',
				"}",
				"```",
				"",
				"And some explanation after.",
			].join("\n");

			await addTurn(session.meta.id, "/test/multiline", {
				turnNumber: 1,
				role: "user",
				content: multiLineContent,
			});

			const loaded = loadSession(session.meta.id, "/test/multiline");
			expect(loaded.turns[0].content).toContain("function hello()");
			expect(loaded.turns[0].content).toContain('console.log("hello")');
		});

		it("should preserve tags through roundtrip", () => {
			const session = createSession({
				project: "/test/tags",
				title: "Tagged Session",
				tags: ["debug", "typescript", "e2e-test"],
			});

			const loaded = loadSession(session.meta.id, "/test/tags");
			expect(loaded.meta.tags).toEqual(["debug", "typescript", "e2e-test"]);
		});

		it("should handle empty tags array", () => {
			const session = createSession({
				project: "/test/empty-tags",
				title: "No Tags",
				tags: [],
			});

			const loaded = loadSession(session.meta.id, "/test/empty-tags");
			expect(loaded.meta.tags).toEqual([]);
		});

		it("should preserve session with zero turns through roundtrip", () => {
			const session = createSession({
				project: "/test/empty-turns",
				title: "Empty Session",
			});

			const loaded = loadSession(session.meta.id, "/test/empty-turns");
			expect(loaded.turns).toEqual([]);
			expect(loaded.meta.title).toBe("Empty Session");
		});

		it("should handle content with markdown heading-like lines", async () => {
			const session = createSession({ project: "/test/headings", title: "Headings" });

			await addTurn(session.meta.id, "/test/headings", {
				turnNumber: 1,
				role: "user",
				content: "# This looks like a heading\n\n## And this too\n\nBut they are just content.",
			});

			const loaded = loadSession(session.meta.id, "/test/headings");
			expect(loaded.turns[0].content).toContain("# This looks like a heading");
		});

		it("should preserve content with YAML-like frontmatter inside turns", async () => {
			const session = createSession({
				project: "/test/yaml-content",
				title: "YAML Content",
			});

			const yamlContent = "Here is some YAML:\n---\nkey: value\nlist:\n  - item1\n---\nEnd.";

			await addTurn(session.meta.id, "/test/yaml-content", {
				turnNumber: 1,
				role: "user",
				content: yamlContent,
			});

			const loaded = loadSession(session.meta.id, "/test/yaml-content");
			expect(loaded.turns[0].content).toContain("key: value");
		});
	});
});
