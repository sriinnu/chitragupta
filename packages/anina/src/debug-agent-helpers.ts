/**
 * @chitragupta/anina — Anveshi (Debug Agent) helper functions.
 *
 * Prompt building, response parsing, test output parsing, and
 * validation execution. All pure or side-effect-contained functions
 * operating on passed-in data.
 */

import { parseField, extractText } from "./agent-response-parser.js";
import { safeExecSync } from "./safe-exec.js";
import type { AgentMessage } from "./types.js";
import type { BugReport, DebugResult } from "./debug-agent.js";

// ─── Prompt Building ────────────────────────────────────────────────────────

/** Build the output format instructions for the debug prompt. */
export function buildOutputInstructions(autoFix: boolean): string {
	const lines = [
		"Format your response to include these clearly labeled sections:", "",
		"ROOT CAUSE: <1-3 sentence explanation of WHY the bug occurs>",
		"BUG LOCATION: <file>:<line>",
		"PROPOSED FIX: <description of the minimal change needed>",
		"CONFIDENCE: <number 0.0 to 1.0>",
		"FILES INVESTIGATED: <comma-separated list of files you read>",
	];
	if (autoFix) lines.push("FIX APPLIED: YES or NO");
	return lines.join("\n");
}

/** Build the investigation prompt from a bug report. */
export function buildInvestigatePrompt(report: BugReport, autoFix: boolean, testCommand?: string): string {
	const parts: string[] = [];
	parts.push("Investigate the following bug report and find the root cause.", "");
	parts.push(`ERROR: ${report.error}`);
	if (report.stackTrace) {
		parts.push("", "STACK TRACE:", "```", report.stackTrace, "```");
	}
	if (report.reproduction) parts.push("", `REPRODUCTION: ${report.reproduction}`);
	if (report.relevantFiles && report.relevantFiles.length > 0) {
		parts.push("", "RELEVANT FILES:");
		for (const f of report.relevantFiles) parts.push(`- ${f}`);
	}
	parts.push("", "Follow your investigation method systematically:",
		"1. Parse the error — what is the symptom?",
		"2. Locate the source — find the file and line",
		"3. Hypothesize — what could cause this?",
		"4. Verify — read surrounding code, check recent changes (git log, git blame)",
		"5. Propose — describe the minimal fix",
	);
	if (autoFix) {
		parts.push("6. APPLY the fix — edit the file(s) to implement your proposed fix");
		if (testCommand) parts.push(`7. Run tests to verify: ${testCommand}`);
	}
	parts.push("", buildOutputInstructions(autoFix));
	return parts.join("\n");
}

// ─── Response Parsing ───────────────────────────────────────────────────────

/** Parse the agent's response into a structured DebugResult. */
export function parseDebugResponse(message: AgentMessage): DebugResult {
	const text = extractText(message);
	const rootCause = parseField(text, "ROOT CAUSE") ?? "Unable to determine root cause.";
	const proposedFix = parseField(text, "PROPOSED FIX") ?? "No fix proposed.";
	const confidenceStr = parseField(text, "CONFIDENCE") ?? "0.5";
	const bugLocationStr = parseField(text, "BUG LOCATION");
	const filesStr = parseField(text, "FILES INVESTIGATED") ?? "";
	const fixAppliedStr = parseField(text, "FIX APPLIED");

	const confidence = Math.max(0, Math.min(1, parseFloat(confidenceStr) || 0.5));
	let bugLocation: { file: string; line: number } | undefined;
	if (bugLocationStr) {
		const m = bugLocationStr.match(/^(.+?):(\d+)/);
		if (m) bugLocation = { file: m[1].trim(), line: parseInt(m[2], 10) };
	}
	const filesInvestigated = filesStr.split(/[,\n]/).map((f) => f.trim()).filter((f) => f.length > 0);
	const fixApplied = fixAppliedStr?.trim().toUpperCase() === "YES";

	return { rootCause, filesInvestigated, bugLocation, proposedFix, fixApplied, confidence };
}

// ─── Test Output Parsing ────────────────────────────────────────────────────

/** Parse test output into error message and stack trace. */
export function parseTestOutput(output: string): { error: string; stackTrace?: string } {
	const lines = output.split("\n");
	let errorLine = "";
	let stackStart = -1;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.match(/^\s*(Error|TypeError|ReferenceError|SyntaxError|RangeError):/)) {
			errorLine = line.trim(); stackStart = i + 1; break;
		}
		if (line.match(/^\s*(FAIL|AssertionError|expect\()/)) {
			errorLine = line.trim(); stackStart = i + 1; break;
		}
		if (line.toLowerCase().includes("error") && !errorLine) errorLine = line.trim();
	}

	let stackTrace: string | undefined;
	if (stackStart > 0) {
		const stackLines: string[] = [];
		for (let i = stackStart; i < lines.length; i++) {
			if (lines[i].match(/^\s+at /)) stackLines.push(lines[i]);
			else if (stackLines.length > 0) break;
		}
		if (stackLines.length > 0) stackTrace = stackLines.join("\n");
	}

	return { error: errorLine || output.slice(0, 500), stackTrace };
}

// ─── Validation ─────────────────────────────────────────────────────────────

/** Run validation commands (build + test) and return pass/fail with output. */
export async function runValidation(
	workingDirectory: string,
	buildCommand?: string,
	testCommand?: string,
): Promise<{ passed: boolean; output: string }> {
	const outputs: string[] = [];
	let allPassed = true;

	for (const { label, cmd } of [
		{ label: "build", cmd: buildCommand },
		{ label: "test", cmd: testCommand },
	]) {
		if (!cmd) continue;
		try {
			const result = safeExecSync(cmd, {
				cwd: workingDirectory, encoding: "utf-8", timeout: 120_000,
				stdio: ["pipe", "pipe", "pipe"],
			});
			outputs.push(`[${label}] PASSED\n${result}`);
		} catch (err: unknown) {
			const execErr = err as { stdout?: string; stderr?: string; message?: string };
			if (execErr.message?.startsWith("Command rejected:")) throw err;
			allPassed = false;
			outputs.push(`[${label}] FAILED\n${execErr.stderr ?? ""}\n${execErr.stdout ?? ""}`);
		}
	}

	return { passed: allPassed, output: outputs.join("\n---\n") };
}
