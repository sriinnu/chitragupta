import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Test the internal response parsing logic of vision-analysis.
 *
 * The actual `analyzeImage` and `analyzeUIChanges` functions require Ollama
 * running with a vision model and real image files, so we test:
 * 1. Response parsing (parseVisionResponse, exposed indirectly)
 * 2. Element normalization
 * 3. Accessibility normalization
 *
 * We import the module and test its exported functions. Since parseVisionResponse
 * is not exported, we test it through its effect on analyzeImage by mocking
 * the underlying HTTP call and file read.
 */

// Mock node:fs/promises and node:http at the top level
vi.mock("node:fs/promises", () => ({
	readFile: vi.fn(),
}));

vi.mock("node:http", () => ({
	request: vi.fn(),
}));

import { analyzeImage, analyzeUIChanges } from "../src/vision-analysis.js";
import { readFile } from "node:fs/promises";
import { request } from "node:http";

function mockOllamaResponse(responseBody: string): void {
	const mockReadFile = vi.mocked(readFile);
	mockReadFile.mockResolvedValue(Buffer.from("fake-image-data"));

	const mockRequest = vi.mocked(request);
	(mockRequest as unknown as { mockImplementation: (fn: (...args: any[]) => any) => void }).mockImplementation((_opts: any, callback: any) => {
		const res = {
			statusCode: 200,
			on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
				if (event === "data") {
					handler(Buffer.from(JSON.stringify({ response: responseBody })));
				}
				if (event === "end") {
					setTimeout(() => handler(), 0);
				}
				return res;
			}),
		};
		if (typeof callback === "function") {
			setTimeout(() => callback(res), 0);
		}
		return {
			on: vi.fn().mockReturnThis(),
			write: vi.fn(),
			end: vi.fn(),
		} as unknown as ReturnType<typeof request>;
	});
}

