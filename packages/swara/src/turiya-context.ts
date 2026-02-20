/**
 * Turiya Context — pattern detection and feature extraction.
 *
 * Extracts a 7-dimensional context vector from conversation messages
 * using regex-based heuristics. When Manas features are available,
 * enriches the context without redundant pattern matching.
 *
 * @module turiya-context
 */

import type { Message } from "./types.js";
import type { ManasFeatureBridge, TuriyaContext } from "./turiya-types.js";
import { estimateTokens } from "./token-counter.js";

// ─── Pattern Constants ──────────────────────────────────────────────────────

/** Patterns for urgency detection. */
const URGENCY_PATTERNS = /\b(urgent|asap|immediately|hurry|critical|emergency|error|bug|crash|broken|fix\s+now|prod\s+down|production\s+issue|p0|p1|blocker)\b/i;

/** Patterns for creativity detection. */
const CREATIVITY_PATTERNS = /\b(brainstorm|creative|imagine|what\s+if|explore|ideas?|suggest|novel|innovative|invent|dream\s+up|blue\s+sky|open.?ended|free.?form|experiment)\b/i;

/** Patterns for precision detection. */
const PRECISION_PATTERNS = /\b(exact|precise|accurate|correct|verify|validate|proof|prove|calculate|compute|math|equation|formula|benchmark|measure|audit|review|check|strict|rigorous)\b/i;

/** Code-related patterns (blocks, file refs, language keywords). */
const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const CODE_KEYWORD_PATTERN = /\b(function|class|import|export|const|let|var|async|await|interface|type|enum|struct|def|fn|impl|pub|mod|crate|package|module)\b/i;
const FILE_REF_PATTERN = /\b[\w\-]+\.(ts|js|py|rs|go|java|cpp|c|h|tsx|jsx|vue|svelte|rb|php|swift|kt|scala|zig|md|json|yaml|yml|toml|sql|sh|bash|zsh)\b/i;

/** Multi-step / complex task indicators. */
const MULTI_STEP_PATTERN = /\b(first\s.*then|step\s*[1-9]|multiple\s+files|refactor\s+.*across|and\s+then|after\s+that|finally|phase\s+[1-9]|stage\s+[1-9])\b/i;

/** Expert domain indicators. */
const EXPERT_PATTERN = /\b(distributed\s+system|consensus|fault.?toleran|zero.?knowledge|cryptograph|sharding|replication|linearizab|serializab|crdts?|raft|paxos|byzantine|merkle|b.?tree|skip\s+list|bloom\s+filter|lock.?free|wait.?free)\b/i;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Clamp a value to [0, 1]. */
export function clamp(value: number): number {
	return Math.max(0, Math.min(1, value));
}

/** Extract the text content from the last user message. */
export function extractLastUserText(messages: Message[]): string {
	const lastUser = [...messages].reverse().find((m) => m.role === "user");
	if (!lastUser) return "";
	return lastUser.content
		.filter((p): p is { type: "text"; text: string } => p.type === "text")
		.map((p) => p.text)
		.join(" ");
}

/** Count code blocks and compute code-to-total character ratio. */
export function computeCodeRatio(text: string): number {
	const codeBlocks = text.match(CODE_BLOCK_PATTERN) ?? [];
	const codeChars = codeBlocks.reduce((sum, block) => sum + block.length, 0);
	const hasKeywords = CODE_KEYWORD_PATTERN.test(text);
	const hasFileRefs = FILE_REF_PATTERN.test(text);

	let ratio = text.length > 0 ? codeChars / text.length : 0;
	if (hasKeywords) ratio = Math.min(1, ratio + 0.2);
	if (hasFileRefs) ratio = Math.min(1, ratio + 0.1);

	return clamp(ratio);
}

/** Estimate complexity from text features. */
export function estimateComplexity(text: string, tokenCount: number): number {
	let score = 0;

	if (tokenCount > 500) score += 0.3;
	else if (tokenCount > 200) score += 0.2;
	else if (tokenCount > 50) score += 0.1;

	if (CODE_KEYWORD_PATTERN.test(text)) score += 0.15;
	if (CODE_BLOCK_PATTERN.test(text)) score += 0.15;
	if (MULTI_STEP_PATTERN.test(text)) score += 0.2;
	if (EXPERT_PATTERN.test(text)) score += 0.3;

	return clamp(score);
}

/** Estimate urgency from text signals. */
export function estimateUrgency(text: string): number {
	let score = 0;
	if (URGENCY_PATTERNS.test(text)) score += 0.5;

	const exclamations = (text.match(/!/g) ?? []).length;
	score += Math.min(0.3, exclamations * 0.1);

	const capsWords = (text.match(/\b[A-Z]{3,}\b/g) ?? []).length;
	score += Math.min(0.2, capsWords * 0.05);

	return clamp(score);
}

/** Estimate creativity requirement. */
export function estimateCreativity(text: string): number {
	let score = 0;
	if (CREATIVITY_PATTERNS.test(text)) score += 0.5;
	if (text.includes("?")) score += 0.1;
	if (/\b(how|why)\b/i.test(text)) score += 0.1;

	return clamp(score);
}

/** Estimate precision requirement. */
export function estimatePrecision(text: string): number {
	let score = 0;
	if (PRECISION_PATTERNS.test(text)) score += 0.5;

	const numbers = (text.match(/\d+/g) ?? []).length;
	score += Math.min(0.2, numbers * 0.03);

	if (/\b(code\s+review|security\s+audit|type\s+check|lint)\b/i.test(text)) score += 0.2;

	return clamp(score);
}

/**
 * Build a full TuriyaContext from messages, with optional Manas enrichment.
 *
 * @param messages - Conversation messages.
 * @param systemPrompt - Optional system prompt.
 * @param memoryHits - Number of memory/retrieval hits.
 * @param maxConversationDepth - Max depth for normalization.
 * @param maxMemoryHits - Max memory hits for normalization.
 * @param manasFeatures - Pre-extracted features from Manas (optional).
 * @returns The 7-dimensional TuriyaContext.
 */
export function buildContext(
	messages: Message[],
	systemPrompt: string | undefined,
	memoryHits: number,
	maxConversationDepth: number,
	maxMemoryHits: number,
	manasFeatures?: ManasFeatureBridge,
): TuriyaContext {
	const text = extractLastUserText(messages);
	const fullText = systemPrompt ? `${systemPrompt} ${text}` : text;
	const tokenCount = estimateTokens(fullText);

	let complexity = estimateComplexity(text, tokenCount);
	let urgency = estimateUrgency(text);
	let creativity = estimateCreativity(text);
	let precision = estimatePrecision(text);
	let codeRatio = computeCodeRatio(text);

	if (manasFeatures) {
		if (manasFeatures.hasCode) codeRatio = clamp(codeRatio + 0.2);
		if (manasFeatures.multiStep) complexity = clamp(complexity + 0.15);
		if (manasFeatures.hasErrorStack) precision = clamp(precision + 0.2);
		if (manasFeatures.questionCount > 2) creativity = clamp(creativity + 0.1);
		if (manasFeatures.imperative) urgency = clamp(urgency + 0.1);
	}

	return {
		complexity,
		urgency,
		creativity,
		precision,
		codeRatio,
		conversationDepth: clamp(messages.length / (2 * maxConversationDepth)),
		memoryLoad: clamp(memoryHits / maxMemoryHits),
	};
}
