import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SandboxConfig } from "@chitragupta/yantra";

// ─── Hoisted mocks (created before module loading) ───────────────────────────

const { mockExec, mockSpawnSync, mockMkdirSync, mockExistsSync, mockRmSync, mockRandomUUID } = vi.hoisted(() => ({
	mockExec: vi.fn(),
	mockSpawnSync: vi.fn(() => ({ status: 0 })),
	mockMkdirSync: vi.fn(),
	mockExistsSync: vi.fn(() => true),
	mockRmSync: vi.fn(),
	mockRandomUUID: vi.fn(() => "abcd1234-5678-9abc-def0-123456789abc"),
}));

vi.mock("node:child_process", () => ({
	exec: mockExec,
	spawnSync: mockSpawnSync,
}));

vi.mock("node:fs", () => ({
	default: {
		mkdirSync: mockMkdirSync,
		existsSync: mockExistsSync,
		rmSync: mockRmSync,
	},
}));

vi.mock("node:crypto", () => ({
	randomUUID: mockRandomUUID,
}));

// Import AFTER mocks are defined
import { Sandbox } from "@chitragupta/yantra";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockExecSuccess(stdout = "", stderr = "") {
	mockExec.mockImplementation((_cmd: unknown, _opts: unknown, cb: unknown) => {
		(cb as Function)(null, stdout, stderr);
		return {} as any;
	});
}

