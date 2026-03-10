import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecFile = vi.fn();
const mockSpawn = vi.fn();

const mockBridgeDetect = vi.fn();
const mockBridgeExecute = vi.fn();
const mockBridgeDispose = vi.fn();
const mockBridgeInjectContext = vi.fn();
const mockDaemonCall = vi.fn();

vi.mock("node:child_process", () => ({
	execFile: (...args: unknown[]) => mockExecFile(...args),
	spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock("../src/modes/takumi-bridge.js", () => ({
	TakumiBridge: vi.fn(function MockTakumiBridge() {
		return {
			detect: mockBridgeDetect,
			execute: mockBridgeExecute,
			dispose: mockBridgeDispose,
			injectContext: mockBridgeInjectContext,
		};
	}),
}));

vi.mock("../src/modes/daemon-bridge.js", () => ({
	daemonCall: (...args: unknown[]) => mockDaemonCall(...args),
}));

import {
	resetDetectionCache,
	routeCodingTask,
	routeViaBridge,
} from "../src/modes/coding-router.js";

function createMockProcess() {
	const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
	const stdoutListeners: Record<string, Array<(...args: unknown[]) => void>> = {};
	const stderrListeners: Record<string, Array<(...args: unknown[]) => void>> = {};

	return {
		stdout: {
			on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
				stdoutListeners[event] = stdoutListeners[event] ?? [];
				stdoutListeners[event].push(cb);
			}),
		},
		stderr: {
			on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
				stderrListeners[event] = stderrListeners[event] ?? [];
				stderrListeners[event].push(cb);
			}),
		},
		on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
			listeners[event] = listeners[event] ?? [];
			listeners[event].push(cb);
		}),
		emitStdout(value: string) {
			stdoutListeners.data?.forEach((cb) => cb(Buffer.from(value)));
		},
		emitStderr(value: string) {
			stderrListeners.data?.forEach((cb) => cb(Buffer.from(value)));
		},
		close(code: number) {
			listeners.close?.forEach((cb) => cb(code));
		},
	};
}

function configureCliLookup(available: string[]) {
	mockExecFile.mockImplementation(
		(_cmd: string, args: string[], cb: (err: Error | null) => void) => {
			if (available.includes(args[0])) cb(null);
			else cb(new Error("not found"));
		},
	);
}

