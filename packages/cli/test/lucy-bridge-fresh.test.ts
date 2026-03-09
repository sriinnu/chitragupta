import { beforeEach, describe, expect, it, vi } from "vitest";

import { executeLucy } from "../src/modes/lucy-bridge.js";
import type { LucyBridgeConfig } from "../src/modes/lucy-bridge.js";

const { mockPackLiveContextText } = vi.hoisted(() => ({
	mockPackLiveContextText: vi.fn(),
}));
const { mockPackContextViaDaemon } = vi.hoisted(() => ({
	mockPackContextViaDaemon: vi.fn(),
}));

vi.mock("../src/modes/coding-router.js", () => ({
	routeViaBridge: vi.fn(),
}));

vi.mock("@chitragupta/smriti", () => ({
	packLiveContextText: mockPackLiveContextText,
}));

vi.mock("../src/modes/daemon-bridge-sessions.js", () => ({
	packContextViaDaemon: mockPackContextViaDaemon,
}));

import { routeViaBridge } from "../src/modes/coding-router.js";

const mockRouteViaBridge = vi.mocked(routeViaBridge);

function createConfig(overrides?: Partial<LucyBridgeConfig>): LucyBridgeConfig {
	return {
		projectPath: "/test/project",
		maxAutoFixAttempts: 0,
		autoFixThreshold: 0.7,
		queryEpisodic: vi.fn().mockResolvedValue([]),
		queryAkasha: vi.fn().mockResolvedValue([]),
		recordEpisode: vi.fn().mockResolvedValue(undefined),
		depositAkasha: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

describe("Lucy Bridge fresh mode", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockPackLiveContextText.mockResolvedValue(null);
		mockPackContextViaDaemon.mockResolvedValue({ packed: false });
		mockRouteViaBridge.mockResolvedValue({
			cli: "takumi",
			output: "Done",
			exitCode: 0,
		});
	});

	it("prepends predictive context when cache reads are allowed", async () => {
		const transcendenceEngine = {
			fuzzyLookup: vi.fn().mockReturnValue({
				entity: "auth",
				content: "Cached auth repair hint",
				source: "natasha",
			}),
		};

		await executeLucy("Fix auth", createConfig({ transcendenceEngine }));

		expect(transcendenceEngine.fuzzyLookup).toHaveBeenCalledWith("Fix auth");
		expect(mockRouteViaBridge).toHaveBeenCalledWith(expect.objectContaining({
			context: expect.objectContaining({
				episodicHints: [expect.stringContaining("[Transcendence:natasha] Cached auth repair hint")],
			}),
		}));
	});

	it("prefers async shared Transcendence queries when provided", async () => {
		const queryTranscendence = vi.fn().mockResolvedValue({
			entity: "auth",
			content: "Daemon-backed auth repair hint",
			source: "daemon-shared",
		});

		await executeLucy("Fix auth", createConfig({ queryTranscendence }));

		expect(queryTranscendence).toHaveBeenCalledWith("Fix auth", "/test/project");
		expect(mockRouteViaBridge).toHaveBeenCalledWith(expect.objectContaining({
			context: expect.objectContaining({
				episodicHints: [expect.stringContaining("[Transcendence:daemon-shared] Daemon-backed auth repair hint")],
			}),
		}));
	});

	it("skips predictive context when fresh mode is requested", async () => {
		const transcendenceEngine = {
			fuzzyLookup: vi.fn().mockReturnValue({
				entity: "auth",
				content: "Cached auth repair hint",
				source: "natasha",
			}),
		};

		await executeLucy("Fix auth", createConfig({ fresh: true, transcendenceEngine }));

		expect(transcendenceEngine.fuzzyLookup).not.toHaveBeenCalled();
		expect(mockRouteViaBridge).toHaveBeenCalledWith(expect.objectContaining({
			context: {},
		}));
	});

	it("skips predictive context when noCache is requested", async () => {
		const transcendenceEngine = {
			fuzzyLookup: vi.fn().mockReturnValue({
				entity: "auth",
				content: "Cached auth repair hint",
				source: "natasha",
			}),
		};

		await executeLucy("Fix auth", createConfig({ noCache: true, transcendenceEngine }));

		expect(transcendenceEngine.fuzzyLookup).not.toHaveBeenCalled();
		expect(mockRouteViaBridge).toHaveBeenCalledWith(expect.objectContaining({
			context: {},
		}));
	});
});
