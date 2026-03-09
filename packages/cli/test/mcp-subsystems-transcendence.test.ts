import { beforeEach, describe, expect, it, vi } from "vitest";

const fuzzyLookupMock = vi.hoisted(() => vi.fn());
const ingestRegressionsMock = vi.hoisted(() => vi.fn());
const prefetchMock = vi.hoisted(() => vi.fn());
const resetMock = vi.hoisted(() => vi.fn());
const getDbMock = vi.hoisted(() => vi.fn());
const daemonNotificationHandlers = vi.hoisted(() => new Map<string, (params?: Record<string, unknown>) => void>());
const onDaemonNotificationMock = vi.hoisted(() => vi.fn(async (method: string, handler: (params?: Record<string, unknown>) => void) => {
	daemonNotificationHandlers.set(method, handler);
	return () => { daemonNotificationHandlers.delete(method); };
}));
const TranscendenceEngineMock = vi.hoisted(() =>
	vi.fn().mockImplementation(function(this: {
		fuzzyLookup: typeof fuzzyLookupMock;
		ingestRegressions: typeof ingestRegressionsMock;
		prefetch: typeof prefetchMock;
		reset: typeof resetMock;
	}) {
		this.fuzzyLookup = fuzzyLookupMock;
		this.ingestRegressions = ingestRegressionsMock;
		this.prefetch = prefetchMock;
		this.reset = resetMock;
	}),
);

vi.mock("@chitragupta/smriti", () => ({
	TranscendenceEngine: TranscendenceEngineMock,
}));

vi.mock("@chitragupta/smriti/db/database", () => ({
	DatabaseManager: {
		instance: () => ({
			get: getDbMock,
		}),
	},
}));

vi.mock("../src/modes/daemon-bridge.js", () => ({
	onDaemonNotification: onDaemonNotificationMock,
}));

describe("lookupTranscendenceFuzzy", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
		daemonNotificationHandlers.clear();
		getDbMock.mockReturnValue({
			prepare: () => ({
				all: () => [],
				get: () => undefined,
			}),
		});
	});

	it("returns null immediately in fresh mode", async () => {
		const { lookupTranscendenceFuzzy } = await import("../src/modes/mcp-subsystems.js");

		const hit = await lookupTranscendenceFuzzy("auth", { fresh: true });

		expect(hit).toBeNull();
		expect(TranscendenceEngineMock).not.toHaveBeenCalled();
		expect(fuzzyLookupMock).not.toHaveBeenCalled();
	});

	it("returns null immediately in noCache mode", async () => {
		const { lookupTranscendenceFuzzy } = await import("../src/modes/mcp-subsystems.js");

		const hit = await lookupTranscendenceFuzzy("auth", { noCache: true });

		expect(hit).toBeNull();
		expect(TranscendenceEngineMock).not.toHaveBeenCalled();
		expect(fuzzyLookupMock).not.toHaveBeenCalled();
	});

	it("returns a normalized predictive hit when cache reads are allowed", async () => {
		fuzzyLookupMock.mockReturnValue({
			entity: "auth",
			content: "Cached auth guidance",
			source: "natasha",
		});

		const { lookupTranscendenceFuzzy } = await import("../src/modes/mcp-subsystems.js");
		const hit = await lookupTranscendenceFuzzy("auth");

		expect(hit).toEqual({
			entity: "auth",
			content: "Cached auth guidance",
			source: "natasha",
		});
		expect(fuzzyLookupMock).toHaveBeenCalledWith("auth");
	});

	it("ingests shared Scarlett regressions before fuzzy lookup", async () => {
		getDbMock.mockReturnValue({
				prepare: () => ({
					all: () => [{
						topic: "smriti",
						trace_type: "warning",
						content: "[critical] smriti unhealthy",
						metadata: JSON.stringify({ severity: "critical" }),
						created_at: Date.now(),
				}],
				get: () => undefined,
			}),
		});
		fuzzyLookupMock.mockReturnValue({
			entity: "smriti",
			content: "Cached smriti guidance",
			source: "regression",
		});

		const { lookupTranscendenceFuzzy } = await import("../src/modes/mcp-subsystems.js");
		const hit = await lookupTranscendenceFuzzy("smriti");

		expect(hit).toEqual({
			entity: "smriti",
			content: "Cached smriti guidance",
			source: "regression",
		});
		expect(ingestRegressionsMock).toHaveBeenCalledWith([
			expect.objectContaining({
				errorSignature: "smriti",
				severity: "critical",
			}),
		]);
		expect(prefetchMock).toHaveBeenCalled();
	});

	it("ingests live daemon anomaly alerts and clears them on heal notifications", async () => {
		const { getTranscendence } = await import("../src/modes/mcp-subsystems.js");
		await getTranscendence();

		expect(onDaemonNotificationMock).toHaveBeenCalledWith("anomaly_alert", expect.any(Function));
		expect(onDaemonNotificationMock).toHaveBeenCalledWith("heal_reported", expect.any(Function));

		daemonNotificationHandlers.get("anomaly_alert")?.({
			type: "internal_probe",
			severity: "critical",
			details: {
				probe: "smriti-db",
				entity: "smriti",
				summary: "Smriti DB unhealthy",
			},
			suggestion: "Investigate internal subsystem smriti-db",
		});

		await vi.waitFor(() => {
			expect(ingestRegressionsMock).toHaveBeenCalledWith([
				expect.objectContaining({
					errorSignature: "smriti",
					severity: "critical",
				}),
			]);
		});
		expect(prefetchMock).toHaveBeenCalled();

		daemonNotificationHandlers.get("heal_reported")?.({
			anomalyType: "internal_probe",
			actionTaken: "smriti-db",
			entity: "smriti",
			outcome: "success",
		});

		await vi.waitFor(() => {
			expect(resetMock).toHaveBeenCalled();
		});
	});

	it("can prime Scarlett notifications before transcendence exists", async () => {
		const { primeLucyScarlettRuntime, getTranscendence } = await import("../src/modes/mcp-subsystems.js");

		await primeLucyScarlettRuntime();
		expect(TranscendenceEngineMock).not.toHaveBeenCalled();
		expect(onDaemonNotificationMock).toHaveBeenCalledWith("anomaly_alert", expect.any(Function));
		expect(onDaemonNotificationMock).toHaveBeenCalledWith("heal_reported", expect.any(Function));

		daemonNotificationHandlers.get("anomaly_alert")?.({
			type: "internal_probe",
			severity: "warning",
			details: {
				probe: "semantic-sync",
				entity: "semantic-memory",
				summary: "Semantic sync lagging",
			},
			suggestion: "Investigate semantic mirror health",
		});

		await getTranscendence();

		expect(ingestRegressionsMock).toHaveBeenCalledWith([
			expect.objectContaining({
				errorSignature: "semantic-memory",
				severity: "warning",
			}),
		]);
	});
});
