import type {
	ResearchScope,
	ResearchScopeSnapshot,
} from "./chitragupta-nodes-research-shared.js";
import { captureScopeSnapshot, compareScopeSnapshots } from "./chitragupta-nodes-research-runner-helpers.js";

/**
 * Normalize one tracked path into the stable relative form used by scoped hash
 * ledgers and git-backed change lists.
 *
 * I collapse slash variants and strip leading relative/root prefixes so scope
 * comparisons cannot drift just because one path came from git and another came
 * from a file-system helper.
 */
function normalizeTrackedPath(file: string): string {
	return file.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/**
 * Recover a reusable pre-run scope snapshot from one recorded run payload.
 *
 * I only accept snapshots that carry file contents because keep/discard
 * verification needs the exact bounded envelope that existed before the run.
 */
export function reusableScopeSnapshot(run: Record<string, unknown>): ResearchScopeSnapshot | null {
	const snapshot = run.scopeSnapshot;
	if (
		!snapshot
		|| typeof snapshot !== "object"
		|| !("fileContents" in snapshot)
		|| typeof (snapshot as { fileContents?: unknown }).fileContents !== "object"
	) {
		return null;
	}
	return snapshot as ResearchScopeSnapshot;
}

/**
 * Hash-only keeps are only defensible when I have a complete scoped hash ledger
 * for both mutable and immutable files. Without that, I cannot prove that the
 * preserved result stayed inside the bounded research envelope.
 */
export function hasCompleteHashOnlySnapshot(
	scope: ResearchScope,
	snapshot: ResearchScopeSnapshot,
): boolean {
	const hashEntries = snapshot.hashes ?? {};
	const normalizedFiles = new Set(
		[...scope.targetFiles, ...scope.immutableFiles]
			.map((file) => file.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "")),
	);
	for (const file of normalizedFiles) {
		if (!Object.prototype.hasOwnProperty.call(hashEntries, file)) {
			return false;
		}
	}
	return true;
}

/**
 * Hash-only keeps are only trustworthy when the scoped target files still
 * differ from the pre-run snapshot, the immutable scope remains unchanged,
 * and the run reports the same surviving target-file delta that I observe.
 */
export async function verifyKeptHashOnlyScope(
	scope: ResearchScope,
	snapshot: ResearchScopeSnapshot,
	run: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<{ ok: boolean; reason: string | null }> {
	if (signal?.aborted) {
		const reason = signal.reason;
		if (reason instanceof Error) throw reason;
		throw new Error(typeof reason === "string" && reason.trim() ? reason : "Research keep verification cancelled");
	}
	if (snapshot.mode !== "git") {
		return {
			ok: false,
			reason: "Hash-only keep verification requires git-backed workspace tracking for out-of-scope safety.",
		};
	}
	if (!hasCompleteHashOnlySnapshot(scope, snapshot)) {
		return {
			ok: false,
			reason: "Hash-only keep verification requires a complete scoped hash snapshot.",
		};
	}
	const before = {
		mode: "git" as const,
		changedPaths: Array.isArray(snapshot.changedPaths)
			? snapshot.changedPaths.map(normalizeTrackedPath)
			: [],
		hashes: new Map(Object.entries(snapshot.hashes ?? {})),
		fileContents: new Map(Object.entries(snapshot.fileContents)),
		gitBranch: typeof snapshot.gitBranch === "string" && snapshot.gitBranch.trim() ? snapshot.gitBranch : null,
		gitHeadCommit: typeof snapshot.gitHeadCommit === "string" && snapshot.gitHeadCommit.trim() ? snapshot.gitHeadCommit : null,
	};
	if (before.changedPaths.length === 0 || !before.gitHeadCommit || !before.gitBranch) {
		return {
			ok: false,
			reason: "Hash-only keep verification requires a full git-backed pre-run snapshot.",
		};
	}
	const after = await captureScopeSnapshot(scope, signal);
	if (after.mode !== "git") {
		return {
			ok: false,
			reason: "Hash-only keep verification requires git-backed workspace tracking for out-of-scope safety.",
		};
	}
	const targetPathSet = new Set(scope.targetFiles.map(normalizeTrackedPath));
	const beforeChanged = new Set(before.changedPaths);
	const introducedOutOfScopePaths = after.changedPaths
		.map(normalizeTrackedPath)
		.filter((file) => !beforeChanged.has(file) && !targetPathSet.has(file));
	if (introducedOutOfScopePaths.length > 0) {
		return {
			ok: false,
			reason: `Hash-only keep verification found new out-of-scope changes: ${introducedOutOfScopePaths.join(", ")}.`,
		};
	}
	const compared = compareScopeSnapshots(scope, before, after);
	const changedTargets = compared.targetFilesChanged;
	if (changedTargets.length === 0) {
		return {
			ok: false,
			reason: "Hash-only keep could not be verified because no scoped target-file changes remained after execution.",
		};
	}
	const reportedTargets = Array.isArray(run.targetFilesChanged)
		? run.targetFilesChanged.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
		: [];
	if (reportedTargets.length === 0) {
		return {
			ok: false,
			reason: "Hash-only keep verification requires explicit reported target-file changes from the run result.",
		};
	}
	const reportedTargetSet = new Set(reportedTargets);
	const scopedTargetSet = new Set(scope.targetFiles.map((file) => file.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "")));
	// Hash-only keep is intentionally strict. If the mutable scope is
	// wider than the explicit surviving delta, I cannot prove that a
	// scoped file was not touched and then silently restored during the run.
	if (reportedTargetSet.size !== scopedTargetSet.size) {
		return {
			ok: false,
			reason: "Hash-only keep verification found a mismatch between reported and surviving scoped target-file changes.",
		};
	}
	for (const scopedTarget of scopedTargetSet) {
		if (!reportedTargetSet.has(scopedTarget)) {
			return {
				ok: false,
				reason: "Hash-only keep verification found a mismatch between reported and surviving scoped target-file changes.",
			};
		}
	}
	if (reportedTargetSet.size !== changedTargets.length) {
		return {
			ok: false,
			reason: "Hash-only keep verification found a mismatch between reported and surviving scoped target-file changes.",
		};
	}
	for (const reportedTarget of reportedTargets) {
		if (!changedTargets.includes(reportedTarget)) {
			return {
				ok: false,
				reason: `Hash-only keep verification lost the expected scoped change for ${reportedTarget}.`,
			};
		}
	}
	return { ok: true, reason: null };
}

