import fs from "node:fs";
import { createHash } from "node:crypto";
import { packCuratedSummaryText, type PackedSummaryResult } from "./pakt-compression.js";
import {
	computeMdlCompactionMetrics,
	decidePackedRepresentation,
	type MdlCompactionMetrics,
	type PackedRepresentationDecision,
} from "./mdl-compaction.js";
import {
	parseConsolidationMetadata,
	stripConsolidationMetadata,
	type ConsolidationMetadata,
} from "./consolidation-provenance.js";

export type ConsolidationLevel = "daily" | "monthly" | "yearly";

export interface ConsolidationSummaryIndex {
	level: ConsolidationLevel;
	period: string;
	project?: string;
	embedding: number[];
	summaryText: string;
}

export interface ConsolidationVectorSyncIssue {
	id: string;
	level: ConsolidationLevel;
	period: string;
	project?: string;
	reason: "missing_vector" | "stale_hash" | "legacy_vector" | "stale_epoch";
}

export interface ConsolidationVectorSyncStatus {
	scanned: number;
	missingCount: number;
	driftCount: number;
	issues: ConsolidationVectorSyncIssue[];
}

export interface CuratedConsolidationArtifactQuery {
	recentDailyLimit?: number;
	recentPeriodicPerProject?: number;
	/** Scan the full curated artifact set instead of the recent-window defaults. */
	scanAll?: boolean;
	dates?: string[];
	projects?: string[];
	periods?: string[];
	levels?: ConsolidationLevel[];
	ids?: string[];
}

export interface CuratedConsolidationArtifact {
	id: string;
	level: ConsolidationLevel;
	period: string;
	project?: string;
	markdown: string;
	summaryText: string;
	packedSummaryText?: string;
	compression?: PackedSummaryResult;
	mdlMetrics: MdlCompactionMetrics;
	packedDecision: PackedRepresentationDecision | null;
	contentHash: string;
	provenance: ConsolidationMetadata;
}

export interface CuratedSummaryCompressionDecision {
	packedSummaryText?: string;
	compression?: PackedSummaryResult;
	mdlMetrics: MdlCompactionMetrics;
	packedDecision: PackedRepresentationDecision | null;
}

/** Build a stable ID for a consolidation summary embedding. */
export function buildConsolidationEmbeddingId(
	level: ConsolidationLevel,
	period: string,
	project?: string,
): string {
	const suffix = project ? `-${fnvHash4(project)}` : "";
	return `${level}_summary:${period}${suffix}`;
}

export function buildConsolidationSourceId(period: string, project?: string): string {
	return project ? `${period}-${fnvHash4(project)}` : period;
}

