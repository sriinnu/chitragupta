import {
	inspectConsolidationVectorSync,
	indexConsolidationSummary,
	listCuratedConsolidationArtifacts,
	type ConsolidationVectorSyncIssue,
	type CuratedConsolidationArtifact,
	type CuratedConsolidationArtifactQuery,
} from "./consolidation-indexer.js";
import {
	inspectRemoteSemanticSync,
	syncRemoteSemanticMirror,
	type RemoteSemanticSyncIssue,
} from "./remote-semantic-sync.js";

/**
 * Candidate artifact for selective semantic refresh.
 *
 * I score these from a mix of epoch drift, remote drift, provenance weight,
 * and MDL quality so the daemon can refresh a small high-value frontier
 * instead of rewriting the entire semantic mirror.
 */
export interface SelectiveReembeddingCandidate {
	id: string;
	level: "daily" | "monthly" | "yearly";
	period: string;
	project: string | undefined;
	score: number;
	localReasons: Array<LocalSelectiveReembeddingReason>;
	remoteReasons: Array<RemoteSemanticSyncIssue["reason"]>;
	sourceSessionCount: number;
	sourcePeriodCount: number;
	mdlScore: number;
	contentHash: string;
}

export type LocalSelectiveReembeddingReason =
	| ConsolidationVectorSyncIssue["reason"]
	| "low_mdl"
	| "rejected_packed";

export type SelectiveReembeddingReason =
	| LocalSelectiveReembeddingReason
	| RemoteSemanticSyncIssue["reason"];

export interface SelectiveReembeddingPlan {
	scanned: number;
	candidateCount: number;
	candidates: SelectiveReembeddingCandidate[];
}

export interface SelectiveReembeddingRepairResult {
	plan: SelectiveReembeddingPlan;
	reembedded: number;
	remoteSynced: number;
	qualityDeferred: number;
}

export interface SelectiveReembeddingOptions extends CuratedConsolidationArtifactQuery {
	candidateLimit?: number;
	reasons?: SelectiveReembeddingReason[];
	resyncRemote?: boolean;
	minMdlScore?: number;
	minSourceSessionCount?: number;
	minPriorityScore?: number;
}

function requiresQualityRefresh(candidate: Pick<SelectiveReembeddingCandidate, "localReasons">): boolean {
	return candidate.localReasons.includes("low_mdl") || candidate.localReasons.includes("rejected_packed");
}

/**
 * Rebuild a curated artifact through the same consolidation path that
 * originally produced it, instead of mutating the artifact ad hoc.
 */
async function rebuildCuratedArtifact(
	artifact: CuratedConsolidationArtifact,
): Promise<boolean> {
	try {
		if (artifact.level === "daily") {
			const { consolidateDay } = await import("./day-consolidation.js");
			await consolidateDay(artifact.period, { force: true });
			return true;
		}
		if (!artifact.project) return false;
		const { PeriodicConsolidation } = await import("./periodic-consolidation.js");
		const consolidation = new PeriodicConsolidation({ project: artifact.project });
		if (artifact.level === "monthly") {
			const [year, month] = artifact.period.split("-").map((value) => Number.parseInt(value, 10));
			if (!Number.isFinite(year) || !Number.isFinite(month)) return false;
			await consolidation.monthly(year, month);
			return true;
		}
		const year = Number.parseInt(artifact.period, 10);
		if (!Number.isFinite(year)) return false;
		await consolidation.yearly(year);
		return true;
	} catch {
		return false;
	}
}

