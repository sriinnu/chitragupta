import { describe, it, expect, beforeEach } from "vitest";
import {
	HealthChecker,
	MemoryHealthCheck,
	EventLoopHealthCheck,
	DiskHealthCheck,
} from "@chitragupta/core";
import type { HealthCheck, HealthCheckResult, HealthStatus } from "@chitragupta/core";

// ─── Test Health Check ───────────────────────────────────────────────────────

class MockHealthCheck implements HealthCheck {
	name: string;
	private result: HealthCheckResult;

	constructor(name: string, status: HealthStatus, message?: string) {
		this.name = name;
		this.result = { status, message };
	}

	setStatus(status: HealthStatus, message?: string): void {
		this.result = { status, message };
	}

	async check(): Promise<HealthCheckResult> {
		return this.result;
	}
}

class ThrowingHealthCheck implements HealthCheck {
	name = "throwing";
	async check(): Promise<HealthCheckResult> {
		throw new Error("check exploded");
	}
}

describe("Health", () => {
	// ═══════════════════════════════════════════════════════════════════════
	// HealthChecker
	// ═══════════════════════════════════════════════════════════════════════

	describe("HealthChecker", () => {
		it("should return UP with no checks registered", async () => {
			const checker = new HealthChecker();
			const report = await checker.getStatus();
			expect(report.status).toBe("UP");
			expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
			expect(report.version).toBe("0.1.0");
			expect(report.uptime).toBeGreaterThanOrEqual(0);
			expect(Object.keys(report.checks)).toHaveLength(0);
		});

		it("should return UP when all checks pass", async () => {
			const checker = new HealthChecker();
			checker.register(new MockHealthCheck("db", "UP"));
			checker.register(new MockHealthCheck("cache", "UP"));
			const report = await checker.getStatus();
			expect(report.status).toBe("UP");
			expect(Object.keys(report.checks)).toHaveLength(2);
			expect(report.checks.db.status).toBe("UP");
			expect(report.checks.cache.status).toBe("UP");
		});

		it("should return DEGRADED when any check is DEGRADED", async () => {
			const checker = new HealthChecker();
			checker.register(new MockHealthCheck("db", "UP"));
			checker.register(new MockHealthCheck("cache", "DEGRADED", "High latency"));
			const report = await checker.getStatus();
			expect(report.status).toBe("DEGRADED");
		});

		it("should return DOWN when any check is DOWN", async () => {
			const checker = new HealthChecker();
			checker.register(new MockHealthCheck("db", "UP"));
			checker.register(new MockHealthCheck("cache", "DEGRADED"));
			checker.register(new MockHealthCheck("disk", "DOWN", "Full"));
			const report = await checker.getStatus();
			expect(report.status).toBe("DOWN");
		});

		it("should handle throwing checks as DOWN", async () => {
			const checker = new HealthChecker();
			checker.register(new ThrowingHealthCheck());
			const report = await checker.getStatus();
			expect(report.status).toBe("DOWN");
			expect(report.checks.throwing.status).toBe("DOWN");
			expect(report.checks.throwing.message).toContain("check exploded");
		});

		it("should include duration in check results", async () => {
			const checker = new HealthChecker();
			checker.register(new MockHealthCheck("fast", "UP"));
			const report = await checker.getStatus();
			expect(report.checks.fast.duration).toBeDefined();
			expect(report.checks.fast.duration).toBeGreaterThanOrEqual(0);
		});

		it("should use custom version", async () => {
			const checker = new HealthChecker({ version: "1.2.3" });
			const report = await checker.getStatus();
			expect(report.version).toBe("1.2.3");
		});

		it("should report uptime", async () => {
			const checker = new HealthChecker();
			// Wait a tiny bit so uptime > 0
			await new Promise((r) => setTimeout(r, 5));
			const report = await checker.getStatus();
			expect(report.uptime).toBeGreaterThan(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Built-in Checks
	// ═══════════════════════════════════════════════════════════════════════

	describe("MemoryHealthCheck", () => {
		it("should return UP under normal conditions", async () => {
			const check = new MemoryHealthCheck();
			const result = await check.check();
			expect(result.status).toBe("UP");
			expect(result.message).toContain("heap=");
			expect(result.message).toContain("rss=");
		});

		it("should have name 'memory'", () => {
			const check = new MemoryHealthCheck();
			expect(check.name).toBe("memory");
		});
	});

	describe("EventLoopHealthCheck", () => {
		it("should return UP under normal conditions", async () => {
			const check = new EventLoopHealthCheck();
			// Allow a small window for monitoring to collect data
			await new Promise((r) => setTimeout(r, 50));
			const result = await check.check();
			// Should be UP or at least have a message
			expect(["UP", "DEGRADED"]).toContain(result.status);
			expect(result.message).toBeDefined();
			check.dispose();
		});

		it("should have name 'event_loop'", () => {
			const check = new EventLoopHealthCheck();
			expect(check.name).toBe("event_loop");
			check.dispose();
		});
	});

	describe("DiskHealthCheck", () => {
		it("should return UP under normal conditions", async () => {
			const check = new DiskHealthCheck();
			const result = await check.check();
			// On a test machine, disk should generally be fine
			expect(["UP", "DEGRADED"]).toContain(result.status);
			expect(result.message).toContain("used=");
			expect(result.message).toContain("free=");
		});

		it("should have name 'disk'", () => {
			const check = new DiskHealthCheck();
			expect(check.name).toBe("disk");
		});
	});
});
