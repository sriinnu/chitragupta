/**
 * @chitragupta/anina/chetana — Dhyana — ध्यान — Attention / Salience Filter.
 *
 * The agent's spotlight of awareness — determines which messages, concepts,
 * and tools deserve the most cognitive bandwidth. Like dhyana in the
 * Ashtanga (eight-limbed) yoga of Patanjali, this system sustains
 * unbroken attention on what matters most, letting irrelevant context
 * fade gracefully into the periphery.
 *
 * ## Salience Model
 *
 * Each message carries a salience score shaped by three forces:
 *
 *   S(m) = recency(m) * base + errorBoost(m) + correctionBoost(m)
 *
 * where:
 *   recency(m) = exp(-lambda * age)          — exponential decay with distance
 *   errorBoost = +attentionErrorBoost         — for messages within 2 of an error
 *   correctionBoost = +attentionCorrectionBoost — for user corrections (sticky)
 *
 * ## Focus Window
 *
 * The top-K most salient messages form the "focus window" — the subset
 * of conversation history that the agent treats as most relevant.
 * K = min(config.attentionFocusWindow, SYSTEM_MAX_FOCUS_WINDOW).
 *
 * ## Concept Tracking
 *
 * Keywords extracted from text accumulate weight over time and decay
 * each turn, forming a thematic attention map of the conversation.
 *
 * @packageDocumentation
 */

import type { AttentionWeights, ChetanaConfig } from "./types.js";
import { SYSTEM_MAX_FOCUS_WINDOW } from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Error adjacency radius: messages within this distance of an error get boosted. */
const ERROR_ADJACENCY_RADIUS = 2;

/** Minimum keyword length to track as a concept. */
const MIN_KEYWORD_LENGTH = 4;

/** Weight increment per concept mention. */
const CONCEPT_MENTION_INCREMENT = 0.1;

/** Weight decay per refreshSalience() call. */
const CONCEPT_DECAY_PER_REFRESH = 0.05;

/** Maximum tracked concepts (evict lowest-weight when exceeded). */
const MAX_CONCEPTS = 100;

/** Tool attention boost multiplier for successful use. */
const TOOL_SUCCESS_ATTENTION_FACTOR = 0.1;

/** Tool attention penalty for failed use. */
const TOOL_FAILURE_PENALTY = 0.05;

// ─── Stop Words ──────────────────────────────────────────────────────────────

/**
 * Common English stop words filtered from concept extraction.
 * Kept as a Set for O(1) lookup in the hot path.
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
	"the", "this", "that", "with", "from", "have", "been",
	"will", "would", "could", "should", "their", "there",
	"about", "which", "when", "then", "them", "than",
	"into", "each", "also", "some", "more", "very",
	"just", "only", "like", "make", "does", "what", "your",
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Clamp a number to [min, max]. */
function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

// ─── Message Metadata ────────────────────────────────────────────────────────

/** Internal metadata attached to each tracked message. */
interface MessageMeta {
	/** Whether this message was near an error. */
	hasError: boolean;
	/** Whether this message was a user correction. */
	isCorrection: boolean;
	/** Base salience before recency weighting. */
	baseSalience: number;
}

// ─── DhyanaSystem ────────────────────────────────────────────────────────────

/**
 * Attention and salience filter for the Chetana consciousness layer.
 *
 * Maintains three attention maps (messages, concepts, tools) and
 * exposes a focus window of the most salient messages for context
 * prioritization.
 */
export class DhyanaSystem {
	private weights: AttentionWeights;
	private config: ChetanaConfig;
	private messageOrder: string[] = [];
	private messageMeta: Map<string, MessageMeta> = new Map();

	constructor(config: ChetanaConfig) {
		this.config = config;
		this.weights = {
			messages: new Map(),
			concepts: new Map(),
			tools: new Map(),
		};
	}

	// ─── Accessors ─────────────────────────────────────────────────────────

	/** Returns the current attention weights (read-only view). */
	getWeights(): Readonly<AttentionWeights> {
		return this.weights;
	}