/** Extract high-signal text from consolidation markdown for embedding. */
export function extractSummaryText(markdown: string, level: ConsolidationLevel): string {
	const lines = stripConsolidationMetadata(markdown).split("\n");
	const parts: string[] = [];

	if (level === "daily") {
		for (const line of lines) {
			const trimmed = line.trim();
			const stripped = trimmed.replace(/^-\s*/, "");
			if (trimmed.startsWith("# ") || trimmed.startsWith("## ")) {
				parts.push(trimmed.replace(/^#+\s*/, ""));
			} else if (
				stripped.startsWith("**Fact**:") || stripped.startsWith("**Decision**:")
				|| stripped.startsWith("**Pref**:") || stripped.startsWith("**Error**:")
				|| stripped.startsWith("**Topic**:") || stripped.startsWith("**Q**:")
			) {
				parts.push(stripped.replace(/\*\*/g, ""));
			} else if (trimmed.startsWith("- [") && trimmed.includes("]")) {
				parts.push(stripped);
			} else if (trimmed.startsWith("**Topics**:")) {
				parts.push(trimmed.replace(/\*\*/g, ""));
			} else if (trimmed.startsWith(">") && !trimmed.includes("sessions |")) {
				parts.push(trimmed.replace(/^>\s*/, ""));
			}
		}
	} else if (level === "monthly") {
		let inRecommendations = false;
		let inVasanas = false;
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed.startsWith("# ")) {
				parts.push(trimmed.replace(/^#+\s*/, ""));
			} else if (
				trimmed.startsWith("- **Sessions**:")
				|| trimmed.startsWith("- **Turns**:")
				|| trimmed.startsWith("- **Estimated Cost**:")
			) {
				parts.push(trimmed.replace(/^-\s*/, "").replace(/\*\*/g, ""));
			}
			if (trimmed === "## Recommendations") inRecommendations = true;
			else if (trimmed.startsWith("## ") && inRecommendations) inRecommendations = false;
			if (inRecommendations && trimmed.startsWith("- ")) {
				parts.push(trimmed.replace(/^-\s*/, ""));
			}
			if (trimmed === "## Vasanas Crystallized") inVasanas = true;
			else if (trimmed.startsWith("## ") && trimmed !== "## Vasanas Crystallized") inVasanas = false;
			if (inVasanas && trimmed.startsWith("|") && !trimmed.startsWith("|--") && !trimmed.startsWith("| Tendency")) {
				const cells = trimmed.split("|").filter(Boolean).map((c) => c.trim());
				if (cells[0]) parts.push(`Vasana: ${cells[0]}`);
			}
		}
	} else {
		let inTrends = false;
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed.startsWith("# ") || trimmed.startsWith("## Annual Summary")) {
				parts.push(trimmed.replace(/^#+\s*/, ""));
			} else if (trimmed.startsWith("- **Sessions**:") || trimmed.startsWith("- **Vasanas Crystallized**:")) {
				parts.push(trimmed.replace(/^-\s*/, "").replace(/\*\*/g, ""));
			}
			if (trimmed === "## Trends") inTrends = true;
			else if (trimmed.startsWith("## ") && trimmed !== "## Trends") inTrends = false;
			if (inTrends && trimmed.startsWith("- ")) {
				parts.push(trimmed.replace(/^-\s*/, ""));
			}
		}
	}

	return parts.join(" ").slice(0, 2000);
}

export function buildArtifactContentHash(summaryText: string): string {
	const hash = createHash("sha1");
	hash.update(summaryText);
	return hash.digest("hex");
}

async function buildCuratedArtifact(params: {
	id: string;
	level: ConsolidationLevel;
	period: string;
	project?: string;
	markdown: string;
	provenance: ConsolidationMetadata;
}): Promise<CuratedConsolidationArtifact | null> {
	const summaryText = extractSummaryText(params.markdown, params.level);
	if (summaryText.length < 10) return null;
	const compressionDecision = await prepareCuratedSummaryCompression(params.markdown, summaryText);
	return {
		id: params.id,
		level: params.level,
		period: params.period,
		project: params.project,
		markdown: params.markdown,
		summaryText,
		packedSummaryText: compressionDecision.packedSummaryText,
		compression: compressionDecision.compression,
		mdlMetrics: compressionDecision.mdlMetrics,
		packedDecision: compressionDecision.packedDecision,
		contentHash: buildArtifactContentHash(summaryText),
		provenance: params.provenance,
	};
}

export async function prepareCuratedSummaryCompression(
	originalText: string,
	summaryText: string,
): Promise<CuratedSummaryCompressionDecision> {
	const compression = await packCuratedSummaryText(summaryText);
	const packedSummaryText = compression?.packedText;
	const candidateMetrics = computeMdlCompactionMetrics({
		originalText,
		summaryText,
		packedText: packedSummaryText,
	});
	const packedDecision = packedSummaryText ? decidePackedRepresentation(candidateMetrics) : null;
	if (!packedSummaryText || !packedDecision || packedDecision.accepted) {
		return {
			packedSummaryText: packedSummaryText ?? undefined,
			compression: compression ?? undefined,
			mdlMetrics: candidateMetrics,
			packedDecision,
		};
	}
	return {
		packedSummaryText: undefined,
		compression: undefined,
		mdlMetrics: computeMdlCompactionMetrics({
			originalText,
			summaryText,
		}),
		packedDecision,
	};
}

export async function listCuratedConsolidationArtifacts(
	options: CuratedConsolidationArtifactQuery = {},
): Promise<CuratedConsolidationArtifact[]> {
	const recentDailyLimit = options.recentDailyLimit ?? 30;
	const recentPeriodicPerProject = options.recentPeriodicPerProject ?? 6;
	const scanAll = options.scanAll === true;
	const artifacts: CuratedConsolidationArtifact[] = [];

	try {
		const { listDayFiles, getDayFilePath } = await import("./day-consolidation.js");
		const dayFiles = scanAll ? listDayFiles() : listDayFiles().slice(0, recentDailyLimit);
		for (const date of dayFiles) {
			const dayPath = getDayFilePath(date);
			if (!fs.existsSync(dayPath)) continue;
			const markdown = fs.readFileSync(dayPath, "utf-8");
			if (!markdown) continue;
			const provenance = parseConsolidationMetadata(markdown);
			if (!provenance || provenance.kind !== "day") continue;
			const artifact = await buildCuratedArtifact({
				id: buildConsolidationEmbeddingId("daily", date),
				level: "daily",
				period: date,
				markdown,
				provenance,
			});
			if (artifact) artifacts.push(artifact);
		}
	} catch {
		/* best-effort */
	}

	try {
		const { PeriodicConsolidation } = await import("./periodic-consolidation.js");
		const { listSessionProjects } = await import("./session-store.js");
		for (const entry of listSessionProjects()) {
			const pc = new PeriodicConsolidation({ project: entry.project });
			const reports = pc
				.listReports()
				.sort((a, b) => reportSortKey(b).localeCompare(reportSortKey(a)))
				.slice(0, scanAll ? undefined : recentPeriodicPerProject);
			for (const report of reports) {
				try {
					const markdown = fs.readFileSync(report.path, "utf-8");
					const provenance = parseConsolidationMetadata(markdown);
					if (!provenance || provenance.kind !== report.type) continue;
					const level: ConsolidationLevel = report.type === "monthly" ? "monthly" : "yearly";
					const artifact = await buildCuratedArtifact({
						id: buildConsolidationEmbeddingId(level, report.period, entry.project),
						level,
						period: report.period,
						project: entry.project,
						markdown,
						provenance,
					});
					if (artifact) artifacts.push(artifact);
				} catch {
					/* skip unreadable reports */
				}
			}
		}
	} catch {
		/* best-effort */
	}

	const levelFilter = options.levels?.length ? new Set(options.levels) : null;
	const dateFilter = options.dates?.length ? new Set(options.dates) : null;
	const periodFilter = options.periods?.length ? new Set(options.periods) : null;
	const projectFilter = options.projects?.length ? new Set(options.projects.filter((value) => value.trim())) : null;
	const idFilter = options.ids?.length ? new Set(options.ids.filter((value) => value.trim())) : null;

	return artifacts.filter((artifact) => {
		if (idFilter && !idFilter.has(artifact.id)) return false;
		if (levelFilter && !levelFilter.has(artifact.level)) return false;
		if (dateFilter && artifact.level === "daily" && !dateFilter.has(artifact.period)) return false;
		if (periodFilter && !periodFilter.has(artifact.period)) return false;
		if (projectFilter) {
			if (!artifact.project) return false;
			if (!projectFilter.has(artifact.project)) return false;
		}
		return true;
	});
}

function reportSortKey(report: { type: "monthly" | "yearly"; period: string }): string {
	return report.type === "monthly" ? `${report.period}-99` : `${report.period}-12-99`;
}

function fnvHash4(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = (h * 0x01000193) >>> 0;
	}
	return (h >>> 0).toString(16).slice(0, 4);
}
