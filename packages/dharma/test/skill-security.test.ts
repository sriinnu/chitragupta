import { describe, it, expect } from "vitest";
import path from "node:path";
import { getChitraguptaHome } from "@chitragupta/core";
import {
	skillRequiresReview,
	skillNetworkIsolation,
	skillFileSandbox,
	SKILL_SECURITY_RULES,
} from "../src/rules/skill-security.js";
import type { PolicyAction, PolicyContext } from "../src/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeContext(overrides?: Partial<PolicyContext>): PolicyContext {
	return {
		sessionId: "test-session",
		agentId: "root",
		agentDepth: 0,
		projectPath: "/tmp/test-project",
		totalCostSoFar: 0,
		costBudget: 10,
		filesModified: [],
		commandsRun: [],
		timestamp: Date.now(),
		...overrides,
	};
}

function makeAction(overrides?: Partial<PolicyAction>): PolicyAction {
	return {
		type: "tool_call",
		tool: "test-tool",
		args: {},
		...overrides,
	};
}

// ─── Rule 1: skillRequiresReview ─────────────────────────────────────────────

describe("skillRequiresReview", () => {
	it("allows non-skill_register actions", async () => {
		const action = makeAction({ type: "tool_call", tool: "bash" });
		const ctx = makeContext();
		const verdict = await skillRequiresReview.evaluate(action, ctx);
		expect(verdict).toMatchObject({ status: "allow", ruleId: "skill-security.requires-review" });
		expect(verdict.reason).toContain("Not a skill registration action");
	});

	it("allows trusted sources (tool, mcp-server, plugin)", async () => {
		for (const source of ["tool", "mcp-server", "plugin"]) {
			const action = makeAction({
				type: "tool_call",
				tool: "skill_register",
				args: { source },
			});
			const ctx = makeContext();
			const verdict = await skillRequiresReview.evaluate(action, ctx);
			expect(verdict.status).toBe("allow");
			expect(verdict.reason).toContain(`Trusted source: ${source}`);
		}
	});

	it("also matches via args.intent instead of tool name", async () => {
		const action = makeAction({
			type: "tool_call",
			tool: "some_other_tool",
			args: { intent: "skill_register", source: "tool" },
		});
		const ctx = makeContext();
		const verdict = await skillRequiresReview.evaluate(action, ctx);
		expect(verdict.status).toBe("allow");
		expect(verdict.reason).toContain("Trusted source: tool");
	});

	it("denies external source without approval", async () => {
		const action = makeAction({
			type: "tool_call",
			tool: "skill_register",
			args: { source: "github" },
		});
		const ctx = makeContext();
		const verdict = await skillRequiresReview.evaluate(action, ctx);
		expect(verdict.status).toBe("deny");
		expect(verdict.reason).toContain("not been approved");
		expect(verdict.suggestion).toBeDefined();
	});

	it("allows external source with approved=true", async () => {
		const action = makeAction({
			type: "tool_call",
			tool: "skill_register",
			args: { source: "github", approved: true },
		});
		const ctx = makeContext();
		const verdict = await skillRequiresReview.evaluate(action, ctx);
		expect(verdict.status).toBe("allow");
		expect(verdict.reason).toContain("approved");
	});

	it("denies when source is undefined and not approved", async () => {
		const action = makeAction({
			type: "tool_call",
			tool: "skill_register",
			args: {},
		});
		const ctx = makeContext();
		const verdict = await skillRequiresReview.evaluate(action, ctx);
		expect(verdict.status).toBe("deny");
		expect(verdict.reason).toContain("not been approved");
	});
});

// ─── Rule 2: skillNetworkIsolation ───────────────────────────────────────────

