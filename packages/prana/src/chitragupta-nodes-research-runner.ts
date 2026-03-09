/**
 * Bounded execution and evaluation helpers for research workflows.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
	councilSupports,
	type ResearchRunData,
	type ResearchScope,
	pickMetric,
	validateScope,
} from "./chitragupta-nodes-research-shared.js";

const execFileAsync = promisify(execFile);

type ScopeSnapshot = {
	mode: "git" | "hash-only";
	changedPaths: string[];
	hashes: Map<string, string | null>;
};

function normalizeRelativePath(file: string): string {
	return file.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function uniqueScopeFiles(scope: ResearchScope): string[] {
	return [...new Set([...scope.targetFiles, ...scope.immutableFiles].map(normalizeRelativePath))];
}

function allowedPaths(scope: ResearchScope): Set<string> {
	return new Set(scope.targetFiles.map(normalizeRelativePath));
}

function immutablePaths(scope: ResearchScope): Set<string> {
	return new Set(scope.immutableFiles.map(normalizeRelativePath));
}

async function hashFile(filePath: string): Promise<string | null> {
	try {
		const content = await fs.readFile(filePath);
		return createHash("sha256").update(content).digest("hex");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

async function captureScopeSnapshot(scope: ResearchScope): Promise<ScopeSnapshot> {
	const hashes = new Map<string, string | null>();
	for (const file of uniqueScopeFiles(scope)) {
		hashes.set(file, await hashFile(path.join(scope.cwd, file)));
	}
	try {
		const { stdout } = await execFileAsync(
			"git",
			["-C", scope.cwd, "status", "--porcelain=v1", "--untracked-files=all"],
			{ maxBuffer: 1024 * 1024 },
		);
		const changedPaths = stdout
			.split("\n")
			.map((line) => line.trimEnd())
			.filter(Boolean)
			.map((line) => {
				const body = line.slice(3);
				const renameIndex = body.indexOf(" -> ");
				return normalizeRelativePath(renameIndex >= 0 ? body.slice(renameIndex + 4) : body);
			});
		return { mode: "git", changedPaths, hashes };
	} catch {
		return { mode: "hash-only", changedPaths: [], hashes };
	}
}

function assertScopeSnapshot(scope: ResearchScope, snapshot: ScopeSnapshot, phase: "before" | "after"): void {
	if (snapshot.mode !== "git") return;
	const allowed = allowedPaths(scope);
	const outside = snapshot.changedPaths.filter((file) => !allowed.has(file));
	if (outside.length > 0) {
		throw new Error(
			`${phase === "before" ? "Pre-existing" : "New"} out-of-scope changes detected: ${outside.join(", ")}`,
		);
	}
}

function compareScopeSnapshots(scope: ResearchScope, before: ScopeSnapshot, after: ScopeSnapshot): {
	targetFilesChanged: string[];
} {
	const immutable = immutablePaths(scope);
	for (const file of immutable) {
		if ((before.hashes.get(file) ?? null) !== (after.hashes.get(file) ?? null)) {
			throw new Error(`Immutable file was modified during experiment: ${file}`);
		}
	}
	const changedTargets = scope.targetFiles.filter((file) => {
		const key = normalizeRelativePath(file);
		return (before.hashes.get(key) ?? null) !== (after.hashes.get(key) ?? null);
	});
	return { targetFilesChanged: changedTargets };
}

async function runBoundedCommand(scope: ResearchScope): Promise<ResearchRunData> {
	validateScope(scope);
	const before = await captureScopeSnapshot(scope);
	assertScopeSnapshot(scope, before, "before");
	const startedAt = Date.now();
	try {
		const { stdout, stderr } = await execFileAsync(scope.command, scope.commandArgs, {
			cwd: scope.cwd,
			timeout: scope.budgetMs,
			maxBuffer: 10 * 1024 * 1024,
		});
		const after = await captureScopeSnapshot(scope);
		assertScopeSnapshot(scope, after, "after");
		const compared = compareScopeSnapshots(scope, before, after);
		const combined = `${stdout}\n${stderr}`;
		return {
			command: scope.command,
			commandArgs: scope.commandArgs,
			cwd: scope.cwd,
			metricName: scope.metricName,
			metric: pickMetric(combined, scope.metricPattern),
			stdout,
			stderr,
			exitCode: 0,
			timedOut: false,
			durationMs: Date.now() - startedAt,
			scopeGuard: after.mode,
			targetFilesChanged: compared.targetFilesChanged,
		};
	} catch (error) {
		const after = await captureScopeSnapshot(scope);
		const compared = compareScopeSnapshots(scope, before, after);
		const err = error as Error & {
			code?: number | string;
			stdout?: string;
			stderr?: string;
			signal?: string | null;
		};
		const combined = `${err.stdout ?? ""}\n${err.stderr ?? ""}`;
		const enriched = Object.assign(new Error(`Research run failed: ${err.message}`), {
			stdout: err.stdout ?? "",
			stderr: err.stderr ?? "",
			metric: pickMetric(combined, scope.metricPattern),
			durationMs: Date.now() - startedAt,
			timedOut: err.signal === "SIGTERM",
			scopeGuard: after.mode,
			targetFilesChanged: compared.targetFilesChanged,
		});
		throw enriched;
	}
}

export async function executeResearchRun(
	scope: ResearchScope,
	council: Record<string, unknown>,
): Promise<ResearchRunData> {
	if (!councilSupports(council.finalVerdict)) {
		throw new Error(`Research council did not approve execution: ${String(council.finalVerdict ?? "unknown")}`);
	}
	const route =
		council.route && typeof council.route === "object"
			? council.route as {
				selectedCapabilityId?: unknown;
				discoverableOnly?: unknown;
				reason?: unknown;
			}
			: null;
	const executionRoute =
		council.executionRoute && typeof council.executionRoute === "object"
			? council.executionRoute as {
				selectedCapabilityId?: unknown;
				discoverableOnly?: unknown;
				reason?: unknown;
			}
			: null;
	const gatingRoute = executionRoute ?? route;
	if (gatingRoute && (gatingRoute.discoverableOnly === true || typeof gatingRoute.selectedCapabilityId !== "string" || !gatingRoute.selectedCapabilityId.trim())) {
		const reason = typeof gatingRoute.reason === "string" && gatingRoute.reason.trim()
			? gatingRoute.reason.trim()
			: "research route did not resolve to an executable engine capability";
		throw new Error(`Research route did not authorize execution: ${reason}`);
	}
	return runBoundedCommand(scope);
}

export async function evaluateResearchResult(
	baseline: Record<string, unknown>,
	run: Record<string, unknown>,
): Promise<{
	metricName: string;
	objective: "minimize" | "maximize";
	baselineMetric: number | null;
	observedMetric: number | null;
	delta: number | null;
	improved: boolean;
	decision: "keep" | "discard";
}> {
	const objective = (baseline.objective === "maximize" || run.objective === "maximize") ? "maximize" : "minimize";
	const baselineMetric = typeof baseline.baselineMetric === "number" ? baseline.baselineMetric : null;
	const observedMetric = typeof run.metric === "number" ? run.metric : null;
	const delta = baselineMetric !== null && observedMetric !== null
		? objective === "minimize"
			? baselineMetric - observedMetric
			: observedMetric - baselineMetric
		: null;
	const improved = delta !== null && delta > 0;
	return {
		metricName: typeof baseline.metricName === "string" ? baseline.metricName : String(run.metricName ?? "val_bpb"),
		objective,
		baselineMetric,
		observedMetric,
		delta,
		improved,
		decision: improved ? "keep" : "discard",
	};
}