describe("vision-analysis response parsing", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("analyzeImage with JSON response", () => {
		it("should parse a valid JSON response with elements and accessibility", async () => {
			const jsonResponse = JSON.stringify({
				description: "A login page with form",
				elements: [
					{ type: "input", label: "Username", properties: { placeholder: "Enter username" } },
					{ type: "button", label: "Submit" },
				],
				suggestions: ["Add ARIA labels", "Improve contrast"],
				accessibility: [
					{
						severity: "error",
						element: "Submit button",
						issue: "Missing ARIA label",
						suggestion: "Add aria-label attribute",
						wcagRule: "WCAG 2.1 1.1.1",
					},
				],
			});

			mockOllamaResponse(jsonResponse);

			const result = await analyzeImage("/fake/image.png");
			expect(result.description).toBe("A login page with form");
			expect(result.elements).toHaveLength(2);
			expect(result.elements[0].type).toBe("input");
			expect(result.elements[0].label).toBe("Username");
			expect(result.elements[1].type).toBe("button");
			expect(result.suggestions).toHaveLength(2);
			expect(result.accessibility).toHaveLength(1);
			expect(result.accessibility[0].severity).toBe("error");
			expect(result.accessibility[0].wcagRule).toBe("WCAG 2.1 1.1.1");
		});

		it("should parse JSON wrapped in markdown code blocks", async () => {
			const wrappedResponse = '```json\n{"description": "Dashboard", "elements": [], "suggestions": [], "accessibility": []}\n```';
			mockOllamaResponse(wrappedResponse);

			const result = await analyzeImage("/fake/image.png");
			expect(result.description).toBe("Dashboard");
		});

		it("should fall back to raw description when JSON parsing fails", async () => {
			mockOllamaResponse("This is a UI showing a navigation bar and some content");

			const result = await analyzeImage("/fake/image.png");
			expect(result.description).toContain("navigation bar");
			expect(result.elements).toHaveLength(0);
			expect(result.suggestions).toHaveLength(0);
			expect(result.accessibility).toHaveLength(0);
		});
	});

	describe("element normalization", () => {
		it("should map unknown element types to 'other'", async () => {
			const jsonResponse = JSON.stringify({
				description: "UI",
				elements: [
					{ type: "weird-unknown-type", label: "Mystery Element" },
				],
				suggestions: [],
				accessibility: [],
			});
			mockOllamaResponse(jsonResponse);

			const result = await analyzeImage("/fake/image.png");
			expect(result.elements[0].type).toBe("other");
		});

		it("should default label to 'unknown' when missing", async () => {
			const jsonResponse = JSON.stringify({
				description: "UI",
				elements: [
					{ type: "button" },
				],
				suggestions: [],
				accessibility: [],
			});
			mockOllamaResponse(jsonResponse);

			const result = await analyzeImage("/fake/image.png");
			expect(result.elements[0].label).toBe("unknown");
		});

		it("should handle all valid element types", async () => {
			const validTypes = [
				"button", "input", "text", "image", "link", "nav",
				"header", "footer", "form", "list", "card", "modal", "other",
			];
			const elements = validTypes.map((type) => ({ type, label: type }));
			const jsonResponse = JSON.stringify({
				description: "UI",
				elements,
				suggestions: [],
				accessibility: [],
			});
			mockOllamaResponse(jsonResponse);

			const result = await analyzeImage("/fake/image.png");
			expect(result.elements).toHaveLength(validTypes.length);
			for (let i = 0; i < validTypes.length; i++) {
				expect(result.elements[i].type).toBe(validTypes[i]);
			}
		});
	});

	describe("accessibility normalization", () => {
		it("should map unknown severities to 'info'", async () => {
			const jsonResponse = JSON.stringify({
				description: "UI",
				elements: [],
				suggestions: [],
				accessibility: [
					{ severity: "critical", issue: "Bad contrast" },
				],
			});
			mockOllamaResponse(jsonResponse);

			const result = await analyzeImage("/fake/image.png");
			expect(result.accessibility[0].severity).toBe("info");
		});

		it("should default missing issue text to 'Unknown issue'", async () => {
			const jsonResponse = JSON.stringify({
				description: "UI",
				elements: [],
				suggestions: [],
				accessibility: [
					{ severity: "warning" },
				],
			});
			mockOllamaResponse(jsonResponse);

			const result = await analyzeImage("/fake/image.png");
			expect(result.accessibility[0].issue).toBe("Unknown issue");
		});

		it("should accept all valid severity levels", async () => {
			const jsonResponse = JSON.stringify({
				description: "UI",
				elements: [],
				suggestions: [],
				accessibility: [
					{ severity: "error", issue: "Issue 1", suggestion: "Fix 1" },
					{ severity: "warning", issue: "Issue 2", suggestion: "Fix 2" },
					{ severity: "info", issue: "Issue 3", suggestion: "Fix 3" },
				],
			});
			mockOllamaResponse(jsonResponse);

			const result = await analyzeImage("/fake/image.png");
			expect(result.accessibility).toHaveLength(3);
			expect(result.accessibility[0].severity).toBe("error");
			expect(result.accessibility[1].severity).toBe("warning");
			expect(result.accessibility[2].severity).toBe("info");
		});
	});

	describe("analyzeUIChanges", () => {
		it("should parse a comparison response with changes and regressions", async () => {
			const jsonResponse = JSON.stringify({
				changes: ["Header color changed", "New button added"],
				regressions: ["Layout shift in footer"],
			});
			mockOllamaResponse(jsonResponse);

			const result = await analyzeUIChanges("/fake/before.png", "/fake/after.png");
			expect(result.changes).toHaveLength(2);
			expect(result.regressions).toHaveLength(1);
			expect(result.regressions[0]).toContain("footer");
		});

		it("should fall back to raw response when JSON parsing fails", async () => {
			mockOllamaResponse("The UI has some minor color changes");

			const result = await analyzeUIChanges("/fake/before.png", "/fake/after.png");
			expect(result.changes).toHaveLength(1);
			expect(result.changes[0]).toContain("color changes");
			expect(result.regressions).toHaveLength(0);
		});

		it("should handle missing arrays in parsed JSON", async () => {
			const jsonResponse = JSON.stringify({
				changes: null,
				regressions: "not an array",
			});
			mockOllamaResponse(jsonResponse);

			const result = await analyzeUIChanges("/fake/before.png", "/fake/after.png");
			// Should use empty arrays when values aren't actual arrays
			expect(result.changes).toEqual([]);
			expect(result.regressions).toEqual([]);
		});
	});

	describe("error handling", () => {
		it("should throw when image file cannot be read", async () => {
			const mockReadFile = vi.mocked(readFile);
			mockReadFile.mockRejectedValue(new Error("ENOENT: no such file"));

			await expect(analyzeImage("/nonexistent/image.png")).rejects.toThrow("ENOENT");
		});

		it("should throw when Ollama connection fails", async () => {
			const mockReadFile = vi.mocked(readFile);
			mockReadFile.mockResolvedValue(Buffer.from("fake-image-data"));

			const mockReq = vi.mocked(request);
			mockReq.mockImplementation(() => {
				const req = {
					on: vi.fn((event: string, handler: (err: Error) => void) => {
						if (event === "error") {
							setTimeout(() => handler(new Error("ECONNREFUSED")), 0);
						}
						return req;
					}),
					write: vi.fn(),
					end: vi.fn(),
				};
				return req as unknown as ReturnType<typeof request>;
			});

			await expect(analyzeImage("/fake/image.png")).rejects.toThrow("ECONNREFUSED");
		});
	});

	describe("custom parameters", () => {
		it("should accept a custom prompt", async () => {
			mockOllamaResponse(JSON.stringify({
				description: "Custom analysis",
				elements: [],
				suggestions: [],
				accessibility: [],
			}));

			const result = await analyzeImage(
				"/fake/image.png",
				"Describe only the colors in this image",
			);
			expect(result.description).toBe("Custom analysis");
		});

		it("should accept custom endpoint and model", async () => {
			mockOllamaResponse(JSON.stringify({
				description: "OK",
				elements: [],
				suggestions: [],
				accessibility: [],
			}));

			const result = await analyzeImage(
				"/fake/image.png",
				undefined,
				"http://custom:12345",
				"bakllava",
			);
			expect(result.description).toBe("OK");
		});
	});
});
