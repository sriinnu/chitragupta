/**
 * Pariksha metrics — heuristic scoring functions for agent output evaluation.
 *
 * Pure functions that assess relevance, completeness, correctness, clarity,
 * and efficiency without any LLM calls.
 */

import type { EvalResult } from "./evaluator.js";

// ─── Utility Functions ───────────────────────────────────────────────────────

/** Common English stop words to exclude from keyword matching. */
const STOP_WORDS = new Set([
	"a", "an", "the", "and", "or", "but", "is", "are", "was", "were", "be",
	"been", "being", "have", "has", "had", "do", "does", "did", "will",
	"would", "could", "should", "may", "might", "shall", "can", "need",
	"to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
	"into", "about", "between", "through", "during", "before", "after",
	"above", "below", "this", "that", "these", "those", "it", "its",
	"i", "me", "my", "we", "our", "you", "your", "he", "she", "they",
	"them", "their", "what", "which", "who", "when", "where", "how",
	"all", "each", "every", "both", "few", "more", "most", "other",
	"some", "such", "no", "not", "only", "same", "so", "than", "too",
	"very", "just", "because", "if", "then", "else", "while", "also",
	"write", "create", "make", "please", "using",
]);

/** Extract significant words from text, excluding stop words and short tokens. */
export function extractSignificantWords(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/** Check if a code block looks structurally valid (balanced brackets). */
export function isCodeLikelyValid(code: string): boolean {
	const trimmed = code.trim();
	if (trimmed.length < 3) return false;

	let braces = 0, brackets = 0, parens = 0;
	for (const char of trimmed) {
		switch (char) {
			case "{": braces++; break;
			case "}": braces--; break;
			case "[": brackets++; break;
			case "]": brackets--; break;
			case "(": parens++; break;
			case ")": parens--; break;
		}
		if (braces < 0 || brackets < 0 || parens < 0) return false;
	}

	return Math.abs(braces) <= 1 && Math.abs(brackets) <= 1 && Math.abs(parens) <= 1;
}

/** Extract n-word phrases from text for redundancy detection. */
export function extractPhrases(text: string, n: number): string[] {
	const words = text.toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length < n) return [];

	const phrases: string[] = [];
	for (let i = 0; i <= words.length - n; i++) {
		phrases.push(words.slice(i, i + n).join(" "));
	}
	return phrases;
}

// ─── Criterion Evaluators ────────────────────────────────────────────────────

/** Relevance: keyword overlap between task and output. */
export function evalRelevance(task: string, output: string): EvalResult {
	const taskWords = extractSignificantWords(task);
	const outputLower = output.toLowerCase();

	if (taskWords.length === 0) {
		return { criterion: "relevance", score: 5, feedback: "Task has no significant keywords to match against" };
	}

	let matches = 0;
	for (const word of taskWords) {
		if (outputLower.includes(word)) matches++;
	}

	const ratio = matches / taskWords.length;
	const score = Math.min(10, Math.round(ratio * 10 * 1.2));

	let feedback: string;
	if (score >= 8) feedback = `Highly relevant: ${matches}/${taskWords.length} task keywords present`;
	else if (score >= 5) feedback = `Moderately relevant: ${matches}/${taskWords.length} task keywords present`;
	else feedback = `Low relevance: only ${matches}/${taskWords.length} task keywords found in output`;

	return { criterion: "relevance", score, feedback };
}

/** Completeness: output length relative to task complexity. */
export function evalCompleteness(task: string, output: string): EvalResult {
	const taskWords = task.split(/\s+/).filter(Boolean).length;
	const outputWords = output.split(/\s+/).filter(Boolean).length;
	const complexityMultiplier = Math.min(10, Math.max(2, taskWords / 5));
	const expectedMinWords = taskWords * complexityMultiplier;

	if (outputWords === 0) {
		return { criterion: "completeness", score: 0, feedback: "Output is empty" };
	}

	const ratio = outputWords / Math.max(1, expectedMinWords);
	let score: number;

	if (ratio >= 1.0) score = Math.min(10, 7 + Math.min(3, (ratio - 1) * 2));
	else if (ratio >= 0.5) score = 4 + (ratio - 0.5) * 6;
	else score = ratio * 8;

	score = Math.max(0, Math.min(10, Math.round(score)));

	const hasCodeBlocks = /```[\s\S]*?```/.test(output);
	const hasLists = /^[\s]*[-*]\s/m.test(output) || /^\s*\d+\.\s/m.test(output);
	const hasExplanation = outputWords > 20;

	const indicators: string[] = [];
	if (hasCodeBlocks) indicators.push("code blocks");
	if (hasLists) indicators.push("structured lists");
	if (hasExplanation) indicators.push("explanatory text");

	const feedback = indicators.length > 0
		? `${outputWords} words with ${indicators.join(", ")}. Coverage: ${Math.round(ratio * 100)}%`
		: `${outputWords} words. Coverage: ${Math.round(ratio * 100)}% of expected`;

	return { criterion: "completeness", score, feedback };
}

