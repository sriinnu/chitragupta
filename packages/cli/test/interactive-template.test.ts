import { describe, it, expect } from "vitest";
import { buildNoLlmTemplateResponse } from "../src/modes/no-llm-template.js";

describe("buildNoLlmTemplateResponse", () => {
	// ─── Cases that SHOULD return canned responses ───────────────────────

	it("returns greeting response for hello-like inputs", () => {
		const response = buildNoLlmTemplateResponse("hi", "conversation");
		expect(response).not.toBeNull();
		expect(response).toContain("What do you want to do next?");
	});

	it("returns greeting for standalone greetings with punctuation", () => {
		expect(buildNoLlmTemplateResponse("hello!")).toContain("What do you want to do next?");
		expect(buildNoLlmTemplateResponse("hey")).toContain("What do you want to do next?");
		expect(buildNoLlmTemplateResponse("namaste")).toContain("What do you want to do next?");
	});

	it("returns model helper response for model questions", () => {
		const response = buildNoLlmTemplateResponse("which model are we using", "conversation");
		expect(response).not.toBeNull();
		expect(response).toContain("/model");
	});

	it("returns help response for help command", () => {
		const response = buildNoLlmTemplateResponse("help");
		expect(response).not.toBeNull();
		expect(response).toContain("/help");
	});

	it("returns default response for empty input", () => {
		const response = buildNoLlmTemplateResponse("   ");
		expect(response).not.toBeNull();
		expect(response).toContain("I'm here.");
	});

	// ─── Cases that SHOULD return null (route to LLM) ───────────────────

	it("returns null for math questions like 'what is 2+2'", () => {
		expect(buildNoLlmTemplateResponse("what is 2+2")).toBeNull();
	});

	it("returns null for general questions", () => {
		expect(buildNoLlmTemplateResponse("can you help me?")).toBeNull();
		expect(buildNoLlmTemplateResponse("what is TypeScript?")).toBeNull();
		expect(buildNoLlmTemplateResponse("how do I fix this error?")).toBeNull();
	});

	it("returns null for coding requests", () => {
		expect(buildNoLlmTemplateResponse("write a function to sort an array")).toBeNull();
		expect(buildNoLlmTemplateResponse("refactor the auth module")).toBeNull();
	});

	it("returns null for general chat", () => {
		expect(buildNoLlmTemplateResponse("tell me about distributed systems")).toBeNull();
		expect(buildNoLlmTemplateResponse("explain how React hooks work")).toBeNull();
	});

	it("returns null for smalltalk intent when message is not a greeting", () => {
		expect(buildNoLlmTemplateResponse("how are you doing today?", "smalltalk")).toBeNull();
	});

	it("returns null for short ambiguous messages", () => {
		expect(buildNoLlmTemplateResponse("ok")).toBeNull();
		expect(buildNoLlmTemplateResponse("thanks")).toBeNull();
		expect(buildNoLlmTemplateResponse("sure")).toBeNull();
	});

	it("returns null for greetings with additional content", () => {
		// "hello how are you" is NOT a pure greeting — route to LLM
		expect(buildNoLlmTemplateResponse("hello how are you")).toBeNull();
		expect(buildNoLlmTemplateResponse("hi can you help me")).toBeNull();
	});
});
