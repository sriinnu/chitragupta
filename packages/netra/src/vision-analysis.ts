/**
 * @chitragupta/netra — LLM-powered image analysis via Ollama.
 *
 * Uses vision-capable models (llava, bakllava) to analyze UI screenshots,
 * identify elements, and detect accessibility issues.
 */

import { readFile } from "node:fs/promises";
import { request } from "node:http";
import type { VisionAnalysis, UIElement, AccessibilityIssue } from "./types.js";

// ─── Ollama Communication ───────────────────────────────────────────────────

const DEFAULT_OLLAMA_ENDPOINT = "http://localhost:11434";
const DEFAULT_MODEL = "llava";

const DEFAULT_ANALYSIS_PROMPT = `Analyze this UI screenshot. Identify all UI elements (buttons, inputs, text, navigation, etc.), describe the layout, and note any accessibility issues.

Respond in the following JSON format:
{
  "description": "Overall description of the UI",
  "elements": [
    {
      "type": "button|input|text|image|link|nav|header|footer|form|list|card|modal|other",
      "label": "Human-readable label for the element",
      "properties": { "key": "value" }
    }
  ],
  "suggestions": ["Improvement suggestion 1", "Improvement suggestion 2"],
  "accessibility": [
    {
      "severity": "error|warning|info",
      "element": "Element description",
      "issue": "What the issue is",
      "suggestion": "How to fix it",
      "wcagRule": "WCAG rule reference if applicable"
    }
  ]
}`;

const DEFAULT_COMPARISON_PROMPT = `Compare these two UI screenshots (before and after). Identify:
1. What changed between the two versions
2. Any visual regressions (layout shifts, missing elements, broken styling, alignment issues)

Respond in the following JSON format:
{
  "changes": ["Change 1", "Change 2"],
  "regressions": ["Regression 1", "Regression 2"]
}`;

/**
 * Make a POST request to Ollama's generate API with image data.
 */
async function ollamaGenerate(
	endpoint: string,
	model: string,
	prompt: string,
	images: string[],
): Promise<string> {
	const url = new URL("/api/generate", endpoint);

	const body = JSON.stringify({
		model,
		prompt,
		images,
		stream: false,
	});

	return new Promise<string>((resolve, reject) => {
		const req = request(
			{
				hostname: url.hostname,
				port: url.port || 11434,
				path: url.pathname,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(body),
				},
			},
			(res) => {
				const chunks: Buffer[] = [];

				res.on("data", (chunk: Buffer) => {
					chunks.push(chunk);
				});

				res.on("end", () => {
					const responseBody = Buffer.concat(chunks).toString("utf-8");

					if (res.statusCode && res.statusCode >= 400) {
						reject(new Error(
							`Ollama API error (${res.statusCode}): ${responseBody}`
						));
						return;
					}

					try {
						const parsed = JSON.parse(responseBody) as { response?: string };
						resolve(parsed.response ?? responseBody);
					} catch {
						resolve(responseBody);
					}
				});

				res.on("error", reject);
			},
		);

		req.on("error", (err) => {
			reject(new Error(
				`Failed to connect to Ollama at ${endpoint}. ` +
				`Ensure Ollama is running with a vision model (${model}). ` +
				`Original error: ${err.message}`
			));
		});

		req.write(body);
		req.end();
	});
}

// ─── Response Parsing ───────────────────────────────────────────────────────

/**
 * Attempt to parse a structured VisionAnalysis from the LLM response.
 * Falls back to a basic description if JSON parsing fails.
 */
function parseVisionResponse(response: string): VisionAnalysis {
	// Try to extract JSON from the response (it may be wrapped in markdown code blocks)
	const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/) ??
		response.match(/(\{[\s\S]*\})/);

	if (jsonMatch?.[1]) {
		try {
			const parsed = JSON.parse(jsonMatch[1]) as Partial<VisionAnalysis>;
			return {
				description: parsed.description ?? response,
				elements: normalizeElements(parsed.elements ?? []),
				suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
				accessibility: normalizeAccessibility(parsed.accessibility ?? []),
			};
		} catch {
			// JSON parsing failed, fall through to basic response
		}
	}

	// Fallback: use raw response as description
	return {
		description: response.trim(),
		elements: [],
		suggestions: [],
		accessibility: [],
	};
}

/**
 * Normalize and validate UIElement array from parsed JSON.
 */