function roundScore(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function levelWeight(level: CuratedConsolidationArtifact["level"]): number {
	switch (level) {
		case "yearly":
			return 1.35;
		case "monthly":
			return 1.2;
		default:
			return 1;
	}
}

function scoreCandidate(
	artifact: CuratedConsolidationArtifact,
	localReasons: Array<LocalSelectiveReembeddingReason>,
	remoteReasons: Array<RemoteSemanticSyncIssue["reason"]>,
): number {
	const sourceSessionCount = artifact.provenance.sourceSessionIds.length;
	const sourcePeriodCount =
		"sourcePeriods" in artifact.provenance && Array.isArray(artifact.provenance.sourcePeriods)
			? artifact.provenance.sourcePeriods.length
			: 0;
	const localEpochDrift = localReasons.includes("stale_epoch");
	const remoteEpochDrift = remoteReasons.includes("stale_remote_epoch");
	const bothSidesDrift = localEpochDrift && remoteEpochDrift;
	const lowMdl = localReasons.includes("low_mdl");
	const rejectedPacked = localReasons.includes("rejected_packed");
	const priorityBase =
		levelWeight(artifact.level)
		+ Math.min(sourceSessionCount, 24) * 0.08
		+ Math.min(sourcePeriodCount, 12) * 0.05
		+ artifact.mdlMetrics.mdlScore
		+ (bothSidesDrift ? 0.5 : localEpochDrift || remoteEpochDrift ? 0.25 : 0)
		+ (lowMdl ? 0.3 : 0)
		+ (rejectedPacked ? 0.2 : 0);
	return roundScore(priorityBase);
}

const DEFAULT_LOW_MDL_REPAIR_THRESHOLD = 0.6;

function deriveArtifactQualityReasons(
	artifact: CuratedConsolidationArtifact,
): Array<LocalSelectiveReembeddingReason> {
	const reasons: Array<LocalSelectiveReembeddingReason> = [];
	if (artifact.mdlMetrics.mdlScore < DEFAULT_LOW_MDL_REPAIR_THRESHOLD) {
		reasons.push("low_mdl");
	}
	if (artifact.packedDecision && !artifact.packedDecision.accepted) {
		reasons.push("rejected_packed");
	}
	return reasons;
}

function buildIssueMap<T extends { id: string }>(
	issues: readonly T[],
): Map<string, T[]> {
	const map = new Map<string, T[]>();
	for (const issue of issues) {
		const bucket = map.get(issue.id) ?? [];
		bucket.push(issue);
		map.set(issue.id, bucket);
	}
	return map;
}

function normalizeReasonFilter(
	reasons: readonly SelectiveReembeddingReason[] | undefined,
): Set<SelectiveReembeddingReason> | null {
	if (!reasons || reasons.length === 0) return null;
	const filtered = reasons.filter((reason): reason is SelectiveReembeddingReason => typeof reason === "string");
	return filtered.length > 0 ? new Set(filtered) : null;
}

export async function planSelectiveReembedding(
	options: SelectiveReembeddingOptions = {},
): Promise<SelectiveReembeddingPlan> {
	const hasExplicitIds = Array.isArray(options.ids) && options.ids.length > 0;
	const candidateLimit = hasExplicitIds || options.scanAll === true
		? Number.MAX_SAFE_INTEGER
		: Math.max(1, Math.min(options.candidateLimit ?? 20, 200));
	const reasonFilter = normalizeReasonFilter(options.reasons);
	const artifacts = await listCuratedConsolidationArtifacts(options);
	if (artifacts.length === 0) {
		return { scanned: 0, candidateCount: 0, candidates: [] };
	}
	const [localStatus, remoteStatus] = await Promise.all([
		inspectConsolidationVectorSync(options),
		inspectRemoteSemanticSync(options),
	]);
	const localIssuesById = buildIssueMap(localStatus.issues);
	const remoteIssuesById = buildIssueMap(remoteStatus.issues);
	const minMdlScore = Math.max(0, Math.min(1, options.minMdlScore ?? 0));
	const minSourceSessionCount = Math.max(0, Math.trunc(options.minSourceSessionCount ?? 0));
	const minPriorityScore = Number.isFinite(options.minPriorityScore) ? Math.max(0, options.minPriorityScore ?? 0) : 0;
	const candidates = artifacts
			.reduce<SelectiveReembeddingCandidate[]>((acc, artifact) => {
				const localSyncReasons = (localIssuesById.get(artifact.id) ?? []).map((issue) => issue.reason);
				const remoteReasons = (remoteIssuesById.get(artifact.id) ?? []).map((issue) => issue.reason);
				const qualityReasons = deriveArtifactQualityReasons(artifact);
				// Quality reasons are first-class repair triggers, not just tie-breakers.
				const localReasons = [...new Set([...localSyncReasons, ...qualityReasons])];
				const effectiveReasons = [...new Set([...localReasons, ...remoteReasons])];
				const epochRelevant =
					localReasons.includes("stale_epoch")
					|| remoteReasons.includes("stale_remote_epoch");
				const remoteRelevant =
					remoteReasons.includes("missing_remote")
					|| remoteReasons.includes("stale_remote")
					|| remoteReasons.includes("remote_error");
				const qualityRelevant =
					localReasons.includes("low_mdl")
					|| localReasons.includes("rejected_packed");
				const matchedReasons = reasonFilter
					? effectiveReasons.filter((reason) => reasonFilter.has(reason))
					: effectiveReasons.filter((reason) => epochRelevant || remoteRelevant || qualityRelevant);
				const reasonMatch = reasonFilter
					? matchedReasons.length > 0
					: epochRelevant || remoteRelevant || qualityRelevant;
				if (!reasonMatch) {
					return acc;
				}
			const sourcePeriodCount =
				"sourcePeriods" in artifact.provenance && Array.isArray(artifact.provenance.sourcePeriods)
					? artifact.provenance.sourcePeriods.length
					: 0;
			const score = scoreCandidate(artifact, localReasons, remoteReasons);
				if (!hasExplicitIds) {
					const bypassMdlGate = matchedReasons.some((reason) => reason === "low_mdl" || reason === "rejected_packed");
					const meetsMdlGate = bypassMdlGate || artifact.mdlMetrics.mdlScore >= minMdlScore;
					const meetsSourceGate = artifact.provenance.sourceSessionIds.length >= minSourceSessionCount;
					const meetsPriorityGate = score >= minPriorityScore;
					if (!meetsMdlGate || !meetsSourceGate || !meetsPriorityGate) {
					return acc;
				}
			}
			acc.push({
				id: artifact.id,
				level: artifact.level,
				period: artifact.period,
				project: artifact.project,
				score,
				localReasons,
				remoteReasons,
				sourceSessionCount: artifact.provenance.sourceSessionIds.length,
				sourcePeriodCount,
				mdlScore: artifact.mdlMetrics.mdlScore,
				contentHash: artifact.contentHash,
			});
			return acc;
		}, [])
		.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
		.slice(0, candidateLimit);
	return {
		scanned: artifacts.length,
		candidateCount: candidates.length,
		candidates,
	};
}

/**
 * Repair the highest-value stale semantic artifacts in place.
 *
 * Local vector freshness is restored first. Remote sync is a second phase
 * because local semantic truth remains authoritative.
 */
export async function repairSelectiveReembedding(
	options: SelectiveReembeddingOptions = {},
): Promise<SelectiveReembeddingRepairResult> {
	const plan = await planSelectiveReembedding(options);
	if (plan.candidateCount === 0) {
		return { plan, reembedded: 0, remoteSynced: 0, qualityDeferred: 0 };
	}
	const artifactIds = plan.candidates.map((candidate) => candidate.id);
	const artifacts = await listCuratedConsolidationArtifacts({ ...options, ids: artifactIds });
	const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
	let reembedded = 0;
	let qualityDeferred = 0;
	const remoteEligibleIds: string[] = [];
	for (const candidate of plan.candidates) {
		let artifact = artifactsById.get(candidate.id);
		if (!artifact) continue;
		let requiresVectorRepair =
			candidate.localReasons.includes("missing_vector")
			|| candidate.localReasons.includes("stale_hash")
			|| candidate.localReasons.includes("legacy_vector")
			|| candidate.localReasons.includes("stale_epoch")
			|| candidate.remoteReasons.includes("missing_remote")
			|| candidate.remoteReasons.includes("stale_remote")
			|| candidate.remoteReasons.includes("stale_remote_epoch")
			|| candidate.remoteReasons.includes("remote_error");
		const qualityRefresh = !requiresVectorRepair && requiresQualityRefresh(candidate);
		let qualityStillDeferred = false;
		if (!requiresVectorRepair && !qualityRefresh) {
			qualityDeferred += 1;
			continue;
		}
		if (qualityRefresh) {
			const rebuilt = await rebuildCuratedArtifact(artifact);
			if (!rebuilt) {
				qualityDeferred += 1;
				continue;
			}
			const refreshed = await listCuratedConsolidationArtifacts({ ...options, ids: [candidate.id] });
			artifact = refreshed[0] ?? artifact;
			artifactsById.set(candidate.id, artifact);
			const remainingQualityReasons = deriveArtifactQualityReasons(artifact);
			qualityStillDeferred = remainingQualityReasons.length > 0;
			requiresVectorRepair = true;
		}
		const reindex = await indexConsolidationSummary(
			artifact.level,
			artifact.period,
			artifact.markdown,
			artifact.project,
		);
		if (reindex.indexed) {
			if (qualityStillDeferred) {
				qualityDeferred += 1;
				continue;
			}
			reembedded += 1;
			remoteEligibleIds.push(candidate.id);
		} else if (qualityStillDeferred) {
			qualityDeferred += 1;
		}
	}
	if (options.resyncRemote === false) {
		return {
			plan,
			reembedded,
			remoteSynced: 0,
			qualityDeferred,
		};
	}
	const remote = remoteEligibleIds.length > 0
		? await syncRemoteSemanticMirror({ ids: remoteEligibleIds, repairLocal: false })
		: { synced: 0 };
	return {
		plan,
		reembedded,
		remoteSynced: remote.synced,
		qualityDeferred,
	};
}