/** Correctness: code block validity and internal consistency. */
export function evalCorrectness(_task: string, output: string): EvalResult {
	let score = 6;
	const observations: string[] = [];

	const codeBlocks = output.match(/```(\w*)\n([\s\S]*?)```/g) ?? [];
	if (codeBlocks.length > 0) {
		let validBlocks = 0;
		for (const block of codeBlocks) {
			const content = block.replace(/```\w*\n/, "").replace(/```$/, "");
			if (isCodeLikelyValid(content)) validBlocks++;
		}
		const codeRatio = validBlocks / codeBlocks.length;
		if (codeRatio >= 0.8) { score += 2; observations.push(`${validBlocks}/${codeBlocks.length} code blocks appear valid`); }
		else if (codeRatio >= 0.5) { score += 1; observations.push(`${validBlocks}/${codeBlocks.length} code blocks appear valid`); }
		else { score -= 1; observations.push(`Only ${validBlocks}/${codeBlocks.length} code blocks appear valid`); }
	}

	const contradictionPatterns = [/\bhowever\b.*\bactually\b/i, /\bwait\b.*\bthat's wrong\b/i, /\bno\b.*\bI meant\b/i, /\bcorrection\b/i];
	let contradictions = 0;
	for (const pattern of contradictionPatterns) { if (pattern.test(output)) contradictions++; }
	if (contradictions > 0) { score -= contradictions; observations.push(`${contradictions} potential self-contradiction(s) detected`); }

	const confidencePatterns = [/\bI'm not sure\b/i, /\bI think\b.*\bmaybe\b/i, /\bprobably\b/i, /\bmight be wrong\b/i];
	let hedges = 0;
	for (const pattern of confidencePatterns) { if (pattern.test(output)) hedges++; }
	if (hedges > 2) { score -= 1; observations.push("Multiple uncertainty hedges detected"); }

	score = Math.max(0, Math.min(10, score));
	return { criterion: "correctness", score, feedback: observations.length > 0 ? observations.join(". ") : "No significant correctness signals detected" };
}

/** Clarity: structure detection and sentence variety. */
export function evalClarity(output: string): EvalResult {
	let score = 5;
	const observations: string[] = [];

	const hasHeaders = /^#{1,6}\s/m.test(output);
	const hasBulletLists = /^[\s]*[-*]\s/m.test(output);
	const hasNumberedLists = /^\s*\d+\.\s/m.test(output);
	const hasCodeBlocks = /```/.test(output);
	const sectionCount = output.split(/\n\n+/).filter((p) => p.trim().length > 0).length;

	let structureScore = 0;
	if (hasHeaders) { structureScore++; observations.push("has headers"); }
	if (hasBulletLists || hasNumberedLists) { structureScore++; observations.push("has lists"); }
	if (hasCodeBlocks) { structureScore++; observations.push("has code blocks"); }
	if (sectionCount >= 2) { structureScore++; observations.push(`${sectionCount} sections`); }
	score += Math.min(3, structureScore);

	const sentences = output.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 10);
	if (sentences.length >= 3) {
		const starters = sentences.map((s) => s.split(/\s+/)[0]?.toLowerCase() ?? "");
		const variety = new Set(starters).size / starters.length;
		if (variety >= 0.6) { score += 1; observations.push("good sentence variety"); }
		else if (variety < 0.3) { score -= 1; observations.push("repetitive sentence starters"); }
	}

	const paragraphs = output.split(/\n\n+/).filter((p) => p.trim().length > 0);
	const longParagraphs = paragraphs.filter((p) => p.split(/\s+/).length > 150);
	if (longParagraphs.length > 0) { score -= 1; observations.push(`${longParagraphs.length} overly long paragraph(s)`); }

	score = Math.max(0, Math.min(10, score));
	return { criterion: "clarity", score, feedback: observations.length > 0 ? `Structure: ${observations.join(", ")}` : "Minimal structural elements" };
}

/** Efficiency: output conciseness relative to task complexity. */
export function evalEfficiency(task: string, output: string): EvalResult {
	const taskWords = task.split(/\s+/).filter(Boolean).length;
	const outputWords = output.split(/\s+/).filter(Boolean).length;

	if (outputWords === 0) {
		return { criterion: "efficiency", score: 0, feedback: "Output is empty" };
	}

	const ratio = outputWords / Math.max(1, taskWords);
	let score: number;
	let feedback: string;

	if (ratio < 1) { score = 3; feedback = `Very brief: ${outputWords} words for a ${taskWords}-word task`; }
	else if (ratio < 3) { score = 6; feedback = `Concise: ${ratio.toFixed(1)}x task length`; }
	else if (ratio <= 20) {
		const normalizedRatio = (ratio - 3) / 17;
		const bellCurve = 1 - Math.pow(2 * normalizedRatio - 0.4, 2);
		score = 7 + Math.round(bellCurve * 3);
		feedback = `Good balance: ${ratio.toFixed(1)}x task length (${outputWords} words)`;
	} else if (ratio <= 50) { score = 5; feedback = `Somewhat verbose: ${ratio.toFixed(1)}x task length (${outputWords} words)`; }
	else { score = Math.max(1, 5 - Math.floor((ratio - 50) / 20)); feedback = `Excessively verbose: ${ratio.toFixed(1)}x task length (${outputWords} words)`; }

	const phrases = extractPhrases(output, 3);
	const uniquePhrases = new Set(phrases);
	if (phrases.length >= 5) {
		const redundancy = 1 - uniquePhrases.size / phrases.length;
		if (redundancy > 0.3) {
			score = Math.max(0, score - 2);
			feedback += `. High redundancy: ${Math.round(redundancy * 100)}% repeated phrases`;
		}
	}

	score = Math.max(0, Math.min(10, score));
	return { criterion: "efficiency", score, feedback };
}
