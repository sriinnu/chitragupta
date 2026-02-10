/**
 * Shiksha E2E Tests — Full pipeline: query → analyze → source → build → scan → approve → execute.
 *
 * All shell execution is mocked (never runs real commands).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ShikshaController } from "../../src/shiksha/controller.js";
import { SkillRegistry } from "../../src/registry.js";
import { SurakshaScanner } from "../../src/suraksha.js";
import type { ShikshaEvent, BashExecutor } from "../../src/shiksha/types.js";

vi.mock("node:child_process", () => ({
	execFile: vi.fn((cmd: string, args: string[], _opts: unknown, cb: Function) => {
		if (cmd === "which") {
			// Common utilities exist
			const knownCmds = ["arp", "df", "ps", "grep", "find", "ls", "uname", "uptime", "wc", "du"];
			const target = args[0];
			if (knownCmds.includes(target)) {
				cb(null, `/usr/bin/${target}`);
			} else {
				cb(new Error("not found"), "");
			}
		} else {
			cb(new Error("not mocked"), "", "");
		}
	}),
}));

describe("Shiksha E2E Pipeline", () => {
	let registry: SkillRegistry;
	let scanner: SurakshaScanner;
	let bashExecutor: { execute: ReturnType<typeof vi.fn> };
	let events: ShikshaEvent[];
	let controller: ShikshaController;

	beforeEach(() => {
		registry = new SkillRegistry();
		scanner = new SurakshaScanner();
		bashExecutor = {
			execute: vi.fn().mockResolvedValue({ stdout: "command output here", stderr: "", exitCode: 0 }),
		};
		events = [];
		controller = new ShikshaController(
			{ registry, scanner },
			{
				bashExecutor: bashExecutor as BashExecutor,
				onEvent: (e) => events.push(e),
			},
		);
	});

	// ─── 1. Network devices (arp) ─────────────────────────────────────────

	it("check what devices are on my network → arp -a", async () => {
		const query = "check what devices are on my network";

		expect(controller.detectGap(query, [])).toBe(true);

		const result = await controller.learn(query);

		expect(result.success).toBe(true);
		expect(result.autoApproved).toBe(true);
		expect(result.executed).toBe(true);
		expect(result.skill).toBeDefined();
		expect(result.skill!.manifest.name).toBeTruthy();
		expect(result.skill!.implementation.type).toBe("shell");
		expect(result.skill!.taskAnalysis.domain).toBe("network");
		expect(result.skill!.taskAnalysis.intents.length).toBeGreaterThan(0);
		expect(result.skill!.sourceResult.tier).toBe("system-utility");

		// Skill is now in the registry
		const skillName = result.skill!.manifest.name;
		expect(registry.get(skillName)).toBeDefined();

		// Bash executor was called
		expect(bashExecutor.execute).toHaveBeenCalledOnce();
	});

	// ─── 2. Disk space (df -h) ────────────────────────────────────────────

	it("disk space left → df -h skill", async () => {
		const query = "disk space left";

		expect(controller.detectGap(query, [])).toBe(true);

		const result = await controller.learn(query);

		expect(result.success).toBe(true);
		expect(result.autoApproved).toBe(true);
		expect(result.executed).toBe(true);
		expect(result.skill).toBeDefined();
		expect(result.skill!.manifest.name).toBeTruthy();
		expect(result.skill!.implementation.type).toBe("shell");

		const skillName = result.skill!.manifest.name;
		expect(registry.get(skillName)).toBeDefined();
		expect(bashExecutor.execute).toHaveBeenCalledOnce();
	});

	it("how much free space → df -h skill", async () => {
		const query = "how much free space";

		expect(controller.detectGap(query, [])).toBe(true);

		const result = await controller.learn(query);

		expect(result.success).toBe(true);
		expect(result.autoApproved).toBe(true);
		expect(result.executed).toBe(true);
		expect(result.skill!.implementation.type).toBe("shell");
		expect(registry.get(result.skill!.manifest.name)).toBeDefined();
	});

	// ─── 3. Running processes (ps aux) ────────────────────────────────────

	it("show running processes → ps aux skill", async () => {
		const query = "show running processes";

		expect(controller.detectGap(query, [])).toBe(true);

		const result = await controller.learn(query);

		expect(result.success).toBe(true);
		expect(result.autoApproved).toBe(true);
		expect(result.executed).toBe(true);
		expect(result.skill).toBeDefined();
		expect(result.skill!.manifest.name).toBeTruthy();
		expect(result.skill!.implementation.type).toBe("shell");

		const skillName = result.skill!.manifest.name;
		expect(registry.get(skillName)).toBeDefined();
		expect(bashExecutor.execute).toHaveBeenCalledOnce();
	});

	// ─── 4. Uptime (single word) ──────────────────────────────────────────

	it("uptime → uptime skill", async () => {
		const query = "uptime";

		expect(controller.detectGap(query, [])).toBe(true);

		const result = await controller.learn(query);

		expect(result.success).toBe(true);
		expect(result.autoApproved).toBe(true);
		expect(result.executed).toBe(true);
		expect(result.skill).toBeDefined();
		expect(result.skill!.manifest.name).toBeTruthy();
		expect(result.skill!.implementation.type).toBe("shell");

		const skillName = result.skill!.manifest.name;
		expect(registry.get(skillName)).toBeDefined();
		expect(bashExecutor.execute).toHaveBeenCalledOnce();
	});

	// ─── 5. LLM-required (no matching utilities) ─────────────────────────

	it("summarize this code → fails, requires LLM", async () => {
		const query = "summarize this code";

		expect(controller.detectGap(query, [])).toBe(true);

		const result = await controller.learn(query);

		expect(result.success).toBe(false);
		expect(result.autoApproved).toBe(false);
		expect(result.executed).toBe(false);
		expect(result.error).toBeDefined();
		expect(result.error!.toLowerCase()).toContain("llm");
	});

	// ─── 6. Find files (find) ─────────────────────────────────────────────

	it("find files named *.ts in this directory → find skill", async () => {
		const query = "find files named *.ts in this directory";

		expect(controller.detectGap(query, [])).toBe(true);

		const result = await controller.learn(query);

		expect(result.success).toBe(true);
		expect(result.autoApproved).toBe(true);
		expect(result.executed).toBe(true);
		expect(result.skill).toBeDefined();
		expect(result.skill!.manifest.name).toBeTruthy();
		expect(result.skill!.implementation.type).toBe("shell");

		const skillName = result.skill!.manifest.name;
		expect(registry.get(skillName)).toBeDefined();
		expect(bashExecutor.execute).toHaveBeenCalledOnce();
	});

	// ─── 7. Event sequence verification ───────────────────────────────────

	it("successful learning emits events in correct order", async () => {
		const query = "show running processes";

		await controller.learn(query);

		const expectedSequence = [
			"gap:detected",
			"skill:analyzing",
			"skill:analyzed",
			"skill:sourcing",
			"skill:sourced",
			"skill:generating",
			"skill:generated",
			"skill:scanning",
			"skill:scanned",
			"skill:auto_approved",
			"skill:executing",
			"skill:executed",
			"skill:learned",
		];

		const eventTypes = events.map((e) => e.type);

		expect(eventTypes).toEqual(expectedSequence);

		// Each event has a timestamp
		for (const event of events) {
			expect(event.timestamp).toBeGreaterThan(0);
		}
	});
});
