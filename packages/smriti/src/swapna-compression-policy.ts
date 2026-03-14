import { packCuratedSummaryText } from "./pakt-compression.js";
import {
	selectMdlSummaryText,
	computeMdlCompactionMetrics,
	decidePackedRepresentation,
	type MdlCompactionMetrics,
	type MdlSummarySelection,
	type PackedRepresentationDecision,
} from "./mdl-compaction.js";
import type { PackedSummaryResult } from "./pakt-compression.js";

export interface SwapnaCompressionDecision {
	summaryText: string;
	packedSummaryText?: string;
	compression?: PackedSummaryResult;
	mdlMetrics: MdlCompactionMetrics;
	packedDecision: PackedRepresentationDecision | null;
	summarySelection: MdlSummarySelection["selection"];
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
	const selectedSummary = selectMdlSummaryText({
		originalText,
		preferredSummaryText: summaryText,
	});
	const effectiveSummaryText = selectedSummary.summaryText;
	const compression = await packCuratedSummaryText(effectiveSummaryText);
	const packedSummaryText = compression?.packedText;
	const candidateMetrics = computeMdlCompactionMetrics({
		originalText,
		summaryText: effectiveSummaryText,
		packedText: packedSummaryText,
	});
	const packedDecision = packedSummaryText
		? decidePackedRepresentation(candidateMetrics)
		: null;

	if (!packedSummaryText || !packedDecision || packedDecision.accepted) {
		return {
			summaryText: effectiveSummaryText,
			packedSummaryText: packedSummaryText ?? undefined,
			compression: compression ?? undefined,
			mdlMetrics: candidateMetrics,
			packedDecision,
			summarySelection: selectedSummary.selection,
		};
	}

	return {
		summaryText: effectiveSummaryText,
		packedSummaryText: undefined,
		compression: undefined,
		mdlMetrics: computeMdlCompactionMetrics({
			originalText,
			summaryText: effectiveSummaryText,
		}),
		packedDecision,
		summarySelection: selectedSummary.selection,
	};
}
