import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProfile } from "@chitragupta/core";
import type { AgentConfig } from "../src/types.js";

const memoryBridgeMock = vi.hoisted(() => ({
	initSession: vi.fn(),
	loadMemoryContext: vi.fn(),
	recordUserTurn: vi.fn(),
	recordAssistantTurn: vi.fn(),
	getIdentityContext: vi.fn(),
}));

const runAgentLoopMock = vi.hoisted(() => vi.fn());

vi.mock("../src/agent-comm.js", () => ({
	initializeSubsystems: vi.fn(() => ({
		memoryBridge: {
			initSession: memoryBridgeMock.initSession,
			loadMemoryContext: memoryBridgeMock.loadMemoryContext,
			recordUserTurn: memoryBridgeMock.recordUserTurn,
			recordAssistantTurn: memoryBridgeMock.recordAssistantTurn,
			getIdentityContext: memoryBridgeMock.getIdentityContext,
		},
		learningLoop: null,
		autonomousAgent: null,
		chetana: null,
		actorSystem: null,
		actorRef: null,
		samiti: null,
		lokapala: null,
		kaala: null,
	})),
	requestInput: vi.fn(),
	resolveInput: vi.fn(),
	sendMeshMessage: vi.fn(),
	askMeshAgent: vi.fn(),
	broadcastToSamitiChannel: vi.fn(),
	broadcastEventToSamiti: vi.fn(),
}));

vi.mock("../src/agent-loop.js", () => ({
	runAgentLoop: runAgentLoopMock,
}));

vi.mock("../src/agent-soul.js", () => ({
	SoulManager: vi.fn().mockImplementation(function(this: {
		getAll: () => unknown[];
		buildSoulPrompt: () => string;
	}) {
		this.getAll = () => [];
		this.buildSoulPrompt = () => "";
	}),
}));

import { Agent } from "../src/agent.js";

const TEST_PROFILE: AgentProfile = {
	id: "test",
	name: "Test Agent",
	personality: "You are a test agent.",
	expertise: ["testing"],
	voice: "minimal",
};

function makeConfig(overrides?: Partial<AgentConfig>): AgentConfig {
	return {
		profile: TEST_PROFILE,
		providerId: "mock",
		model: "mock-model",
		enableMemory: true,
		project: "/test/project",
		...overrides,
	};
}

describe("Agent prompt context refresh", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		memoryBridgeMock.getIdentityContext.mockReturnValue(null);
		memoryBridgeMock.initSession.mockResolvedValue("session-1");
		memoryBridgeMock.loadMemoryContext.mockResolvedValue("## Memory Context\nremembered context");
		memoryBridgeMock.recordUserTurn.mockResolvedValue(undefined);
		memoryBridgeMock.recordAssistantTurn.mockResolvedValue(undefined);
		runAgentLoopMock.mockImplementation(async (deps: {
			createMessage: (role: "assistant", content: Array<{ type: "text"; text: string }>) => unknown;
		}) => deps.createMessage("assistant", [{ type: "text", text: "done" }]));
	});

	it("refreshes memory prompt context on every turn", async () => {
		memoryBridgeMock.loadMemoryContext
			.mockResolvedValueOnce("## Memory Context\nold context")
			.mockResolvedValueOnce("## Memory Context\nfresh context");

		const agent = new Agent(makeConfig());
		agent.setProvider({ id: "mock" } as never);

		await agent.prompt("first");
		await agent.prompt("second");

		expect(memoryBridgeMock.initSession).toHaveBeenCalledTimes(1);
		expect(memoryBridgeMock.loadMemoryContext).toHaveBeenCalledTimes(2);
		expect(agent.getState().systemPrompt).toContain("fresh context");
		expect(agent.getState().systemPrompt).not.toContain("old context");
	});

	it("refreshes memory prompt context when scoped memory changes without identity changes", async () => {
		memoryBridgeMock.loadMemoryContext
			.mockResolvedValueOnce("## Memory Context\nproject memory v1")
			.mockResolvedValueOnce("## Memory Context\nproject memory v2");

		const agent = new Agent(makeConfig());
		agent.setProvider({ id: "mock" } as never);

		await agent.prompt("first");
		await agent.prompt("second");

		expect(memoryBridgeMock.loadMemoryContext).toHaveBeenCalledTimes(2);
		expect(agent.getState().systemPrompt).toContain("project memory v2");
		expect(agent.getState().systemPrompt).not.toContain("project memory v1");
	});

	it("falls back to the last successful memory prompt context when a refresh fails", async () => {
		memoryBridgeMock.loadMemoryContext
			.mockResolvedValueOnce("## Memory Context\nstable context")
			.mockRejectedValueOnce(new Error("memory store unavailable"));

		const agent = new Agent(makeConfig());
		agent.setProvider({ id: "mock" } as never);

		await agent.prompt("first");
		await agent.prompt("second");

		expect(memoryBridgeMock.loadMemoryContext).toHaveBeenCalledTimes(2);
		expect(agent.getState().systemPrompt).toContain("stable context");
	});
});
