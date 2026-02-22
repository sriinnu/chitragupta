import { describe, it, expect } from "vitest";
import { buildNoLlmTemplateResponse } from "../src/modes/no-llm-template.js";

describe("buildNoLlmTemplateResponse", () => {
	it("returns greeting response for hello-like inputs", () => {
		const response = buildNoLlmTemplateResponse("hi", "conversation");
		expect(response).toContain("What do you want to do next?");
	});

	it("returns model helper response for model questions", () => {
		const response = buildNoLlmTemplateResponse("which model are we using", "conversation");
		expect(response).toContain("/model");
	});

	it("returns quick guidance for question-form text", () => {
		const response = buildNoLlmTemplateResponse("can you help me?");
		expect(response).toContain("quick answer");
	});

	it("returns default response for empty input", () => {
		const response = buildNoLlmTemplateResponse("   ");
		expect(response).toContain("I'm here.");
	});
});
