import { describe, it, expect } from "vitest";
import { ProcessPool } from "@chitragupta/swara";

describe("ProcessPool", () => {
	describe("constructor", () => {
		it("creates pool with default maxConcurrency=5 and defaultTimeout=30000", () => {
			const pool = new ProcessPool();
			// Defaults are internal, but we verify the pool works and getStats returns zeros
			const stats = pool.getStats();
			expect(stats.active).toBe(0);
			expect(stats.queued).toBe(0);
			expect(stats.completed).toBe(0);
			expect(stats.failed).toBe(0);
		});
	});

	describe("execute", () => {
		it("returns ProcessResult with stdout and exitCode 0 for echo", async () => {
			const pool = new ProcessPool();
			const result = await pool.execute("echo", ["hello"]);
			expect(result.stdout).toBe("hello\n");
			expect(result.exitCode).toBe(0);
			expect(result.killed).toBe(false);
			expect(result.duration).toBeGreaterThanOrEqual(0);
			expect(result.stderr).toBe("");
		});

		it("returns non-zero exitCode for a failing command", async () => {
			const pool = new ProcessPool();
			const result = await pool.execute("node", ["-e", "process.exit(1)"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.killed).toBe(false);
		});

		it("pipes stdin data into child process", async () => {
			const pool = new ProcessPool();
			const result = await pool.execute(
				"node",
				["-e", "process.stdin.on('data', d => process.stdout.write(d))"],
				{ stdin: "piped-input" },
			);
			expect(result.stdout).toBe("piped-input");
			expect(result.exitCode).toBe(0);
		});

		it("kills process on timeout and sets killed=true", async () => {
			const pool = new ProcessPool();
			const result = await pool.execute("sleep", ["10"], { timeout: 100 });
			expect(result.killed).toBe(true);
		});

		it("passes custom env variables to child process", async () => {
			const pool = new ProcessPool();
			const result = await pool.execute(
				"node",
				["-e", "process.stdout.write(process.env.CHITRAGUPTA_TEST_VAR || '')"],
				{ env: { CHITRAGUPTA_TEST_VAR: "vedic_value" } },
			);
			expect(result.stdout).toBe("vedic_value");
			expect(result.exitCode).toBe(0);
		});
	});

	describe("getStats", () => {
		it("initially shows all zeros", () => {
			const pool = new ProcessPool();
			const stats = pool.getStats();
			expect(stats).toEqual({
				active: 0,
				queued: 0,
				completed: 0,
				failed: 0,
			});
		});

		it("increments completed after successful execution", async () => {
			const pool = new ProcessPool();
			await pool.execute("echo", ["done"]);
			const stats = pool.getStats();
			expect(stats.completed).toBe(1);
			expect(stats.failed).toBe(0);
		});

		it("increments failed after a failed execution", async () => {
			const pool = new ProcessPool();
			await pool.execute("node", ["-e", "process.exit(1)"]);
			const stats = pool.getStats();
			expect(stats.failed).toBe(1);
			expect(stats.completed).toBe(0);
		});
	});

	describe("killAll", () => {
		it("terminates active processes", async () => {
			const pool = new ProcessPool();
			const promise = pool.execute("sleep", ["60"]);
			// Give the process a moment to start
			await new Promise<void>((r) => setTimeout(r, 50));
			expect(pool.getStats().active).toBeGreaterThan(0);
			pool.killAll();
			const result = await promise;
			expect(result.exitCode).not.toBe(0);
		});
	});

	describe("drain", () => {
		it("resolves when all processes complete", async () => {
			const pool = new ProcessPool();
			const p1 = pool.execute("echo", ["a"]);
			const p2 = pool.execute("echo", ["b"]);
			await pool.drain();
			const [r1, r2] = await Promise.all([p1, p2]);
			expect(r1.exitCode).toBe(0);
			expect(r2.exitCode).toBe(0);
			expect(pool.getStats().active).toBe(0);
			expect(pool.getStats().queued).toBe(0);
		});
	});

	describe("concurrency", () => {
		it("respects maxConcurrency by queuing excess tasks", async () => {
			const pool = new ProcessPool({ maxConcurrency: 1 });
			// Launch two tasks — second must wait for the first
			const p1 = pool.execute("node", ["-e", "setTimeout(() => {}, 200)"]);
			const p2 = pool.execute("echo", ["second"]);

			// Immediately after launch, at most 1 active (second is queued)
			const stats = pool.getStats();
			expect(stats.active).toBeLessThanOrEqual(1);

			await Promise.all([p1, p2]);
			const final = pool.getStats();
			expect(final.completed).toBe(2);
			expect(final.active).toBe(0);
			expect(final.queued).toBe(0);
		});
	});
});
