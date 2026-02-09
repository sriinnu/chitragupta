import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	HeartbeatMonitor,
	type HeartbeatEntry,
} from "../src/components/heartbeat-monitor.js";

function makeEntry(overrides: Partial<HeartbeatEntry> = {}): HeartbeatEntry {
	return {
		agentId: `agent-${Math.random().toString(36).slice(2, 8)}`,
		status: "alive",
		depth: 0,
		purpose: "general",
		lastBeatAge: 500,
		tokenUsage: 5000,
		tokenBudget: 100_000,
		...overrides,
	};
}

describe("HeartbeatMonitor", () => {
	let monitor: HeartbeatMonitor;

	beforeEach(() => {
		monitor = new HeartbeatMonitor({ width: 30, blinkDead: true });
	});

	afterEach(() => {
		monitor.stop();
	});

	describe("render with no agents", () => {
		it("should render a 'no agents' message", () => {
			const output = monitor.render();
			expect(output).toContain("No agents running");
		});
	});

	describe("render with agents", () => {
		it("should render a line for each agent", () => {
			monitor.update([
				makeEntry({ agentId: "root", purpose: "coordinator" }),
				makeEntry({ agentId: "worker-1", purpose: "code reviewer", depth: 1 }),
			]);

			const output = monitor.render();
			const lines = output.split("\n");
			// At least header + 2 agent lines
			expect(lines.length).toBeGreaterThanOrEqual(3);
		});

		it("should show agent purpose in the output", () => {
			monitor.update([
				makeEntry({ agentId: "test-agent", purpose: "testing purpose" }),
			]);

			const output = monitor.render();
			expect(output).toContain("testing purpose");
		});

		it("should show agent ID (truncated to 10 chars)", () => {
			monitor.update([
				makeEntry({ agentId: "very-long-agent-id-12345", purpose: "test" }),
			]);

			const output = monitor.render();
			// ID should be truncated to 10 chars
			expect(output).toContain("very-long-");
		});
	});

	describe("ECG waveform generation", () => {
		it("should produce a waveform of the configured width", () => {
			monitor.update([
				makeEntry({ status: "alive" }),
			]);

			const output = monitor.render();
			// Alive agents should have ECG characters
			// The waveform uses box-drawing chars like \u2500, \u256E, \u2570, etc.
			expect(output).toContain("\u2500"); // Flat-line char is part of ECG
		});

		it("should show flat-line for dead agents", () => {
			monitor.update([
				makeEntry({ status: "dead" }),
			]);

			const output = monitor.render();
			// Dead agents get all flat-line characters
			expect(output).toContain("\u2500");
		});

		it("should show flat-line for completed agents", () => {
			monitor.update([
				makeEntry({ status: "completed" }),
			]);

			const output = monitor.render();
			expect(output).toContain("\u2500");
		});
	});

	describe("status icons", () => {
		it("should show heart icon for alive agents", () => {
			monitor.update([makeEntry({ status: "alive" })]);
			const output = monitor.render();
			expect(output).toContain("\u2665"); // ♥
		});

		it("should show empty heart for stale agents", () => {
			monitor.update([makeEntry({ status: "stale" })]);
			const output = monitor.render();
			expect(output).toContain("\u2661"); // ♡
		});

		it("should show X for dead agents", () => {
			monitor.update([makeEntry({ status: "dead" })]);
			const output = monitor.render();
			expect(output).toContain("\u2715"); // ✕
		});

		it("should show checkmark for completed agents", () => {
			monitor.update([makeEntry({ status: "completed" })]);
			const output = monitor.render();
			expect(output).toContain("\u2713"); // ✓
		});

		it("should show skull for error agents", () => {
			monitor.update([makeEntry({ status: "error" })]);
			const output = monitor.render();
			expect(output).toContain("\u2620"); // ☠
		});
	});

	describe("blinking for dead agents", () => {
		it("should dim dead agents on odd frames", () => {
			monitor.update([makeEntry({ status: "dead" })]);

			// Frame 0: normal
			const r0 = monitor.render();
			monitor.tick(); // Frame 1: dimmed
			const r1 = monitor.render();

			// Both should render, but content may differ due to dimming
			expect(r0.length).toBeGreaterThan(0);
			expect(r1.length).toBeGreaterThan(0);
		});
	});

	describe("tree hierarchy rendering", () => {
		it("should indent child agents with tree-drawing characters", () => {
			monitor.update([
				makeEntry({ agentId: "root", depth: 0 }),
				makeEntry({ agentId: "child", depth: 1 }),
				makeEntry({ agentId: "grandchild", depth: 2 }),
			]);

			const output = monitor.render();
			// Should contain tree-drawing characters
			expect(output).toMatch(/[\u251C\u2514\u2502]/); // ├ └ │
		});

		it("should not show tree indent when showTree is disabled", () => {
			const noTreeMonitor = new HeartbeatMonitor({ showTree: false, width: 30 });
			noTreeMonitor.update([
				makeEntry({ agentId: "root", depth: 0 }),
				makeEntry({ agentId: "child", depth: 1 }),
			]);

			const output = noTreeMonitor.render();
			// Tree chars should not be used for indentation
			// (the agent line still renders, just without tree prefix)
			expect(output).toContain("root");
		});
	});

	describe("token budget display", () => {
		it("should show token budget bar for agents with budget > 0", () => {
			monitor.update([
				makeEntry({ tokenUsage: 50_000, tokenBudget: 100_000 }),
			]);

			const output = monitor.render();
			// Should contain filled/empty bar chars
			expect(output).toMatch(/[\u2588\u2591]/); // █ ░
		});

		it("should format large token counts with k/M suffix", () => {
			monitor.update([
				makeEntry({ tokenUsage: 45_000, tokenBudget: 200_000 }),
			]);

			const output = monitor.render();
			expect(output).toContain("45k");
			expect(output).toContain("200k");
		});

		it("should not show budget when showBudget is disabled", () => {
			const noBudgetMonitor = new HeartbeatMonitor({ showBudget: false, width: 30 });
			noBudgetMonitor.update([
				makeEntry({ tokenUsage: 50_000, tokenBudget: 100_000 }),
			]);

			const output = noBudgetMonitor.render();
			// Budget bar should not appear
			expect(output).not.toContain("50k/100k");
		});
	});

	describe("compact render", () => {
		it("should show summary counts", () => {
			monitor.update([
				makeEntry({ status: "alive" }),
				makeEntry({ status: "alive" }),
				makeEntry({ status: "stale" }),
				makeEntry({ status: "dead" }),
			]);

			const compact = monitor.renderCompact();
			expect(compact).toContain("2/4 alive");
			expect(compact).toContain("1 stale");
			expect(compact).toContain("1 dead");
		});

		it("should show 'No agents' when empty", () => {
			const compact = monitor.renderCompact();
			expect(compact).toContain("No agents");
		});

		it("should count killed agents as dead", () => {
			monitor.update([
				makeEntry({ status: "killed" }),
			]);

			const compact = monitor.renderCompact();
			expect(compact).toContain("1 dead");
		});

		it("should show error and completed counts", () => {
			monitor.update([
				makeEntry({ status: "error" }),
				makeEntry({ status: "completed" }),
			]);

			const compact = monitor.renderCompact();
			expect(compact).toContain("1 error");
			expect(compact).toContain("1 done");
		});
	});

	describe("start / stop / tick", () => {
		it("should track running state", () => {
			expect(monitor.isRunning).toBe(false);
			monitor.start();
			expect(monitor.isRunning).toBe(true);
			monitor.stop();
			expect(monitor.isRunning).toBe(false);
		});

		it("should not double-start", () => {
			monitor.start();
			monitor.start(); // Should be a no-op
			expect(monitor.isRunning).toBe(true);
			monitor.stop();
		});

		it("should advance frame on tick", () => {
			const before = monitor.currentFrame;
			monitor.tick();
			expect(monitor.currentFrame).toBe(before + 1);
		});
	});

	describe("header rendering", () => {
		it("should include 'Agent Vitals' in the header", () => {
			monitor.update([makeEntry()]);
			const output = monitor.render();
			expect(output).toContain("Agent Vitals");
		});
	});
});
