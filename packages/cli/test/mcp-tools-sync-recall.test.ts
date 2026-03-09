import { beforeEach, describe, expect, it, vi } from "vitest";

import { createRecallTool } from "../src/modes/mcp-tools-sync.js";

const daemonBridgeMock = vi.hoisted(() => ({
	unifiedRecall: vi.fn(),
}));

const subsystemMock = vi.hoisted(() => ({
	lookupTranscendenceFuzzy: vi.fn(),
}));

vi.mock("../src/modes/daemon-bridge.js", () => daemonBridgeMock);
vi.mock("../src/modes/mcp-subsystems.js", () => subsystemMock);

describe("mcp-tools-sync recall", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		daemonBridgeMock.unifiedRecall.mockResolvedValue([
			{
				score: 0.91,
				answer: "The auth fix lives in the session archive.",
				primarySource: "session",
				sessionId: "sess-1",
			},
		]);
	});

	it("includes predicted context by default", async () => {
		subsystemMock.lookupTranscendenceFuzzy.mockResolvedValue({
			entity: "auth",
			content: "Predicted auth context",
			source: "natasha",
		});

		const result = await createRecallTool().execute({ query: "auth" });
		const text = (result.content?.[0] as { text?: string } | undefined)?.text ?? "";

		expect(subsystemMock.lookupTranscendenceFuzzy).toHaveBeenCalledWith("auth", { noCache: false });
		expect(text).toContain("Predicted");
		expect(result._metadata).toEqual(expect.objectContaining({
			noCache: false,
			typed: expect.objectContaining({
				noCache: false,
				predicted: true,
			}),
		}));
	});

	it("supports fresh mode as an alias for noCache", async () => {
		subsystemMock.lookupTranscendenceFuzzy.mockResolvedValue(null);

		const result = await createRecallTool().execute({ query: "auth", fresh: true });
		const text = (result.content?.[0] as { text?: string } | undefined)?.text ?? "";

		expect(subsystemMock.lookupTranscendenceFuzzy).toHaveBeenCalledWith("auth", { noCache: true });
		expect(text).not.toContain("Predicted");
		expect(result._metadata).toEqual(expect.objectContaining({
			noCache: true,
			typed: expect.objectContaining({
				noCache: true,
				predicted: false,
			}),
		}));
	});

	it("bypasses predicted context when noCache is requested directly", async () => {
		subsystemMock.lookupTranscendenceFuzzy.mockResolvedValue(null);

		const result = await createRecallTool().execute({ query: "auth", noCache: true });
		const text = (result.content?.[0] as { text?: string } | undefined)?.text ?? "";

		expect(subsystemMock.lookupTranscendenceFuzzy).toHaveBeenCalledWith("auth", { noCache: true });
		expect(text).not.toContain("Predicted");
		expect(result._metadata).toEqual(expect.objectContaining({
			noCache: true,
			typed: expect.objectContaining({
				noCache: true,
				predicted: false,
			}),
		}));
	});
});