	// ─── Message Tracking ──────────────────────────────────────────────────

	/**
	 * Register a new message and compute its initial salience.
	 *
	 * Error and correction flags are sticky — they permanently mark
	 * the message for boosted salience even as recency decays.
	 */
	addMessage(messageId: string, hasError: boolean, isUserCorrection: boolean): void {
		this.messageOrder.push(messageId);

		const baseSalience = 1.0;
		this.messageMeta.set(messageId, {
			hasError,
			isCorrection: isUserCorrection,
			baseSalience,
		});

		// Compute initial salience (recency = 1.0 for the newest message)
		let salience = baseSalience;
		if (isUserCorrection) {
			salience += this.config.attentionCorrectionBoost;
		}
		this.weights.messages.set(messageId, clamp(salience, 0, 2));

		// Retroactively boost neighbors if this message has an error
		if (hasError) {
			this.boostErrorNeighbors(this.messageOrder.length - 1);
		}
	}

	// ─── Tool Tracking ─────────────────────────────────────────────────────

	/**
	 * Update tool attention after a tool is used.
	 *
	 * Successful tools gain attention proportional to their performance
	 * score. Failed tools are penalized. Weights are clamped to [0, 1].
	 */
	onToolUsed(toolName: string, success: boolean, performanceScore: number): void {
		const current = this.weights.tools.get(toolName) ?? 0.5;

		const delta = success
			? performanceScore * TOOL_SUCCESS_ATTENTION_FACTOR
			: -TOOL_FAILURE_PENALTY;

		this.weights.tools.set(toolName, clamp(current + delta, 0, 1));
	}

	// ─── Concept Tracking ──────────────────────────────────────────────────

	/**
	 * Extract and track concept keywords from text.
	 *
	 * Words shorter than 4 characters and common stop words are filtered.
	 * Each surviving keyword increments its concept weight by 0.1.
	 * When the concept map exceeds 100 entries, the lowest-weight
	 * concept is evicted.
	 */
	trackConcepts(text: string): void {
		const keywords = text
			.split(/\s+/)
			.map(w => w.toLowerCase().replace(/[^a-z0-9]/g, ""))
			.filter(w => w.length >= MIN_KEYWORD_LENGTH && !STOP_WORDS.has(w));

		// Deduplicate within this text to avoid runaway weight from repetition
		const unique = new Set(keywords);

		for (const keyword of unique) {
			const current = this.weights.concepts.get(keyword) ?? 0;
			this.weights.concepts.set(keyword, clamp(current + CONCEPT_MENTION_INCREMENT, 0, 1));
		}

		// Evict lowest-weight concepts if we exceed the cap
		this.evictExcessConcepts();
	}

	// ─── Focus Window ──────────────────────────────────────────────────────

	/**
	 * Get the top-K most salient message IDs (the "focus window").
	 *
	 * K = min(config.attentionFocusWindow, SYSTEM_MAX_FOCUS_WINDOW).
	 * Messages are returned in descending salience order.
	 */
	getFocusWindow(): string[] {
		const k = Math.min(this.config.attentionFocusWindow, SYSTEM_MAX_FOCUS_WINDOW);

		return [...this.weights.messages.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, k)
			.map(([id]) => id);
	}

	// ─── Salience Refresh ──────────────────────────────────────────────────

