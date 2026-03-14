import { parseEmbeddingEpoch } from "./embedding-epoch.js";
import { parseEmbeddingMetadata, type EmbeddingRow } from "./consolidation-indexer-sync.js";

/**
 * Read-path metadata distilled from a curated artifact embedding row.
 *
 * Search scoring uses this to penalize stale epochs and low-MDL summaries
 * without forcing every caller to understand raw embedding metadata.
 */
export interface ConsolidationSearchMetadata {
	period: string;
	project?: string;
	mdlScore: number;
	compactionDisposition: "healthy" | "watch" | "repair";
	packedAccepted: boolean;
	staleEpoch: boolean;
}

/** Trigger semantic refresh from read paths without failing search outright. */
export async function ensureSemanticEpochFreshnessOnRead(): Promise<void> {
	try {
		const {
			isSemanticEpochRefreshInProgress,
			refreshGlobalSemanticEpochDrift,
		} = await import("./semantic-epoch-refresh.js");
		if (isSemanticEpochRefreshInProgress()) {
			return;
		}
		await refreshGlobalSemanticEpochDrift();
	} catch {
		// Search remains best-effort even if refresh orchestration fails.
	}
}

/**
 * Parse the subset of embedding metadata that influences read-time ranking.
 *
 * I treat malformed legacy epoch payloads as stale so schema drift cannot hide
 * behind a seemingly healthy vector row.
 */
export function parseSearchMetadata(
	row: Pick<EmbeddingRow, "metadata" | "source_id">,
	expectedEpoch: string | null,
): ConsolidationSearchMetadata {
	const metadata = parseEmbeddingMetadata(row);
	const storedEpoch = parseEmbeddingEpoch(metadata.embeddingEpoch);
	const rawEmbeddingEpoch =
		typeof metadata.embeddingEpoch === "object" && metadata.embeddingEpoch !== null
			? metadata.embeddingEpoch
			: null;
	return {
		period:
			typeof metadata.period === "string" && metadata.period.trim()
				? metadata.period
				: row.source_id,
		project:
			typeof metadata.project === "string" && metadata.project.trim()
				? metadata.project
				: undefined,
		mdlScore:
			typeof metadata.mdlMetrics === "object"
			&& metadata.mdlMetrics !== null
			&& typeof (metadata.mdlMetrics as { mdlScore?: unknown }).mdlScore === "number"
				? Math.max(0, Math.min(1, (metadata.mdlMetrics as { mdlScore: number }).mdlScore))
				: 0.5,
		compactionDisposition:
			typeof metadata.compactionDecision === "object"
			&& metadata.compactionDecision !== null
			&& (
				(metadata.compactionDecision as { disposition?: unknown }).disposition === "healthy"
				|| (metadata.compactionDecision as { disposition?: unknown }).disposition === "watch"
				|| (metadata.compactionDecision as { disposition?: unknown }).disposition === "repair"
			)
				? (metadata.compactionDecision as { disposition: "healthy" | "watch" | "repair" }).disposition
				: "watch",
		packedAccepted:
			typeof metadata.packedDecision === "object"
			&& metadata.packedDecision !== null
			&& (metadata.packedDecision as { accepted?: unknown }).accepted === true,
		// Treat malformed legacy epoch payloads as stale when the caller expects a
		// concrete epoch. Otherwise a bad persisted epoch can silently evade read-
		// path freshness pressure after the epoch schema evolves.
		staleEpoch: Boolean(
			expectedEpoch
			&& ((storedEpoch && storedEpoch.epoch !== expectedEpoch) || (!storedEpoch && rawEmbeddingEpoch)),
		),
	};
}

/**
 * Score one curated hit with MDL, packing, and epoch-health signals.
 *
 * This is intentionally conservative: stale epochs and repair-grade summaries
 * are still visible, but they lose ranking priority against healthy artifacts.
 */
export function scoreCuratedSearchHit(baseScore: number, metadata: ConsolidationSearchMetadata): number {
	const mdlWeight = 0.75 + (metadata.mdlScore * 0.45);
	const compactionWeight =
		metadata.compactionDisposition === "healthy"
			? 1
			: metadata.compactionDisposition === "watch"
				? 0.9
				: 0.72;
	const packedWeight = metadata.packedAccepted ? 1.03 : 1;
	const epochWeight = metadata.staleEpoch ? 0.65 : 1;
	return Math.round(baseScore * mdlWeight * compactionWeight * packedWeight * epochWeight * 1000) / 1000;
}
