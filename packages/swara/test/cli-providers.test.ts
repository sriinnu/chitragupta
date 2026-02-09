import { describe, it, expect } from "vitest";
import {
	claudeCodeProvider,
	codexProvider,
	geminiCLIProvider,
	aiderProvider,
	contextToPrompt,
} from "../src/providers/cli-providers.js";
import type { Context } from "../src/types.js";

describe("CLI Providers", () => {
	describe("contextToPrompt", () => {
		it("should extract last user message text", () => {
			const ctx: Context = {
				messages: [
					{ role: "user", content: [{ type: "text", text: "First question" }] },
					{ role: "assistant", content: [{ type: "text", text: "Answer" }] },
					{ role: "user", content: [{ type: "text", text: "Follow up" }] },
				],
			};
			expect(contextToPrompt(ctx)).toBe("Follow up");
		});

		it("should concatenate multiple text parts with newlines", () => {
			const ctx: Context = {
				messages: [
					{ role: "user", content: [
						{ type: "text", text: "Part one" },
						{ type: "text", text: "Part two" },
					] },
				],
			};
			expect(contextToPrompt(ctx)).toBe("Part one\nPart two");
		});

		it("should return empty string when no user messages exist", () => {
			const ctx: Context = {
				messages: [
					{ role: "assistant", content: [{ type: "text", text: "Hello" }] },
				],
			};
			expect(contextToPrompt(ctx)).toBe("");
		});

		it("should skip non-text content parts", () => {
			const ctx: Context = {
				messages: [
					{ role: "user", content: [
						{ type: "image", source: { type: "base64", mediaType: "image/png", data: "abc" } },
						{ type: "text", text: "Describe this" },
					] },
				],
			};
			expect(contextToPrompt(ctx)).toBe("Describe this");
		});
	});

	describe("Claude Code Provider", () => {
		it("should have correct id and name", () => {
			expect(claudeCodeProvider.id).toBe("claude-code");
			expect(claudeCodeProvider.name).toBe("Claude Code CLI");
		});

		it("should have one model defined", () => {
			expect(claudeCodeProvider.models.length).toBe(1);
			expect(claudeCodeProvider.models[0].id).toBe("claude-code");
		});

		it("should have zero pricing", () => {
			expect(claudeCodeProvider.models[0].pricing.input).toBe(0);
			expect(claudeCodeProvider.models[0].pricing.output).toBe(0);
		});

		it("should have custom auth type", () => {
			expect(claudeCodeProvider.auth.type).toBe("custom");
		});
	});

	describe("Codex Provider", () => {
		it("should have correct id and name", () => {
			expect(codexProvider.id).toBe("codex-cli");
			expect(codexProvider.name).toBe("Codex CLI");
		});

		it("should have one model defined", () => {
			expect(codexProvider.models.length).toBe(1);
			expect(codexProvider.models[0].id).toBe("codex-cli");
		});

		it("should have zero pricing", () => {
			expect(codexProvider.models[0].pricing.input).toBe(0);
			expect(codexProvider.models[0].pricing.output).toBe(0);
		});
	});

	describe("Gemini CLI Provider", () => {
		it("should have correct id and name", () => {
			expect(geminiCLIProvider.id).toBe("gemini-cli");
			expect(geminiCLIProvider.name).toBe("Gemini CLI");
		});

		it("should have one model defined", () => {
			expect(geminiCLIProvider.models.length).toBe(1);
			expect(geminiCLIProvider.models[0].id).toBe("gemini-cli");
		});

		it("should have vision capability", () => {
			expect(geminiCLIProvider.models[0].capabilities.vision).toBe(true);
		});
	});

	describe("Aider Provider", () => {
		it("should have correct id and name", () => {
			expect(aiderProvider.id).toBe("aider-cli");
			expect(aiderProvider.name).toBe("Aider CLI");
		});

		it("should have one model defined", () => {
			expect(aiderProvider.models.length).toBe(1);
			expect(aiderProvider.models[0].id).toBe("aider-cli");
		});

		it("should not have tool use capability", () => {
			expect(aiderProvider.models[0].capabilities.toolUse).toBe(false);
		});

		it("should have zero pricing", () => {
			expect(aiderProvider.models[0].pricing.input).toBe(0);
			expect(aiderProvider.models[0].pricing.output).toBe(0);
		});
	});

	describe("All CLI providers", () => {
		const providers = [claudeCodeProvider, codexProvider, geminiCLIProvider, aiderProvider];

		it("should all have custom auth type", () => {
			for (const p of providers) {
				expect(p.auth.type).toBe("custom");
			}
		});

		it("should all have streaming disabled", () => {
			for (const p of providers) {
				for (const m of p.models) {
					expect(m.capabilities.streaming).toBe(false);
				}
			}
		});

		it("should all have a stream function", () => {
			for (const p of providers) {
				expect(typeof p.stream).toBe("function");
			}
		});

		it("should all have a validateKey function", () => {
			for (const p of providers) {
				expect(typeof p.validateKey).toBe("function");
			}
		});
	});
});
