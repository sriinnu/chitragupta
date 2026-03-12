import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ResearchScope, ResearchScopeSnapshot } from "./chitragupta-nodes-research-shared.js";

const execFileAsync = promisify(execFile);

export type ScopeSnapshot = {
	mode: "git" | "hash-only";
	changedPaths: string[];
	hashes: Map<string, string | null>;
	fileContents: Map<string, string | null>;
	gitBranch: string | null;
	gitHeadCommit: string | null;
};

export type ExecutableResearchScope = ResearchScope & {
	env?: Record<string, string>;
	interruptSignal?: AbortSignal;
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

async function readFileContent(filePath: string): Promise<string | null> {
	try {
		return await fs.readFile(filePath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

/**
 * Capture the exact file and git state a bounded research round is allowed to touch.
 * This snapshot is the basis for both safety checks and deterministic revert-on-discard.
 */
export async function captureScopeSnapshot(scope: ResearchScope): Promise<ScopeSnapshot> {
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

export function assertScopeSnapshot(scope: ResearchScope, snapshot: ScopeSnapshot, phase: "before" | "after"): void {
	if (snapshot.mode !== "git") return;
	const allowed = allowedPaths(scope);
	const outside = snapshot.changedPaths.filter((file) => !allowed.has(file));
	if (outside.length > 0) {
		throw new Error(
			`${phase === "before" ? "Pre-existing" : "New"} out-of-scope changes detected: ${outside.join(", ")}`,
		);
	}
}

export function assertWorkspaceReadyForResearch(scope: ResearchScope, snapshot: ScopeSnapshot): void {
	if (snapshot.mode !== "git") return;
	if (scope.allowDirtyWorkspace) return;
	if (snapshot.changedPaths.length === 0) return;
	throw new Error(
		`Research loop requires a clean workspace unless researchAllowDirtyWorkspace=true. Dirty paths: ${snapshot.changedPaths.join(", ")}`,
	);
}

/**
 * Compare before/after scope snapshots and enforce that only declared mutable targets changed.
 */
export function compareScopeSnapshots(
	scope: ResearchScope,
	before: ScopeSnapshot,
	after: ScopeSnapshot,
): { targetFilesChanged: string[] } {
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

export function dirtyStateForSnapshot(snapshot: ScopeSnapshot): boolean | null {
	return snapshot.mode === "git" ? snapshot.changedPaths.length > 0 : null;
}

export function serializeScopeSnapshot(scope: ResearchScope, snapshot: ScopeSnapshot): ResearchScopeSnapshot {
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

/**
 * Restore only the declared mutable research files from the captured pre-run snapshot.
 * This is intentionally file-scoped rather than git-reset scoped so research cannot revert unrelated work.
 */
export async function restoreScopeFromSnapshot(
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
