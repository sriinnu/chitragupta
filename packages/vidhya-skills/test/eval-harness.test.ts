import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { EvalCase } from "../src/types-v2.js";
import {
	loadEvalCases,
	validateEvalCases,
	runEvalSuite,
	filterByType,
	formatEvalSummary,
} from "../src/eval-harness.js";

describe("Eval Harness", () => {
	let skillDir: string;

	beforeEach(async () => {
		skillDir = await mkdtemp(join(tmpdir(), "eval-test-"));
	});

	afterEach(async () => {
		await rm(skillDir, { recursive: true, force: true });
	});

	describe("loadEvalCases", () => {
		it("should return empty for no eval directory", async () => {
			const cases = await loadEvalCases(skillDir);
			expect(cases).toEqual([]);
		});

		it("should load single case from JSON", async () => {
			await mkdir(join(skillDir, "eval", "cases"), { recursive: true });
			const evalCase: EvalCase = {
				id: "golden-1",
				input: { query: "hello" },
				expected: { greeting: "world" },
				type: "golden",
			};
			await writeFile(
				join(skillDir, "eval", "cases", "golden.json"),
				JSON.stringify(evalCase),
			);

			const cases = await loadEvalCases(skillDir);
			expect(cases).toHaveLength(1);
			expect(cases[0].id).toBe("golden-1");
		});

		it("should load array of cases from JSON", async () => {
			await mkdir(join(skillDir, "eval", "cases"), { recursive: true });
			const evalCases: EvalCase[] = [
				{ id: "g1", input: { a: 1 }, expected: { b: 2 }, type: "golden" },
				{ id: "g2", input: { a: 3 }, expected: { b: 4 }, type: "golden" },
			];
			await writeFile(
				join(skillDir, "eval", "cases", "golden.json"),
				JSON.stringify(evalCases),
			);

			const cases = await loadEvalCases(skillDir);
			expect(cases).toHaveLength(2);
		});

		it("should load from multiple files sorted by name", async () => {
			await mkdir(join(skillDir, "eval", "cases"), { recursive: true });
			await writeFile(
				join(skillDir, "eval", "cases", "adversarial.json"),
				JSON.stringify({ id: "adv-1", input: { x: "evil" }, expected: "rejected" }),
			);
			await writeFile(
				join(skillDir, "eval", "cases", "golden.json"),
				JSON.stringify({ id: "gold-1", input: { x: "good" }, expected: "accepted" }),
			);

			const cases = await loadEvalCases(skillDir);
			expect(cases).toHaveLength(2);
			// Sorted by filename: adversarial first
			expect(cases[0].id).toBe("adv-1");
			expect(cases[1].id).toBe("gold-1");
		});

		it("should skip non-JSON files", async () => {
			await mkdir(join(skillDir, "eval", "cases"), { recursive: true });
			await writeFile(join(skillDir, "eval", "cases", "readme.md"), "# Not JSON");
			await writeFile(
				join(skillDir, "eval", "cases", "good.json"),
				JSON.stringify({ id: "g1", input: {}, expected: "ok" }),
			);

			const cases = await loadEvalCases(skillDir);
			expect(cases).toHaveLength(1);
		});

		it("should skip malformed JSON", async () => {
			await mkdir(join(skillDir, "eval", "cases"), { recursive: true });
			await writeFile(join(skillDir, "eval", "cases", "bad.json"), "not json{{{");
			await writeFile(
				join(skillDir, "eval", "cases", "good.json"),
				JSON.stringify({ id: "g1", input: {}, expected: "ok" }),
			);

			const cases = await loadEvalCases(skillDir);
			expect(cases).toHaveLength(1);
		});

		it("should skip invalid eval case objects", async () => {
			await mkdir(join(skillDir, "eval", "cases"), { recursive: true });
			// Missing 'id' field
			await writeFile(
				join(skillDir, "eval", "cases", "bad.json"),
				JSON.stringify({ input: {}, expected: "ok" }),
			);

			const cases = await loadEvalCases(skillDir);
			expect(cases).toHaveLength(0);
		});
	});

	describe("validateEvalCases", () => {
		it("should pass for valid cases", () => {
			const cases: EvalCase[] = [
				{ id: "g1", input: { a: 1 }, expected: "ok", type: "golden" },
				{ id: "a1", input: { b: 2 }, expected: { c: 3 }, type: "adversarial" },
			];
			const errors = validateEvalCases(cases);
			expect(errors).toEqual([]);
		});

		it("should detect duplicate IDs", () => {
			const cases: EvalCase[] = [
				{ id: "dup", input: {}, expected: "a" },
				{ id: "dup", input: {}, expected: "b" },
			];
			const errors = validateEvalCases(cases);
			expect(errors.some((e) => e.includes("duplicate"))).toBe(true);
		});

		it("should detect missing input", () => {
			const cases = [{ id: "bad", expected: "ok" }] as unknown as EvalCase[];
			const errors = validateEvalCases(cases);
			expect(errors.some((e) => e.includes("input"))).toBe(true);
		});

		it("should detect invalid type", () => {
			const cases = [
				{ id: "bad", input: {}, expected: "ok", type: "invalid" as EvalCase["type"] },
			] as EvalCase[];
			const errors = validateEvalCases(cases);
			expect(errors.some((e) => e.includes("type"))).toBe(true);
		});
	});

	describe("runEvalSuite", () => {
		it("should run all cases and report results", async () => {
			const cases: EvalCase[] = [
				{ id: "pass", input: { x: 1 }, expected: { doubled: 2 } },
				{ id: "fail", input: { x: 2 }, expected: { doubled: 5 } },
			];

			const result = await runEvalSuite(
				"test-skill",
				cases,
				async (input) => ({ doubled: (input.x as number) * 2 }),
			);

			expect(result.skillName).toBe("test-skill");
			expect(result.totalCases).toBe(2);
			expect(result.passed).toBe(1);
			expect(result.failed).toBe(1);
			expect(result.results[0].passed).toBe(true);
			expect(result.results[1].passed).toBe(false);
		});

		it("should handle executor errors", async () => {
			const cases: EvalCase[] = [
				{ id: "error-case", input: { x: 1 }, expected: "anything" },
			];

			const result = await runEvalSuite(
				"test-skill",
				cases,
				async () => { throw new Error("boom"); },
			);

			expect(result.failed).toBe(1);
			expect(result.results[0].error).toBe("boom");
		});

		it("should work with string expected values", async () => {
			const cases: EvalCase[] = [
				{ id: "str", input: {}, expected: "hello" },
			];

			const result = await runEvalSuite(
				"test-skill",
				cases,
				async () => "hello",
			);

			expect(result.passed).toBe(1);
		});

		it("should support custom comparator", async () => {
			const cases: EvalCase[] = [
				{ id: "fuzzy", input: {}, expected: "HELLO" },
			];

			const result = await runEvalSuite(
				"test-skill",
				cases,
				async () => "hello",
				(expected, actual) =>
					String(expected).toLowerCase() === String(actual).toLowerCase(),
			);

			expect(result.passed).toBe(1);
		});
	});

	describe("filterByType", () => {
		const cases: EvalCase[] = [
			{ id: "g1", input: {}, expected: "a", type: "golden" },
			{ id: "a1", input: {}, expected: "b", type: "adversarial" },
			{ id: "g2", input: {}, expected: "c", type: "golden" },
			{ id: "none", input: {}, expected: "d" },
		];

		it("should filter golden cases", () => {
			expect(filterByType(cases, "golden")).toHaveLength(2);
		});

		it("should filter adversarial cases", () => {
			expect(filterByType(cases, "adversarial")).toHaveLength(1);
		});
	});

	describe("formatEvalSummary", () => {
		it("should format passing summary", () => {
			const summary = formatEvalSummary({
				skillName: "test",
				totalCases: 3,
				passed: 3,
				failed: 0,
				results: [
					{ caseId: "a", passed: true },
					{ caseId: "b", passed: true },
					{ caseId: "c", passed: true },
				],
			});

			expect(summary).toContain("PASS");
			expect(summary).toContain("3/3");
		});

		it("should format failing summary with details", () => {
			const summary = formatEvalSummary({
				skillName: "test",
				totalCases: 2,
				passed: 1,
				failed: 1,
				results: [
					{ caseId: "good", passed: true },
					{ caseId: "bad", passed: false, error: "timeout" },
				],
			});

			expect(summary).toContain("FAIL");
			expect(summary).toContain("bad");
			expect(summary).toContain("timeout");
		});
	});
});
