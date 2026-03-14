/**
 * Measured compression/retention profile for a curated semantic artifact.
 *
 * `mdlScore` is a practical compaction utility score, not a formal MDL proof.
 * It intentionally rewards signal preservation more than raw reduction.
 */
export interface MdlCompactionMetrics {
	originalChars: number;
	summaryChars: number;
	packedChars: number | null;
	summaryReduction: number;
	packedReduction: number | null;
	summarySignalRetention: number;
	packedSignalRetention: number | null;
	mdlScore: number;
}

/** Decision about whether a packed derivative is worth persisting. */
export interface PackedRepresentationDecision {
	accepted: boolean;
	reason: "accepted" | "missing_packed" | "low_reduction" | "low_retention" | "low_mdl";
}

/**
 * Semantic mirrors need a version stamp that changes when the compaction
 * policy changes materially enough to warrant re-embedding.
 */
export const MDL_COMPACTION_POLICY_VERSION = "mdl-v1";

/**
 * Selected summary text plus the MDL-style metrics that justified the choice.
 *
 * I persist both so repair paths can explain why the preferred summary was
 * kept or widened into a representative fallback.
 */
export interface MdlSummarySelection {
	summaryText: string;
	metrics: MdlCompactionMetrics;
	selection: "preferred" | "representative_fallback";
}

/** Steering decision for whether a curated summary is healthy, marginal, or needs repair. */
export interface MdlCompactionDecision {
	disposition: "healthy" | "watch" | "repair";
	reason:
		| "accepted"
		| "low_mdl"
		| "low_retention"
		| "low_reduction"
		| "borderline_mdl"
		| "borderline_reduction";
}

const MIN_PACKED_REDUCTION = 0.08;
const MIN_PACKED_SIGNAL_RETENTION = 0.05;
const MIN_PACKED_MDL_SCORE = 0.5;
/** Minimum MDL score required before a summary is considered durable and healthy. */
export const MIN_SUMMARY_MDL_SCORE = 0.45;
const MIN_SUMMARY_SIGNAL_RETENTION = 0.12;
const MIN_SUMMARY_MDL_GAIN = 0.08;
const MIN_SUMMARY_REDUCTION = 0.35;
const MIN_SUMMARY_STRONG_GAIN = 0.15;
const DEFAULT_REPRESENTATIVE_SUMMARY_CHARS = 2000;
/** Borderline threshold where I keep the summary but continue to watch it. */
export const WATCH_SUMMARY_MDL_SCORE = 0.55;
const WATCH_SUMMARY_REDUCTION = 0.4;

function normalizeToken(token: string): string {
	return token.replace(/\d+/g, "#");
}

function tokenize(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.match(/[a-z0-9][a-z0-9_-]{2,}/g)
			?.map((token) => normalizeToken(token.trim()))
			.filter(Boolean) ?? [],
	);
}

