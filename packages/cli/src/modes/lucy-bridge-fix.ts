import {
	normalizeContextForReuse,
	packContextWithFallback,
} from "../context-packing.js";
import { routeViaBridge } from "./coding-router.js";

type LucyBridgeExecutionResult = Awaited<ReturnType<typeof routeViaBridge>>;

/** Patterns that indicate test failures in CLI output. */
export const TEST_FAILURE_PATTERNS: readonly RegExp[] = [
	/FAIL\s+\d+\s+test/i,
	/(\d+)\s+failed/i,
	/Tests?:\s+\d+\s+failed/i,
	/ERROR\s+in\s+test/i,
	/AssertionError/i,
	/expect\(.*\)\.to/i,
	/vitest.*FAIL/i,
	/jest.*FAIL/i,
];

/** Check whether a Lucy/Takumi run looks like a fixable test regression. */
export function hasTestFailures(output: string): boolean {
	return TEST_FAILURE_PATTERNS.some((p) => p.test(output));
}

/** Extract a concise failure hint that can seed the follow-up repair task. */
export function extractFailureHint(output: string): string {
	const lines = output.split("\n");
	const failLines = lines.filter((l) =>
		TEST_FAILURE_PATTERNS.some((p) => p.test(l)),
	);
	return failLines.slice(0, 5).join("\n") || "Unknown test failure";
}

/**
 * Decide whether Lucy should try an autonomous repair pass.
 * The threshold gates only clear test/regression-like failures.
 */
export function shouldAutoFix(
	result: LucyBridgeExecutionResult,
	threshold: number,
): boolean {
	if (result.exitCode > 128) return false;
	if (result.output.length < 10) return false;

	const output = result.output.toLowerCase();
	if (
		output.includes("segmentation fault")
		|| output.includes("permission denied")
		|| output.includes("command not found")
		|| output.includes("timed out")
		|| output.includes("timeout")
	) {
		return false;
	}

	let confidence = 0;
	if (hasTestFailures(result.output)) confidence += 0.45;
	if (/assertionerror|expect\(|vitest|jest|failing test|tests?:\s+\d+\s+failed|\b\d+\s+failed\b/i.test(result.output)) confidence += 0.25;
	if (result.bridgeResult?.testsRun && result.bridgeResult.testsRun.failed > 0) confidence += 0.2;
	if (result.bridgeResult?.filesModified?.length) confidence += 0.1;

	return confidence >= threshold;
}

/** Build the focused repair task for Lucy's next autonomous pass. */
export async function buildFixTask(originalTask: string, failureOutput: string): Promise<string> {
	const hint = extractFailureHint(failureOutput);
	const recentOutputSection = await buildFixOutputSection(failureOutput);

	return (
		`Fix the test failures from the previous task.\n\n` +
		`Original task: ${originalTask}\n\n` +
		`Failure summary:\n${hint}\n\n` +
		recentOutputSection
	);
}

async function buildFixOutputSection(failureOutput: string): Promise<string> {
	const normalized = await normalizeContextForReuse(failureOutput);
	const sourceText = typeof normalized === "string" && normalized.trim() ? normalized : failureOutput;
	const shouldPack = sourceText.length >= 420;
	if (!shouldPack) {
		return `Recent output (last 2000 chars):\n${sourceText.slice(-2000)}`;
	}
	const packed = await packContextWithFallback(sourceText);
	if (!packed) {
		return `Recent output (last 2000 chars):\n${sourceText.slice(-2000)}`;
	}
	return (
		`Recent output (packed via ${packed.runtime}, saved ${Math.max(0, Math.round(packed.savings * 100))}%):\n` +
		packed.packedText
	);
}