function mockExecSequence(results: Array<{ stdout?: string; stderr?: string; error?: Error }>) {
	let callIndex = 0;
	mockExec.mockImplementation((_cmd: unknown, _opts: unknown, cb: unknown) => {
		const r = results[callIndex] ?? results[results.length - 1];
		callIndex++;
		if (r.error) {
			const enriched = Object.assign(r.error, { stdout: r.stdout ?? "", stderr: r.stderr ?? "" });
			(cb as Function)(enriched, r.stdout ?? "", r.stderr ?? "");
		} else {
			(cb as Function)(null, r.stdout ?? "", r.stderr ?? "");
		}
		return {} as any;
	});
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Sandbox (Kshetra)", () => {
	beforeEach(() => {
		mockExec.mockReset();
		mockSpawnSync.mockReset().mockReturnValue({ status: 0 } as any);
		mockMkdirSync.mockClear();
		mockExistsSync.mockReset().mockReturnValue(true);
		mockRmSync.mockClear();
		mockRandomUUID.mockReset().mockReturnValue("abcd1234-5678-9abc-def0-123456789abc");
	});

	// ─── Constructor ───────────────────────────────────────────────────

	describe("constructor", () => {
		it("should use default config values", () => {
			const sb = new Sandbox("/repo");
			expect(sb).toBeDefined();
			expect(sb.list()).toEqual([]);
		});

		it("should accept custom config", () => {
			const config: SandboxConfig = {
				baseDir: "/custom/dir",
				autoCleanup: false,
				maxSandboxes: 10,
				defaultTimeout: 30_000,
			};
			const sb = new Sandbox("/repo", config);
			expect(sb).toBeDefined();
		});
	});

	// ─── create() ─────────────────────────────────────────────────────

	describe("create()", () => {
		it("should create a sandbox worktree", async () => {
			mockExecSuccess();
			const sb = new Sandbox("/repo");
			const info = await sb.create();

			expect(info.id).toBe("abcd1234");
			expect(info.branch).toBe("sandbox/abcd1234");
			expect(info.active).toBe(true);
			expect(info.createdAt).toBeGreaterThan(0);
			expect(info.path).toContain("abcd1234");
			expect(mockMkdirSync).toHaveBeenCalled();
		});

		it("should use custom branch name when provided", async () => {
			mockExecSuccess();
			const sb = new Sandbox("/repo");
			const info = await sb.create("feature/my-branch");

			expect(info.branch).toBe("feature/my-branch");
		});

		it("should throw when not a git repo", async () => {
			mockSpawnSync.mockReturnValue({ status: 1 } as any);
			const sb = new Sandbox("/not-a-repo");

			await expect(sb.create()).rejects.toThrow("Not a git repository");
		});

		it("should throw when max sandboxes reached", async () => {
			mockExecSuccess();
			const sb = new Sandbox("/repo", { maxSandboxes: 1 });
			await sb.create();

			await expect(sb.create()).rejects.toThrow("Maximum sandbox limit reached");
		});

		it("should track created sandbox in list()", async () => {
			mockExecSuccess();
			const sb = new Sandbox("/repo");
			const info = await sb.create();

			expect(sb.list()).toHaveLength(1);
			expect(sb.list()[0].id).toBe(info.id);
		});
	});

	// ─── exec() ───────────────────────────────────────────────────────

	describe("exec()", () => {
		it("should execute command in sandbox working directory", async () => {
			mockExecSuccess("create output");
			const sb = new Sandbox("/repo");
			const info = await sb.create();

			mockExecSuccess("npm test passed");
			const result = await sb.exec(info.id, "npm test");
			expect(result).toBe("npm test passed");
		});

		it("should throw for unknown sandbox id", async () => {
			const sb = new Sandbox("/repo");
			await expect(sb.exec("unknown-id", "ls")).rejects.toThrow("Sandbox not found");
		});

		it("should throw for inactive sandbox", async () => {
			mockExecSuccess();
			const sb = new Sandbox("/repo");
			const info = await sb.create();

			// Destroy removes it from the map entirely
			await sb.destroy(info.id);

			await expect(sb.exec(info.id, "ls")).rejects.toThrow("Sandbox not found");
		});
	});

	// ─── commit() ─────────────────────────────────────────────────────

	describe("commit()", () => {
		it("should stage and commit changes, returning hash", async () => {
			mockExecSuccess();
			const sb = new Sandbox("/repo");
			const info = await sb.create();

			// git add -> git commit -> git rev-parse
			mockExecSequence([
				{ stdout: "" },
				{ stdout: "" },
				{ stdout: "abc123def456\n" },
			]);

			const hash = await sb.commit(info.id, "test commit");
			expect(hash).toBe("abc123def456");
		});

		it("should throw for unknown sandbox", async () => {
			const sb = new Sandbox("/repo");
			await expect(sb.commit("nope", "msg")).rejects.toThrow("Sandbox not found");
		});
	});

	// ─── merge() ──────────────────────────────────────────────────────

	describe("merge()", () => {
		it("should return success:true on clean merge", async () => {
			mockExecSuccess();
			const sb = new Sandbox("/repo");
			const info = await sb.create();

			mockExecSuccess();
			const result = await sb.merge(info.id);

			expect(result.success).toBe(true);
			expect(result.conflicts).toEqual([]);
		});

		it("should return conflicts on failed merge and abort", async () => {
			mockExecSuccess();
			const sb = new Sandbox("/repo");
			const info = await sb.create();

			mockExecSequence([
				{
					error: new Error("merge failed"),
					stderr: "CONFLICT (content): Merge conflict in src/main.ts\nCONFLICT (content): Merge conflict in src/utils.ts",
				},
				{ stdout: "" }, // git merge --abort
			]);

			const result = await sb.merge(info.id);
			expect(result.success).toBe(false);
			expect(result.conflicts).toContain("src/main.ts");
			expect(result.conflicts).toContain("src/utils.ts");
		});

		it("should handle merge abort failure gracefully", async () => {
			mockExecSuccess();
			const sb = new Sandbox("/repo");
			const info = await sb.create();

			mockExecSequence([
				{ error: new Error("conflict"), stderr: "" },
				{ error: new Error("abort failed") },
			]);

			const result = await sb.merge(info.id);
			expect(result.success).toBe(false);
			expect(result.conflicts).toEqual([]);
		});
	});

	// ─── destroy() ────────────────────────────────────────────────────

	describe("destroy()", () => {
		it("should remove worktree and delete branch", async () => {
			mockExecSuccess();
			const sb = new Sandbox("/repo");
			const info = await sb.create();

			mockExecSuccess();
			await sb.destroy(info.id);

			expect(sb.list()).toHaveLength(0);
		});

		it("should throw for unknown sandbox", async () => {
			const sb = new Sandbox("/repo");
			await expect(sb.destroy("nope")).rejects.toThrow("Sandbox not found");
		});

		it("should fallback to rmSync when worktree removal fails with autoCleanup", async () => {
			mockExecSuccess();
			const sb = new Sandbox("/repo", { autoCleanup: true });
			const info = await sb.create();

			mockRmSync.mockClear();
			mockExecSequence([
				{ error: new Error("worktree remove failed") },
				{ stdout: "" },
				{ stdout: "" },
			]);

			await sb.destroy(info.id);
			expect(mockRmSync).toHaveBeenCalled();
		});

		it("should not rmSync when autoCleanup is false", async () => {
			mockExecSuccess();
			const sb = new Sandbox("/repo", { autoCleanup: false });
			const info = await sb.create();

			mockRmSync.mockClear();
			mockExecSequence([
				{ error: new Error("worktree remove failed") },
				{ stdout: "" },
				{ stdout: "" },
			]);

			await sb.destroy(info.id);
			expect(mockRmSync).not.toHaveBeenCalled();
		});
	});

	// ─── list() ───────────────────────────────────────────────────────

	describe("list()", () => {
		it("should return empty array initially", () => {
			const sb = new Sandbox("/repo");
			expect(sb.list()).toEqual([]);
		});

		it("should list all sandboxes", async () => {
			mockExecSuccess();
			const sb = new Sandbox("/repo", { maxSandboxes: 5 });
			await sb.create();
			mockRandomUUID.mockReturnValueOnce("bbbb2222-3333-4444-5555-666677778888");
			await sb.create();

			expect(sb.list()).toHaveLength(2);
		});
	});

	// ─── destroyAll() ─────────────────────────────────────────────────

	describe("destroyAll()", () => {
		it("should destroy all sandboxes", async () => {
			mockExecSuccess();
			const sb = new Sandbox("/repo", { maxSandboxes: 5 });
			await sb.create();
			mockRandomUUID.mockReturnValueOnce("cccc3333-4444-5555-6666-777788889999");
			await sb.create();

			expect(sb.list()).toHaveLength(2);

			mockExecSuccess();
			await sb.destroyAll();
			expect(sb.list()).toHaveLength(0);
		});

		it("should be no-op when no sandboxes exist", async () => {
			const sb = new Sandbox("/repo");
			await sb.destroyAll();
			expect(sb.list()).toEqual([]);
		});
	});

	// ─── Edge cases ───────────────────────────────────────────────────

	describe("edge cases", () => {
		it("should handle exec after exec on same sandbox", async () => {
			mockExecSuccess();
			const sb = new Sandbox("/repo");
			const info = await sb.create();

			mockExecSuccess("first");
			const r1 = await sb.exec(info.id, "echo first");
			mockExecSuccess("second");
			const r2 = await sb.exec(info.id, "echo second");

			expect(r1).toBe("first");
			expect(r2).toBe("second");
		});

		it("should reject operations after destroy", async () => {
			mockExecSuccess();
			const sb = new Sandbox("/repo");
			const info = await sb.create();

			await sb.destroy(info.id);

			await expect(sb.exec(info.id, "ls")).rejects.toThrow();
			await expect(sb.commit(info.id, "msg")).rejects.toThrow();
		});
	});
});
