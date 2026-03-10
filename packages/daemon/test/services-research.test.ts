import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RpcRouter } from "../src/rpc-router.js";
import { registerResearchMethods } from "../src/services-research.js";

const upsertResearchExperiment = vi.fn((input: Record<string, unknown>) => ({ id: "exp-1", ...input }));
const listResearchExperiments = vi.fn(() => [
	{ id: "exp-1", decision: "keep", packedContext: "pakt:abc" },
]);
const autoProcessTextThroughPolicy = vi.fn(async () => ({ result: "expanded context" }));
const appendMemory = vi.fn(async () => undefined);
const leave = vi.fn(() => ({ id: "trace-1" }));
const restore = vi.fn();
const persist = vi.fn();
const get = vi.fn(() => ({ kind: "agent-db" }));
const instance = vi.fn(() => ({ get }));
const AkashaField = vi.fn(function AkashaFieldMock(this: Record<string, unknown>) {
	this.restore = restore;
	this.leave = leave;
	this.persist = persist;
});
const DatabaseManager = { instance };

vi.mock("@chitragupta/smriti", () => ({
	upsertResearchExperiment,
	listResearchExperiments,
	autoProcessTextThroughPolicy,
	appendMemory,
	AkashaField,
	DatabaseManager,
}));

describe("services-research", () => {
	let router: RpcRouter;

	beforeEach(() => {
		router = new RpcRouter();
		registerResearchMethods(router);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("records bounded research experiments into the canonical ledger", async () => {
		const result = await router.handle("research.experiments.record", {
			projectPath: "/repo/project",
			experimentKey: "exp-key-1",
			budgetMs: 300000,
			topic: "optimizer sweep",
			metricName: "val_bpb",
			objective: "minimize",
			decision: "keep",
			sessionId: "sess-1",
			parentSessionId: "parent-1",
			sessionLineageKey: "lineage-a",
			sabhaId: "sabha-1",
			record: { delta: 0.01 },
		}, {});

		expect(upsertResearchExperiment).toHaveBeenCalledWith(expect.objectContaining({
			projectPath: "/repo/project",
			experimentKey: "exp-key-1",
			budgetMs: 300000,
			topic: "optimizer sweep",
			metricName: "val_bpb",
			objective: "minimize",
			decision: "keep",
			sessionId: "sess-1",
			parentSessionId: "parent-1",
			sessionLineageKey: "lineage-a",
			sabhaId: "sabha-1",
		}));
		expect(result).toEqual({
			experiment: expect.objectContaining({ id: "exp-1", decision: "keep" }),
		});
	});

	it("records research outcomes atomically through memory, akasha, and the ledger", async () => {
		const result = await router.handle("research.outcome.record", {
			projectPath: "/repo/../repo/project",
			experimentKey: "exp-key-2",
			budgetMs: 300000,
			topic: "optimizer sweep",
			hypothesis: "adamw warmup beats cosine",
			metricName: "val_bpb",
			objective: "minimize",
			decision: "keep",
			agentId: "prana:autoresearch",
			entry: "## experiment",
			traceContent: "decision trace",
			traceMetadata: { phase: "night" },
			sessionId: "sess-1",
			parentSessionId: "parent-1",
			sessionLineageKey: "lineage-a",
			sabhaId: "sabha-2",
			record: { delta: 0.01 },
		}, {});

		expect(appendMemory).toHaveBeenCalledWith(
			{ type: "project", path: "/repo/project" },
			"## experiment",
			{ dedupe: false },
		);
		expect(AkashaField).toHaveBeenCalled();
		expect(restore).toHaveBeenCalledWith({ kind: "agent-db" });
		expect(leave).toHaveBeenCalledWith(
			"prana:autoresearch",
			"pattern",
			"optimizer sweep",
			"decision trace",
			{ phase: "night" },
		);
		expect(persist).toHaveBeenCalledWith({ kind: "agent-db" });
		expect(upsertResearchExperiment).toHaveBeenCalledWith(expect.objectContaining({
			projectPath: "/repo/project",
			experimentKey: "exp-key-2",
			budgetMs: 300000,
			topic: "optimizer sweep",
			parentSessionId: "parent-1",
			sessionLineageKey: "lineage-a",
			sabhaId: "sabha-2",
		}));
		expect(result).toEqual({
			recorded: true,
			memoryScope: "project",
			traceId: "trace-1",
			experimentId: "exp-1",
			experiment: expect.objectContaining({ id: "exp-1", decision: "keep" }),
		});
	});

	it("lists experiments and expands packed context on demand", async () => {
		const result = await router.handle("research.experiments.list", {
			projectPath: "/repo/project",
			decision: "keep",
			limit: 20,
			expandPackedContext: true,
		}, {});

		expect(listResearchExperiments).toHaveBeenCalledWith({
			projectPath: "/repo/project",
			sessionId: undefined,
			decision: "keep",
			limit: 20,
		});
		expect(autoProcessTextThroughPolicy).toHaveBeenCalledWith({ text: "pakt:abc" });
		expect(result).toEqual({
			experiments: [
				expect.objectContaining({
					id: "exp-1",
					expandedPackedContext: "expanded context",
				}),
			],
		});
	});
});
