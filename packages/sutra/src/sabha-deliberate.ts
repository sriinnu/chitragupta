/**
 * Sabha LLM Deliberation — injectable provider for risk-gate consensus.
 *
 * When a high-risk Kartavya action (confidence > sabhaRiskThreshold) is
 * about to be approved, this module routes it through a Sabha-style
 * deliberation via an injectable LLM provider. The provider synthesizes
 * a multi-perspective consensus and returns a structured verdict.
 *
 * No Sabha type dependencies are needed here — this is a lightweight
 * bridge that maps LLM output to a simple approved/rejected/no-consensus
 * verdict. The full SabhaEngine (sabha.ts) remains for structured
 * multi-round deliberation with participants.
 *
 * @module sabha-deliberate
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Verdict from LLM-backed Sabha deliberation. */
export type SabhaVerdict = "approved" | "rejected" | "no-consensus";

/** Deliberation outcome returned by the provider. */
export interface SabhaDeliberateResult {
	/** Final verdict. */
	verdict: SabhaVerdict;
	/**
	 * Aggregate confidence in the verdict (0-1).
	 * For "approved": how strongly it was approved.
	 * For "rejected": how strongly it was rejected.
	 * For "no-consensus": how split the deliberation was (lower = more split).
	 */
	confidence: number;
	/** Human-readable rationale for the verdict. */
	rationale: string;
	/** Individual perspective votes from simulated participants. */
	perspectives?: SabhaDeliberatePerspective[];
}

/** A single simulated participant's perspective. */
export interface SabhaDeliberatePerspective {
	/** Simulated role (e.g., "security-reviewer", "product-owner"). */
	role: string;
	/** Position taken. */
	position: "support" | "oppose" | "abstain";
	/** Confidence weight for this perspective (0-1). */
	weight: number;
	/** Brief reasoning. */
	reasoning: string;
}

/** Options for configuring a single deliberation call. */
export interface SabhaDeliberateOptions {
	/**
	 * Simulated roles to include in the deliberation.
	 * Default: ["safety-reviewer", "product-owner", "security-auditor"]
	 */
	roles?: string[];
	/**
	 * Consensus threshold (0-1). Weighted support share needed for "approved".
	 * Default: 0.67
	 */
	consensusThreshold?: number;
	/**
	 * Timeout for the LLM call in ms. Provider-level, not enforced here.
	 * Pass through to the provider for informational purposes.
	 */
	timeoutMs?: number;
}

/**
 * Injectable LLM provider for Sabha deliberation.
 * Implement this to wire any provider into the risk gate.
 */
export interface SabhaProvider {
	/**
	 * Run a deliberation on the given topic and context.
	 *
	 * The provider must return a structured result. It is responsible for:
	 * - Simulating multiple perspectives if desired
	 * - Returning a verdict + confidence + rationale
	 * - Optionally populating `perspectives[]`
	 *
	 * Non-fatal errors should be handled internally; if the provider
	 * truly cannot proceed, throw — SabhaRejectedError is NOT for provider
	 * failures (use a plain Error instead). The caller handles both.
	 */
	deliberate(
		topic: string,
		context: string,
		options?: SabhaDeliberateOptions,
	): Promise<SabhaDeliberateResult>;
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * Thrown when Sabha deliberation returns verdict = "rejected".
 * Distinct from a provider failure — this is a deliberate block.
 */
export class SabhaRejectedError extends Error {
	/** The full deliberation result that led to rejection. */
	readonly result: SabhaDeliberateResult;

	constructor(topic: string, result: SabhaDeliberateResult) {
		super(
			`Sabha rejected: "${topic}" — ${result.rationale} (confidence: ${result.confidence.toFixed(2)})`,
		);
		this.name = "SabhaRejectedError";
		this.result = result;
	}
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_ROLES = ["safety-reviewer", "product-owner", "security-auditor"];
const DEFAULT_THRESHOLD = 0.67;

// ─── Core function ────────────────────────────────────────────────────────────

/**
 * Run Sabha deliberation on a proposed action via an injectable LLM provider.
 *
 * Flow:
 * 1. Call provider.deliberate(topic, context, options)
 * 2. Clamp returned confidence to [0, 1]
 * 3. If verdict = "rejected" → throw SabhaRejectedError
 * 4. If verdict = "approved" → return result
 * 5. If verdict = "no-consensus" → return result (caller decides)
 *
 * Provider failures (throws) propagate as-is — they are not SabhaRejectedError.
 *
 * @param topic - Short description of the proposed action (e.g., "auto-schedule nightly cleanup")
 * @param context - Full context string (evidence, risk score, description)
 * @param provider - Injectable LLM provider
 * @param options - Optional deliberation config
 * @returns Deliberation result (never "rejected" — that throws)
 * @throws {SabhaRejectedError} when verdict = "rejected"
 * @throws {Error} on provider failure
 */
export async function deliberateWithSabha(
	topic: string,
	context: string,
	provider: SabhaProvider,
	options?: SabhaDeliberateOptions,
): Promise<SabhaDeliberateResult> {
	const opts: SabhaDeliberateOptions = {
		roles: options?.roles ?? DEFAULT_ROLES,
		consensusThreshold: options?.consensusThreshold ?? DEFAULT_THRESHOLD,
		timeoutMs: options?.timeoutMs,
	};

	const raw = await provider.deliberate(topic, context, opts);

	// Sanitize provider output
	const result: SabhaDeliberateResult = {
		verdict: normalizeVerdict(raw.verdict),
		confidence: Math.max(0, Math.min(1, raw.confidence ?? 0)),
		rationale: raw.rationale?.trim() || "(no rationale provided)",
		perspectives: raw.perspectives,
	};

	if (result.verdict === "rejected") {
		throw new SabhaRejectedError(topic, result);
	}

	return result;
}

/**
 * Compute a weighted verdict from an array of perspectives.
 *
 * Used by provider implementations that collect individual votes and
 * need to aggregate them into a single verdict. Exported for composability.
 *
 * @param perspectives - Individual participant perspectives
 * @param threshold - Weighted support share needed for "approved" (0-1)
 * @returns Computed verdict + aggregate confidence
 */
export function aggregatePerspectives(
	perspectives: SabhaDeliberatePerspective[],
	threshold = DEFAULT_THRESHOLD,
): Pick<SabhaDeliberateResult, "verdict" | "confidence"> {
	if (perspectives.length === 0) {
		return { verdict: "no-consensus", confidence: 0 };
	}

	let supportWeight = 0;
	let opposeWeight = 0;
	let totalWeight = 0;

	for (const p of perspectives) {
		const w = Math.max(0, Math.min(1, p.weight));
		totalWeight += w;
		if (p.position === "support") supportWeight += w;
		else if (p.position === "oppose") opposeWeight += w;
	}

	if (totalWeight === 0) return { verdict: "no-consensus", confidence: 0 };

	const supportShare = supportWeight / totalWeight;
	const opposeShare = opposeWeight / totalWeight;

	if (supportShare >= threshold) {
		return { verdict: "approved", confidence: supportShare };
	}
	if (opposeShare >= threshold) {
		return { verdict: "rejected", confidence: opposeShare };
	}
	return { verdict: "no-consensus", confidence: Math.max(supportShare, opposeShare) };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalize raw verdict string to a valid SabhaVerdict. */
function normalizeVerdict(raw: string): SabhaVerdict {
	const v = (raw ?? "").toLowerCase().trim();
	if (v === "approved" || v === "approve") return "approved";
	if (v === "rejected" || v === "reject") return "rejected";
	return "no-consensus";
}
