import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DaemonManager, type HealthEvent, type SkillSyncEvent, type SamitiBroadcaster } from "../src/daemon-manager.js";

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Mock the ChitraguptaDaemon to avoid real consolidation
vi.mock("../src/chitragupta-daemon.js", () => {
	const { EventEmitter } = require("node:events");

	class MockDaemon extends EventEmitter {
		running = false;
		touchCalled = false;
		shouldFailStart = false;

		async start() {
			if (this.shouldFailStart) throw new Error("Daemon start failed");
			this.running = true;
			this.emit("started");
		}

		async stop() {
			this.running = false;
			this.emit("stopped");
		}

		touch() {
			this.touchCalled = true;
		}

		getState() {
			return {
				running: this.running,
				nidraState: "LISTENING" as const,
				lastConsolidation: null,
				lastBackfill: null,
				consolidatedDates: [],
				uptime: 0,
			};
		}
	}

	return { ChitraguptaDaemon: MockDaemon };
});

// Mock vidhya-skills to avoid real skill discovery
vi.mock("@chitragupta/vidhya-skills", () => ({
	SkillDiscovery: class {
		async discoverFromDirectory(_path: string) {
			return [
				{
					name: "test-skill",
					version: "1.0.0",
					description: "A test skill",
					capabilities: [{ verb: "read", object: "files", description: "Read" }],
					tags: ["test"],
					source: { type: "manual", filePath: "/test/SKILL.md" },
					updatedAt: new Date().toISOString(),
				},
			];
		}
	},
	ApprovalQueue: class {
		submissions: any[] = [];
		submit(manifest: any, path: string, opts?: any) {
			const req = { id: `ap-${this.submissions.length}`, manifest, status: "pending", riskLevel: "low", riskFactors: [], ...opts };
			this.submissions.push(req);
			return req;
		}
		autoApproveSafe() {
			return this.submissions
				.filter(s => s.status === "pending" && s.riskLevel === "low" && !(s.validationErrors?.length > 0))
				.map(s => { s.status = "approved"; s.approver = "auto"; return s; });
		}
		get pendingCount() {
			return this.submissions.filter(s => s.status === "pending").length;
		}
	},
	assessRisk: () => ({ level: "low", factors: [] }),
	validateSkill: () => ({ valid: true, errors: [], warnings: [] }),
}));

// Mock core
vi.mock("@chitragupta/core", () => ({
	getChitraguptaHome: () => "/tmp/test-chitragupta",
}));

