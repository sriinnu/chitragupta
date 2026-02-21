import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApprovalQueue } from "../src/approval-queue.js";
import { ApprovalNotifier, type SamitiBroadcaster } from "../src/approval-notifier.js";
import type { SkillManifest } from "../src/types.js";
import type { EnhancedSkillManifest } from "../src/types-v2.js";

// ─── Test Fixtures ──────────────────────────────────────────────────────────

function makeManifest(overrides?: Partial<SkillManifest>): SkillManifest {
	return {
		name: "test-skill",
		version: "1.0.0",
		description: "A test skill",
		capabilities: [{ verb: "read", object: "files", description: "Read files" }],
		tags: ["test"],
		source: { type: "manual", filePath: "/tmp/test/SKILL.md" },
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

function makeDangerousManifest(): EnhancedSkillManifest {
	return {
		...makeManifest({
			name: "dangerous-skill",
			capabilities: [
				{ verb: "execute", object: "commands", description: "Run shell commands" },
				{ verb: "delete", object: "files", description: "Delete files" },
			],
		}),
		requirements: { bins: [], env: [], os: [], network: true, privilege: true },
		permissions: {
			bins: [],
			env: [],
			os: [],
			network: true,
			privilege: true,
			networkPolicy: { allowlist: [] },
			secrets: ["API_KEY", "DB_PASSWORD"],
			userData: { location: "precise", memory: "write", calendar: true },
			filesystem: { scope: "staging_dir" },
			piiPolicy: "explicit_only",
		},
	} as unknown as EnhancedSkillManifest;
}

function createMockSamiti(): SamitiBroadcaster & { calls: Array<{ channel: string; message: unknown }> } {
	const calls: Array<{ channel: string; message: unknown }> = [];
	return {
		calls,
		broadcast(channel: string, message: unknown) {
			calls.push({ channel, message });
		},
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ApprovalNotifier", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "notifier-test-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	describe("attach and event forwarding", () => {
		it("broadcasts skill-discovered events to Samiti", () => {
			const samiti = createMockSamiti();
			const queue = new ApprovalQueue(tempDir);
			const notifier = new ApprovalNotifier(samiti);
			notifier.attach(queue);

			queue.submit(makeManifest({ name: "my-skill" }), "/tmp/my/SKILL.md");

			expect(samiti.calls).toHaveLength(1);
			const call = samiti.calls[0];
			expect(call.channel).toBe("#alerts");
			const msg = call.message as Record<string, unknown>;
			expect(msg.sender).toBe("skill-daemon");
			expect(msg.severity).toBe("info");
			expect(msg.category).toBe("skill-discovery");
			expect((msg.content as string)).toContain("my-skill@1.0.0");
			expect((msg.content as string)).toContain("Awaiting manual approval");
		});

		it("broadcasts skill-approved events", () => {
			const samiti = createMockSamiti();
			const queue = new ApprovalQueue(tempDir);
			const notifier = new ApprovalNotifier(samiti);
			notifier.attach(queue);

			const req = queue.submit(makeManifest(), "/tmp/test/SKILL.md");
			queue.approve(req.id, "santhi", "Looks good", "sha256:abc");

			expect(samiti.calls).toHaveLength(2); // discovered + approved
			const approvedMsg = samiti.calls[1].message as Record<string, unknown>;
			expect(approvedMsg.category).toBe("skill-approved");
			expect(approvedMsg.severity).toBe("info");
			expect((approvedMsg.content as string)).toContain("Approved by: santhi");
			expect((approvedMsg.content as string)).toContain("Seal: sha256:abc");
		});

		it("broadcasts skill-rejected events", () => {
			const samiti = createMockSamiti();
			const queue = new ApprovalQueue(tempDir);
			const notifier = new ApprovalNotifier(samiti);
			notifier.attach(queue);

			const req = queue.submit(makeManifest(), "/tmp/test/SKILL.md");
			queue.reject(req.id, "santhi", "Not needed");

			expect(samiti.calls).toHaveLength(2);
			const rejectedMsg = samiti.calls[1].message as Record<string, unknown>;
			expect(rejectedMsg.category).toBe("skill-rejected");
			expect((rejectedMsg.content as string)).toContain("Rejected by: santhi");
			expect((rejectedMsg.content as string)).toContain("Not needed");
		});

		it("broadcasts skill-quarantined events with critical severity", () => {
			const samiti = createMockSamiti();
			const queue = new ApprovalQueue(tempDir);
			const notifier = new ApprovalNotifier(samiti);
			notifier.attach(queue);

			const req = queue.submit(makeDangerousManifest(), "/tmp/danger/SKILL.md");
			queue.quarantine(req.id, "santhi", "Security concern");

			expect(samiti.calls).toHaveLength(2);
			const quarantinedMsg = samiti.calls[1].message as Record<string, unknown>;
			expect(quarantinedMsg.category).toBe("skill-quarantined");
			expect(quarantinedMsg.severity).toBe("critical");
			expect((quarantinedMsg.content as string)).toContain("[SECURITY]");
		});
	});

	describe("event formatting", () => {
		it("marks high-risk discoveries with warning severity", () => {
			const samiti = createMockSamiti();
			const queue = new ApprovalQueue(tempDir);
			const notifier = new ApprovalNotifier(samiti);
			notifier.attach(queue);

			queue.submit(makeDangerousManifest(), "/tmp/danger/SKILL.md");

			const msg = samiti.calls[0].message as Record<string, unknown>;
			expect(msg.severity).toBe("warning");
			expect((msg.content as string)).toContain("!!");
		});

		it("includes risk factors when enabled", () => {
			const samiti = createMockSamiti();
			const queue = new ApprovalQueue(tempDir);
			const notifier = new ApprovalNotifier(samiti, { includeRiskDetails: true });
			notifier.attach(queue);

			queue.submit(makeDangerousManifest(), "/tmp/danger/SKILL.md");

			const msg = samiti.calls[0].message as Record<string, unknown>;
			expect((msg.content as string)).toContain("Risk factors:");
		});

		it("excludes risk factors when disabled", () => {
			const samiti = createMockSamiti();
			const queue = new ApprovalQueue(tempDir);
			const notifier = new ApprovalNotifier(samiti, { includeRiskDetails: false });
			notifier.attach(queue);

			queue.submit(makeDangerousManifest(), "/tmp/danger/SKILL.md");

			const msg = samiti.calls[0].message as Record<string, unknown>;
			expect((msg.content as string)).not.toContain("Risk factors:");
		});

		it("includes event data payload with metadata", () => {
			const samiti = createMockSamiti();
			const queue = new ApprovalQueue(tempDir);
			const notifier = new ApprovalNotifier(samiti);
			notifier.attach(queue);

			queue.submit(makeManifest({ name: "data-skill", version: "2.0.0" }), "/src/SKILL.md");

			const msg = samiti.calls[0].message as Record<string, unknown>;
			const data = msg.data as Record<string, unknown>;
			expect(data.skillName).toBe("data-skill");
			expect(data.skillVersion).toBe("2.0.0");
			expect(data.sourcePath).toBe("/src/SKILL.md");
			expect(data.status).toBe("pending");
			expect(data.requestId).toBeTruthy();
			expect(data.timestamp).toBeTruthy();
		});

		it("shows validation error count in discovered message", () => {
			const samiti = createMockSamiti();
			const queue = new ApprovalQueue(tempDir);
			const notifier = new ApprovalNotifier(samiti);
			notifier.attach(queue);

			queue.submit(makeManifest(), "/tmp/test/SKILL.md", {
				validationErrors: ["Missing description", "No examples"],
			});

			const msg = samiti.calls[0].message as Record<string, unknown>;
			expect((msg.content as string)).toContain("Validation errors: 2");
		});
	});

	describe("configuration", () => {
		it("uses custom channel", () => {
			const samiti = createMockSamiti();
			const queue = new ApprovalQueue(tempDir);
			const notifier = new ApprovalNotifier(samiti, { channel: "#skills" });
			notifier.attach(queue);

			queue.submit(makeManifest(), "/tmp/test/SKILL.md");

			expect(samiti.calls[0].channel).toBe("#skills");
		});

		it("uses custom sender", () => {
			const samiti = createMockSamiti();
			const queue = new ApprovalQueue(tempDir);
			const notifier = new ApprovalNotifier(samiti, { sender: "vidhya" });
			notifier.attach(queue);

			queue.submit(makeManifest(), "/tmp/test/SKILL.md");

			const msg = samiti.calls[0].message as Record<string, unknown>;
			expect(msg.sender).toBe("vidhya");
		});
	});

	describe("detach", () => {
		it("stops broadcasting after detach", () => {
			const samiti = createMockSamiti();
			const queue = new ApprovalQueue(tempDir);
			const notifier = new ApprovalNotifier(samiti);
			notifier.attach(queue);

			queue.submit(makeManifest({ name: "a" }), "/a");
			expect(samiti.calls).toHaveLength(1);

			notifier.detachAll();
			queue.submit(makeManifest({ name: "b" }), "/b");
			expect(samiti.calls).toHaveLength(1); // No new calls
		});

		it("individual unsubscribe works", () => {
			const samiti = createMockSamiti();
			const queue = new ApprovalQueue(tempDir);
			const notifier = new ApprovalNotifier(samiti);
			const unsub = notifier.attach(queue);

			queue.submit(makeManifest({ name: "a" }), "/a");
			expect(samiti.calls).toHaveLength(1);

			unsub();
			queue.submit(makeManifest({ name: "b" }), "/b");
			expect(samiti.calls).toHaveLength(1);
		});
	});

	describe("broadcastPendingSummary", () => {
		it("broadcasts summary of pending skills", () => {
			const samiti = createMockSamiti();
			const queue = new ApprovalQueue(tempDir);
			const notifier = new ApprovalNotifier(samiti);

			queue.submit(makeManifest({ name: "skill-a" }), "/a");
			queue.submit(makeManifest({ name: "skill-b" }), "/b");
			queue.submit(makeDangerousManifest(), "/danger");

			// Clear discovery broadcasts
			samiti.calls.length = 0;

			notifier.broadcastPendingSummary(queue);

			expect(samiti.calls).toHaveLength(1);
			const msg = samiti.calls[0].message as Record<string, unknown>;
			expect(msg.category).toBe("skill-pending-summary");
			expect((msg.content as string)).toContain("3 skill(s) awaiting approval");

			const data = msg.data as Record<string, unknown>;
			expect((data as any).pendingCount).toBe(3);
		});

		it("does not broadcast when no pending skills", () => {
			const samiti = createMockSamiti();
			const queue = new ApprovalQueue(tempDir);
			const notifier = new ApprovalNotifier(samiti);

			notifier.broadcastPendingSummary(queue);

			expect(samiti.calls).toHaveLength(0);
		});

		it("uses warning severity when critical-risk skills are pending", () => {
			const samiti = createMockSamiti();
			const queue = new ApprovalQueue(tempDir);
			const notifier = new ApprovalNotifier(samiti);

			queue.submit(makeDangerousManifest(), "/danger");
			samiti.calls.length = 0;

			notifier.broadcastPendingSummary(queue);

			const msg = samiti.calls[0].message as Record<string, unknown>;
			expect(msg.severity).toBe("warning");
		});

		it("truncates list at 5 skills with 'and N more'", () => {
			const samiti = createMockSamiti();
			const queue = new ApprovalQueue(tempDir);
			const notifier = new ApprovalNotifier(samiti);

			for (let i = 0; i < 7; i++) {
				queue.submit(makeManifest({ name: `skill-${i}`, version: `${i}.0.0` }), `/s${i}`);
			}
			samiti.calls.length = 0;

			notifier.broadcastPendingSummary(queue);

			const msg = samiti.calls[0].message as Record<string, unknown>;
			expect((msg.content as string)).toContain("and 2 more");
		});
	});

	describe("error resilience", () => {
		it("does not throw when Samiti broadcast fails", () => {
			const failingSamiti: SamitiBroadcaster = {
				broadcast() {
					throw new Error("Samiti down");
				},
			};
			const queue = new ApprovalQueue(tempDir);
			const notifier = new ApprovalNotifier(failingSamiti);
			notifier.attach(queue);

			// Should not throw
			expect(() => queue.submit(makeManifest(), "/tmp/test/SKILL.md")).not.toThrow();
		});

		it("does not throw when Samiti broadcast fails during summary", () => {
			const failingSamiti: SamitiBroadcaster = {
				broadcast() {
					throw new Error("Samiti down");
				},
			};
			const queue = new ApprovalQueue(tempDir);
			queue.submit(makeManifest(), "/tmp/test/SKILL.md");

			const notifier = new ApprovalNotifier(failingSamiti);
			expect(() => notifier.broadcastPendingSummary(queue)).not.toThrow();
		});
	});
});
