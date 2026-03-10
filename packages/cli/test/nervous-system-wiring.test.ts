import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetLucyLiveContextViaDaemon = vi.fn();
const mockPackContextViaDaemon = vi.fn();
const mockPackLiveContextText = vi.fn();
const mockAllowLocalRuntimeFallback = vi.fn(() => false);

vi.mock("../src/modes/daemon-bridge.js", () => ({
	getLucyLiveContextViaDaemon: mockGetLucyLiveContextViaDaemon,
}));

vi.mock("../src/modes/daemon-bridge-sessions.js", () => ({
	packContextViaDaemon: mockPackContextViaDaemon,
}));

vi.mock("../src/runtime-daemon-proxies.js", () => ({
	allowLocalRuntimeFallback: mockAllowLocalRuntimeFallback,
}));

vi.mock("@chitragupta/smriti", () => ({
	DatabaseManager: {
		instance: vi.fn(() => ({ get: vi.fn() })),
	},
	packLiveContextText: mockPackLiveContextText,
}));

describe("nervous-system-wiring Lucy guidance", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAllowLocalRuntimeFallback.mockReturnValue(false);
		mockGetLucyLiveContextViaDaemon.mockResolvedValue({
			hit: { content: "Recent memory: auth retry path" },
			predictions: [
				{ entity: "auth.ts", confidence: 0.93, source: "transcendence" },
			],
			liveSignals: [
				{ entity: "smriti", reason: "semantic sync lag" },
			],
		});
		mockPackContextViaDaemon.mockResolvedValue({ packed: false });
		mockPackLiveContextText.mockResolvedValue(null);
	});

	it("packs Lucy live guidance through the daemon compression policy when available", async () => {
		mockPackContextViaDaemon.mockResolvedValue({
			runtime: "pakt-core",
			packedText: "packed-lucy-guidance",
			format: "text",
			savings: 39,
			originalLength: 321,
		});

		const { getLucyLiveGuidanceBlock } = await import("../src/nervous-system-wiring.js");
		const result = await getLucyLiveGuidanceBlock("Investigate auth regression", "/tmp/project");

		expect(result).toContain("## Lucy live guidance");
		expect(result).toContain("[packed via pakt-core");
		expect(result).toContain("packed-lucy-guidance");
		expect(mockPackContextViaDaemon).toHaveBeenCalledTimes(1);
		expect(mockPackLiveContextText).not.toHaveBeenCalled();
	});

	it("uses daemon-provided packed Lucy guidance blocks without rebuilding them locally", async () => {
		mockGetLucyLiveContextViaDaemon.mockResolvedValue({
			hit: { content: "Recent memory: auth retry path" },
			predictions: [{ entity: "auth.ts", confidence: 0.93, source: "transcendence" }],
			liveSignals: [{ entity: "smriti", reason: "semantic sync lag" }],
			guidanceBlock: "## Lucy live guidance\n[packed via pakt-core, saved 35%]\npacked-daemon-guidance",
		});

		const { getLucyLiveGuidanceBlock } = await import("../src/nervous-system-wiring.js");
		const result = await getLucyLiveGuidanceBlock("Investigate auth regression", "/tmp/project");

		expect(result).toContain("packed-daemon-guidance");
		expect(mockPackContextViaDaemon).not.toHaveBeenCalled();
		expect(mockPackLiveContextText).not.toHaveBeenCalled();
	});

	it("falls back to local packing when daemon packing fails and local fallback is allowed", async () => {
		mockAllowLocalRuntimeFallback.mockReturnValue(true);
		mockPackContextViaDaemon.mockRejectedValue(new Error("daemon unavailable"));
		mockPackLiveContextText.mockResolvedValue({
			runtime: "pakt-core",
			packedText: "local-packed-guidance",
			format: "text",
			savings: 22,
			originalLength: 280,
		});

		const { getLucyLiveGuidanceBlock } = await import("../src/nervous-system-wiring.js");
		const result = await getLucyLiveGuidanceBlock("Investigate auth regression", "/tmp/project");

		expect(result).toContain("## Lucy live guidance");
		expect(result).toContain("packed via pakt-core");
		expect(result).toContain("local-packed-guidance");
		expect(mockPackLiveContextText).toHaveBeenCalledTimes(1);
	});

	it("treats daemon packed=false as authoritative when building Lucy live guidance", async () => {
		mockAllowLocalRuntimeFallback.mockReturnValue(true);
		mockPackContextViaDaemon.mockResolvedValue({ packed: false });
		mockPackLiveContextText.mockResolvedValue({
			runtime: "pakt-core",
			packedText: "declined-local-packed-guidance",
			format: "text",
			savings: 19,
			originalLength: 240,
		});

		const { getLucyLiveGuidanceBlock } = await import("../src/nervous-system-wiring.js");
		const result = await getLucyLiveGuidanceBlock("Investigate auth regression", "/tmp/project");

		expect(result).toContain("## Lucy live guidance");
		expect(result).not.toContain("packed via pakt-core");
		expect(result).not.toContain("declined-local-packed-guidance");
		expect(mockPackLiveContextText).not.toHaveBeenCalled();
	});

	it("packs Transcendence prompt enrichment through the shared compression policy", async () => {
		mockPackContextViaDaemon.mockResolvedValue({
			runtime: "pakt-core",
			packedText: "packed-predictions",
			format: "text",
			savings: 33,
			originalLength: 198,
		});

		const { enrichFromTranscendence } = await import("../src/nervous-system-wiring.js");
		const result = await enrichFromTranscendence("/tmp/project");

		expect(result).toContain("## Predicted Context (Transcendence pre-cache)");
		expect(result).toContain("packed via pakt-core");
		expect(result).toContain("packed-predictions");
	});

	it("packs Vasana prompt enrichment through the shared compression policy", async () => {
		mockPackContextViaDaemon.mockResolvedValue({
			runtime: "pakt-core",
			packedText: "packed-vasana",
			format: "text",
			savings: 28,
			originalLength: 176,
		});

		const { enrichFromVasana } = await import("../src/nervous-system-wiring.js");
		const result = await enrichFromVasana({
			getVasanas: () => [
				{
					tendency: "Prefer small, reversible changes",
					description: "Past sessions converged faster with narrow edits.",
					strength: 0.84,
					valence: "positive",
				},
			],
		}, "/tmp/project");

		expect(result).toContain("## Behavioral Tendencies (Vasana)");
		expect(result).toContain("packed via pakt-core");
		expect(result).toContain("packed-vasana");
	});
});
