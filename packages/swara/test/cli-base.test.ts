import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Context, StreamEvent, ModelDefinition } from "../src/types.js";
import { createCLIProvider, type CLIProviderConfig } from "../src/providers/cli-base.js";
import { ProcessPool } from "../src/process-pool.js";

function minimalContext(userText = "Hello"): Context {
	return {
		messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
	};
}

async function collectEvents(gen: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
	const events: StreamEvent[] = [];
	for await (const e of gen) events.push(e);
	return events;
}

const testModel: ModelDefinition = {
	id: "test-cli-model",
	name: "Test CLI Model",
	contextWindow: 64_000,
	maxOutputTokens: 8_192,
	pricing: { input: 0, output: 0 },
	capabilities: { vision: false, thinking: false, toolUse: false, streaming: false },
};

describe("CLI Provider Base (createCLIProvider)", () => {
	let mockPool: ProcessPool;

	beforeEach(() => {
		mockPool = {
			execute: vi.fn(),
			getStats: vi.fn().mockReturnValue({ active: 0, queued: 0, completed: 0, failed: 0 }),
			drain: vi.fn(),
			killAll: vi.fn(),
		} as unknown as ProcessPool;
	});

	it("should create provider with correct properties", () => {
		const config: CLIProviderConfig = {
			id: "test-cli",
			name: "Test CLI",
			command: "test-cmd",
			models: [testModel],
			buildArgs: () => ["--print", "hello"],
			parseOutput: (s) => s.trim(),
			pool: mockPool,
		};
		const provider = createCLIProvider(config);
		expect(provider.id).toBe("test-cli");
		expect(provider.name).toBe("Test CLI");
		expect(provider.models).toHaveLength(1);
		expect(provider.auth.type).toBe("custom");
	});

	it("should yield start, text, usage, done events on successful execution", async () => {
		(mockPool.execute as any).mockResolvedValue({
			stdout: "  Hello World  ",
			stderr: "",
			exitCode: 0,
			killed: false,
			duration: 100,
		});
		const config: CLIProviderConfig = {
			id: "test-cli",
			name: "Test CLI",
			command: "test-cmd",
			models: [testModel],
			buildArgs: () => ["--print", "hello"],
			parseOutput: (s) => s.trim(),
			pool: mockPool,
		};
		const provider = createCLIProvider(config);
		const events = await collectEvents(provider.stream("test-cli-model", minimalContext(), {}));
		const types = events.map((e) => e.type);
		expect(types).toContain("start");
		expect(types).toContain("text");
		expect(types).toContain("usage");
		expect(types).toContain("done");
		const textEvt = events.find((e) => e.type === "text")!;
		expect((textEvt as any).text).toBe("Hello World");
	});

	it("should pass correct args from buildArgs", async () => {
		(mockPool.execute as any).mockResolvedValue({
			stdout: "ok",
			stderr: "",
			exitCode: 0,
			killed: false,
			duration: 50,
		});
		const buildArgs = vi.fn().mockReturnValue(["--flag", "value"]);
		const config: CLIProviderConfig = {
			id: "test-cli",
			name: "Test CLI",
			command: "my-cmd",
			models: [testModel],
			buildArgs,
			parseOutput: (s) => s.trim(),
			pool: mockPool,
		};
		const provider = createCLIProvider(config);
		await collectEvents(provider.stream("test-cli-model", minimalContext("Hi"), {}));
		expect(buildArgs).toHaveBeenCalledOnce();
		expect(mockPool.execute).toHaveBeenCalledWith(
			"my-cmd",
			["--flag", "value"],
			expect.any(Object),
		);
	});

	it("should yield error event on non-zero exit code", async () => {
		(mockPool.execute as any).mockResolvedValue({
			stdout: "",
			stderr: "command not found",
			exitCode: 127,
			killed: false,
			duration: 10,
		});
		const config: CLIProviderConfig = {
			id: "test-cli",
			name: "Test CLI",
			command: "bad-cmd",
			models: [testModel],
			buildArgs: () => [],
			parseOutput: (s) => s.trim(),
			pool: mockPool,
		};
		const provider = createCLIProvider(config);
		const events = await collectEvents(provider.stream("test-cli-model", minimalContext(), {}));
		const errorEvents = events.filter((e) => e.type === "error");
		expect(errorEvents.length).toBe(1);
		expect((errorEvents[0] as any).error.message).toContain("127");
	});

	it("should yield error event when process is killed (timeout)", async () => {
		(mockPool.execute as any).mockResolvedValue({
			stdout: "",
			stderr: "",
			exitCode: 137,
			killed: true,
			duration: 30000,
		});
		const config: CLIProviderConfig = {
			id: "test-cli",
			name: "Test CLI",
			command: "slow-cmd",
			models: [testModel],
			buildArgs: () => [],
			parseOutput: (s) => s.trim(),
			pool: mockPool,
		};
		const provider = createCLIProvider(config);
		const events = await collectEvents(provider.stream("test-cli-model", minimalContext(), {}));
		const errorEvents = events.filter((e) => e.type === "error");
		expect(errorEvents.length).toBe(1);
		expect((errorEvents[0] as any).error.message).toContain("killed");
	});

	it("should yield error event when pool.execute throws", async () => {
		(mockPool.execute as any).mockRejectedValue(new Error("spawn ENOENT"));
		const config: CLIProviderConfig = {
			id: "test-cli",
			name: "Test CLI",
			command: "nonexistent",
			models: [testModel],
			buildArgs: () => [],
			parseOutput: (s) => s.trim(),
			pool: mockPool,
		};
		const provider = createCLIProvider(config);
		const events = await collectEvents(provider.stream("test-cli-model", minimalContext(), {}));
		const errorEvents = events.filter((e) => e.type === "error");
		expect(errorEvents.length).toBe(1);
		expect((errorEvents[0] as any).error.message).toContain("spawn");
	});

	it("should emit zeroed usage for CLI providers", async () => {
		(mockPool.execute as any).mockResolvedValue({
			stdout: "result",
			stderr: "",
			exitCode: 0,
			killed: false,
			duration: 50,
		});
		const config: CLIProviderConfig = {
			id: "test-cli",
			name: "Test CLI",
			command: "cmd",
			models: [testModel],
			buildArgs: () => [],
			parseOutput: (s) => s.trim(),
			pool: mockPool,
		};
		const provider = createCLIProvider(config);
		const events = await collectEvents(provider.stream("test-cli-model", minimalContext(), {}));
		const usageEvt = events.find((e) => e.type === "usage")!;
		expect((usageEvt as any).usage.inputTokens).toBe(0);
		expect((usageEvt as any).usage.outputTokens).toBe(0);
	});

	it("should validate by checking if command exists via which", async () => {
		(mockPool.execute as any).mockResolvedValue({
			stdout: "/usr/local/bin/cmd",
			stderr: "",
			exitCode: 0,
			killed: false,
			duration: 10,
		});
		const config: CLIProviderConfig = {
			id: "test-cli",
			name: "Test CLI",
			command: "cmd",
			models: [testModel],
			buildArgs: () => [],
			parseOutput: (s) => s.trim(),
			pool: mockPool,
		};
		const provider = createCLIProvider(config);
		const valid = await provider.validateKey!("");
		expect(valid).toBe(true);
	});

	it("should validate returning false when command not found", async () => {
		(mockPool.execute as any).mockResolvedValue({
			stdout: "",
			stderr: "cmd not found",
			exitCode: 1,
			killed: false,
			duration: 10,
		});
		const config: CLIProviderConfig = {
			id: "test-cli",
			name: "Test CLI",
			command: "cmd",
			models: [testModel],
			buildArgs: () => [],
			parseOutput: (s) => s.trim(),
			pool: mockPool,
		};
		const provider = createCLIProvider(config);
		const valid = await provider.validateKey!("");
		expect(valid).toBe(false);
	});

	it("should not emit text event when parseOutput returns empty string", async () => {
		(mockPool.execute as any).mockResolvedValue({
			stdout: "   ",
			stderr: "",
			exitCode: 0,
			killed: false,
			duration: 50,
		});
		const config: CLIProviderConfig = {
			id: "test-cli",
			name: "Test CLI",
			command: "cmd",
			models: [testModel],
			buildArgs: () => [],
			parseOutput: (s) => s.trim(),
			pool: mockPool,
		};
		const provider = createCLIProvider(config);
		const events = await collectEvents(provider.stream("test-cli-model", minimalContext(), {}));
		const textEvents = events.filter((e) => e.type === "text");
		expect(textEvents.length).toBe(0);
	});
});