function createMockSamiti(): SamitiBroadcaster & { calls: Array<{ channel: string; message: any }> } {
	const calls: Array<{ channel: string; message: any }> = [];
	return {
		calls,
		broadcast(channel: string, message: any) {
			calls.push({ channel, message });
		},
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("DaemonManager", () => {
	let manager: DaemonManager;

	afterEach(async () => {
		if (manager) {
			await manager.stop();
		}
	});

	describe("lifecycle", () => {
		it("should start and report healthy", async () => {
			manager = new DaemonManager({ enableSkillSync: false });
			const healthEvents: HealthEvent[] = [];
			manager.on("health", (e: HealthEvent) => healthEvents.push(e));

			await manager.start();

			const state = manager.getState();
			expect(state.health).toBe("healthy");
			expect(state.daemon).not.toBeNull();
			expect(state.daemon?.running).toBe(true);
			expect(healthEvents.some(e => e.to === "healthy")).toBe(true);
		});

		it("should stop and report stopped", async () => {
			manager = new DaemonManager({ enableSkillSync: false });
			await manager.start();

			const healthEvents: HealthEvent[] = [];
			manager.on("health", (e: HealthEvent) => healthEvents.push(e));

			await manager.stop();

			const state = manager.getState();
			expect(state.health).toBe("stopped");
			expect(healthEvents.some(e => e.to === "stopped")).toBe(true);
		});

		it("should be idempotent on double start", async () => {
			manager = new DaemonManager({ enableSkillSync: false });
			await manager.start();
			await manager.start(); // No-op
			expect(manager.getState().health).toBe("healthy");
		});

		it("should be idempotent on double stop", async () => {
			manager = new DaemonManager({ enableSkillSync: false });
			await manager.start();
			await manager.stop();
			await manager.stop(); // No-op
			expect(manager.getState().health).toBe("stopped");
		});
	});

	describe("touch passthrough", () => {
		it("should forward touch() to daemon", async () => {
			manager = new DaemonManager({ enableSkillSync: false });
			await manager.start();
			manager.touch();
			// No error thrown — touch is fire-and-forget
		});

		it("should handle touch when daemon is null", () => {
			manager = new DaemonManager({ enableSkillSync: false });
			// Not started — daemon is null
			expect(() => manager.touch()).not.toThrow();
		});
	});

	describe("error tracking", () => {
		it("should track errors and emit them", async () => {
			manager = new DaemonManager({ enableSkillSync: false, errorBudget: 3, errorWindowMs: 10_000 });
			await manager.start();

			const errors: Error[] = [];
			manager.on("error", (e: Error) => errors.push(e));

			// Simulate consolidation errors from daemon
			(manager as any).recordError("test error 1");
			(manager as any).recordError("test error 2");

			expect(errors).toHaveLength(2);
			expect(manager.getState().errorsInWindow).toBe(2);
		});

		it("should mark as degraded when error budget is exhausted", async () => {
			manager = new DaemonManager({ enableSkillSync: false, errorBudget: 2, errorWindowMs: 10_000 });
			await manager.start();

			const healthEvents: HealthEvent[] = [];
			manager.on("health", (e: HealthEvent) => healthEvents.push(e));
			manager.on("error", () => {}); // Prevent unhandled error throw

			(manager as any).recordError("err 1");
			(manager as any).recordError("err 2"); // Exceeds budget

			expect(manager.getState().health).toBe("degraded");
			expect(healthEvents.some(e => e.to === "degraded")).toBe(true);
		});

		it("should not count errors outside the window", async () => {
			manager = new DaemonManager({ enableSkillSync: false, errorBudget: 3, errorWindowMs: 100 });
			await manager.start();
			manager.on("error", () => {}); // Prevent unhandled error throw

			(manager as any).recordError("old error");

			// Wait for window to expire
			await new Promise(r => setTimeout(r, 150));

			expect(manager.getState().errorsInWindow).toBe(0);
		});
	});

	describe("Samiti broadcasting", () => {
		it("should broadcast health changes to #daemon channel", async () => {
			const samiti = createMockSamiti();
			manager = new DaemonManager({ enableSkillSync: false });
			manager.setSamiti(samiti);

			await manager.start();

			const daemonBroadcasts = samiti.calls.filter(c => c.channel === "#daemon");
			expect(daemonBroadcasts.length).toBeGreaterThanOrEqual(1);
			expect(daemonBroadcasts[0].message.category).toContain("daemon-");
		});

		it("should send critical severity for crashed state", async () => {
			const samiti = createMockSamiti();
			manager = new DaemonManager({
				enableSkillSync: false,
				errorBudget: 1,
				errorWindowMs: 10_000,
				maxRestartAttempts: 0,
			});
			manager.setSamiti(samiti);

			await manager.start();

			// Force a crash
			(manager as any).setHealth("crashed", "Test crash");

			const crashBroadcasts = samiti.calls.filter(
				c => c.channel === "#daemon" && c.message.severity === "critical",
			);
			expect(crashBroadcasts.length).toBeGreaterThanOrEqual(1);
		});

		it("should not throw when Samiti is not set", async () => {
			manager = new DaemonManager({ enableSkillSync: false });
			await manager.start();
			// No Samiti set — should not throw
			expect(manager.getState().health).toBe("healthy");
		});
	});

	describe("state snapshot", () => {
		it("should return complete state", async () => {
			manager = new DaemonManager({ enableSkillSync: false });
			await manager.start();

			const state = manager.getState();
			expect(state.health).toBe("healthy");
			expect(state.daemon).not.toBeNull();
			expect(state.restartCount).toBe(0);
			expect(state.errorsInWindow).toBe(0);
			expect(state.lastHealthChange).toBeTruthy();
			expect(state.pendingApprovalCount).toBe(0);
		});

		it("should return null daemon when stopped", () => {
			manager = new DaemonManager({ enableSkillSync: false });
			const state = manager.getState();
			expect(state.health).toBe("stopped");
			expect(state.daemon).toBeNull();
		});
	});

	describe("skill sync", () => {
		it("should emit skill-sync events during scan", async () => {
			manager = new DaemonManager({
				enableSkillSync: true,
				skillScanPaths: ["/test/skills"],
				skillScanIntervalMs: 600_000,
			});

			const syncEvents: SkillSyncEvent[] = [];
			manager.on("skill-sync", (e: SkillSyncEvent) => syncEvents.push(e));

			await manager.start();

			// Manually trigger scan (don't wait for timer)
			await manager.scanSkillsNow();

			expect(syncEvents.some(e => e.type === "scan-start")).toBe(true);
			expect(syncEvents.some(e => e.type === "scan-complete")).toBe(true);
		});

		it("should discover and auto-approve safe skills", async () => {
			manager = new DaemonManager({
				enableSkillSync: true,
				skillScanPaths: ["/test/skills"],
				autoApproveSafe: true,
				skillScanIntervalMs: 600_000,
			});

			const syncEvents: SkillSyncEvent[] = [];
			manager.on("skill-sync", (e: SkillSyncEvent) => syncEvents.push(e));

			await manager.start();
			await manager.scanSkillsNow();

			const approved = syncEvents.filter(e => e.type === "skill-auto-approved");
			expect(approved.length).toBeGreaterThanOrEqual(1);
			expect(approved[0].detail).toContain("test-skill");
		});

		it("should broadcast pending approvals to Samiti #alerts", async () => {
			// Mock the queue to have pending items
			vi.doMock("@chitragupta/vidhya-skills", () => ({
				SkillDiscovery: class {
					async discoverFromDirectory() {
						return [{
							name: "risky-skill",
							version: "1.0.0",
							description: "Risky",
							capabilities: [{ verb: "execute", object: "shell", description: "Execute" }],
							tags: [],
							source: { type: "manual", filePath: "/r/SKILL.md" },
							updatedAt: new Date().toISOString(),
						}];
					}
				},
				ApprovalQueue: class {
					submissions: any[] = [];
					submit(manifest: any, path: string) {
						const req = { id: "ap-0", manifest, status: "pending", riskLevel: "high", riskFactors: ["dangerous"] };
						this.submissions.push(req);
						return req;
					}
					autoApproveSafe() { return []; }
					get pendingCount() { return 1; }
				},
				assessRisk: () => ({ level: "high", factors: ["dangerous"] }),
				validateSkill: () => ({ valid: true, errors: [], warnings: [] }),
			}));

			const samiti = createMockSamiti();
			manager = new DaemonManager({
				enableSkillSync: true,
				skillScanPaths: ["/test/skills"],
				skillScanIntervalMs: 600_000,
			});
			manager.setSamiti(samiti);

			await manager.start();
			await manager.scanSkillsNow();

			const alerts = samiti.calls.filter(c => c.channel === "#alerts");
			expect(alerts.some(a => a.message.category === "skill-pending")).toBe(true);
		});

		it("should not scan when not running", async () => {
			manager = new DaemonManager({
				enableSkillSync: true,
				skillScanPaths: ["/test/skills"],
			});

			const syncEvents: SkillSyncEvent[] = [];
			manager.on("skill-sync", (e: SkillSyncEvent) => syncEvents.push(e));

			// Not started — should be a no-op
			await manager.scanSkillsNow();
			expect(syncEvents).toHaveLength(0);
		});

		it("should handle scan errors gracefully", async () => {
			// Override to throw
			vi.doMock("@chitragupta/vidhya-skills", () => {
				throw new Error("Module not found");
			});

			manager = new DaemonManager({
				enableSkillSync: true,
				skillScanPaths: ["/test/skills"],
				skillScanIntervalMs: 600_000,
			});

			await manager.start();

			const syncEvents: SkillSyncEvent[] = [];
			manager.on("skill-sync", (e: SkillSyncEvent) => syncEvents.push(e));

			await manager.scanSkillsNow();

			expect(syncEvents.some(e => e.type === "scan-error")).toBe(true);
		});
	});

	describe("configuration", () => {
		it("should use default config values", () => {
			manager = new DaemonManager();
			const config = (manager as any).config;
			expect(config.errorBudget).toBe(5);
			expect(config.errorWindowMs).toBe(60_000);
			expect(config.initialRestartDelayMs).toBe(1_000);
			expect(config.maxRestartDelayMs).toBe(60_000);
			expect(config.maxRestartAttempts).toBe(10);
			expect(config.skillScanIntervalMs).toBe(300_000);
			expect(config.enableSkillSync).toBe(true);
			expect(config.autoApproveSafe).toBe(true);
		});

		it("should merge custom config over defaults", () => {
			manager = new DaemonManager({
				errorBudget: 10,
				skillScanIntervalMs: 600_000,
			});
			const config = (manager as any).config;
			expect(config.errorBudget).toBe(10);
			expect(config.skillScanIntervalMs).toBe(600_000);
			// Defaults still present
			expect(config.maxRestartAttempts).toBe(10);
		});
	});
});
