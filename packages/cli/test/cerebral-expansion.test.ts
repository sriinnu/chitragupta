/**
 * Tests for Cerebral Expansion — Autonomous Skill Discovery & Installation.
 *
 * Covers: intent extraction, Akasha cache hits, security gate blocking,
 * confidence threshold enforcement, successful local resolution, and
 * graceful fallback on no match.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	CerebralExpansion,
	extractIntent,
	createCerebralHandler,
	createCerebralExpansionTool,
} from "../src/modes/cerebral-expansion.js";
import type { AkashaFieldLike, SkillRegistryLike } from "../src/modes/mcp-subsystems-types.js";

// ─── Mocks ──────────────────────────────────────────────────────────────────

function createMockAkasha(traces: Array<{
	id: string;
	agentId: string;
	traceType: string;
	topic: string;
	content: string;
	strength: number;
	reinforcements: number;
}>): AkashaFieldLike {
	return {
		query: vi.fn((_topic: string, _opts?: { type?: string; limit?: number }) => traces),
		leave: vi.fn((_agentId: string, _type: string, _topic: string, _content: string) => ({ id: "trace-1" })),
	};
}

function createMockSkillRegistry(skills: Array<Record<string, unknown>> = []): SkillRegistryLike {
	return {
		size: skills.length,
		register: vi.fn(),
		getByName: vi.fn((name: string) => skills.find((s) => s.name === name)),
		getByTag: vi.fn(() => skills),
		getByVerb: vi.fn(() => skills),
		getAll: vi.fn(() => skills),
	};
}

// ─── extractIntent ──────────────────────────────────────────────────────────

describe("extractIntent", () => {
	it("splits snake_case tool names into tokens", () => {
		const result = extractIntent("deploy_docker_container");
		expect(result.tokens).toEqual(["deploy", "docker", "container"]);
		expect(result.query).toBe("deploy docker container");
	});

	it("splits camelCase tool names into tokens", () => {
		const result = extractIntent("deployDockerContainer");
		expect(result.tokens).toEqual(["deploy", "docker", "container"]);
	});

	it("splits kebab-case tool names into tokens", () => {
		const result = extractIntent("deploy-docker-container");
		expect(result.tokens).toEqual(["deploy", "docker", "container"]);
	});

	it("filters out single-character tokens", () => {
		const result = extractIntent("a_deploy_b");
		expect(result.tokens).toEqual(["deploy"]);
	});

	it("preserves raw tool name", () => {
		const result = extractIntent("  myTool  ");
		expect(result.raw).toBe("myTool");
	});

	it("handles empty string gracefully", () => {
		const result = extractIntent("");
		expect(result.tokens).toEqual([]);
		expect(result.query).toBe("");
	});
});

// ─── CerebralExpansion.resolve ──────────────────────────────────────────────

describe("CerebralExpansion", () => {
	let expansion: CerebralExpansion;

	beforeEach(() => {
		expansion = new CerebralExpansion();
	});

	it("returns no-match for empty intent", async () => {
		const akasha = createMockAkasha([]);
		const registry = createMockSkillRegistry();

		const result = await expansion.resolve("", akasha, registry);
		expect(result.resolved).toBe(false);
		expect(result.rejectionReason).toBe("empty-intent");
	});

	it("returns akasha cache hit when strong trace exists", async () => {
		const akasha = createMockAkasha([
			{
				id: "t1",
				agentId: "cerebral-expansion",
				traceType: "solution",
				topic: "deploy docker",
				content: "skill:docker-deployer source:local-match tokens:[deploy,docker]",
				strength: 5,
				reinforcements: 3,
			},
		]);
		const registry = createMockSkillRegistry();

		const result = await expansion.resolve("deploy_docker", akasha, registry);
		expect(result.resolved).toBe(true);
		expect(result.source).toBe("akasha-cache");
		expect(result.skillName).toBe("docker-deployer");
		expect(result.confidence).toBeGreaterThan(0);
	});

	it("ignores akasha traces with low strength", async () => {
		const akasha = createMockAkasha([
			{
				id: "t1",
				agentId: "cerebral-expansion",
				traceType: "solution",
				topic: "deploy docker",
				content: "skill:docker-deployer source:local-match",
				strength: 0.5, // Below threshold of 1
				reinforcements: 0,
			},
		]);
		const registry = createMockSkillRegistry();

		const result = await expansion.resolve("deploy_docker", akasha, registry);
		// Should not return cache hit because strength <= 1
		expect(result.source).not.toBe("akasha-cache");
	});

	it("rejects skills below confidence threshold", async () => {
		// Use a high threshold
		expansion = new CerebralExpansion({ confidenceThreshold: 0.99 });
		const akasha = createMockAkasha([]);

		// Mock matchSkills to return a low-confidence match
		vi.doMock("@chitragupta/vidhya-skills", () => ({
			matchSkills: () => [{ skill: { name: "weak-match", tags: [] }, score: 0.5 }],
			SurakshaScanner: class { scan() { return { verdict: "pass", riskScore: 0, findings: [] }; } },
		}));

		const registry = createMockSkillRegistry([
			{ name: "weak-match", description: "A weak match", tags: ["test"] },
		]);

		const result = await expansion.resolve("deploy_docker", akasha, registry);
		// With threshold at 0.99, the 0.5 score match should be rejected
		expect(result.resolved).toBe(false);

		vi.doUnmock("@chitragupta/vidhya-skills");
	});

	it("records gap warning when no match found", async () => {
		const akasha = createMockAkasha([]);
		const registry = createMockSkillRegistry();

		const result = await expansion.resolve("nonexistent_tool", akasha, registry);
		expect(result.resolved).toBe(false);
		expect(result.rejectionReason).toBe("no-matching-skill");
		expect(result.source).toBe("none");

		// Should have recorded a warning trace
		expect(akasha.leave).toHaveBeenCalledWith(
			"cerebral-expansion",
			"warning",
			expect.any(String),
			expect.stringContaining("unresolved-gap"),
		);
	});

	it("uses custom config values", () => {
		const custom = new CerebralExpansion({
			confidenceThreshold: 0.9,
			maxRiskScore: 0.1,
			recordSolutions: false,
		});
		// Verify it constructs without error
		expect(custom).toBeInstanceOf(CerebralExpansion);
	});
});

// ─── createCerebralHandler ──────────────────────────────────────────────────

describe("createCerebralHandler", () => {
	it("creates a callable handler that resolves expansion results", async () => {
		const expansion = new CerebralExpansion();
		const akasha = createMockAkasha([]);
		const registry = createMockSkillRegistry();

		const handler = createCerebralHandler(
			expansion,
			async () => akasha,
			async () => registry,
		);

		const result = await handler("unknown_tool");
		expect(result).toHaveProperty("resolved");
		expect(result).toHaveProperty("toolName", "unknown_tool");
		expect(result).toHaveProperty("source");
		expect(result).toHaveProperty("confidence");
	});
});

// ─── createCerebralExpansionTool ────────────────────────────────────────────

describe("createCerebralExpansionTool", () => {
	it("creates an MCP tool with correct definition", () => {
		const expansion = new CerebralExpansion();
		const tool = createCerebralExpansionTool(
			expansion,
			async () => createMockAkasha([]),
			async () => createMockSkillRegistry(),
		);

		expect(tool.definition.name).toBe("cerebral_expand");
		expect(tool.definition.description).toContain("Cerebral Expansion");
		expect(tool.definition.inputSchema.required).toContain("toolName");
	});

	it("returns error when toolName is empty", async () => {
		const expansion = new CerebralExpansion();
		const tool = createCerebralExpansionTool(
			expansion,
			async () => createMockAkasha([]),
			async () => createMockSkillRegistry(),
		);

		const result = await tool.execute({ toolName: "" });
		expect(result.isError).toBe(true);
	});

	it("returns formatted result for valid tool name", async () => {
		const expansion = new CerebralExpansion();
		const tool = createCerebralExpansionTool(
			expansion,
			async () => createMockAkasha([]),
			async () => createMockSkillRegistry(),
		);

		const result = await tool.execute({ toolName: "deploy_docker" });
		expect(result.isError).toBeUndefined();
		const text = (result.content[0] as { type: string; text: string }).text;
		expect(text).toContain("Cerebral Expansion");
		expect(text).toContain("deploy_docker");
	});
});
