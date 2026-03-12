import { packCuratedSummaryText } from "./pakt-compression.js";
import {
	computeMdlCompactionMetrics,
	decidePackedRepresentation,
	type MdlCompactionMetrics,
	type PackedRepresentationDecision,
} from "./mdl-compaction.js";
import type { PackedSummaryResult } from "./pakt-compression.js";

export interface SwapnaCompressionDecision {
	packedSummaryText?: string;
	compression?: PackedSummaryResult;
	mdlMetrics: MdlCompactionMetrics;
	packedDecision: PackedRepresentationDecision | null;
}

/**
 * Apply the same MDL gate used for curated artifacts to Swapna-derived
 * compaction summaries so dream-state packing promotes only high-signal packed
 * representations.
 */
export async function prepareSwapnaCompressionDecision(
	originalText: string,
	summaryText: string,
): Promise<SwapnaCompressionDecision> {
	const compression = await packCuratedSummaryText(summaryText);
	const packedSummaryText = compression?.packedText;
	const candidateMetrics = computeMdlCompactionMetrics({
		originalText,
		summaryText,
		packedText: packedSummaryText,
	});
	const packedDecision = packedSummaryText
		? decidePackedRepresentation(candidateMetrics)
		: null;

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
