/** Measured compression/retention profile for a curated semantic artifact. */
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

const MIN_PACKED_REDUCTION = 0.08;
const MIN_PACKED_SIGNAL_RETENTION = 0.05;
const MIN_PACKED_MDL_SCORE = 0.5;

function tokenize(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.match(/[a-z0-9][a-z0-9_-]{2,}/g)
			?.map((token) => token.trim())
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

	const mdlScore = clamp01(
		(summarySignalRetention * 0.7)
		+ (summaryReduction * 0.2)
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
