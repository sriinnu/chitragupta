/**
 * Bounded execution and evaluation helpers for research workflows.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import {
	councilSupports,
	type ResearchFinalizeResult,
	type ResearchRunData,
	type ResearchScope,
	type ResearchScopeSnapshot,
	pickMetric,
	validateScope,
} from "./chitragupta-nodes-research-shared.js";

const execFileAsync = promisify(execFile);

type ScopeSnapshot = {
	mode: "git" | "hash-only";
	changedPaths: string[];
	hashes: Map<string, string | null>;
	fileContents: Map<string, string | null>;
	gitBranch: string | null;
	gitHeadCommit: string | null;
};

type ExecutableResearchScope = ResearchScope & {
	env?: Record<string, string>;
};

type ResearchExecutionRoute = {
	routeClass?: unknown;
	capability?: unknown;
	selectedCapabilityId?: unknown;
	discoverableOnly?: unknown;
	reason?: unknown;
	executionBinding?: {
		source?: unknown;
		selectedModelId?: unknown;
		selectedProviderId?: unknown;
		preferredModelIds?: unknown;
		preferredProviderIds?: unknown;
		candidateModelIds?: unknown;
		allowCrossProvider?: unknown;
	} | null;
} | null;

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

async function readFileContent(filePath: string): Promise<string | null> {
	try {
		return await fs.readFile(filePath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

async function captureScopeSnapshot(scope: ResearchScope): Promise<ScopeSnapshot> {
	const hashes = new Map<string, string | null>();
	const fileContents = new Map<string, string | null>();
	for (const file of uniqueScopeFiles(scope)) {
		const fullPath = path.join(scope.cwd, file);
		hashes.set(file, await hashFile(fullPath));
		if (allowedPaths(scope).has(file)) {
			fileContents.set(file, await readFileContent(fullPath));
		}
	}
	try {
		const { stdout } = await execFileAsync(
			"git",
			["-C", scope.cwd, "status", "--porcelain=v1", "--untracked-files=all"],
			{ maxBuffer: 1024 * 1024 },
		);
		const [branchResult, headResult] = await Promise.allSettled([
			execFileAsync("git", ["-C", scope.cwd, "rev-parse", "--abbrev-ref", "HEAD"], { maxBuffer: 1024 * 1024 }),
			execFileAsync("git", ["-C", scope.cwd, "rev-parse", "HEAD"], { maxBuffer: 1024 * 1024 }),
		]);
		const gitBranch =
			branchResult.status === "fulfilled" &&
			typeof branchResult.value.stdout === "string" &&
			branchResult.value.stdout.trim()
				? branchResult.value.stdout.trim()
			: null;
		const gitHeadCommit =
			headResult.status === "fulfilled" &&
			typeof headResult.value.stdout === "string" &&
			headResult.value.stdout.trim()
				? headResult.value.stdout.trim()
			: null;
		const changedPaths = stdout
			.split("\n")
			.map((line) => line.trimEnd())
			.filter(Boolean)
			.map((line) => {
				const body = line.slice(3);
				const renameIndex = body.indexOf(" -> ");
				return normalizeRelativePath(renameIndex >= 0 ? body.slice(renameIndex + 4) : body);
			});
		return { mode: "git", changedPaths, hashes, fileContents, gitBranch, gitHeadCommit };
	} catch {
		return { mode: "hash-only", changedPaths: [], hashes, fileContents, gitBranch: null, gitHeadCommit: null };
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
	if (
		before.mode === "git" &&
		after.mode === "git" &&
		(before.gitBranch !== after.gitBranch || before.gitHeadCommit !== after.gitHeadCommit)
	) {
		throw new Error("Git refs changed during experiment execution");
	}
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

function dirtyStateForSnapshot(snapshot: ScopeSnapshot): boolean | null {
	return snapshot.mode === "git" ? snapshot.changedPaths.length > 0 : null;
}

function serializeScopeSnapshot(scope: ResearchScope, snapshot: ScopeSnapshot): ResearchScopeSnapshot {
	const fileContents: Record<string, string | null> = {};
	for (const file of scope.targetFiles) {
		const key = normalizeRelativePath(file);
		fileContents[key] = snapshot.fileContents.get(key) ?? null;
	}
	return {
		mode: snapshot.mode,
		fileContents,
	};
}

async function runBoundedCommand(scope: ExecutableResearchScope): Promise<ResearchRunData> {
	validateScope(scope);
	const before = await captureScopeSnapshot(scope);
	assertScopeSnapshot(scope, before, "before");
	const startedAt = Date.now();
	try {
		const { stdout, stderr } = await execFileAsync(scope.command, scope.commandArgs, {
			cwd: scope.cwd,
			env: scope.env ? { ...process.env, ...scope.env } : process.env,
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
			gitBranch: before.gitBranch,
			gitHeadCommit: before.gitHeadCommit,
			gitDirtyBefore: dirtyStateForSnapshot(before),
			gitDirtyAfter: dirtyStateForSnapshot(after),
			scopeSnapshot: serializeScopeSnapshot(scope, before),
		};
	} catch (error) {
		const after = await captureScopeSnapshot(scope);
		assertScopeSnapshot(scope, after, "after");
		let compared: { targetFilesChanged: string[] } = { targetFilesChanged: [] };
		let scopeError: Error | null = null;
		try {
			compared = compareScopeSnapshots(scope, before, after);
		} catch (compareError) {
			scopeError = compareError instanceof Error ? compareError : new Error(String(compareError));
		}
		const err = error as Error & {
			code?: number | string;
			stdout?: string;
			stderr?: string;
			signal?: string | null;
		};
		const combined = `${err.stdout ?? ""}\n${err.stderr ?? ""}`;
		const message = scopeError
			? scopeError.message
			: `Research run failed: ${err.message}`;
		const enriched = Object.assign(new Error(message), {
			stdout: err.stdout ?? "",
			stderr: err.stderr ?? "",
			metric: pickMetric(combined, scope.metricPattern),
			exitCode: typeof err.code === "number" ? err.code : null,
			durationMs: Date.now() - startedAt,
			timedOut: err.signal === "SIGTERM",
			scopeGuard: after.mode,
			targetFilesChanged: compared.targetFilesChanged,
			gitBranch: before.gitBranch,
			gitHeadCommit: before.gitHeadCommit,
			gitDirtyBefore: dirtyStateForSnapshot(before),
			gitDirtyAfter: dirtyStateForSnapshot(after),
			scopeSnapshot: serializeScopeSnapshot(scope, before),
		});
		throw enriched;
	}
}

function normalizeStringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function extractGatingRoute(council: Record<string, unknown>): ResearchExecutionRoute {
	return council.executionRoute && typeof council.executionRoute === "object"
		? council.executionRoute as ResearchExecutionRoute
		: council.route && typeof council.route === "object"
			? council.route as ResearchExecutionRoute
			: null;
}

function extractExecutionRoute(council: Record<string, unknown>): ResearchExecutionRoute {
	return council.executionRoute && typeof council.executionRoute === "object"
		? council.executionRoute as ResearchExecutionRoute
		: null;
}

function buildResearchExecutionEnv(
	scope: ResearchScope,
	executionRoute: ResearchExecutionRoute,
): Record<string, string> {
	if (!executionRoute) return {};
	const env: Record<string, string> = {};
	if (scope.executionRouteClass) env.CHITRAGUPTA_ROUTE_CLASS = scope.executionRouteClass;
	if (scope.executionCapability) env.CHITRAGUPTA_ROUTE_CAPABILITY = scope.executionCapability;
	if (typeof executionRoute.routeClass === "string" && executionRoute.routeClass.trim()) {
		env.CHITRAGUPTA_EXECUTION_ROUTE_CLASS = executionRoute.routeClass.trim();
	}
	if (typeof executionRoute.capability === "string" && executionRoute.capability.trim()) {
		env.CHITRAGUPTA_EXECUTION_CAPABILITY = executionRoute.capability.trim();
	}
	if (typeof executionRoute.selectedCapabilityId === "string" && executionRoute.selectedCapabilityId.trim()) {
		env.CHITRAGUPTA_SELECTED_CAPABILITY_ID = executionRoute.selectedCapabilityId.trim();
	}
	const binding = executionRoute.executionBinding;
	if (!binding || typeof binding !== "object") return env;
	env.CHITRAGUPTA_EXECUTION_BINDING = JSON.stringify(binding);
	if (typeof binding.source === "string" && binding.source.trim()) {
		env.CHITRAGUPTA_EXECUTION_BINDING_SOURCE = binding.source.trim();
	}
	if (typeof binding.selectedModelId === "string" && binding.selectedModelId.trim()) {
		env.CHITRAGUPTA_SELECTED_MODEL_ID = binding.selectedModelId.trim();
	}
	if (typeof binding.selectedProviderId === "string" && binding.selectedProviderId.trim()) {
		env.CHITRAGUPTA_SELECTED_PROVIDER_ID = binding.selectedProviderId.trim();
	}
	const preferredModelIds = normalizeStringList(binding.preferredModelIds);
	if (preferredModelIds.length > 0) env.CHITRAGUPTA_PREFERRED_MODEL_IDS = preferredModelIds.join(",");
	const preferredProviderIds = normalizeStringList(binding.preferredProviderIds);
	if (preferredProviderIds.length > 0) env.CHITRAGUPTA_PREFERRED_PROVIDER_IDS = preferredProviderIds.join(",");
	const candidateModelIds = normalizeStringList(binding.candidateModelIds);
	if (candidateModelIds.length > 0) env.CHITRAGUPTA_CANDIDATE_MODEL_IDS = candidateModelIds.join(",");
	if (binding.allowCrossProvider === false) env.CHITRAGUPTA_ALLOW_CROSS_PROVIDER = "0";
	return env;
}

export async function executeResearchRun(
	scope: ResearchScope,
	council: Record<string, unknown>,
): Promise<ResearchRunData> {
	if (!councilSupports(council.finalVerdict)) {
		throw new Error(`Research council did not approve execution: ${String(council.finalVerdict ?? "unknown")}`);
	}
	const gatingRoute = extractGatingRoute(council);
	const executionRoute = extractExecutionRoute(council);
	if (gatingRoute && (gatingRoute.discoverableOnly === true || typeof gatingRoute.selectedCapabilityId !== "string" || !gatingRoute.selectedCapabilityId.trim())) {
		const reason = typeof gatingRoute.reason === "string" && gatingRoute.reason.trim()
			? gatingRoute.reason.trim()
			: "research route did not resolve to an executable engine capability";
		throw new Error(`Research route did not authorize execution: ${reason}`);
	}
	const env = buildResearchExecutionEnv(scope, executionRoute);
	let result: ResearchRunData;
	try {
		result = await runBoundedCommand({ ...scope, env });
	} catch (error) {
		const err = error as Error & Record<string, unknown>;
		err.executionRouteClass =
			typeof executionRoute?.routeClass === "string" ? executionRoute.routeClass : scope.executionRouteClass;
		err.selectedCapabilityId =
			typeof executionRoute?.selectedCapabilityId === "string" ? executionRoute.selectedCapabilityId : null;
		err.selectedModelId =
			typeof executionRoute?.executionBinding?.selectedModelId === "string"
				? executionRoute.executionBinding.selectedModelId
				: null;
		err.selectedProviderId =
			typeof executionRoute?.executionBinding?.selectedProviderId === "string"
				? executionRoute.executionBinding.selectedProviderId
				: null;
		throw err;
	}
	return {
		...result,
		executionRouteClass: typeof executionRoute?.routeClass === "string" ? executionRoute.routeClass : scope.executionRouteClass,
		selectedCapabilityId: typeof executionRoute?.selectedCapabilityId === "string" ? executionRoute.selectedCapabilityId : null,
		selectedModelId: typeof executionRoute?.executionBinding?.selectedModelId === "string"
			? executionRoute.executionBinding.selectedModelId
			: null,
		selectedProviderId: typeof executionRoute?.executionBinding?.selectedProviderId === "string"
			? executionRoute.executionBinding.selectedProviderId
			: null,
	};
}

async function restoreScopeFromSnapshot(
	scope: ResearchScope,
	snapshot: ResearchScopeSnapshot,
): Promise<string[]> {
	const revertedFiles: string[] = [];
	for (const [file, content] of Object.entries(snapshot.fileContents)) {
		const fullPath = path.join(scope.cwd, file);
		if (content === null) {
			try {
				await fs.rm(fullPath, { force: true });
				revertedFiles.push(file);
			} catch {
				// Ignore cleanup errors for absent files.
			}
			continue;
		}
		await fs.mkdir(path.dirname(fullPath), { recursive: true });
		await fs.writeFile(fullPath, content, "utf8");
		revertedFiles.push(file);
	}
	return revertedFiles;
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

export async function finalizeResearchResult(
	scope: ResearchScope,
	run: Record<string, unknown>,
	evaluation: Record<string, unknown>,
): Promise<ResearchFinalizeResult> {
	const decision = evaluation.decision === "keep" ? "keep" : "discard";
	const scopeGuard = run.scopeGuard === "hash-only" ? "hash-only" : "git";
	if (decision === "keep") {
		return {
			decision,
			action: "kept",
			revertedFiles: [],
			reason: null,
			scopeGuard,
		};
	}
	const snapshot = run.scopeSnapshot;
	if (!snapshot || typeof snapshot !== "object" || !("fileContents" in snapshot) || typeof (snapshot as { fileContents?: unknown }).fileContents !== "object") {
		return {
			decision,
			action: "skipped",
			revertedFiles: [],
			reason: "No reusable scope snapshot was available for discard cleanup.",
			scopeGuard,
		};
	}
	const revertedFiles = await restoreScopeFromSnapshot(scope, snapshot as ResearchScopeSnapshot);
	return {
		decision,
		action: "reverted",
		revertedFiles,
		reason: revertedFiles.length > 0 ? null : "Discarded run produced no target-file changes to restore.",
		scopeGuard,
	};
}
