import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Workflow, WorkflowExecution } from "../src/types.js";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("fs", () => ({
	default: {
		mkdirSync: vi.fn(),
		writeFileSync: vi.fn(),
		readFileSync: vi.fn(),
		readdirSync: vi.fn(),
		statSync: vi.fn(),
		existsSync: vi.fn(),
		unlinkSync: vi.fn(),
	},
}));

vi.mock("@chitragupta/core", () => ({
	getChitraguptaHome: vi.fn(() => "/mock-home/.chitragupta"),
}));

import fs from "fs";
import {
	saveWorkflow,
	loadWorkflow,
	listWorkflows,
	deleteWorkflow,
	saveExecution,
	loadExecution,
	listExecutions,
} from "../src/persistence.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeWorkflow(overrides?: Partial<Workflow>): Workflow {
	return {
		id: "wf-1",
		name: "Test Workflow",
		description: "A test workflow",
		version: "1.0.0",
		steps: [],
		...overrides,
	};
}

function makeExecution(overrides?: Partial<WorkflowExecution>): WorkflowExecution {
	return {
		workflowId: "wf-1",
		executionId: "exec-1",
		status: "completed",
		startTime: 1000,
		endTime: 2000,
		steps: new Map([
			["step-1", { stepId: "step-1", status: "completed", retryCount: 0 }],
		]),
		context: { key: "value" },
		...overrides,
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("persistence", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ── saveWorkflow ──────────────────────────────────────────────────────

	describe("saveWorkflow", () => {
		it("should create the workflows directory recursively", () => {
			saveWorkflow(makeWorkflow());
			expect(fs.mkdirSync).toHaveBeenCalledWith(
				"/mock-home/.chitragupta/workflows",
				{ recursive: true },
			);
		});

		it("should write workflow JSON with tab indentation", () => {
			const workflow = makeWorkflow({ id: "my-wf" });
			saveWorkflow(workflow);
			expect(fs.writeFileSync).toHaveBeenCalledWith(
				"/mock-home/.chitragupta/workflows/my-wf.json",
				JSON.stringify(workflow, null, "\t"),
				"utf-8",
			);
		});

		it("should use the workflow id as the filename", () => {
			saveWorkflow(makeWorkflow({ id: "special-123" }));
			expect(fs.writeFileSync).toHaveBeenCalledWith(
				expect.stringContaining("special-123.json"),
				expect.any(String),
				"utf-8",
			);
		});

		it("should save workflows with complex step data", () => {
			const wf = makeWorkflow({
				steps: [
					{
						id: "s1",
						name: "Step 1",
						action: { type: "prompt", message: "hello" },
						dependsOn: [],
					},
				],
			});
			saveWorkflow(wf);
			const writtenJson = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1];
			const parsed = JSON.parse(writtenJson as string);
			expect(parsed.steps).toHaveLength(1);
			expect(parsed.steps[0].id).toBe("s1");
		});
	});

	// ── loadWorkflow ─────────────────────────────────────────────────────

	describe("loadWorkflow", () => {
		it("should return parsed workflow when file exists", () => {
			const wf = makeWorkflow();
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(wf));

			const result = loadWorkflow("wf-1");
			expect(result).toEqual(wf);
		});

		it("should check the correct file path", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false);
			loadWorkflow("abc-123");
			expect(fs.existsSync).toHaveBeenCalledWith(
				"/mock-home/.chitragupta/workflows/abc-123.json",
			);
		});

		it("should return undefined when file does not exist", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false);
			const result = loadWorkflow("nonexistent");
			expect(result).toBeUndefined();
		});

		it("should return undefined for corrupted JSON", () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readFileSync).mockReturnValue("NOT VALID JSON {{{");

			const result = loadWorkflow("corrupted");
			expect(result).toBeUndefined();
		});

		it("should return undefined when readFileSync throws", () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readFileSync).mockImplementation(() => {
				throw new Error("EACCES");
			});

			const result = loadWorkflow("no-perms");
			expect(result).toBeUndefined();
		});

		it("should read with utf-8 encoding", () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readFileSync).mockReturnValue("{}");
			loadWorkflow("test");
			expect(fs.readFileSync).toHaveBeenCalledWith(
				expect.any(String),
				"utf-8",
			);
		});
	});

	// ── listWorkflows ────────────────────────────────────────────────────

	describe("listWorkflows", () => {
		it("should return empty array when directory does not exist", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false);
			const result = listWorkflows();
			expect(result).toEqual([]);
		});

		it("should return parsed workflows from JSON files", () => {
			const wf1 = makeWorkflow({ id: "w1" });
			const wf2 = makeWorkflow({ id: "w2" });

			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readdirSync).mockReturnValue(["w1.json", "w2.json"] as any);
			vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => false } as any);
			vi.mocked(fs.readFileSync)
				.mockReturnValueOnce(JSON.stringify(wf1))
				.mockReturnValueOnce(JSON.stringify(wf2));

			const result = listWorkflows();
			expect(result).toHaveLength(2);
			expect(result[0].id).toBe("w1");
			expect(result[1].id).toBe("w2");
		});

		it("should skip non-JSON files", () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readdirSync).mockReturnValue(["readme.md", "notes.txt", "wf.json"] as any);
			vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => false } as any);
			vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(makeWorkflow()));

			const result = listWorkflows();
			expect(result).toHaveLength(1);
			// statSync should only be called for the .json file
			expect(fs.statSync).toHaveBeenCalledTimes(1);
		});

		it("should skip directories even if they end in .json", () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readdirSync).mockReturnValue(["history.json", "real.json"] as any);
			vi.mocked(fs.statSync)
				.mockReturnValueOnce({ isDirectory: () => true } as any)
				.mockReturnValueOnce({ isDirectory: () => false } as any);
			vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(makeWorkflow()));

			const result = listWorkflows();
			expect(result).toHaveLength(1);
		});

		it("should skip corrupted JSON files silently", () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readdirSync).mockReturnValue(["bad.json", "good.json"] as any);
			vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => false } as any);
			vi.mocked(fs.readFileSync)
				.mockReturnValueOnce("INVALID")
				.mockReturnValueOnce(JSON.stringify(makeWorkflow({ id: "good" })));

			const result = listWorkflows();
			expect(result).toHaveLength(1);
			expect(result[0].id).toBe("good");
		});

		it("should return empty when directory has no JSON files", () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readdirSync).mockReturnValue(["readme.md"] as any);

			const result = listWorkflows();
			expect(result).toEqual([]);
		});

		it("should return empty when directory is empty", () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readdirSync).mockReturnValue([] as any);

			const result = listWorkflows();
			expect(result).toEqual([]);
		});
	});

	// ── deleteWorkflow ───────────────────────────────────────────────────

	describe("deleteWorkflow", () => {
		it("should return true when file exists and is deleted", () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			const result = deleteWorkflow("wf-1");
			expect(result).toBe(true);
			expect(fs.unlinkSync).toHaveBeenCalledWith(
				"/mock-home/.chitragupta/workflows/wf-1.json",
			);
		});

		it("should return false when file does not exist", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false);
			const result = deleteWorkflow("nonexistent");
			expect(result).toBe(false);
			expect(fs.unlinkSync).not.toHaveBeenCalled();
		});

		it("should return false when unlinkSync throws", () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.unlinkSync).mockImplementation(() => {
				throw new Error("EACCES");
			});

			const result = deleteWorkflow("no-perms");
			expect(result).toBe(false);
		});

		it("should check the correct file path", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false);
			deleteWorkflow("target-id");
			expect(fs.existsSync).toHaveBeenCalledWith(
				"/mock-home/.chitragupta/workflows/target-id.json",
			);
		});
	});

	// ── saveExecution ────────────────────────────────────────────────────

	describe("saveExecution", () => {
		it("should create nested directory for the workflow", () => {
			saveExecution(makeExecution());
			expect(fs.mkdirSync).toHaveBeenCalledWith(
				"/mock-home/.chitragupta/workflows/history/wf-1",
				{ recursive: true },
			);
		});

		it("should write to the correct path using executionId", () => {
			saveExecution(makeExecution({ executionId: "exec-42" }));
			expect(fs.writeFileSync).toHaveBeenCalledWith(
				"/mock-home/.chitragupta/workflows/history/wf-1/exec-42.json",
				expect.any(String),
				"utf-8",
			);
		});

		it("should serialize Map steps to plain object", () => {
			const exec = makeExecution({
				steps: new Map([
					["s1", { stepId: "s1", status: "completed", retryCount: 0 }],
					["s2", { stepId: "s2", status: "failed", retryCount: 2 }],
				]),
			});
			saveExecution(exec);

			const writtenJson = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1];
			const parsed = JSON.parse(writtenJson as string);
			expect(parsed.steps).toEqual({
				s1: { stepId: "s1", status: "completed", retryCount: 0 },
				s2: { stepId: "s2", status: "failed", retryCount: 2 },
			});
		});

		it("should write JSON with tab indentation", () => {
			saveExecution(makeExecution());
			const writtenJson = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
			expect(writtenJson).toContain("\t");
		});

		it("should preserve all execution fields in serialization", () => {
			const exec = makeExecution({
				workflowId: "wf-x",
				executionId: "exec-y",
				status: "running",
				startTime: 5000,
				endTime: 6000,
				context: { foo: "bar" },
			});
			saveExecution(exec);

			const writtenJson = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1];
			const parsed = JSON.parse(writtenJson as string);
			expect(parsed.workflowId).toBe("wf-x");
			expect(parsed.executionId).toBe("exec-y");
			expect(parsed.status).toBe("running");
			expect(parsed.startTime).toBe(5000);
			expect(parsed.endTime).toBe(6000);
			expect(parsed.context).toEqual({ foo: "bar" });
		});
	});

	// ── loadExecution ────────────────────────────────────────────────────

	describe("loadExecution", () => {
		it("should return undefined when history dir does not exist", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false);
			const result = loadExecution("exec-1");
			expect(result).toBeUndefined();
		});

		it("should search across workflow subdirectories", () => {
			const serializedExec = JSON.stringify({
				workflowId: "wf-a",
				executionId: "exec-1",
				status: "completed",
				startTime: 1000,
				steps: { s1: { stepId: "s1", status: "completed", retryCount: 0 } },
				context: {},
			});

			vi.mocked(fs.existsSync)
				.mockReturnValueOnce(true)    // history dir exists
				.mockReturnValueOnce(false)   // exec not in wf-a
				.mockReturnValueOnce(true);   // exec found in wf-b
			vi.mocked(fs.readdirSync).mockReturnValue(["wf-a", "wf-b"] as any);
			vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
			vi.mocked(fs.readFileSync).mockReturnValue(serializedExec);

			const result = loadExecution("exec-1");
			expect(result).toBeDefined();
			expect(result!.executionId).toBe("exec-1");
		});

		it("should deserialize object back to Map for steps", () => {
			const serializedExec = JSON.stringify({
				workflowId: "wf-1",
				executionId: "exec-1",
				status: "completed",
				startTime: 1000,
				steps: {
					s1: { stepId: "s1", status: "completed", retryCount: 0 },
					s2: { stepId: "s2", status: "failed", retryCount: 1 },
				},
				context: {},
			});

			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readdirSync).mockReturnValue(["wf-1"] as any);
			vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
			vi.mocked(fs.readFileSync).mockReturnValue(serializedExec);

			const result = loadExecution("exec-1");
			expect(result).toBeDefined();
			expect(result!.steps).toBeInstanceOf(Map);
			expect(result!.steps.size).toBe(2);
			expect(result!.steps.get("s1")!.status).toBe("completed");
			expect(result!.steps.get("s2")!.status).toBe("failed");
		});

		it("should return undefined when execution is not found in any subdir", () => {
			vi.mocked(fs.existsSync)
				.mockReturnValueOnce(true)    // history dir exists
				.mockReturnValueOnce(false)   // not in wf-a
				.mockReturnValueOnce(false);  // not in wf-b
			vi.mocked(fs.readdirSync).mockReturnValue(["wf-a", "wf-b"] as any);
			vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);

			const result = loadExecution("ghost");
			expect(result).toBeUndefined();
		});

		it("should skip non-directory entries in history dir", () => {
			vi.mocked(fs.existsSync)
				.mockReturnValueOnce(true)    // history dir exists
				.mockReturnValueOnce(false);  // not found in wf-1
			vi.mocked(fs.readdirSync).mockReturnValue(["readme.txt", "wf-1"] as any);
			vi.mocked(fs.statSync)
				.mockReturnValueOnce({ isDirectory: () => false } as any)  // readme.txt
				.mockReturnValueOnce({ isDirectory: () => true } as any);  // wf-1

			const result = loadExecution("not-here");
			expect(result).toBeUndefined();
		});

		it("should skip corrupted execution files", () => {
			vi.mocked(fs.existsSync)
				.mockReturnValueOnce(true)    // history dir
				.mockReturnValueOnce(true);   // file exists but corrupt
			vi.mocked(fs.readdirSync).mockReturnValue(["wf-1"] as any);
			vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
			vi.mocked(fs.readFileSync).mockReturnValue("NOT JSON");

			const result = loadExecution("exec-corrupt");
			expect(result).toBeUndefined();
		});

		it("should populate context with empty object if missing", () => {
			const serializedExec = JSON.stringify({
				workflowId: "wf-1",
				executionId: "exec-1",
				status: "completed",
				startTime: 1000,
				steps: {},
			});

			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readdirSync).mockReturnValue(["wf-1"] as any);
			vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
			vi.mocked(fs.readFileSync).mockReturnValue(serializedExec);

			const result = loadExecution("exec-1");
			expect(result).toBeDefined();
			expect(result!.context).toEqual({});
		});
	});

	// ── listExecutions ───────────────────────────────────────────────────

	describe("listExecutions", () => {
		it("should return empty when directory does not exist", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false);
			const result = listExecutions("wf-1");
			expect(result).toEqual([]);
		});

		it("should return executions sorted by startTime descending", () => {
			const exec1 = JSON.stringify({
				workflowId: "wf-1",
				executionId: "older",
				status: "completed",
				startTime: 1000,
				steps: {},
				context: {},
			});
			const exec2 = JSON.stringify({
				workflowId: "wf-1",
				executionId: "newer",
				status: "completed",
				startTime: 3000,
				steps: {},
				context: {},
			});
			const exec3 = JSON.stringify({
				workflowId: "wf-1",
				executionId: "middle",
				status: "completed",
				startTime: 2000,
				steps: {},
				context: {},
			});

			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readdirSync).mockReturnValue(["older.json", "newer.json", "middle.json"] as any);
			vi.mocked(fs.readFileSync)
				.mockReturnValueOnce(exec1)
				.mockReturnValueOnce(exec2)
				.mockReturnValueOnce(exec3);

			const result = listExecutions("wf-1");
			expect(result).toHaveLength(3);
			expect(result[0].executionId).toBe("newer");
			expect(result[1].executionId).toBe("middle");
			expect(result[2].executionId).toBe("older");
		});

		it("should skip non-JSON files", () => {
			const exec = JSON.stringify({
				workflowId: "wf-1",
				executionId: "e1",
				status: "completed",
				startTime: 1000,
				steps: {},
				context: {},
			});

			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readdirSync).mockReturnValue(["e1.json", "notes.txt"] as any);
			vi.mocked(fs.readFileSync).mockReturnValue(exec);

			const result = listExecutions("wf-1");
			expect(result).toHaveLength(1);
		});

		it("should skip corrupted files silently", () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readdirSync).mockReturnValue(["bad.json", "good.json"] as any);
			vi.mocked(fs.readFileSync)
				.mockReturnValueOnce("BAD")
				.mockReturnValueOnce(JSON.stringify({
					workflowId: "wf-1",
					executionId: "good",
					status: "completed",
					startTime: 1000,
					steps: {},
					context: {},
				}));

			const result = listExecutions("wf-1");
			expect(result).toHaveLength(1);
			expect(result[0].executionId).toBe("good");
		});

		it("should return empty when directory has no JSON files", () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readdirSync).mockReturnValue(["readme.md"] as any);

			const result = listExecutions("wf-1");
			expect(result).toEqual([]);
		});

		it("should deserialize step Maps in listed executions", () => {
			const exec = JSON.stringify({
				workflowId: "wf-1",
				executionId: "e1",
				status: "completed",
				startTime: 1000,
				steps: { s1: { stepId: "s1", status: "completed", retryCount: 0 } },
				context: {},
			});

			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readdirSync).mockReturnValue(["e1.json"] as any);
			vi.mocked(fs.readFileSync).mockReturnValue(exec);

			const result = listExecutions("wf-1");
			expect(result[0].steps).toBeInstanceOf(Map);
			expect(result[0].steps.get("s1")!.stepId).toBe("s1");
		});
	});
});