/**
 * Verify that a restore/discard operation returned the bounded scope to its
 * pre-run contents and hashes.
 */
export async function verifyRestoredScope(
	scope: ResearchScope,
	snapshot: ResearchScopeSnapshot,
	run: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<{ ok: boolean; reason: string | null }> {
	if (signal?.aborted) {
		return { ok: false, reason: "Research cleanup verification was cancelled before it could complete." };
	}
	const after = await captureScopeSnapshot(scope, signal);
	if (signal?.aborted) {
		return { ok: false, reason: "Research cleanup verification was cancelled after the restore snapshot was captured." };
	}
	for (const [file, expectedContent] of Object.entries(snapshot.fileContents)) {
		const actualContent = after.fileContents.get(file) ?? null;
		if (actualContent !== expectedContent) {
			return {
				ok: false,
				reason: `Failed to restore the pre-run contents for ${file}.`,
			};
		}
	}
	for (const [file, expectedHash] of Object.entries(snapshot.hashes ?? {})) {
		const actualHash = after.hashes.get(file) ?? null;
		if (actualHash !== expectedHash) {
			return {
				ok: false,
				reason: `Failed to restore the expected scoped hash for ${file}.`,
			};
		}
	}
	if (snapshot.mode !== "git") {
		return { ok: true, reason: null };
	}
	if (after.mode !== "git") {
		return {
			ok: false,
			reason: "Git-backed cleanup verification became unavailable after restore.",
		};
	}
	if (
		typeof run.gitBranch === "string"
		&& run.gitBranch.trim()
		&& after.gitBranch !== run.gitBranch
	) {
		return {
			ok: false,
			reason: `Git branch changed during cleanup: expected ${run.gitBranch}, found ${after.gitBranch ?? "unknown"}.`,
		};
	}
	if (
		typeof run.gitHeadCommit === "string"
		&& run.gitHeadCommit.trim()
		&& after.gitHeadCommit !== run.gitHeadCommit
	) {
		return {
			ok: false,
			reason: `Git HEAD changed during cleanup: expected ${run.gitHeadCommit}, found ${after.gitHeadCommit ?? "unknown"}.`,
		};
	}
	return { ok: true, reason: null };
}
