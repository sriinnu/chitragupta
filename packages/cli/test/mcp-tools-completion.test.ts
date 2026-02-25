import { beforeEach, describe, expect, it, vi } from "vitest";

const routerConfigSpy = vi.fn<(config: Record<string, unknown>) => void>();
const completeSpy = vi.fn(
	async (request: Record<string, unknown>) => ({
		id: "cmp-1",
		model: String(request.model ?? "unknown"),
		content: [{ type: "text" as const, text: `model:${String(request.model ?? "unknown")}` }],
		stopReason: "end_turn" as const,
		usage: { inputTokens: 1, outputTokens: 1 },
	}),
);
const createAnthropicAdapterSpy = vi.fn(() => ({
	id: "anthropic",
	name: "Anthropic",
	complete: vi.fn(),
}));
const createOpenAIAdapterSpy = vi.fn(() => ({
	id: "openai",
	name: "OpenAI",
	complete: vi.fn(),
}));

vi.mock("@chitragupta/swara", () => {
	class MockCompletionRouter {
		constructor(config: Record<string, unknown>) {
			routerConfigSpy(config);
		}

		complete = completeSpy;
	}

	return {
		CompletionRouter: MockCompletionRouter,
		createAnthropicAdapter: createAnthropicAdapterSpy,
		createOpenAIAdapter: createOpenAIAdapterSpy,
	};
});

async function createTool() {
	const mod = await import("../src/modes/mcp-tools-completion.js");
	return mod.createCompletionTool();
}

describe("mcp-tools-completion", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it("uses pinned-provider default model when provider is set and model is omitted", async () => {
		vi.stubEnv("OPENAI_API_KEY", "test-openai-key");

		const tool = await createTool();
		const result = await tool.execute({ prompt: "hello", provider: "openai" });

		expect(result.isError).toBeUndefined();
		expect(createOpenAIAdapterSpy).toHaveBeenCalledTimes(1);
		expect(routerConfigSpy).toHaveBeenCalledWith(expect.objectContaining({ defaultModel: "gpt-4o" }));
		expect(completeSpy).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4o" }));
		expect(result.content[0]?.type).toBe("text");
		expect((result.content[0] as { text?: string }).text).toContain("model:gpt-4o");
	});

	it("uses an available provider default when provider is omitted and only one adapter is loaded", async () => {
		vi.stubEnv("OPENAI_API_KEY", "test-openai-key");

		const tool = await createTool();
		const result = await tool.execute({ prompt: "hello" });

		expect(result.isError).toBeUndefined();
		expect(routerConfigSpy).toHaveBeenCalledWith(expect.objectContaining({ defaultModel: "gpt-4o" }));
		expect(completeSpy).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4o" }));
	});

	it("returns a clear error for unsupported pinned providers", async () => {
		const tool = await createTool();
		const result = await tool.execute({ prompt: "hello", provider: "ollama" });

		expect(result.isError).toBe(true);
		expect((result.content[0] as { text?: string }).text).toContain('unsupported provider "ollama"');
		expect((result.content[0] as { text?: string }).text).toContain("anthropic, openai");
		expect(routerConfigSpy).not.toHaveBeenCalled();
	});

	it("matches no-provider error text to the actually supported adapters", async () => {
		const tool = await createTool();
		const pinned = await tool.execute({ prompt: "hello", provider: "openai" });
		const unpinned = await tool.execute({ prompt: "hello" });

		expect(pinned.isError).toBe(true);
		expect((pinned.content[0] as { text?: string }).text).toContain("Set OPENAI_API_KEY");
		expect(unpinned.isError).toBe(true);
		expect((unpinned.content[0] as { text?: string }).text).toContain(
			"Set ANTHROPIC_API_KEY or OPENAI_API_KEY",
		);
		expect((unpinned.content[0] as { text?: string }).text).not.toContain("Ollama");
	});

	it("advertises only currently supported pinned providers in the tool schema", async () => {
		const tool = await createTool();
		const description = tool.definition.description;
		const providerDescription = (
			(tool.definition.inputSchema.properties as Record<string, { description?: string }>).provider
				?.description ?? ""
		);

		expect(description).toContain("anthropic/openai");
		expect(description).not.toContain("gemini");
		expect(description).not.toContain("mistral");
		expect(providerDescription).toContain("'anthropic' or 'openai'");
	});
});
