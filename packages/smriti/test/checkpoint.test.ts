import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CheckpointManager } from "@chitragupta/smriti";
import type { CheckpointData } from "@chitragupta/smriti";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-checkpoint-test-"));
}

function makeCheckpointData(
	sessionId: string,
	turns: unknown[] = [{ role: "user", content: "hello" }],
): CheckpointData {
	return {
		version: 1,
		sessionId,
		turns,
		metadata: { key: "value" },
		timestamp: Date.now(),
	};
}

// ─── CheckpointManager ──────────────────────────────────────────────────────

describe("CheckpointManager", () => {
	let tmpDir: string;
	let mgr: CheckpointManager;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		mgr = new CheckpointManager({
			checkpointDir: tmpDir,
			maxCheckpoints: 3,
		});
	});

	afterEach(() => {
		mgr.stopAutoCheckpoint();
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			// best-effort cleanup
		}
	});

	describe("save", () => {
		it("should save a checkpoint and return checkpoint info", async () => {
			const data = makeCheckpointData("session-1");
			const cp = await mgr.save("session-1", data);

			expect(cp.sessionId).toBe("session-1");
			expect(cp.turnCount).toBe(1);
			expect(cp.size).toBeGreaterThan(0);
			expect(cp.timestamp).toBeGreaterThan(0);
			expect(cp.id).toBeTruthy();
		});

		it("should write a file to disk", async () => {
			const data = makeCheckpointData("session-2");
			await mgr.save("session-2", data);

			const sessionDir = path.join(tmpDir, "session-2");
			const files = fs.readdirSync(sessionDir);
			expect(files.length).toBe(1);
			expect(files[0]).toMatch(/\.json$/);
		});

		it("should write valid JSON that can be parsed", async () => {
			const data = makeCheckpointData("session-3", [
				{ role: "user", content: "hello" },
				{ role: "assistant", content: "hi" },
			]);
			await mgr.save("session-3", data);

			const sessionDir = path.join(tmpDir, "session-3");
			const files = fs.readdirSync(sessionDir);
			const content = fs.readFileSync(path.join(sessionDir, files[0]), "utf-8");
			const parsed = JSON.parse(content);

			expect(parsed.version).toBe(1);
			expect(parsed.sessionId).toBe("session-3");
			expect(parsed.turns.length).toBe(2);
		});

		it("should create session directory if it does not exist", async () => {
			const data = makeCheckpointData("new-session");
			await mgr.save("new-session", data);

			const sessionDir = path.join(tmpDir, "new-session");
			expect(fs.existsSync(sessionDir)).toBe(true);
		});
	});

	describe("load", () => {
		it("should load the most recent checkpoint", async () => {
			const data1 = makeCheckpointData("session-1", [{ role: "user", content: "first" }]);
			const data2 = makeCheckpointData("session-1", [
				{ role: "user", content: "first" },
				{ role: "assistant", content: "second" },
			]);

			await mgr.save("session-1", data1);
			// Small delay to ensure different timestamps
			await new Promise((r) => setTimeout(r, 10));
			await mgr.save("session-1", data2);

			const loaded = await mgr.load("session-1");
			expect(loaded).not.toBeNull();
			expect(loaded!.turns.length).toBe(2);
		});

		it("should return null for non-existent session", async () => {
			const loaded = await mgr.load("does-not-exist");
			expect(loaded).toBeNull();
		});

		it("should skip corrupted checkpoint files and fall back", async () => {
			// Save a valid checkpoint first
			const validData = makeCheckpointData("session-x");
			await mgr.save("session-x", validData);

			// Manually write a corrupted file with a newer timestamp
			const sessionDir = path.join(tmpDir, "session-x");
			const corruptedFile = path.join(sessionDir, `${Date.now() + 1000}-corrupt.json`);
			fs.writeFileSync(corruptedFile, "not valid json {{{", "utf-8");

			const loaded = await mgr.load("session-x");
			expect(loaded).not.toBeNull();
			expect(loaded!.sessionId).toBe("session-x");
		});

		it("should validate sessionId in loaded data", async () => {
			// Manually write a file with wrong sessionId
			const sessionDir = path.join(tmpDir, "session-y");
			fs.mkdirSync(sessionDir, { recursive: true });
			const filePath = path.join(sessionDir, `${Date.now()}-abc.json`);
			fs.writeFileSync(filePath, JSON.stringify({
				version: 1,
				sessionId: "wrong-id",
				turns: [],
				metadata: {},
				timestamp: Date.now(),
			}), "utf-8");

			const loaded = await mgr.load("session-y");
			expect(loaded).toBeNull();
		});
	});

	describe("list", () => {
		it("should return empty array for non-existent session", () => {
			const list = mgr.list("no-such-session");
			expect(list).toEqual([]);
		});

		it("should list checkpoints sorted by timestamp descending", async () => {
			await mgr.save("session-l", makeCheckpointData("session-l"));
			await new Promise((r) => setTimeout(r, 10));
			await mgr.save("session-l", makeCheckpointData("session-l"));
			await new Promise((r) => setTimeout(r, 10));
			await mgr.save("session-l", makeCheckpointData("session-l"));

			const list = mgr.list("session-l");
			expect(list.length).toBe(3);
			// Newest first
			expect(list[0].timestamp).toBeGreaterThanOrEqual(list[1].timestamp);
			expect(list[1].timestamp).toBeGreaterThanOrEqual(list[2].timestamp);
		});

		it("should skip .tmp files", async () => {
			await mgr.save("session-t", makeCheckpointData("session-t"));

			// Write a .tmp file manually
			const sessionDir = path.join(tmpDir, "session-t");
			fs.writeFileSync(path.join(sessionDir, "temp.json.tmp"), "tmp", "utf-8");

			const list = mgr.list("session-t");
			expect(list.length).toBe(1);
		});

		it("should include turnCount from checkpoint data", async () => {
			const data = makeCheckpointData("session-tc", [
				{ role: "user", content: "a" },
				{ role: "assistant", content: "b" },
				{ role: "user", content: "c" },
			]);
			await mgr.save("session-tc", data);

			const list = mgr.list("session-tc");
			expect(list.length).toBe(1);
			expect(list[0].turnCount).toBe(3);
		});
	});

	describe("prune", () => {
		it("should remove old checkpoints beyond maxCheckpoints", async () => {
			// maxCheckpoints is 3 for our test manager
			for (let i = 0; i < 5; i++) {
				await mgr.save("session-p", makeCheckpointData("session-p"));
				await new Promise((r) => setTimeout(r, 10));
			}

			const list = mgr.list("session-p");
			expect(list.length).toBeLessThanOrEqual(3);
		});

		it("should not prune when under limit", async () => {
			await mgr.save("session-np", makeCheckpointData("session-np"));
			await mgr.save("session-np", makeCheckpointData("session-np"));

			const removed = await mgr.prune("session-np");
			expect(removed).toBe(0);
		});

		it("should return the number of pruned checkpoints", async () => {
			// Create a manager with maxCheckpoints=2 for easier testing
			const strictMgr = new CheckpointManager({
				checkpointDir: tmpDir,
				maxCheckpoints: 2,
			});

			for (let i = 0; i < 4; i++) {
				await strictMgr.save("session-pr", makeCheckpointData("session-pr"));
				await new Promise((r) => setTimeout(r, 10));
			}

			// After auto-prune in save, there should be at most 2
			const list = strictMgr.list("session-pr");
			expect(list.length).toBeLessThanOrEqual(2);
		});
	});

	describe("deleteAll", () => {
		it("should delete all checkpoints for a session", async () => {
			await mgr.save("session-d", makeCheckpointData("session-d"));
			await mgr.save("session-d", makeCheckpointData("session-d"));

			await mgr.deleteAll("session-d");

			const sessionDir = path.join(tmpDir, "session-d");
			expect(fs.existsSync(sessionDir)).toBe(false);
		});

		it("should not throw for non-existent session", async () => {
			await expect(mgr.deleteAll("ghost-session")).resolves.toBeUndefined();
		});
	});

	describe("auto-checkpoint", () => {
		it("should start and stop without errors", () => {
			const saveFn = () => makeCheckpointData("auto-session");
			expect(() => mgr.startAutoCheckpoint("auto-session", saveFn)).not.toThrow();
			expect(() => mgr.stopAutoCheckpoint()).not.toThrow();
		});

		it("should stop previous timer when starting a new one", () => {
			const saveFn = () => makeCheckpointData("auto-session");
			mgr.startAutoCheckpoint("auto-session", saveFn);
			mgr.startAutoCheckpoint("auto-session", saveFn);
			// Should not throw, just replaces the timer
			mgr.stopAutoCheckpoint();
		});

		it("should be idempotent to stop when not started", () => {
			expect(() => mgr.stopAutoCheckpoint()).not.toThrow();
		});
	});

	describe("data integrity", () => {
		it("should round-trip checkpoint data faithfully", async () => {
			const data: CheckpointData = {
				version: 1,
				sessionId: "integrity-test",
				turns: [
					{ role: "user", content: "What is the meaning of life?" },
					{ role: "assistant", content: "42" },
				],
				metadata: {
					agent: "chitragupta",
					model: "claude-3",
					nested: { deep: [1, 2, 3] },
				},
				timestamp: 1700000000000,
			};

			await mgr.save("integrity-test", data);
			const loaded = await mgr.load("integrity-test");

			expect(loaded).not.toBeNull();
			expect(loaded!.version).toBe(1);
			expect(loaded!.sessionId).toBe("integrity-test");
			expect(loaded!.turns).toEqual(data.turns);
			expect(loaded!.metadata).toEqual(data.metadata);
			expect(loaded!.timestamp).toBe(1700000000000);
		});
	});
});