async function tick(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("coding-router bridge integration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetDetectionCache();
		mockDaemonCall.mockResolvedValue(null);
	});

	it("uses the live Takumi --print CLI flags for generic routing", async () => {
		configureCliLookup(["takumi"]);
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const resultPromise = routeCodingTask({
			task: "Fix router bug",
			cwd: "/tmp/project",
		});

		await tick();
		expect(mockSpawn).toHaveBeenCalledWith(
			"takumi",
			["--print", "--cwd", "/tmp/project", "Fix router bug"],
			expect.objectContaining({ cwd: "/tmp/project" }),
		);

		proc.emitStdout("done\n");
		proc.close(0);

		const result = await resultPromise;
		expect(result.cli).toBe("takumi");
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("done");
	});

	it("reports the actual bridge mode used when structured execution falls back", async () => {
		mockBridgeDetect.mockResolvedValue({
			mode: "rpc",
			command: "takumi",
			version: "takumi 1.0.0",
		});
		mockBridgeExecute.mockResolvedValue({
			type: "result",
			modeUsed: "cli",
			cacheIntent: "fresh",
			filesModified: ["src/auth.ts"],
			output: "Modified: src/auth.ts",
			exitCode: 0,
		});

		const result = await routeViaBridge({
			task: "Repair auth flow",
			cwd: "/tmp/project",
			fresh: true,
			context: { repoMap: "src/auth.ts -> src/session.ts" },
		});

		expect(result.cli).toBe("takumi (cli)");
		expect(result.bridgeResult?.modeUsed).toBe("cli");
		expect(result.bridgeResult?.cacheIntent).toBe("fresh");
		expect(mockBridgeInjectContext).toHaveBeenCalledWith({
			repoMap: "src/auth.ts -> src/session.ts",
			fresh: true,
		});
		expect(mockBridgeExecute).toHaveBeenCalledWith(
			{
				type: "task",
				task: "Repair auth flow",
				context: {
					repoMap: "src/auth.ts -> src/session.ts",
					fresh: true,
				},
			},
			expect.any(Function),
		);
		expect(mockBridgeDispose).toHaveBeenCalledTimes(1);
	});

	it("falls back to the generic router when Takumi is unavailable", async () => {
		mockBridgeDetect.mockResolvedValue({
			mode: "unavailable",
			command: "takumi",
		});
		configureCliLookup(["codex"]);
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const resultPromise = routeViaBridge({
			task: "Fix fallback path",
			cwd: "/tmp/project",
		});

		await tick();
		expect(mockSpawn).toHaveBeenCalledWith(
			"codex",
			["exec", "--full-auto", "-q", "Fix fallback path"],
			expect.objectContaining({ cwd: "/tmp/project" }),
		);

		proc.emitStdout("fallback ok\n");
		proc.close(0);

		const result = await resultPromise;
		expect(result.cli).toBe("codex");
		expect(result.exitCode).toBe(0);
	});

	it("fails closed when engine route resolution is requested but the daemon call fails", async () => {
		mockDaemonCall.mockRejectedValue(new Error("bridge auth required"));

		const result = await routeViaBridge({
			task: "Strict review with engine policy",
			cwd: "/tmp/project",
			sessionId: "sess-err",
			routeClass: "coding.review.strict",
		});

		expect(result.cli).toBe("engine-route");
		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("Engine route resolution failed");
		expect(mockBridgeDetect).not.toHaveBeenCalled();
	});

	it("normalizes noCache into bridge context even without an existing context object", async () => {
		mockBridgeDetect.mockResolvedValue({
			mode: "rpc",
			command: "takumi",
			version: "takumi 1.0.0",
		});
		mockBridgeExecute.mockResolvedValue({
			type: "result",
			modeUsed: "rpc",
			cacheIntent: "fresh",
			filesModified: [],
			output: "done",
			exitCode: 0,
		});

		await routeViaBridge({
			task: "Re-inspect auth flow",
			cwd: "/tmp/project",
			noCache: true,
		});

		expect(mockBridgeInjectContext).toHaveBeenCalledWith({ noCache: true });
		expect(mockBridgeExecute).toHaveBeenCalledWith(
			{
				type: "task",
				task: "Re-inspect auth flow",
				context: { noCache: true },
			},
			expect.any(Function),
		);
	});

	it("honors engine-selected Takumi route classes before bridge execution", async () => {
		mockDaemonCall.mockImplementation(async (method: string) => {
			if (method === "route.resolveBatch") {
				return {
					resolutions: [
						{
							key: "primary",
							request: { capability: "coding.review" },
							selected: { id: "adapter.takumi.executor" },
							routeClass: { id: "coding.review.strict", capability: "coding.review" },
							executionBinding: {
								source: "kosha-discovery",
								kind: "executor",
								query: { capability: "chat", mode: "chat", role: "reviewer" },
								selectedModelId: "gpt-4.1",
								selectedProviderId: "openai",
								preferredModelIds: ["gpt-4.1"],
								preferredProviderIds: ["openai"],
								allowCrossProvider: true,
							},
							policyTrace: ["route-class:coding.review.strict", "selected:adapter.takumi.executor"],
							reason: "strict review requires the Takumi executor",
						},
						{
							key: "planner",
							request: { capability: "coding.review" },
							selected: { id: "adapter.takumi.executor" },
							routeClass: { id: "coding.deep-reasoning", capability: "coding.review" },
							executionBinding: {
								source: "kosha-discovery",
								kind: "model",
								query: { capability: "chat", mode: "chat", role: "planner" },
								selectedModelId: "qwen2.5-coder:32b",
								selectedProviderId: "llamacpp",
								preferredModelIds: ["qwen2.5-coder:32b"],
								preferredProviderIds: ["llamacpp"],
								allowCrossProvider: true,
							},
							policyTrace: ["route-class:coding.deep-reasoning", "selected:adapter.takumi.executor"],
							reason: "planner lane prefers stronger local reasoning",
						},
					],
				};
			}
			return {
				request: { capability: "coding.review" },
				selected: { id: "adapter.takumi.executor" },
				routeClass: { id: "coding.review.strict", capability: "coding.review" },
				executionBinding: {
					source: "kosha-discovery",
					kind: "executor",
					query: { capability: "chat", mode: "chat" },
					selectedModelId: "gpt-4.1",
					selectedProviderId: "openai",
					preferredModelIds: ["gpt-4.1"],
					preferredProviderIds: ["openai"],
					allowCrossProvider: true,
				},
				policyTrace: ["route-class:coding.review.strict", "selected:adapter.takumi.executor"],
				reason: "strict review requires the Takumi executor",
			};
		});
		mockBridgeDetect.mockResolvedValue({
			mode: "rpc",
			command: "takumi",
			version: "takumi 1.0.0",
		});
		mockBridgeExecute.mockResolvedValue({
			type: "result",
			modeUsed: "rpc",
			cacheIntent: "default",
			filesModified: [],
			output: "review ok",
			exitCode: 0,
		});

		await routeViaBridge({
			task: "Review this patch strictly",
			cwd: "/tmp/project",
			sessionId: "sess-1",
			routeClass: "coding.review.strict",
		});

		expect(mockDaemonCall).toHaveBeenCalledWith("route.resolve", expect.objectContaining({
			consumer: "cli:takumi-bridge",
			sessionId: "sess-1",
			routeClass: "coding.review.strict",
		}));
		expect(mockDaemonCall).toHaveBeenCalledWith("route.resolveBatch", expect.objectContaining({
			consumer: "cli:takumi-bridge",
			sessionId: "sess-1",
			routes: expect.arrayContaining([
				expect.objectContaining({ key: "primary", routeClass: "coding.review.strict" }),
				expect.objectContaining({ key: "planner", routeClass: "coding.deep-reasoning" }),
				expect.objectContaining({ key: "implementer", routeClass: "coding.patch-cheap" }),
				expect.objectContaining({ key: "reviewer", routeClass: "coding.review.strict" }),
				expect.objectContaining({ key: "validator", routeClass: "coding.validation-high-trust" }),
			]),
		}));
		expect(mockBridgeInjectContext).toHaveBeenCalledWith(expect.objectContaining({
			engineRoute: expect.objectContaining({
				routeClass: "coding.review.strict",
				capability: "coding.review",
				selectedCapabilityId: "adapter.takumi.executor",
				executionBinding: expect.objectContaining({
					selectedModelId: "gpt-4.1",
					selectedProviderId: "openai",
					preferredModelIds: ["gpt-4.1"],
					preferredProviderIds: ["openai"],
				}),
				enforced: true,
			}),
			engineRouteEnvelope: expect.objectContaining({
				primaryKey: "primary",
				lanes: expect.arrayContaining([
					expect.objectContaining({
						key: "primary",
						routeClass: "coding.review.strict",
						selectedCapabilityId: "adapter.takumi.executor",
					}),
					expect.objectContaining({
						key: "planner",
						routeClass: "coding.deep-reasoning",
						executionBinding: expect.objectContaining({
							selectedModelId: "qwen2.5-coder:32b",
							selectedProviderId: "llamacpp",
						}),
					}),
				]),
			}),
		}));
		expect(mockBridgeExecute).toHaveBeenCalledWith(expect.objectContaining({
			context: expect.objectContaining({
				engineRoute: expect.objectContaining({
					routeClass: "coding.review.strict",
						selectedCapabilityId: "adapter.takumi.executor",
						enforced: true,
					}),
					engineRouteEnvelope: expect.objectContaining({
						primaryKey: "primary",
					}),
				}),
			}), expect.any(Function));
	});

	it("allows engine-selected local model lanes to execute through Takumi under an enforced route envelope", async () => {
		mockDaemonCall.mockResolvedValue({
			request: { capability: "model.local.chat" },
			selected: { id: "engine.local.llamacpp" },
			routeClass: { id: "coding.deep-reasoning", capability: "model.local.chat" },
			executionBinding: {
				source: "kosha-discovery",
				kind: "model",
				query: { capability: "chat", mode: "chat" },
				selectedModelId: "qwen2.5-coder:32b",
				selectedProviderId: "llamacpp",
				preferredModelIds: ["qwen2.5-coder:32b"],
				preferredProviderIds: ["llamacpp"],
				allowCrossProvider: false,
			},
			policyTrace: ["route-class:coding.deep-reasoning", "selected:engine.local.llamacpp"],
			reason: "local high-context lane selected by engine policy",
		});
		mockBridgeDetect.mockResolvedValue({
			mode: "rpc",
			command: "takumi",
			version: "takumi 1.0.0",
		});
		mockBridgeExecute.mockResolvedValue({
			type: "result",
			modeUsed: "rpc",
			cacheIntent: "default",
			filesModified: [],
			output: "llama.cpp lane ok",
			exitCode: 0,
		});

		const result = await routeViaBridge({
			task: "Reason deeply about this refactor",
			cwd: "/tmp/project",
			sessionId: "sess-model-lane",
			routeClass: "coding.deep-reasoning",
		});

		expect(result.cli).toBe("takumi (rpc)");
		expect(mockBridgeDetect).toHaveBeenCalledTimes(1);
		expect(mockBridgeInjectContext).toHaveBeenCalledWith(expect.objectContaining({
			engineRoute: expect.objectContaining({
				routeClass: "coding.deep-reasoning",
				capability: "model.local.chat",
				selectedCapabilityId: "engine.local.llamacpp",
				executionBinding: expect.objectContaining({
					selectedModelId: "qwen2.5-coder:32b",
					selectedProviderId: "llamacpp",
				}),
				enforced: true,
			}),
		}));
		expect(mockBridgeExecute).toHaveBeenCalledWith(expect.objectContaining({
			context: expect.objectContaining({
				engineRoute: expect.objectContaining({
					selectedCapabilityId: "engine.local.llamacpp",
					enforced: true,
				}),
			}),
		}), expect.any(Function));
	});

		it("refuses to override a non-Takumi engine-selected coding lane", async () => {
			mockDaemonCall.mockResolvedValue({
				request: { capability: "coding.patch-and-validate" },
				selected: { id: "tool.coding_agent" },
				routeClass: { id: "coding.fast-local", capability: "coding.patch-and-validate" },
				policyTrace: ["route-class:coding.fast-local", "selected:tool.coding_agent"],
			});
			configureCliLookup(["codex"]);
			const proc = createMockProcess();
			mockSpawn.mockReturnValue(proc);

			const resultPromise = routeViaBridge({
				task: "Make a fast local patch",
				cwd: "/tmp/project",
				sessionId: "sess-2",
				routeClass: "coding.fast-local",
			});

			await tick();
			expect(mockSpawn).toHaveBeenCalledWith(
				"codex",
				["exec", "--full-auto", "-q", "Make a fast local patch"],
				expect.objectContaining({ cwd: "/tmp/project" }),
			);
			expect(mockBridgeDetect).not.toHaveBeenCalled();
			expect(mockBridgeExecute).not.toHaveBeenCalled();

			proc.emitStdout("local patch ok\n");
			proc.close(0);

			const result = await resultPromise;
			expect(result.cli).toBe("codex");
			expect(result.exitCode).toBe(0);
		});

	it("fails closed when the engine selected Takumi but Takumi is unavailable", async () => {
		mockDaemonCall.mockResolvedValue({
			request: { capability: "coding.review" },
			selected: { id: "adapter.takumi.executor" },
			routeClass: { id: "coding.review.strict", capability: "coding.review" },
			policyTrace: ["route-class:coding.review.strict", "selected:adapter.takumi.executor"],
		});
		mockBridgeDetect.mockResolvedValue({
			mode: "unavailable",
			command: "takumi",
		});

		const result = await routeViaBridge({
			task: "Strict review with engine-selected Takumi",
			cwd: "/tmp/project",
			sessionId: "sess-3",
			routeClass: "coding.review.strict",
		});

		expect(result.cli).toBe("engine-route");
		expect(result.exitCode).toBe(1);
			expect(result.output).toContain("adapter.takumi.executor");
			expect(result.output).toContain("unavailable");
			expect(mockSpawn).not.toHaveBeenCalled();
		});

		it("fails closed when the engine selected a discovery-backed model lane but Takumi is unavailable", async () => {
			mockDaemonCall.mockResolvedValue({
				request: { capability: "model.tool-use" },
				selected: { id: "discovery.model.ollama.qwen-coder" },
				routeClass: { id: "coding.patch-cheap", capability: "model.tool-use" },
				executionBinding: {
					source: "kosha-discovery",
					kind: "model",
					query: { capability: "function_calling", mode: "chat" },
					preferredModelIds: ["qwen-coder"],
					preferredProviderIds: ["ollama"],
					allowCrossProvider: false,
				},
				policyTrace: ["route-class:coding.patch-cheap", "selected:discovery.model.ollama.qwen-coder"],
			});
			mockBridgeDetect.mockResolvedValue({
				mode: "unavailable",
				command: "takumi",
			});

			const result = await routeViaBridge({
				task: "Patch auth flow cheaply",
				cwd: "/tmp/project",
				sessionId: "sess-3b",
				routeClass: "coding.patch-cheap",
			});

			expect(result.cli).toBe("engine-route");
			expect(result.exitCode).toBe(1);
			expect(result.output).toContain("discovery.model.ollama.qwen-coder");
			expect(result.output).toContain("unavailable");
			expect(mockSpawn).not.toHaveBeenCalled();
		});

		it("infers an engine route class when only a canonical session is present", async () => {
			mockDaemonCall.mockResolvedValue({
				request: { capability: "coding.patch-and-validate" },
				selected: { id: "tool.coding_agent" },
				routeClass: { id: "coding.patch-cheap", capability: "coding.patch-and-validate" },
				policyTrace: ["route-class:coding.patch-cheap", "selected:tool.coding_agent"],
			});
			configureCliLookup(["codex"]);
			const proc = createMockProcess();
			mockSpawn.mockReturnValue(proc);

			const resultPromise = routeViaBridge({
				task: "Fix this bug quickly",
				cwd: "/tmp/project",
				sessionId: "sess-4",
			});

			await tick();
			expect(mockDaemonCall).toHaveBeenCalledWith("route.resolve", expect.objectContaining({
				sessionId: "sess-4",
				routeClass: "coding.patch-cheap",
			}));
			proc.emitStdout("quick patch\n");
			proc.close(0);

			const result = await resultPromise;
			expect(result.cli).toBe("codex");
			expect(result.exitCode).toBe(0);
		});
	});
