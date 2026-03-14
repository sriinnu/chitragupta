import { describe, expect, it } from "vitest";

import { SEMANTIC_EMBEDDING_POLICY_VERSION } from "../src/embedding-epoch.js";
import { parseSearchMetadata } from "../src/consolidation-indexer-search.js";

describe("consolidation-indexer-search", () => {
	it("marks malformed persisted embedding epochs as stale when a live epoch is expected", () => {
		const metadata = parseSearchMetadata(
			{
				source_id: "2026-03-12",
				metadata: JSON.stringify({
					period: "2026-03-12",
					embeddingEpoch: {
						providerId: "provider-a",
						modelId: "model-a",
						dimensions: 1536,
						strategy: "provider",
						epoch: "provider-a:model-a:1536:provider",
					},
				}),
			},
			`provider-a:model-a:1536:provider:${SEMANTIC_EMBEDDING_POLICY_VERSION}`,
		);

		expect(metadata.staleEpoch).toBe(true);
	});

	it("does not mark stale epoch when no epoch is expected for the read path", () => {
		const metadata = parseSearchMetadata(
			{
				source_id: "2026-03-12",
				metadata: JSON.stringify({
					period: "2026-03-12",
					embeddingEpoch: {
						providerId: "provider-a",
						modelId: "model-a",
						dimensions: 1536,
						strategy: "provider",
						epoch: "provider-a:model-a:1536:provider",
					},
				}),
			},
			null,
		);

		expect(metadata.staleEpoch).toBe(false);
	});
});
