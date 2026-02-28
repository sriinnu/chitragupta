import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConsolidateTool, createVidhisTool } from "../src/modes/mcp-tools-sync.js";

const daemonBridgeMock = vi.hoisted(() => ({
	listVidhisViaDaemon: vi.fn(),
	matchVidhiViaDaemon: vi.fn(),
	runConsolidationViaDaemon: vi.fn(),
}));

vi.mock("../src/modes/daemon-bridge.js", () => daemonBridgeMock);

describe("mcp-tools-sync daemon routing", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("routes vidhis list through daemon bridge", async () => {
		daemonBridgeMock.listVidhisViaDaemon.mockResolvedValue([
			{
				name: "memory triage",
				steps: [{ toolName: "memory.search", description: "find prior context" }],
				triggers: ["remember", "recall"],
				confidence: 0.84,
				successRate: 0.9,
				successCount: 9,
				failureCount: 1,
				parameterSchema: {},
			},
		]);
		const tool = createVidhisTool("/tmp/project");
		const result = await tool.execute({});

		expect(daemonBridgeMock.listVidhisViaDaemon).toHaveBeenCalledWith("/tmp/project", 10);
		const text = (result.content?.[0] as { text?: string } | undefined)?.text ?? "";
		expect(text).toContain("Learned Procedures");
		expect(text).toContain("memory triage");
	});

	it("routes vidhis search through daemon bridge", async () => {
		daemonBridgeMock.matchVidhiViaDaemon.mockResolvedValue({
			name: "weather brief",
			steps: [{ toolName: "weather", description: "fetch current weather" }],
			triggers: ["weather", "forecast"],
			confidence: 0.72,
			successRate: 0.88,
			successCount: 22,
			failureCount: 3,
			parameterSchema: {},
		});
		const tool = createVidhisTool("/tmp/project");
		const result = await tool.execute({ query: "weather tomorrow" });

		expect(daemonBridgeMock.matchVidhiViaDaemon).toHaveBeenCalledWith("/tmp/project", "weather tomorrow");
		const text = (result.content?.[0] as { text?: string } | undefined)?.text ?? "";
		expect(text).toContain("Best match");
		expect(text).toContain("weather brief");
	});

	it("routes consolidation through daemon bridge", async () => {
		daemonBridgeMock.runConsolidationViaDaemon.mockResolvedValue({
			sessionsAnalyzed: 5,
			newRulesCount: 2,
			reinforcedRulesCount: 3,
			weakenedRulesCount: 1,
			patternsDetectedCount: 4,
			newRulesPreview: ["[memory] favor project recall before web lookup"],
			vidhisNewCount: 1,
			vidhisReinforcedCount: 2,
		});
		const tool = createConsolidateTool("/tmp/project");
		const result = await tool.execute({ sessionCount: 7 });

		expect(daemonBridgeMock.runConsolidationViaDaemon).toHaveBeenCalledWith("/tmp/project", 7);
		const text = (result.content?.[0] as { text?: string } | undefined)?.text ?? "";
		expect(text).toContain("Swapna Consolidation Complete");
		expect(text).toContain("Sessions analyzed: 5");
		expect(text).toContain("Vidhis: 1 new, 2 reinforced");
	});
});