function overlapRatio(base: Set<string>, sample: Set<string>): number {
	if (base.size === 0) return 1;
	let overlap = 0;
	for (const token of sample) {
		if (base.has(token)) overlap++;
	}
	return overlap / base.size;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function roundMetric(value: number | null): number | null {
	return value === null ? null : Math.round(value * 1000) / 1000;
}

function normalizeLineSignature(line: string): string {
	return line
		.toLowerCase()
		.replace(/\d+/g, "#")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Build a deterministic representative fallback summary from the original
 * source text.
 *
 * I use this during repair so the compaction layer can widen a lossy summary
 * without introducing another model dependency.
 */
export function buildRepresentativeSummaryText(
	originalText: string,
	maxChars = DEFAULT_REPRESENTATIVE_SUMMARY_CHARS,
): string {
	const selected: string[] = [];
	const seen = new Set<string>();
	let totalChars = 0;

	for (const rawLine of originalText.split(/\r?\n/)) {
		const line = rawLine.replace(/\s+/g, " ").trim();
		if (!line) continue;
		const signature = normalizeLineSignature(line);
		if (!signature || seen.has(signature)) continue;
		const nextChars = totalChars === 0 ? line.length : totalChars + 1 + line.length;
		if (selected.length > 0 && nextChars > maxChars) break;
		seen.add(signature);
		selected.push(line);
		totalChars = nextChars;
		if (totalChars >= maxChars) break;
	}

	return selected.join(" ").trim();
}

/**
 * Pick the effective compaction summary, widening to a representative fallback
 * only when the preferred summary is too lossy and the fallback materially
 * improves MDL-style utility while staying compact.
 */
export function selectMdlSummaryText(args: {
	originalText: string;
	preferredSummaryText: string;
	fallbackSummaryText?: string;
	maxFallbackChars?: number;
}): MdlSummarySelection {
	const sourceText = args.originalText.trim();
	const preferredSummaryText = args.preferredSummaryText.trim();
	const preferredMetrics = computeMdlCompactionMetrics({
		originalText: sourceText,
		summaryText: preferredSummaryText,
	});

	const fallbackSummaryText = (args.fallbackSummaryText?.trim()
		|| buildRepresentativeSummaryText(sourceText, args.maxFallbackChars)).trim();
	if (!fallbackSummaryText || fallbackSummaryText === preferredSummaryText) {
		return {
			summaryText: preferredSummaryText,
			metrics: preferredMetrics,
			selection: "preferred",
		};
	}

	const fallbackMetrics = computeMdlCompactionMetrics({
		originalText: sourceText,
		summaryText: fallbackSummaryText,
	});
	// I only widen into the representative fallback when the preferred summary is
	// objectively weak and the wider fallback buys materially better MDL utility.
	// This avoids oscillating to a larger summary for tiny metric changes.
	const preferredIsWeak = preferredMetrics.mdlScore < MIN_SUMMARY_MDL_SCORE
		|| preferredMetrics.summarySignalRetention < MIN_SUMMARY_SIGNAL_RETENTION;
	const fallbackIsMeaningfullyBetter = fallbackMetrics.mdlScore >= preferredMetrics.mdlScore + MIN_SUMMARY_MDL_GAIN
		&& fallbackMetrics.summaryReduction >= MIN_SUMMARY_REDUCTION;
	const fallbackClearlyDominates = fallbackMetrics.mdlScore >= preferredMetrics.mdlScore + MIN_SUMMARY_STRONG_GAIN
		&& fallbackMetrics.summaryReduction >= preferredMetrics.summaryReduction - 0.1;
	if (fallbackIsMeaningfullyBetter && (preferredIsWeak || fallbackClearlyDominates)) {
		return {
			summaryText: fallbackSummaryText,
			metrics: fallbackMetrics,
			selection: "representative_fallback",
		};
	}

	return {
		summaryText: preferredSummaryText,
		metrics: preferredMetrics,
		selection: "preferred",
	};
}

/**
 * A practical MDL-style compaction heuristic.
 *
 * This is intentionally not a formal MDL proof. It rewards representations
 * that reduce description length while keeping enough lexical signal to remain
 * useful during retrieval and recall.
 */
export function computeMdlCompactionMetrics(args: {
	originalText: string;
	summaryText: string;
	packedText?: string | null;
}): MdlCompactionMetrics {
	const originalChars = args.originalText.trim().length;
	const summaryChars = args.summaryText.trim().length;
	const packedChars = args.packedText?.trim() ? args.packedText.trim().length : null;

	const originalTokens = tokenize(args.originalText);
	const summaryTokens = tokenize(args.summaryText);
	const packedTokens = args.packedText ? tokenize(args.packedText) : null;

	const summaryReduction = originalChars > 0 ? clamp01(1 - (summaryChars / originalChars)) : 0;
	const packedReduction = packedChars !== null && summaryChars > 0
		? clamp01(1 - (packedChars / summaryChars))
		: null;
	const summarySignalRetention = clamp01(overlapRatio(originalTokens, summaryTokens));
	const packedSignalRetention = packedTokens ? clamp01(overlapRatio(summaryTokens, packedTokens)) : null;

	// Signal retention has the highest weight because retrieval quality degrades
	// faster from semantic loss than from a slightly larger artifact.
	const mdlScore = packedSignalRetention === null
		? clamp01(
			(summarySignalRetention * 0.7)
			+ (summaryReduction * 0.2)
			+ ((packedReduction ?? 0) * 0.1),
		)
		: clamp01(
			(summarySignalRetention * 0.55)
			+ (summaryReduction * 0.2)
			+ (packedSignalRetention * 0.15)
			+ ((packedReduction ?? 0) * 0.1),
		);

	return {
		originalChars,
		summaryChars,
		packedChars,
		summaryReduction: roundMetric(summaryReduction) ?? 0,
		packedReduction: roundMetric(packedReduction),
		summarySignalRetention: roundMetric(summarySignalRetention) ?? 0,
		packedSignalRetention: roundMetric(packedSignalRetention),
		mdlScore: roundMetric(mdlScore) ?? 0,
	};
}

/**
 * Decide whether a packed representation is worth promoting as a durable
 * derived artifact.
 *
 * I keep this gate conservative because packed summaries are an optimization,
 * not the canonical memory record.
 */
export function decidePackedRepresentation(metrics: MdlCompactionMetrics): PackedRepresentationDecision {
	if (metrics.packedChars === null || metrics.packedReduction === null || metrics.packedSignalRetention === null) {
		return { accepted: false, reason: "missing_packed" };
	}
	if (metrics.packedReduction < MIN_PACKED_REDUCTION) {
		return { accepted: false, reason: "low_reduction" };
	}
	if (metrics.packedSignalRetention < MIN_PACKED_SIGNAL_RETENTION) {
		return { accepted: false, reason: "low_retention" };
	}
	if (metrics.mdlScore < MIN_PACKED_MDL_SCORE) {
		return { accepted: false, reason: "low_mdl" };
	}
	return { accepted: true, reason: "accepted" };
}

/**
 * Decide whether the summary itself is good enough to promote as the durable
 * semantic representation, or whether it should be revisited during a repair
 * cycle before it keeps propagating through the mirror.
 */
export function decideMdlCompaction(metrics: MdlCompactionMetrics): MdlCompactionDecision {
	if (metrics.summarySignalRetention < MIN_SUMMARY_SIGNAL_RETENTION) {
		return { disposition: "repair", reason: "low_retention" };
	}
	if (metrics.mdlScore < MIN_SUMMARY_MDL_SCORE) {
		return { disposition: "repair", reason: "low_mdl" };
	}
	if (metrics.summaryReduction < MIN_SUMMARY_REDUCTION) {
		return { disposition: "repair", reason: "low_reduction" };
	}
	if (metrics.mdlScore < WATCH_SUMMARY_MDL_SCORE) {
		return { disposition: "watch", reason: "borderline_mdl" };
	}
	if (metrics.summaryReduction < WATCH_SUMMARY_REDUCTION) {
		return { disposition: "watch", reason: "borderline_reduction" };
	}
	return { disposition: "healthy", reason: "accepted" };
}