describe("skillNetworkIsolation", () => {
	it("allows network calls outside quarantine context", async () => {
		const action = makeAction({ type: "network_request", tool: "fetch" });
		const ctx = makeContext({ agentId: "root" });
		const verdict = await skillNetworkIsolation.evaluate(action, ctx);
		expect(verdict.status).toBe("allow");
		expect(verdict.reason).toContain("Not in quarantine");
	});

	it("blocks network_request in quarantine context (agentId prefix)", async () => {
		const action = makeAction({ type: "network_request" });
		const ctx = makeContext({ agentId: "quarantine:test-skill" });
		const verdict = await skillNetworkIsolation.evaluate(action, ctx);
		expect(verdict.status).toBe("deny");
		expect(verdict.reason).toContain("Network access is blocked");
		expect(verdict.suggestion).toBeDefined();
	});

	it("blocks network tools (fetch, http_request) when args.quarantine=true", async () => {
		for (const tool of ["fetch", "http_request"]) {
			const action = makeAction({
				type: "tool_call",
				tool,
				args: { quarantine: true },
			});
			const ctx = makeContext();
			const verdict = await skillNetworkIsolation.evaluate(action, ctx);
			expect(verdict.status).toBe("deny");
			expect(verdict.reason).toContain("Network access is blocked");
		}
	});

	it("allows non-network actions in quarantine context", async () => {
		const action = makeAction({ type: "tool_call", tool: "read_file" });
		const ctx = makeContext({ agentId: "quarantine:test-skill" });
		const verdict = await skillNetworkIsolation.evaluate(action, ctx);
		expect(verdict.status).toBe("allow");
		expect(verdict.reason).toContain("Non-network action allowed");
	});
});

// ─── Rule 3: skillFileSandbox ────────────────────────────────────────────────

describe("skillFileSandbox", () => {
	const stagingDir = path.join(getChitraguptaHome(), "skills", "staging");

	it("allows file ops outside quarantine context", async () => {
		const action = makeAction({
			type: "file_write",
			filePath: "/etc/passwd",
		});
		const ctx = makeContext({ agentId: "root" });
		const verdict = await skillFileSandbox.evaluate(action, ctx);
		expect(verdict.status).toBe("allow");
		expect(verdict.reason).toContain("Not in quarantine");
	});

	it("allows file ops within staging directory in quarantine", async () => {
		const action = makeAction({
			type: "file_write",
			filePath: path.join(stagingDir, "my-skill", "index.ts"),
		});
		const ctx = makeContext({ agentId: "quarantine:test-skill" });
		const verdict = await skillFileSandbox.evaluate(action, ctx);
		expect(verdict.status).toBe("allow");
		expect(verdict.reason).toContain("within skill staging directory");
	});

	it("blocks file ops outside staging dir in quarantine", async () => {
		const action = makeAction({
			type: "file_write",
			filePath: "/tmp/evil-file.txt",
		});
		const ctx = makeContext({ agentId: "quarantine:test-skill" });
		const verdict = await skillFileSandbox.evaluate(action, ctx);
		expect(verdict.status).toBe("deny");
		expect(verdict.reason).toContain("cannot access");
		expect(verdict.suggestion).toContain("staging directory");
	});

	it("allows non-file actions in quarantine context", async () => {
		const action = makeAction({ type: "tool_call", tool: "bash" });
		const ctx = makeContext({ agentId: "quarantine:test-skill" });
		const verdict = await skillFileSandbox.evaluate(action, ctx);
		expect(verdict.status).toBe("allow");
		expect(verdict.reason).toContain("Not a file operation");
	});
});

// ─── SKILL_SECURITY_RULES export ─────────────────────────────────────────────

describe("SKILL_SECURITY_RULES", () => {
	it("contains exactly 3 rules", () => {
		expect(SKILL_SECURITY_RULES).toHaveLength(3);
	});

	it("all rules have valid structure (id, name, description, severity, category, evaluate)", () => {
		for (const rule of SKILL_SECURITY_RULES) {
			expect(rule.id).toEqual(expect.any(String));
			expect(rule.id.length).toBeGreaterThan(0);
			expect(rule.name).toEqual(expect.any(String));
			expect(rule.name.length).toBeGreaterThan(0);
			expect(rule.description).toEqual(expect.any(String));
			expect(rule.description.length).toBeGreaterThan(0);
			expect(["error", "warning", "info"]).toContain(rule.severity);
			expect(typeof rule.category).toBe("string");
			expect(typeof rule.evaluate).toBe("function");
		}
	});
});
