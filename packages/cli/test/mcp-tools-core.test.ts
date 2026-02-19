import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@chitragupta/core", async () => {
	const actual = await vi.importActual("@chitragupta/core");
	return {
		...actual,
		loadGlobalSettings: vi.fn(),
	};
});

import { ProviderError, loadGlobalSettings } from "@chitragupta/core";
import { runAgentPromptWithFallback } from "../src/modes/mcp-tools-core.js";

const mockedLoadGlobalSettings = vi.mocked(loadGlobalSettings);

describe("runAgentPromptWithFallback", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mockedLoadGlobalSettings.mockReturnValue({
			providerPriority: ["claude-code", "codex-cli"],
		});
	});

	it("tries the next provider when the CLI fails with a ProviderError", async () => {
		const failingInstance = {
			prompt: vi.fn().mockRejectedValue(
				new ProviderError("CLI claude exited with code 1", "claude-code"),
			),
			destroy: vi.fn().mockResolvedValue(undefined),
		};
		const successInstance = {
			prompt: vi.fn().mockResolvedValue("fallback result"),
			destroy: vi.fn().mockResolvedValue(undefined),
		};

		const createChitragupta = vi.fn(async ({ provider }) => {
			if (provider === "claude-code") return failingInstance;
			return successInstance;
		});

		const result = await runAgentPromptWithFallback("describe architecture", {}, createChitragupta);

		expect(result).toBe("fallback result");
		expect(createChitragupta).toHaveBeenCalledTimes(2);
		expect(failingInstance.destroy).toHaveBeenCalledOnce();
		expect(successInstance.destroy).toHaveBeenCalledOnce();
	});

	it("propagates fatal errors that are not retryable", async () => {
		const fatalError = new Error("fatal");
		const fatalInstance = {
			prompt: vi.fn().mockRejectedValue(fatalError),
			destroy: vi.fn().mockResolvedValue(undefined),
		};

		const createChitragupta = vi.fn(async () => fatalInstance);

		await expect(
			runAgentPromptWithFallback("plan next steps", {}, createChitragupta),
		).rejects.toThrow(fatalError);

		expect(createChitragupta).toHaveBeenCalledOnce();
		expect(fatalInstance.destroy).toHaveBeenCalledOnce();
	});

	it("continues when the error indicates no provider was available", async () => {
		const busyInstance = {
			prompt: vi.fn().mockRejectedValue(new Error("No provider available right now")),
			destroy: vi.fn().mockResolvedValue(undefined),
		};
		const successInstance = {
			prompt: vi.fn().mockResolvedValue("rolled over"),
			destroy: vi.fn().mockResolvedValue(undefined),
		};

		const createChitragupta = vi.fn(async ({ provider }) => {
			if (provider === "claude-code") return busyInstance;
			return successInstance;
		});

		const result = await runAgentPromptWithFallback("remember history", {}, createChitragupta);

		expect(result).toBe("rolled over");
		expect(createChitragupta).toHaveBeenCalledTimes(2);
		expect(busyInstance.destroy).toHaveBeenCalledOnce();
		expect(successInstance.destroy).toHaveBeenCalledOnce();
	});
});
