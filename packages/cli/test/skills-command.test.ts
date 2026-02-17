/**
 * Tests for the /skills CLI command and all subcommands.
 *
 * Mocks @chitragupta/vidhya-skills to avoid filesystem/scanner side effects.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import { Writable } from "stream";

// ─── Mock vidhya-skills ─────────────────────────────────────────────────────

const mockListStaged = vi.fn();
const mockListApproved = vi.fn();
const mockLoadEvolutionState = vi.fn();
const mockSaveEvolutionState = vi.fn();
const mockScannerScan = vi.fn();
const mockScannerScanMultiple = vi.fn();
const mockPipelineApprove = vi.fn();
const mockPipelineReject = vi.fn();
const mockSandboxGet = vi.fn();
const mockDiscoverAndQuarantine = vi.fn();
const mockSetSecurity = vi.fn();

vi.mock("@chitragupta/vidhya-skills", () => ({
	SurakshaScanner: class {
		scan = mockScannerScan;
		scanMultiple = mockScannerScanMultiple;
	},
	SkillSandbox: class {
		get = mockSandboxGet;
	},
	PratikshaManager: class {
		listStaged = mockListStaged;
		listApproved = mockListApproved;
		loadEvolutionState = mockLoadEvolutionState;
		saveEvolutionState = mockSaveEvolutionState;
	},
	SkillRegistry: class {},
	SkillPipeline: class {
		approve = mockPipelineApprove;
		reject = mockPipelineReject;
	},
	SkillEvolution: {
		deserialize: vi.fn().mockReturnValue({
			getEvolutionReport: vi.fn().mockReturnValue([]),
			suggestFusions: vi.fn().mockReturnValue([]),
			getDeprecationCandidates: vi.fn().mockReturnValue([]),
		}),
	},
	SkillDiscovery: class {
		setSecurity = mockSetSecurity;
		discoverAndQuarantine = mockDiscoverAndQuarantine;
	},
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function createCapture(): { stdout: NodeJS.WriteStream; output: () => string } {
	const chunks: string[] = [];
	const writable = new Writable({
		write(chunk, _encoding, callback) {
			chunks.push(chunk.toString());
			callback();
		},
	}) as unknown as NodeJS.WriteStream;
	return {
		stdout: writable,
		output: () => chunks.join(""),
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("runSkillsCommand", () => {
	let runSkillsCommand: typeof import("../src/commands/skills.js").runSkillsCommand;

	beforeEach(async () => {
		vi.clearAllMocks();
		const mod = await import("../src/commands/skills.js");
		runSkillsCommand = mod.runSkillsCommand;
	});

	// ── No subcommand → usage ───────────────────────────────────────────

	describe("no subcommand", () => {
		it("prints usage when subCmd is undefined", async () => {
			const { stdout, output } = createCapture();
			await runSkillsCommand(undefined, [], stdout);
			const text = output();
			expect(text).toContain("Usage");
			expect(text).toContain("pending");
			expect(text).toContain("approve");
			expect(text).toContain("reject");
			expect(text).toContain("list");
			expect(text).toContain("health");
			expect(text).toContain("scan");
			expect(text).toContain("ingest");
		});
	});

	// ── Unknown subcommand ──────────────────────────────────────────────

	describe("unknown subcommand", () => {
		it("prints warning and usage for unknown subcommand", async () => {
			const { stdout, output } = createCapture();
			await runSkillsCommand("foobar", [], stdout);
			const text = output();
			expect(text).toContain("Unknown subcommand");
			expect(text).toContain("foobar");
			expect(text).toContain("Usage");
		});
	});

	// ── pending ─────────────────────────────────────────────────────────

	describe("pending", () => {
		it("shows empty message when no pending skills", async () => {
			mockListStaged.mockResolvedValue([]);
			const { stdout, output } = createCapture();
			await runSkillsCommand("pending", [], stdout);
			expect(output()).toContain("No skills pending review");
		});

		it("lists pending skills with risk and age", async () => {
			mockListStaged.mockResolvedValue([
				{
					quarantineId: "abcdef1234567890",
					skillName: "test-skill",
					reason: "npm",
					status: "quarantined",
					healthScore: 0.5,
					riskScore: 0.12,
					stagedAt: new Date(Date.now() - 3600_000).toISOString(),
				},
			]);
			const { stdout, output } = createCapture();
			await runSkillsCommand("pending", [], stdout);
			const text = output();
			expect(text).toContain("Pending Review");
			expect(text).toContain("1 skill");
			expect(text).toContain("test-skill");
			expect(text).toContain("risk:0.12");
			expect(text).toContain("1h ago");
		});

		it("pluralizes skill count correctly", async () => {
			mockListStaged.mockResolvedValue([
				{
					quarantineId: "aaa_1234567890ab",
					skillName: "skill-a",
					reason: "npm",
					status: "validated",
					healthScore: 1,
					riskScore: 0.01,
					stagedAt: new Date().toISOString(),
				},
				{
					quarantineId: "bbb_1234567890cd",
					skillName: "skill-b",
					reason: "generated",
					status: "validated",
					healthScore: 1,
					riskScore: 0.05,
					stagedAt: new Date().toISOString(),
				},
			]);
			const { stdout, output } = createCapture();
			await runSkillsCommand("pending", [], stdout);
			expect(output()).toContain("2 skills");
		});

		it("highlights high-risk skills with yellow", async () => {
			mockListStaged.mockResolvedValue([
				{
					quarantineId: "high_risk_abcdef",
					skillName: "risky-skill",
					reason: "github",
					status: "quarantined",
					healthScore: 0.3,
					riskScore: 0.45,
					stagedAt: new Date().toISOString(),
				},
			]);
			const { stdout, output } = createCapture();
			await runSkillsCommand("pending", [], stdout);
			expect(output()).toContain("risk:0.45");
		});
	});

	// ── approve ─────────────────────────────────────────────────────────

	describe("approve", () => {
		it("shows usage when no id provided", async () => {
			const { stdout, output } = createCapture();
			await runSkillsCommand("approve", [], stdout);
			expect(output()).toContain("Usage");
			expect(output()).toContain("approve <quarantine-id>");
		});

		it("approves a skill and prints result", async () => {
			mockPipelineApprove.mockResolvedValue({
				skillName: "file-parser",
				path: "/home/user/.chitragupta/skills/approved/file-parser",
			});
			const { stdout, output } = createCapture();
			await runSkillsCommand("approve", ["qs_abc123"], stdout);
			const text = output();
			expect(text).toContain("Approved");
			expect(text).toContain("file-parser");
			expect(text).toContain("Path:");
		});

		it("shows error when approval fails", async () => {
			mockPipelineApprove.mockRejectedValue(new Error("Skill not found"));
			const { stdout, output } = createCapture();
			await runSkillsCommand("approve", ["nonexistent_id"], stdout);
			expect(output()).toContain("Error");
			expect(output()).toContain("Skill not found");
		});
	});

	// ── reject ──────────────────────────────────────────────────────────

	describe("reject", () => {
		it("shows usage when no id provided", async () => {
			const { stdout, output } = createCapture();
			await runSkillsCommand("reject", [], stdout);
			expect(output()).toContain("Usage");
			expect(output()).toContain("reject <quarantine-id>");
		});

		it("rejects a skill with default reason", async () => {
			mockPipelineReject.mockResolvedValue(undefined);
			const { stdout, output } = createCapture();
			await runSkillsCommand("reject", ["qs_bad123"], stdout);
			const text = output();
			expect(text).toContain("Rejected");
			expect(text).toContain("qs_bad123");
			expect(text).toContain("Rejected by user");
			expect(mockPipelineReject).toHaveBeenCalledWith("qs_bad123", "Rejected by user");
		});

		it("rejects a skill with custom reason", async () => {
			mockPipelineReject.mockResolvedValue(undefined);
			const { stdout, output } = createCapture();
			await runSkillsCommand("reject", ["qs_bad123", "contains", "eval"], stdout);
			const text = output();
			expect(text).toContain("Rejected");
			expect(text).toContain("contains eval");
			expect(mockPipelineReject).toHaveBeenCalledWith("qs_bad123", "contains eval");
		});

		it("shows error when rejection fails", async () => {
			mockPipelineReject.mockRejectedValue(new Error("Already archived"));
			const { stdout, output } = createCapture();
			await runSkillsCommand("reject", ["qs_old123"], stdout);
			expect(output()).toContain("Error");
			expect(output()).toContain("Already archived");
		});
	});

	// ── list ────────────────────────────────────────────────────────────

	describe("list", () => {
		it("shows empty message when no approved skills", async () => {
			mockListApproved.mockResolvedValue([]);
			const { stdout, output } = createCapture();
			await runSkillsCommand("list", [], stdout);
			expect(output()).toContain("No approved skills");
		});

		it("lists approved skills with age", async () => {
			mockListApproved.mockResolvedValue([
				{
					skillName: "file-reader",
					approvedAt: new Date(Date.now() - 86_400_000).toISOString(),
					path: "/home/user/.chitragupta/skills/approved/file-reader",
				},
				{
					skillName: "code-analyzer",
					approvedAt: new Date(Date.now() - 7200_000).toISOString(),
					path: "/home/user/.chitragupta/skills/approved/code-analyzer",
				},
			]);
			const { stdout, output } = createCapture();
			await runSkillsCommand("list", [], stdout);
			const text = output();
			expect(text).toContain("Approved Skills (2)");
			expect(text).toContain("file-reader");
			expect(text).toContain("code-analyzer");
			expect(text).toContain("1d ago");
			expect(text).toContain("2h ago");
		});
	});

	// ── health ──────────────────────────────────────────────────────────

	describe("health", () => {
		it("shows empty message when no evolution state", async () => {
			mockLoadEvolutionState.mockResolvedValue(null);
			const { stdout, output } = createCapture();
			await runSkillsCommand("health", [], stdout);
			expect(output()).toContain("No evolution data available");
		});

		it("shows empty message when report is empty", async () => {
			mockLoadEvolutionState.mockResolvedValue({ skills: {} });
			const { SkillEvolution } = await import("@chitragupta/vidhya-skills");
			(SkillEvolution as any).deserialize = vi.fn().mockReturnValue({
				getEvolutionReport: vi.fn().mockReturnValue([]),
				suggestFusions: vi.fn().mockReturnValue([]),
				getDeprecationCandidates: vi.fn().mockReturnValue([]),
			});
			const { stdout, output } = createCapture();
			await runSkillsCommand("health", [], stdout);
			expect(output()).toContain("No skill health data recorded");
		});

		it("shows health report with bars and stats", async () => {
			mockLoadEvolutionState.mockResolvedValue({ skills: {} });
			const { SkillEvolution } = await import("@chitragupta/vidhya-skills");
			(SkillEvolution as any).deserialize = vi.fn().mockReturnValue({
				getEvolutionReport: vi.fn().mockReturnValue([
					{
						name: "file-reader",
						health: 0.92,
						useCount: 342,
						successRate: 0.98,
						matchCount: 500,
						flaggedForReview: false,
					},
					{
						name: "code-gen",
						health: 0.35,
						useCount: 12,
						successRate: 0.5,
						matchCount: 20,
						flaggedForReview: true,
					},
				]),
				suggestFusions: vi.fn().mockReturnValue([]),
				getDeprecationCandidates: vi.fn().mockReturnValue([]),
			});
			const { stdout, output } = createCapture();
			await runSkillsCommand("health", [], stdout);
			const text = output();
			expect(text).toContain("Skill Health Report");
			expect(text).toContain("file-reader");
			expect(text).toContain("uses:342");
			expect(text).toContain("success:98%");
			expect(text).toContain("code-gen");
			expect(text).toContain("[REVIEW]");
		});

		it("shows fusion suggestions", async () => {
			mockLoadEvolutionState.mockResolvedValue({ skills: {} });
			const { SkillEvolution } = await import("@chitragupta/vidhya-skills");
			(SkillEvolution as any).deserialize = vi.fn().mockReturnValue({
				getEvolutionReport: vi.fn().mockReturnValue([
					{
						name: "skill-a",
						health: 0.8,
						useCount: 100,
						successRate: 0.9,
						matchCount: 200,
						flaggedForReview: false,
					},
				]),
				suggestFusions: vi.fn().mockReturnValue([
					{ skillA: "skill-a", skillB: "skill-b", coOccurrenceRate: 0.72 },
				]),
				getDeprecationCandidates: vi.fn().mockReturnValue([]),
			});
			const { stdout, output } = createCapture();
			await runSkillsCommand("health", [], stdout);
			const text = output();
			expect(text).toContain("Fusion Suggestions");
			expect(text).toContain("skill-a");
			expect(text).toContain("skill-b");
			expect(text).toContain("72% co-use");
		});

		it("shows deprecation candidates", async () => {
			mockLoadEvolutionState.mockResolvedValue({ skills: {} });
			const { SkillEvolution } = await import("@chitragupta/vidhya-skills");
			(SkillEvolution as any).deserialize = vi.fn().mockReturnValue({
				getEvolutionReport: vi.fn().mockReturnValue([
					{
						name: "dead-skill",
						health: 0.05,
						useCount: 1,
						successRate: 0,
						matchCount: 60,
						flaggedForReview: true,
					},
				]),
				suggestFusions: vi.fn().mockReturnValue([]),
				getDeprecationCandidates: vi.fn().mockReturnValue([
					{ name: "dead-skill", health: 0.05, matchCount: 60 },
				]),
			});
			const { stdout, output } = createCapture();
			await runSkillsCommand("health", [], stdout);
			const text = output();
			expect(text).toContain("Deprecation Candidates");
			expect(text).toContain("dead-skill");
		});

		it("handles errors gracefully", async () => {
			mockLoadEvolutionState.mockRejectedValue(new Error("FS read failed"));
			const { stdout, output } = createCapture();
			await runSkillsCommand("health", [], stdout);
			expect(output()).toContain("Error");
			expect(output()).toContain("FS read failed");
		});
	});

	// ── scan ────────────────────────────────────────────────────────────

	describe("scan", () => {
		it("shows usage when no file provided", async () => {
			const { stdout, output } = createCapture();
			await runSkillsCommand("scan", [], stdout);
			expect(output()).toContain("Usage");
			expect(output()).toContain("scan <file>");
		});

		it("shows error for nonexistent file", async () => {
			const { stdout, output } = createCapture();
			await runSkillsCommand("scan", ["/nonexistent/path/skill.md"], stdout);
			expect(output()).toContain("File not found");
		});

		it("shows clean verdict for safe files", async () => {
			const tmpFile = "/tmp/chitragupta-test-clean-skill.md";
			fs.writeFileSync(tmpFile, "# Safe Skill\nDoes nothing harmful.\n");

			mockScannerScan.mockReturnValue({
				skillName: "safe-skill",
				verdict: "clean",
				findings: [],
				riskScore: 0,
				scanDurationMs: 1.2,
				contentHash: 0xdeadbeef,
			});

			const { stdout, output } = createCapture();
			await runSkillsCommand("scan", [tmpFile], stdout);
			const text = output();
			expect(text).toContain("Suraksha Scan Report");
			expect(text).toContain("CLEAN");
			expect(text).toContain("0.000");
			expect(text).toContain("No findings");

			fs.unlinkSync(tmpFile);
		});

		it("shows findings for dangerous files", async () => {
			const tmpFile = "/tmp/chitragupta-test-dangerous-skill.md";
			fs.writeFileSync(tmpFile, "eval(atob('bWFsaWNpb3Vz'))\n");

			mockScannerScan.mockReturnValue({
				skillName: "danger-skill",
				verdict: "dangerous",
				findings: [
					{
						threat: "code-injection",
						severity: "block",
						pattern: "eval(",
						line: 1,
						snippet: "eval(atob('bWFsaWNpb3Vz'))",
						message: "Dynamic code execution via eval()",
					},
					{
						threat: "dynamic-execution",
						severity: "block",
						pattern: "atob",
						line: 1,
						snippet: "atob('bWFsaWNpb3Vz')",
						message: "Base64 decode likely combined with eval",
					},
				],
				riskScore: 0.75,
				scanDurationMs: 0.8,
				contentHash: 0xcafebabe,
			});

			const { stdout, output } = createCapture();
			await runSkillsCommand("scan", [tmpFile], stdout);
			const text = output();
			expect(text).toContain("DANGEROUS");
			expect(text).toContain("0.750");
			expect(text).toContain("Findings (2)");
			expect(text).toContain("BLOCK");
			expect(text).toContain("code-injection");
			expect(text).toContain("Dynamic code execution");

			fs.unlinkSync(tmpFile);
		});
	});

	// ── ingest ──────────────────────────────────────────────────────────

	describe("ingest", () => {
		it("shows empty message when no skills found", async () => {
			mockDiscoverAndQuarantine.mockResolvedValue([]);
			const { stdout, output } = createCapture();
			await runSkillsCommand("ingest", ["/tmp"], stdout);
			expect(output()).toContain("No skill.md files found");
		});

		it("lists discovered skills with quarantine IDs", async () => {
			mockDiscoverAndQuarantine.mockResolvedValue([
				{
					manifest: { name: "file-parser" },
					quarantineId: "qs_1234567890abcdef",
				},
				{
					manifest: { name: "code-runner" },
					quarantineId: "qs_abcdef1234567890",
				},
			]);
			mockSandboxGet.mockImplementation((id: string) => {
				if (id === "qs_1234567890abcdef") return { status: "validated" };
				if (id === "qs_abcdef1234567890") return { status: "quarantined" };
				return null;
			});
			const { stdout, output } = createCapture();
			await runSkillsCommand("ingest", ["/tmp"], stdout);
			const text = output();
			expect(text).toContain("Discovered 2 skill(s)");
			expect(text).toContain("file-parser");
			expect(text).toContain("code-runner");
			expect(text).toContain("validated");
			expect(text).toContain("quarantined");
		});

		it("defaults to current directory when no path given", async () => {
			mockDiscoverAndQuarantine.mockResolvedValue([]);
			const { stdout } = createCapture();
			await runSkillsCommand("ingest", [], stdout);
			expect(mockSetSecurity).toHaveBeenCalled();
			expect(mockDiscoverAndQuarantine).toHaveBeenCalled();
		});

		it("handles errors gracefully", async () => {
			mockDiscoverAndQuarantine.mockRejectedValue(new Error("Permission denied"));
			const { stdout, output } = createCapture();
			await runSkillsCommand("ingest", ["/root/secret"], stdout);
			expect(output()).toContain("Error");
			expect(output()).toContain("Permission denied");
		});
	});

	// ── Case insensitivity ──────────────────────────────────────────────

	describe("case insensitivity", () => {
		it("handles PENDING in uppercase", async () => {
			mockListStaged.mockResolvedValue([]);
			const { stdout, output } = createCapture();
			await runSkillsCommand("PENDING", [], stdout);
			expect(output()).toContain("No skills pending review");
		});

		it("handles List in mixed case", async () => {
			mockListApproved.mockResolvedValue([]);
			const { stdout, output } = createCapture();
			await runSkillsCommand("List", [], stdout);
			expect(output()).toContain("No approved skills");
		});
	});
});
