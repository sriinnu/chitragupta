/**
 * @module eval-harness
 * @description Eval Harness — Structured Skill Evaluation Framework.
 *
 * Provides structured evaluation of skills via golden (happy path) and
 * adversarial (attack/edge case) test cases. Each skill can declare
 * eval cases in `eval/cases/*.json` within its directory.
 *
 * Cherry-picked from vaayu-skill-factory-pro's eval system and adapted
 * to the Vidya spec.
 *
 * @packageDocumentation
 */

import { readFile, readdir } from "node:fs/promises";
import { join, extname } from "node:path";
import type { EvalCase, EvalResult } from "./types-v2.js";

// ─── Loading ────────────────────────────────────────────────────────────────

/**
 * Load eval cases from a skill directory.
 *
 * Scans `eval/cases/*.json` for structured eval case files.
 * Each JSON file should contain either a single EvalCase or an array of EvalCase objects.
 *
 * @param skillDir - Absolute path to the skill directory.
 * @returns Array of loaded eval cases, empty if none found.
 */
export async function loadEvalCases(skillDir: string): Promise<EvalCase[]> {
	const evalDir = join(skillDir, "eval", "cases");
	const cases: EvalCase[] = [];

	let entries: string[];
	try {
		entries = await readdir(evalDir);
	} catch {
		return cases; // No eval directory — that's fine
	}

	for (const entry of entries.sort()) {
		if (extname(entry) !== ".json") continue;

		try {
			const content = await readFile(join(evalDir, entry), "utf-8");
			const parsed = JSON.parse(content);

			if (Array.isArray(parsed)) {
				cases.push(...parsed.filter(isValidEvalCase));
			} else if (isValidEvalCase(parsed)) {
				cases.push(parsed);
			}
		} catch {
			// Skip malformed files silently
		}
	}

	return cases;
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Type guard: check if an object is a valid EvalCase.
 */
function isValidEvalCase(obj: unknown): obj is EvalCase {
	if (typeof obj !== "object" || obj === null) return false;
	const o = obj as Record<string, unknown>;
	return (
		typeof o.id === "string" &&
		o.id.length > 0 &&
		typeof o.input === "object" &&
		o.input !== null &&
		(typeof o.expected === "object" || typeof o.expected === "string")
	);
}

/**
 * Validate eval cases for structural correctness.
 *
 * Returns a list of issues found. Empty array = all valid.
 *
 * @param cases - Array of eval cases to validate.
 * @returns Array of validation error strings.
 */
export function validateEvalCases(cases: EvalCase[]): string[] {
	const errors: string[] = [];
	const seenIds = new Set<string>();

	for (let i = 0; i < cases.length; i++) {
		const ec = cases[i];

		if (!ec.id || typeof ec.id !== "string") {
			errors.push(`case[${i}]: missing or invalid id`);
		} else if (seenIds.has(ec.id)) {
			errors.push(`case[${i}]: duplicate id "${ec.id}"`);
		} else {
			seenIds.add(ec.id);
		}

		if (!ec.input || typeof ec.input !== "object") {
			errors.push(`case[${i}] (${ec.id ?? "?"}): missing or invalid input`);
		}

		if (ec.expected === undefined || ec.expected === null) {
			errors.push(`case[${i}] (${ec.id ?? "?"}): missing expected`);
		}

		if (ec.type !== undefined && ec.type !== "golden" && ec.type !== "adversarial") {
			errors.push(`case[${i}] (${ec.id ?? "?"}): type must be "golden" or "adversarial" (got "${ec.type}")`);
		}
	}

	return errors;
}

// ─── Execution ──────────────────────────────────────────────────────────────

/**
 * Executor function type for running a single eval case.
 * Takes the eval case input and returns the actual output.
 */
export type EvalExecutor = (
	input: Record<string, unknown>,
) => Promise<unknown>;

/**
 * Comparator function for eval results.
 * Returns true if actual matches expected.
 * Default: deep JSON equality.
 */
export type EvalComparator = (
	expected: Record<string, unknown> | string,
	actual: unknown,
) => boolean;

/**
 * Default comparator: JSON stringification equality.
 */
function defaultComparator(
	expected: Record<string, unknown> | string,
	actual: unknown,
): boolean {
	if (typeof expected === "string") {
		return String(actual) === expected;
	}
	return JSON.stringify(actual) === JSON.stringify(expected);
}

/**
 * Run eval cases against a skill and collect results.
 *
 * @param skillName - Name of the skill being evaluated.
 * @param cases - Array of eval cases to run.
 * @param executor - Function that executes the skill with given input.
 * @param comparator - Optional custom comparator for matching expected vs actual.
 * @returns Aggregated evaluation results.
 */
export async function runEvalSuite(
	skillName: string,
	cases: EvalCase[],
	executor: EvalExecutor,
	comparator: EvalComparator = defaultComparator,
): Promise<EvalResult> {
	const results: EvalResult["results"] = [];
	let passed = 0;
	let failed = 0;

	for (const ec of cases) {
		try {
			const actual = await executor(ec.input);
			const match = comparator(ec.expected, actual);

			if (match) {
				passed++;
				results.push({ caseId: ec.id, passed: true, actual });
			} else {
				failed++;
				results.push({ caseId: ec.id, passed: false, actual });
			}
		} catch (err) {
			failed++;
			results.push({
				caseId: ec.id,
				passed: false,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return {
		skillName,
		totalCases: cases.length,
		passed,
		failed,
		results,
	};
}

// ─── Filtering ──────────────────────────────────────────────────────────────

/**
 * Filter eval cases by type.
 *
 * @param cases - Array of eval cases.
 * @param type - Filter to "golden" or "adversarial" cases.
 * @returns Filtered array.
 */
export function filterByType(
	cases: EvalCase[],
	type: "golden" | "adversarial",
): EvalCase[] {
	return cases.filter((ec) => ec.type === type);
}

/**
 * Get a summary string for an eval result.
 */
export function formatEvalSummary(result: EvalResult): string {
	const status = result.failed === 0 ? "PASS" : "FAIL";
	const lines = [
		`Eval: ${result.skillName} — ${status}`,
		`  ${result.passed}/${result.totalCases} passed`,
	];

	if (result.failed > 0) {
		lines.push(`  Failed:`);
		for (const r of result.results) {
			if (!r.passed) {
				lines.push(`    - ${r.caseId}: ${r.error ?? "mismatch"}`);
			}
		}
	}

	return lines.join("\n");
}
