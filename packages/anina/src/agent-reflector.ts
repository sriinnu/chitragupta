/**
 * Pratyaksha — Agent self-reflection and peer review.
 *
 * Provides heuristic self-evaluation of agent outputs without consuming
 * additional LLM tokens. The reflector scores outputs on substance,
 * structure, relevance, and certainty, then tracks trends over time
 * to surface recurring weaknesses.
 *
 * Sanskrit: Pratyaksha (प्रत्यक्ष) = direct perception, self-evident knowledge.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ReflectionResult {
	agentId: string;
	/** Self-assessment score (0-10) */
	score: number;
	/** Confidence in own output (0-1) */
	confidence: number;
	/** Identified strengths in this output */
	strengths: string[];
	/** Identified weaknesses */
	weaknesses: string[];
	/** Suggested improvements */
	improvements: string[];
	timestamp: number;
}

export interface PeerReview {
	reviewerId: string;
	targetId: string;
	/** Reviewer's score (0-10) */
	score: number;
	/** Detailed feedback */
	feedback: string;
	/** Whether the output is approved */
	approved: boolean;
	timestamp: number;
}

export interface ReflectorConfig {
	/** Minimum confidence to skip revision. Default: 0.7 */
	confidenceThreshold?: number;
	/** Maximum reflections to store per agent. Default: 100 */
	maxHistory?: number;
}

// ─── Reflector ──────────────────────────────────────────────────────────────

export class AgentReflector {
	private history = new Map<string, ReflectionResult[]>();
	private peerReviews = new Map<string, PeerReview[]>();
	private readonly confidenceThreshold: number;
	private readonly maxHistory: number;

	constructor(config?: ReflectorConfig) {
		this.confidenceThreshold = config?.confidenceThreshold ?? 0.7;
		this.maxHistory = config?.maxHistory ?? 100;
	}

	/**
	 * Reflect on a task output. Analyzes the output text to produce
	 * a self-assessment using heuristic scoring (not LLM-based, to
	 * avoid token waste on meta-evaluation).
	 */
	reflect(
		agentId: string,
		taskDescription: string,
		output: string,
	): ReflectionResult {
		const strengths: string[] = [];
		const weaknesses: string[] = [];
		const improvements: string[] = [];
		let score = 5; // baseline
		let confidence = 0.5;

		// ── Length analysis ──────────────────────────────────────────────
		if (output.length > 100) {
			score += 1;
			strengths.push("substantive response");
		}
		if (output.length > 2000) {
			score += 0.5;
			strengths.push("thorough coverage");
		}
		if (output.length < 20) {
			score -= 2;
			weaknesses.push("very brief");
			improvements.push("provide more detail");
		}

		// ── Code detection ──────────────────────────────────────────────
		const hasCode = /```[\s\S]*?```|function |class |const |import /.test(output);
		if (hasCode) {
			score += 1;
			strengths.push("includes code");
		}

		// ── Structure detection ─────────────────────────────────────────
		const hasStructure = /^#{1,3} |^\d+\.|^- |\*\*/m.test(output);
		if (hasStructure) {
			score += 0.5;
			strengths.push("well-structured");
		}

		// ── Uncertainty detection ────────────────────────────────────────
		const hasUncertainty = /i'm not sure|i think|maybe|possibly|unclear/i.test(output);
		if (hasUncertainty) {
			confidence -= 0.15;
			weaknesses.push("expressed uncertainty");
		}

		// ── Task relevance (keyword overlap) ────────────────────────────
		const taskWords = new Set(
			taskDescription.toLowerCase().split(/\s+/).filter(w => w.length > 2),
		);
		const outputWords = new Set(
			output.toLowerCase().split(/\s+/).filter(w => w.length > 2),
		);
		let overlap = 0;
		for (const w of taskWords) {
			if (outputWords.has(w)) overlap++;
		}
		const relevance = taskWords.size > 0 ? overlap / taskWords.size : 0;

		if (relevance > 0.3) {
			score += 1;
			confidence += 0.1;
			strengths.push("task-relevant");
		}
		if (relevance < 0.1) {
			score -= 1;
			confidence -= 0.1;
			weaknesses.push("may be off-topic");
			improvements.push("focus on the task requirements");
		}

		// ── Clamp to valid ranges ───────────────────────────────────────
		score = Math.max(0, Math.min(10, score));
		confidence = Math.max(0, Math.min(1, confidence));

		const result: ReflectionResult = {
			agentId,
			score,
			confidence,
			strengths,
			weaknesses,
			improvements,
			timestamp: Date.now(),
		};

		// Store in history (ring buffer)
		const hist = this.history.get(agentId) ?? [];
		hist.push(result);
		if (hist.length > this.maxHistory) hist.shift();
		this.history.set(agentId, hist);

		return result;
	}

	/** Submit a peer review from one agent about another. */
	submitPeerReview(review: PeerReview): void {
		const reviews = this.peerReviews.get(review.targetId) ?? [];
		reviews.push(review);
		if (reviews.length > this.maxHistory) reviews.shift();
		this.peerReviews.set(review.targetId, reviews);
	}

	/** Check if output needs revision (below confidence threshold). */
	needsRevision(reflection: ReflectionResult): boolean {
		return reflection.confidence < this.confidenceThreshold;
	}

	/** Get reflection history for an agent. */
	getHistory(agentId: string): ReflectionResult[] {
		return this.history.get(agentId) ?? [];
	}

	/** Get peer reviews targeting an agent. */
	getPeerReviews(agentId: string): PeerReview[] {
		return this.peerReviews.get(agentId) ?? [];
	}

	/** Compute average self-assessment score for an agent. */
	getAverageScore(agentId: string): number {
		const hist = this.history.get(agentId) ?? [];
		if (hist.length === 0) return 0;
		return hist.reduce((sum, r) => sum + r.score, 0) / hist.length;
	}

	/** Compute average confidence for an agent. */
	getAverageConfidence(agentId: string): number {
		const hist = this.history.get(agentId) ?? [];
		if (hist.length === 0) return 0.5;
		return hist.reduce((sum, r) => sum + r.confidence, 0) / hist.length;
	}

	/**
	 * Get trending weaknesses (most frequent across reflection history).
	 * Useful for identifying systemic issues in an agent's behavior.
	 */
	getTrendingWeaknesses(
		agentId: string,
		topN = 5,
	): Array<{ weakness: string; count: number }> {
		const hist = this.history.get(agentId) ?? [];
		const counts = new Map<string, number>();

		for (const r of hist) {
			for (const w of r.weaknesses) {
				counts.set(w, (counts.get(w) ?? 0) + 1);
			}
		}

		return [...counts.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, topN)
			.map(([weakness, count]) => ({ weakness, count }));
	}
}