function normalizeElements(elements: unknown[]): UIElement[] {
	const validTypes = new Set([
		"button", "input", "text", "image", "link", "nav",
		"header", "footer", "form", "list", "card", "modal", "other",
	]);

	return elements
		.filter((el): el is Record<string, unknown> => typeof el === "object" && el !== null)
		.map((el) => ({
			type: validTypes.has(el["type"] as string)
				? (el["type"] as UIElement["type"])
				: "other",
			label: typeof el["label"] === "string" ? el["label"] : "unknown",
			properties: typeof el["properties"] === "object" && el["properties"] !== null
				? el["properties"] as Record<string, string>
				: undefined,
		}));
}

/**
 * Normalize and validate AccessibilityIssue array from parsed JSON.
 */
function normalizeAccessibility(issues: unknown[]): AccessibilityIssue[] {
	const validSeverities = new Set(["error", "warning", "info"]);

	return issues
		.filter((issue): issue is Record<string, unknown> => typeof issue === "object" && issue !== null)
		.map((issue) => ({
			severity: validSeverities.has(issue["severity"] as string)
				? (issue["severity"] as AccessibilityIssue["severity"])
				: "info",
			element: typeof issue["element"] === "string" ? issue["element"] : undefined,
			issue: typeof issue["issue"] === "string" ? issue["issue"] : "Unknown issue",
			suggestion: typeof issue["suggestion"] === "string" ? issue["suggestion"] : "",
			wcagRule: typeof issue["wcagRule"] === "string" ? issue["wcagRule"] : undefined,
		}));
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Analyze an image using a vision-capable LLM via Ollama.
 *
 * Reads the image, base64-encodes it, and sends it to Ollama's
 * generate API with a structured analysis prompt. The response
 * is parsed into a VisionAnalysis object.
 *
 * @param imagePath - Path to the image file to analyze
 * @param prompt - Custom analysis prompt (optional)
 * @param ollamaEndpoint - Ollama API endpoint (default: http://localhost:11434)
 * @param model - Vision model to use (default: llava)
 */
export async function analyzeImage(
	imagePath: string,
	prompt?: string,
	ollamaEndpoint?: string,
	model?: string,
): Promise<VisionAnalysis> {
	const imageBuffer = await readFile(imagePath);
	const base64Image = imageBuffer.toString("base64");

	const endpoint = ollamaEndpoint ?? DEFAULT_OLLAMA_ENDPOINT;
	const modelName = model ?? DEFAULT_MODEL;
	const analysisPrompt = prompt ?? DEFAULT_ANALYSIS_PROMPT;

	const response = await ollamaGenerate(
		endpoint,
		modelName,
		analysisPrompt,
		[base64Image],
	);

	return parseVisionResponse(response);
}

/**
 * Compare two UI screenshots using a vision-capable LLM.
 *
 * Sends both images to the LLM with a comparison prompt to identify
 * visual changes and regressions between versions.
 *
 * @param before - Path to the baseline screenshot
 * @param after - Path to the comparison screenshot
 * @param ollamaEndpoint - Ollama API endpoint (default: http://localhost:11434)
 * @param model - Vision model to use (default: llava)
 */
export async function analyzeUIChanges(
	before: string,
	after: string,
	ollamaEndpoint?: string,
	model?: string,
): Promise<{ changes: string[]; regressions: string[] }> {
	const [beforeBuffer, afterBuffer] = await Promise.all([
		readFile(before),
		readFile(after),
	]);

	const base64Before = beforeBuffer.toString("base64");
	const base64After = afterBuffer.toString("base64");

	const endpoint = ollamaEndpoint ?? DEFAULT_OLLAMA_ENDPOINT;
	const modelName = model ?? DEFAULT_MODEL;

	const response = await ollamaGenerate(
		endpoint,
		modelName,
		DEFAULT_COMPARISON_PROMPT,
		[base64Before, base64After],
	);

	// Parse comparison response
	const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/) ??
		response.match(/(\{[\s\S]*\})/);

	if (jsonMatch?.[1]) {
		try {
			const parsed = JSON.parse(jsonMatch[1]) as {
				changes?: string[];
				regressions?: string[];
			};
			return {
				changes: Array.isArray(parsed.changes) ? parsed.changes : [],
				regressions: Array.isArray(parsed.regressions) ? parsed.regressions : [],
			};
		} catch {
			// Fall through
		}
	}

	// Fallback: return raw response as a single change entry
	return {
		changes: [response.trim()],
		regressions: [],
	};
}
