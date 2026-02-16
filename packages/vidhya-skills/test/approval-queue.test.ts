import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	ApprovalQueue,
	assessRisk,
	type ApprovalEvent,
	type ApprovalRequest,
} from "../src/approval-queue.js";
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
			userData: { location: "read", memory: "write", calendar: true },
			filesystem: { scope: "full" },
			piiPolicy: "collect",
		},
	} as EnhancedSkillManifest;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Approval Queue", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "approval-test-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	describe("assessRisk", () => {
		it("returns low risk for simple skills", () => {
			const { level, factors } = assessRisk(makeManifest());
			expect(level).toBe("low");
			expect(factors).toHaveLength(0);
		});

		it("detects network access", () => {
			const manifest = {
				...makeManifest(),
				requirements: { bins: [], env: [], os: [], network: true, privilege: false },
			} as EnhancedSkillManifest;
			const { factors } = assessRisk(manifest);
			expect(factors.some(f => f.includes("network"))).toBe(true);
		});

		it("detects privilege escalation", () => {
			const manifest = {
				...makeManifest(),
				requirements: { bins: [], env: [], os: [], network: false, privilege: true },
			} as EnhancedSkillManifest;
			const { factors } = assessRisk(manifest);
			expect(factors.some(f => f.includes("privilege"))).toBe(true);
		});

		it("detects dangerous capability verbs", () => {
			const manifest = makeManifest({
				capabilities: [
					{ verb: "execute", object: "shell", description: "Execute shell commands" },
				],
			});
			const { factors } = assessRisk(manifest);
			expect(factors.some(f => f.includes("execute"))).toBe(true);
		});

		it("returns critical for many risk factors", () => {
			const { level, factors } = assessRisk(makeDangerousManifest());
			expect(level).toBe("critical");
			expect(factors.length).toBeGreaterThanOrEqual(4);
		});

		it("detects secrets access", () => {
			const manifest = {
				...makeManifest(),
				permissions: {
					bins: [], env: [], os: [], network: false, privilege: false,
					secrets: ["API_KEY"],
				},
			} as EnhancedSkillManifest;
			const { factors } = assessRisk(manifest);
			expect(factors.some(f => f.includes("secret"))).toBe(true);
		});

		it("detects full filesystem access", () => {
			const manifest = {
				...makeManifest(),
				permissions: {
					bins: [], env: [], os: [], network: false, privilege: false,
					filesystem: { scope: "full" },
				},
			} as EnhancedSkillManifest;
			const { level, factors } = assessRisk(manifest);
			expect(factors.some(f => f.includes("Full filesystem"))).toBe(true);
			expect(level).toBe("high"); // Escalated
		});

		it("detects PII collection", () => {
			const manifest = {
				...makeManifest(),
				permissions: {
					bins: [], env: [], os: [], network: false, privilege: false,
					piiPolicy: "collect",
				},
			} as EnhancedSkillManifest;
			const { factors } = assessRisk(manifest);
			expect(factors.some(f => f.includes("PII"))).toBe(true);
		});
	});

	describe("submit", () => {
		it("queues a skill for approval", () => {
			const queue = new ApprovalQueue(tempDir);
			const manifest = makeManifest();
			const req = queue.submit(manifest, "/tmp/test/SKILL.md");

			expect(req.id).toBeTruthy();
			expect(req.status).toBe("pending");
			expect(req.manifest.name).toBe("test-skill");
			expect(queue.pendingCount).toBe(1);
		});

		it("deduplicates by name + version", () => {
			const queue = new ApprovalQueue(tempDir);
			const manifest = makeManifest();
			const req1 = queue.submit(manifest, "/tmp/test/SKILL.md");
			const req2 = queue.submit(manifest, "/tmp/test/SKILL.md");

			expect(req1.id).toBe(req2.id);
			expect(queue.size).toBe(1);
		});

		it("computes risk assessment on submit", () => {
			const queue = new ApprovalQueue(tempDir);
			const req = queue.submit(makeDangerousManifest(), "/tmp/danger/SKILL.md");

			expect(req.riskLevel).toBe("critical");
			expect(req.riskFactors.length).toBeGreaterThanOrEqual(4);
		});

		it("stores validation errors and warnings", () => {
			const queue = new ApprovalQueue(tempDir);
			const req = queue.submit(makeManifest(), "/tmp/test/SKILL.md", {
				validationErrors: ["Missing description"],
				validationWarnings: ["No examples provided"],
			});

			expect(req.validationErrors).toEqual(["Missing description"]);
			expect(req.validationWarnings).toEqual(["No examples provided"]);
		});

		it("emits skill-discovered event", () => {
			const queue = new ApprovalQueue(tempDir);
			const events: ApprovalEvent[] = [];
			queue.onEvent(e => events.push(e));

			queue.submit(makeManifest(), "/tmp/test/SKILL.md");

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe("skill-discovered");
		});
	});

	describe("approve", () => {
		it("approves a pending skill", () => {
			const queue = new ApprovalQueue(tempDir);
			const req = queue.submit(makeManifest(), "/tmp/test/SKILL.md");
			const result = queue.approve(req.id, "santhi", "Looks good");

			expect(result).toBeTruthy();
			expect(result!.status).toBe("approved");
			expect(result!.approver).toBe("santhi");
			expect(result!.reason).toBe("Looks good");
			expect(queue.pendingCount).toBe(0);
		});

		it("records seal hash on approval", () => {
			const queue = new ApprovalQueue(tempDir);
			const req = queue.submit(makeManifest(), "/tmp/test/SKILL.md");
			const result = queue.approve(req.id, "santhi", "Verified", "sha256:abc123");

			expect(result!.sealHash).toBe("sha256:abc123");
		});

		it("adds ledger entry on approval", () => {
			const queue = new ApprovalQueue(tempDir);
			const req = queue.submit(makeManifest(), "/tmp/test/SKILL.md");
			queue.approve(req.id, "santhi", "Approved after review");

			const ledger = queue.getLedger();
			expect(ledger).toHaveLength(1);
			expect(ledger[0].decision).toBe("approved");
			expect(ledger[0].approver).toBe("santhi");
			expect(ledger[0].skillName).toBe("test-skill");
		});

		it("emits skill-approved event", () => {
			const queue = new ApprovalQueue(tempDir);
			const events: ApprovalEvent[] = [];
			queue.onEvent(e => events.push(e));

			const req = queue.submit(makeManifest(), "/tmp/test/SKILL.md");
			queue.approve(req.id, "santhi", "OK");

			expect(events).toHaveLength(2); // discovered + approved
			expect(events[1].type).toBe("skill-approved");
		});

		it("rejects approval of non-pending skill", () => {
			const queue = new ApprovalQueue(tempDir);
			const req = queue.submit(makeManifest(), "/tmp/test/SKILL.md");
			queue.approve(req.id, "santhi", "First approval");

			const second = queue.approve(req.id, "santhi", "Double approval");
			expect(second).toBeNull();
		});

		it("rejects approval of unknown ID", () => {
			const queue = new ApprovalQueue(tempDir);
			expect(queue.approve("nonexistent", "santhi", "nope")).toBeNull();
		});
	});

	describe("reject", () => {
		it("rejects a pending skill", () => {
			const queue = new ApprovalQueue(tempDir);
			const req = queue.submit(makeManifest({ name: "bad-skill" }), "/tmp/bad/SKILL.md");
			const result = queue.reject(req.id, "santhi", "Too risky");

			expect(result).toBeTruthy();
			expect(result!.status).toBe("rejected");
			expect(result!.reason).toBe("Too risky");
		});

		it("adds ledger entry on rejection", () => {
			const queue = new ApprovalQueue(tempDir);
			const req = queue.submit(makeManifest(), "/tmp/test/SKILL.md");
			queue.reject(req.id, "santhi", "Not needed");

			const ledger = queue.getLedger();
			expect(ledger).toHaveLength(1);
			expect(ledger[0].decision).toBe("rejected");
		});

		it("emits skill-rejected event", () => {
			const queue = new ApprovalQueue(tempDir);
			const events: ApprovalEvent[] = [];
			queue.onEvent(e => events.push(e));

			const req = queue.submit(makeManifest(), "/tmp/test/SKILL.md");
			queue.reject(req.id, "santhi", "No");

			expect(events[1].type).toBe("skill-rejected");
		});
	});

	describe("quarantine", () => {
		it("quarantines a skill", () => {
			const queue = new ApprovalQueue(tempDir);
			const req = queue.submit(makeDangerousManifest(), "/tmp/danger/SKILL.md");
			const result = queue.quarantine(req.id, "santhi", "Security concern");

			expect(result).toBeTruthy();
			expect(result!.status).toBe("quarantined");
		});

		it("adds ledger entry on quarantine", () => {
			const queue = new ApprovalQueue(tempDir);
			const req = queue.submit(makeManifest(), "/tmp/test/SKILL.md");
			queue.quarantine(req.id, "santhi", "Suspicious");

			const ledger = queue.getLedger();
			expect(ledger[0].decision).toBe("quarantined");
		});
	});

	describe("auto-approve", () => {
		it("auto-approves low-risk skills with no errors", () => {
			const queue = new ApprovalQueue(tempDir);
			queue.submit(makeManifest({ name: "safe-skill" }), "/tmp/safe/SKILL.md");

			const approved = queue.autoApproveSafe();
			expect(approved).toHaveLength(1);
			expect(approved[0].status).toBe("approved");
			expect(approved[0].approver).toBe("auto");
		});

		it("does not auto-approve high-risk skills", () => {
			const queue = new ApprovalQueue(tempDir);
			queue.submit(makeDangerousManifest(), "/tmp/danger/SKILL.md");

			const approved = queue.autoApproveSafe();
			expect(approved).toHaveLength(0);
		});

		it("does not auto-approve skills with validation errors", () => {
			const queue = new ApprovalQueue(tempDir);
			queue.submit(makeManifest(), "/tmp/test/SKILL.md", {
				validationErrors: ["Missing capabilities"],
			});

			const approved = queue.autoApproveSafe();
			expect(approved).toHaveLength(0);
		});
	});

	describe("queries", () => {
		it("filters by status", () => {
			const queue = new ApprovalQueue(tempDir);
			queue.submit(makeManifest({ name: "a" }), "/tmp/a/SKILL.md");
			queue.submit(makeManifest({ name: "b" }), "/tmp/b/SKILL.md");
			const req = queue.submit(makeManifest({ name: "c" }), "/tmp/c/SKILL.md");
			queue.approve(req.id, "santhi", "OK");

			expect(queue.getByStatus("pending")).toHaveLength(2);
			expect(queue.getByStatus("approved")).toHaveLength(1);
		});

		it("gets ledger for specific skill", () => {
			const queue = new ApprovalQueue(tempDir);
			const req1 = queue.submit(makeManifest({ name: "skill-a" }), "/a/SKILL.md");
			const req2 = queue.submit(makeManifest({ name: "skill-b" }), "/b/SKILL.md");
			queue.approve(req1.id, "santhi", "OK");
			queue.reject(req2.id, "santhi", "No");

			expect(queue.getLedgerForSkill("skill-a")).toHaveLength(1);
			expect(queue.getLedgerForSkill("skill-b")).toHaveLength(1);
			expect(queue.getLedgerForSkill("skill-c")).toHaveLength(0);
		});
	});

	describe("persistence", () => {
		it("survives restart", () => {
			// Create and populate queue
			const queue1 = new ApprovalQueue(tempDir);
			queue1.submit(makeManifest({ name: "persistent-skill" }), "/tmp/p/SKILL.md");
			const req = queue1.submit(makeManifest({ name: "approved-skill" }), "/tmp/a/SKILL.md");
			queue1.approve(req.id, "santhi", "Good");

			// Create new queue from same directory
			const queue2 = new ApprovalQueue(tempDir);
			expect(queue2.size).toBe(2);
			expect(queue2.pendingCount).toBe(1);
			expect(queue2.getLedger()).toHaveLength(1);
		});
	});

	describe("event handlers", () => {
		it("unsubscribes correctly", () => {
			const queue = new ApprovalQueue(tempDir);
			const events: ApprovalEvent[] = [];
			const unsub = queue.onEvent(e => events.push(e));

			queue.submit(makeManifest({ name: "a" }), "/a");
			expect(events).toHaveLength(1);

			unsub();
			queue.submit(makeManifest({ name: "b" }), "/b");
			expect(events).toHaveLength(1); // No new events after unsub
		});

		it("handler errors don't break the queue", () => {
			const queue = new ApprovalQueue(tempDir);
			queue.onEvent(() => { throw new Error("Handler crash"); });

			// Should not throw
			expect(() => queue.submit(makeManifest(), "/tmp/test/SKILL.md")).not.toThrow();
		});
	});
});
