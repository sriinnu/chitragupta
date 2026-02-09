/**
 * Tests for PraptyaSourcer — 5-tier cascading solution sourcer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TaskAnalysis, ShikshaConfig, SourceResult, CandidateUtility } from "../../src/shiksha/types.js";
import { DEFAULT_SHIKSHA_CONFIG } from "../../src/shiksha/types.js";

// ─── Mock node:child_process ───────────────────────────────────────────────

vi.mock("node:child_process", () => ({
	execFile: vi.fn(),
}));

import { execFile } from "node:child_process";
import {
	whichCommand,
	tryBuiltinTool,
	trySystemUtility,
	tryNpmPackage,
	tryGithubRepo,
	flagCodeGeneration,
	sourceSkill,
} from "../../src/shiksha/praptya.js";

const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeAnalysis(overrides: Partial<TaskAnalysis> = {}): TaskAnalysis {
	return {
		query: "list files in current directory",
		intents: [{ verb: "list", object: "files" }],
		strategy: "shell-command",
		complexity: "trivial",
		candidateUtilities: [],
		domain: "files",
		confidence: 0.9,
		...overrides,
	};
}

function makeCandidate(overrides: Partial<CandidateUtility> = {}): CandidateUtility {
	return {
		command: "ls",
		template: "ls -la",
		confidence: 0.95,
		requiresPrivilege: false,
		requiresNetwork: false,
		domain: "files",
		...overrides,
	};
}

function makeConfig(overrides: Partial<ShikshaConfig> = {}): ShikshaConfig {
	return { ...DEFAULT_SHIKSHA_CONFIG, ...overrides };
}

function makeRegistry(matches: Array<{ skill: { name: string; description: string }; score: number }> = []) {
	return {
		query: vi.fn().mockReturnValue(matches),
	};
}

// ─── whichCommand ──────────────────────────────────────────────────────────

describe("whichCommand", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns path when command is found", async () => {
		mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
			cb(null, "/usr/bin/ls\n");
		});
		const result = await whichCommand("ls");
		expect(result).toBe("/usr/bin/ls");
	});

	it("returns null when command is not found", async () => {
		mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
			cb(new Error("not found"), "");
		});
		const result = await whichCommand("nonexistent-binary-xyz");
		expect(result).toBeNull();
	});

	it("returns null when stdout is empty", async () => {
		mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
			cb(null, "");
		});
		const result = await whichCommand("empty");
		expect(result).toBeNull();
	});

	it("returns null when stdout is only whitespace", async () => {
		mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
			cb(null, "   \n  ");
		});
		const result = await whichCommand("whitespace");
		expect(result).toBeNull();
	});
});

// ─── tryBuiltinTool ────────────────────────────────────────────────────────

describe("tryBuiltinTool", () => {
	it("returns null when registry is undefined", async () => {
		const result = await tryBuiltinTool(makeAnalysis(), undefined);
		expect(result).toBeNull();
	});

	it("returns null when registry has no matches", async () => {
		const registry = makeRegistry([]);
		const result = await tryBuiltinTool(makeAnalysis(), registry as any);
		expect(result).toBeNull();
		expect(registry.query).toHaveBeenCalledWith({
			text: "list files in current directory",
			topK: 1,
			threshold: 0.15,
		});
	});

	it("returns builtin-tool result when registry has a match", async () => {
		const registry = makeRegistry([
			{
				skill: { name: "file-reader", description: "Reads files from disk" },
				score: 0.85,
			},
		]);
		const result = await tryBuiltinTool(makeAnalysis(), registry as any);
		expect(result).not.toBeNull();
		expect(result!.tier).toBe("builtin-tool");
		expect(result!.implementation).toEqual({
			type: "tool-chain",
			tools: ["file-reader"],
			steps: ["Use file-reader: Reads files from disk"],
		});
		expect(result!.toolChain).toEqual(["file-reader"]);
		expect(result!.commands).toEqual([]);
	});

	it("uses the first match from registry", async () => {
		const registry = makeRegistry([
			{
				skill: { name: "first-tool", description: "First tool" },
				score: 0.9,
			},
		]);
		const result = await tryBuiltinTool(makeAnalysis(), registry as any);
		expect(result!.toolChain).toEqual(["first-tool"]);
	});
});

// ─── trySystemUtility ──────────────────────────────────────────────────────

describe("trySystemUtility", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns null when candidateUtilities is empty", async () => {
		const result = await trySystemUtility(makeAnalysis({ candidateUtilities: [] }));
		expect(result).toBeNull();
	});

	it("returns system-utility result when command is available", async () => {
		mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
			cb(null, "/usr/bin/ls\n");
		});
		const analysis = makeAnalysis({
			candidateUtilities: [makeCandidate({ command: "ls", template: "ls -la" })],
		});
		const result = await trySystemUtility(analysis);
		expect(result).not.toBeNull();
		expect(result!.tier).toBe("system-utility");
		expect(result!.implementation).toEqual({ type: "shell", script: "ls -la" });
		expect(result!.commands).toEqual(["ls -la"]);
		expect(result!.toolChain).toEqual([]);
	});

	it("returns null when command is not available", async () => {
		mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
			cb(new Error("not found"), "");
		});
		const analysis = makeAnalysis({
			candidateUtilities: [makeCandidate({ command: "nmap", template: "nmap -sn 192.168.1.0/24" })],
		});
		const result = await trySystemUtility(analysis);
		expect(result).toBeNull();
	});

	it("tries multiple candidates and returns first available", async () => {
		let callCount = 0;
		mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
			callCount++;
			if (args[0] === "nmap") {
				cb(new Error("not found"), "");
			} else if (args[0] === "arp") {
				cb(null, "/usr/sbin/arp\n");
			} else {
				cb(new Error("not found"), "");
			}
		});
		const analysis = makeAnalysis({
			candidateUtilities: [
				makeCandidate({ command: "nmap", template: "nmap -sn 192.168.1.0/24", confidence: 0.9 }),
				makeCandidate({ command: "arp", template: "arp -a", confidence: 0.7 }),
			],
		});
		const result = await trySystemUtility(analysis);
		expect(result).not.toBeNull();
		expect(result!.implementation).toEqual({ type: "shell", script: "arp -a" });
	});

	it("returns null when all candidates are unavailable", async () => {
		mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
			cb(new Error("not found"), "");
		});
		const analysis = makeAnalysis({
			candidateUtilities: [
				makeCandidate({ command: "nmap", template: "nmap -sn 192.168.1.0/24" }),
				makeCandidate({ command: "masscan", template: "masscan 192.168.1.0/24" }),
			],
		});
		const result = await trySystemUtility(analysis);
		expect(result).toBeNull();
	});
});

// ─── tryNpmPackage ─────────────────────────────────────────────────────────

describe("tryNpmPackage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns null when enableRemoteSourcing is false", async () => {
		const config = makeConfig({ enableRemoteSourcing: false });
		const result = await tryNpmPackage(makeAnalysis(), config);
		expect(result).toBeNull();
		expect(mockExecFile).not.toHaveBeenCalled();
	});

	it("returns null when intents produce empty search terms", async () => {
		const config = makeConfig({ enableRemoteSourcing: true });
		const analysis = makeAnalysis({ intents: [] });
		const result = await tryNpmPackage(analysis, config);
		expect(result).toBeNull();
	});

	it("returns npm-package result when qualified package found", async () => {
		mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
			cb(null, JSON.stringify([
				{ name: "glob", version: "10.3.0", description: "Pattern matching", downloads: 5000 },
			]));
		});
		const config = makeConfig({ enableRemoteSourcing: true, minNpmDownloads: 1000 });
		const result = await tryNpmPackage(makeAnalysis(), config);
		expect(result).not.toBeNull();
		expect(result!.tier).toBe("npm-package");
		expect(result!.implementation.type).toBe("typescript");
		expect(result!.commands).toEqual(["npm install glob"]);
		expect(result!.packageInfo).toEqual({
			name: "glob",
			version: "10.3.0",
			downloads: 5000,
			url: "https://www.npmjs.com/package/glob",
		});
	});

	it("returns null when no packages meet minimum downloads", async () => {
		mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
			cb(null, JSON.stringify([
				{ name: "tiny-pkg", version: "0.0.1", downloads: 50 },
			]));
		});
		const config = makeConfig({ enableRemoteSourcing: true, minNpmDownloads: 1000 });
		const result = await tryNpmPackage(makeAnalysis(), config);
		expect(result).toBeNull();
	});

	it("returns null when npm search fails", async () => {
		mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
			cb(new Error("npm timeout"), "");
		});
		const config = makeConfig({ enableRemoteSourcing: true });
		const result = await tryNpmPackage(makeAnalysis(), config);
		expect(result).toBeNull();
	});
});

// ─── tryGithubRepo ─────────────────────────────────────────────────────────

describe("tryGithubRepo", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns null when enableRemoteSourcing is false", async () => {
		const config = makeConfig({ enableRemoteSourcing: false });
		const result = await tryGithubRepo(makeAnalysis(), config);
		expect(result).toBeNull();
		expect(mockExecFile).not.toHaveBeenCalled();
	});

	it("returns null when intents produce empty search terms", async () => {
		const config = makeConfig({ enableRemoteSourcing: true });
		const analysis = makeAnalysis({ intents: [] });
		const result = await tryGithubRepo(analysis, config);
		expect(result).toBeNull();
	});

	it("returns null when no repos meet minimum stars", async () => {
		mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
			cb(null, JSON.stringify([
				{ name: "tiny-repo", stargazersCount: 5, url: "https://github.com/x/tiny-repo" },
			]));
		});
		const config = makeConfig({ enableRemoteSourcing: true, minGithubStars: 50 });
		const result = await tryGithubRepo(makeAnalysis(), config);
		expect(result).toBeNull();
	});

	it("returns github-repo result when qualified repo found", async () => {
		mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
			cb(null, JSON.stringify([
				{ name: "cool-lib", description: "A cool library", stargazersCount: 200, url: "https://github.com/x/cool-lib" },
			]));
		});
		const config = makeConfig({ enableRemoteSourcing: true, minGithubStars: 50 });
		const result = await tryGithubRepo(makeAnalysis(), config);
		expect(result).not.toBeNull();
		expect(result!.tier).toBe("github-repo");
		expect(result!.implementation.type).toBe("typescript");
		expect(result!.packageInfo).toEqual({
			name: "cool-lib",
			stars: 200,
			url: "https://github.com/x/cool-lib",
		});
	});
});

// ─── flagCodeGeneration ────────────────────────────────────────────────────

describe("flagCodeGeneration", () => {
	it("always returns code-generation tier", () => {
		const result = flagCodeGeneration(makeAnalysis());
		expect(result.tier).toBe("code-generation");
	});

	it("has llm-chain implementation", () => {
		const result = flagCodeGeneration(makeAnalysis());
		expect(result.implementation.type).toBe("llm-chain");
	});

	it("includes query in system prompt", () => {
		const analysis = makeAnalysis({ query: "deploy to production" });
		const result = flagCodeGeneration(analysis);
		const impl = result.implementation as { type: "llm-chain"; systemPrompt: string; steps: string[] };
		expect(impl.systemPrompt).toContain("deploy to production");
	});

	it("maps intents to steps", () => {
		const analysis = makeAnalysis({
			intents: [
				{ verb: "build", object: "docker image" },
				{ verb: "push", object: "to registry", modifier: "with tag latest" },
			],
		});
		const result = flagCodeGeneration(analysis);
		const impl = result.implementation as { type: "llm-chain"; systemPrompt: string; steps: string[] };
		expect(impl.steps).toEqual(["build docker image", "push to registry with tag latest"]);
	});

	it("produces empty steps for empty intents", () => {
		const analysis = makeAnalysis({ intents: [] });
		const result = flagCodeGeneration(analysis);
		const impl = result.implementation as { type: "llm-chain"; systemPrompt: string; steps: string[] };
		expect(impl.steps).toEqual([]);
	});

	it("returns empty commands and toolChain", () => {
		const result = flagCodeGeneration(makeAnalysis());
		expect(result.commands).toEqual([]);
		expect(result.toolChain).toEqual([]);
	});
});

// ─── sourceSkill (full pipeline) ───────────────────────────────────────────

describe("sourceSkill", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns builtin-tool when registry matches", async () => {
		const registry = makeRegistry([
			{ skill: { name: "grep-tool", description: "Search files" }, score: 0.8 },
		]);
		const result = await sourceSkill(makeAnalysis(), makeConfig(), registry as any);
		expect(result.tier).toBe("builtin-tool");
		expect(result.toolChain).toEqual(["grep-tool"]);
	});

	it("falls through to system-utility when registry has no match", async () => {
		mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
			if (args[0] === "ls") {
				cb(null, "/bin/ls\n");
			} else {
				cb(new Error("not found"), "");
			}
		});
		const registry = makeRegistry([]);
		const analysis = makeAnalysis({
			candidateUtilities: [makeCandidate({ command: "ls", template: "ls -la" })],
		});
		const result = await sourceSkill(analysis, makeConfig(), registry as any);
		expect(result.tier).toBe("system-utility");
	});

	it("falls through to code-generation when all tiers fail", async () => {
		mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
			cb(new Error("not found"), "");
		});
		const registry = makeRegistry([]);
		const analysis = makeAnalysis({
			query: "do something exotic",
			candidateUtilities: [],
		});
		const config = makeConfig({ enableRemoteSourcing: false });
		const result = await sourceSkill(analysis, config, registry as any);
		expect(result.tier).toBe("code-generation");
		expect(result.implementation.type).toBe("llm-chain");
	});

	it("falls through to code-generation without registry", async () => {
		mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
			cb(new Error("not found"), "");
		});
		const analysis = makeAnalysis({ candidateUtilities: [] });
		const config = makeConfig({ enableRemoteSourcing: false });
		const result = await sourceSkill(analysis, config);
		expect(result.tier).toBe("code-generation");
	});

	it("skips remote tiers when enableRemoteSourcing is false", async () => {
		mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
			cb(new Error("not found"), "");
		});
		const analysis = makeAnalysis({ candidateUtilities: [] });
		const config = makeConfig({ enableRemoteSourcing: false });
		const result = await sourceSkill(analysis, config);
		// Should never call npm or gh
		const calls = mockExecFile.mock.calls;
		const cmds = calls.map((c: any[]) => c[0]);
		expect(cmds).not.toContain("npm");
		expect(cmds).not.toContain("gh");
		expect(result.tier).toBe("code-generation");
	});
});

// ─── Edge cases ────────────────────────────────────────────────────────────

describe("edge cases", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("handles empty candidateUtilities gracefully", async () => {
		const analysis = makeAnalysis({ candidateUtilities: [] });
		const result = await trySystemUtility(analysis);
		expect(result).toBeNull();
	});

	it("handles empty intents in flagCodeGeneration", () => {
		const analysis = makeAnalysis({ intents: [] });
		const result = flagCodeGeneration(analysis);
		expect(result.tier).toBe("code-generation");
		const impl = result.implementation as { type: "llm-chain"; systemPrompt: string; steps: string[] };
		expect(impl.steps).toEqual([]);
	});

	it("handles intents without modifiers in flagCodeGeneration", () => {
		const analysis = makeAnalysis({
			intents: [{ verb: "check", object: "disk space" }],
		});
		const result = flagCodeGeneration(analysis);
		const impl = result.implementation as { type: "llm-chain"; systemPrompt: string; steps: string[] };
		expect(impl.steps).toEqual(["check disk space"]);
	});

	it("tryNpmPackage returns null for whitespace-only search terms", async () => {
		const config = makeConfig({ enableRemoteSourcing: true });
		const analysis = makeAnalysis({
			intents: [{ verb: " ", object: " " }],
		});
		const result = await tryNpmPackage(analysis, config);
		expect(result).toBeNull();
	});

	it("tryGithubRepo returns null for whitespace-only search terms", async () => {
		const config = makeConfig({ enableRemoteSourcing: true });
		const analysis = makeAnalysis({
			intents: [{ verb: " ", object: " " }],
		});
		const result = await tryGithubRepo(analysis, config);
		expect(result).toBeNull();
	});
});