	/**
	 * Recompute recency-based salience decay for all messages and
	 * apply concept weight decay.
	 *
	 * Called at the end of each turn. Message salience is recomputed
	 * from scratch using the recency formula:
	 *
	 *   salience = baseSalience * exp(-lambda * age) + errorBoost + correctionBoost
	 *
	 * Concept weights decay by a fixed amount per call.
	 */
	refreshSalience(): void {
		const lambda = this.config.attentionRecencyLambda;
		const totalMessages = this.messageOrder.length;

		// --- Message recency recomputation ---
		for (let i = 0; i < totalMessages; i++) {
			const messageId = this.messageOrder[i]!;
			const meta = this.messageMeta.get(messageId);
			if (!meta) continue;

			const age = totalMessages - 1 - i;
			const recencyWeight = Math.exp(-lambda * age);
			let salience = meta.baseSalience * recencyWeight;

			// Error adjacency boost
			if (this.hasErrorNeighbor(i)) {
				salience += this.config.attentionErrorBoost;
			}

			// Correction boost (sticky — decays slower via half-rate recency)
			if (meta.isCorrection) {
				const correctionRecency = Math.exp(-lambda * 0.5 * age);
				salience += this.config.attentionCorrectionBoost * correctionRecency;
			}

			this.weights.messages.set(messageId, clamp(salience, 0, 2));
		}

		// --- Concept decay ---
		for (const [concept, weight] of this.weights.concepts) {
			const decayed = weight - CONCEPT_DECAY_PER_REFRESH;
			if (decayed <= 0) {
				this.weights.concepts.delete(concept);
			} else {
				this.weights.concepts.set(concept, decayed);
			}
		}
	}

	// ─── Serialization ─────────────────────────────────────────────────────

	/** Serialize attention state to arrays for JSON persistence. */
	serialize(): { concepts: Array<[string, number]>; tools: Array<[string, number]> } {
		return {
			concepts: [...this.weights.concepts.entries()],
			tools: [...this.weights.tools.entries()],
		};
	}

	/**
	 * Restore a DhyanaSystem from serialized state.
	 *
	 * Only concept and tool weights are restored — message salience
	 * is ephemeral and recomputed from the live conversation.
	 */
	static deserialize(
		data: { concepts: Array<[string, number]>; tools: Array<[string, number]> },
		config: ChetanaConfig,
	): DhyanaSystem {
		const system = new DhyanaSystem(config);

		for (const [concept, weight] of data.concepts) {
			system.weights.concepts.set(concept, weight);
		}
		for (const [tool, weight] of data.tools) {
			system.weights.tools.set(tool, weight);
		}

		return system;
	}

	// ─── Internal ──────────────────────────────────────────────────────────

	/**
	 * Boost salience of messages within ERROR_ADJACENCY_RADIUS of
	 * the given index.
	 */
	private boostErrorNeighbors(errorIndex: number): void {
		const start = Math.max(0, errorIndex - ERROR_ADJACENCY_RADIUS);
		const end = Math.min(this.messageOrder.length - 1, errorIndex + ERROR_ADJACENCY_RADIUS);

		for (let i = start; i <= end; i++) {
			if (i === errorIndex) continue;
			const neighborId = this.messageOrder[i]!;
			const current = this.weights.messages.get(neighborId) ?? 0;
			this.weights.messages.set(neighborId, clamp(current + this.config.attentionErrorBoost, 0, 2));
		}
	}

	/**
	 * Check whether the message at `index` has an error-flagged
	 * neighbor within ERROR_ADJACENCY_RADIUS.
	 */
	private hasErrorNeighbor(index: number): boolean {
		const start = Math.max(0, index - ERROR_ADJACENCY_RADIUS);
		const end = Math.min(this.messageOrder.length - 1, index + ERROR_ADJACENCY_RADIUS);

		for (let i = start; i <= end; i++) {
			if (i === index) continue;
			const neighborId = this.messageOrder[i]!;
			const meta = this.messageMeta.get(neighborId);
			if (meta?.hasError) return true;
		}
		return false;
	}

	/**
	 * Evict the lowest-weight concepts when the map exceeds MAX_CONCEPTS.
	 */
	private evictExcessConcepts(): void {
		if (this.weights.concepts.size <= MAX_CONCEPTS) return;

		const sorted = [...this.weights.concepts.entries()]
			.sort((a, b) => a[1] - b[1]);

		const toEvict = sorted.length - MAX_CONCEPTS;
		for (let i = 0; i < toEvict; i++) {
			this.weights.concepts.delete(sorted[i]![0]);
		}
	}
}
