/**
 * @chitragupta/smriti — Provider Bridge
 *
 * Loads relevant memory context when a provider starts a session.
 * This is what makes switching between Claude, Codex, and Vaayu seamless —
 * every provider gets the same memory context.
 *
 * Adaptive context budget: scales with provider's context window size.
 * Interrupted session detection: surfaces recently abandoned conversations
 * for cross-device continuity.
 *
 * Called on session start, returns a context string for injection
 * into the provider's system prompt or first message.
 */

import type { MemoryScope, SessionMeta, Session } from "./types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Context assembled for a provider session. */
export interface ProviderContext {
	/** Global facts (identity, location, preferences). */
	globalFacts: string;
	/** Project-specific memory (decisions, patterns). */
	projectMemory: string;
	/** Recent session summary for continuity. */
	recentContext: string;
	/** Interrupted session handover (if detected). */
	interruptedSession: string;
	/** Full assembled context string. */
	assembled: string;
	/** Number of memory items loaded. */
	itemCount: number;
}

/** Options for context loading with adaptive budget. */
export interface ContextOptions {
	/** Max recent sessions to summarize. Default: 3. */
	recentSessionLimit?: number;
	/** Max total context length in chars. Default: adaptive based on providerContextWindow. */
	maxContextLength?: number;
	/**
	 * Provider's context window size in tokens. Used to compute adaptive budget.
	 * ~4 chars per token assumed. Default: 8192 (conservative).
	 * Examples: Claude 200K = 200000, GPT-4 = 128000, small models = 4096.
	 */
	providerContextWindow?: number;
	/** Device identifier for cross-device session pickup. */
	deviceId?: string;
	/** User identity token for cross-device session matching. */
	userId?: string;
}

// ─── Adaptive Budget ─────────────────────────────────────────────────────────

/** Context budget tier based on provider's context window. */
interface ContextBudget {
	/** Total character budget for assembled context. */
	totalChars: number;
	/** Max recent sessions to include. */
	recentSessions: number;
	/** Max vasanas to include. */
	vasanaCount: number;
	/** Hours to look back for interrupted sessions. */
	interruptedLookbackHours: number;
}

/**
 * Compute adaptive context budget from provider's context window.
 *
 * Allocates ~2% of the provider's token budget to memory context.
 * Scales session count and vasana count with budget tier.
 *
 * @param providerTokens - Provider's context window in tokens.
 * @returns Adaptive budget parameters.
 */
function computeBudget(providerTokens: number): ContextBudget {
	// ~4 chars per token, allocate 2% of context window to memory
	const totalChars = Math.max(2000, Math.min(50_000, Math.floor(providerTokens * 4 * 0.02)));

	if (providerTokens >= 100_000) {
		// Large context (Claude 200K, Gemini 1M): rich context injection
		return { totalChars, recentSessions: 5, vasanaCount: 8, interruptedLookbackHours: 8 };
	}
	if (providerTokens >= 32_000) {
		// Medium context (GPT-4 128K, Claude Haiku): balanced
		return { totalChars, recentSessions: 3, vasanaCount: 5, interruptedLookbackHours: 6 };
	}
	// Small context (< 32K): lean injection
	return { totalChars, recentSessions: 2, vasanaCount: 3, interruptedLookbackHours: 4 };
}

/**
 * Allocate character budget across sections proportionally to content availability.
 *
 * Instead of fixed 1/3 splits, gives more space to sections with more content
 * and doesn't waste budget on empty sections.
 *
 * @param sections - Map of section name → raw content length.
 * @param totalBudget - Total character budget.
 * @returns Map of section name → allocated character budget.
 */
function allocateBudget(
	sections: Map<string, number>,
	totalBudget: number,
): Map<string, number> {
	const result = new Map<string, number>();
	const totalContent = [...sections.values()].reduce((a, b) => a + b, 0);

	if (totalContent === 0) return result;

	// If total content fits within budget, no truncation needed
	if (totalContent <= totalBudget) {
		for (const [name, len] of sections) result.set(name, len);
		return result;
	}

	// Proportional allocation with minimum floor of 200 chars per section
	const MIN_SECTION = 200;
	const activeSections = [...sections.entries()].filter(([, len]) => len > 0);
	const floorTotal = activeSections.length * MIN_SECTION;
	const distributable = Math.max(0, totalBudget - floorTotal);

	for (const [name, len] of activeSections) {
		const share = totalContent > 0 ? (len / totalContent) * distributable : 0;
		result.set(name, Math.floor(MIN_SECTION + share));
	}

	return result;
}

// ─── Interrupted Session Detection ──────────────────────────────────────────

/**
 * Detect recently interrupted sessions — conversations that ended abruptly
 * without a natural conclusion. Used for cross-device pickup.
 *
 * Heuristics for "interrupted":
 * - Session updated within lookback window
 * - Last turn was from the user (assistant didn't respond) OR
 * - Last assistant turn mentions "continuing", "next step", or ends with incomplete thought
 * - Session has no handover marker
 */
async function detectInterruptedSession(
	project: string | undefined,
	lookbackHours: number,
): Promise<string> {
	try {
		const { listSessions, loadSession } = await import("./session-store.js");
		const sessions = project
			? listSessions(project).slice(0, 10)
			: listSessions().slice(0, 10);

		const cutoff = Date.now() - lookbackHours * 3600_000;

		for (const meta of sessions) {
			const updatedMs = new Date(meta.updated).getTime();
			if (updatedMs < cutoff) continue;

			try {
				const session = loadSession(meta.id, meta.project);
				if (session.turns.length < 2) continue;

				const lastTurn = session.turns[session.turns.length - 1];
				const hasHandover = session.turns.some((t) =>
					t.content.includes("[handover]") || t.content.includes("chitragupta_handover"),
				);
				if (hasHandover) continue;

				// Interrupted if last turn was user (no response) or assistant was mid-thought
				const isInterrupted = lastTurn.role === "user" ||
					/\b(next|continuing|will now|let me|todo|then we)\b/i.test(
						lastTurn.content.slice(-200),
					);

				if (!isInterrupted) continue;

				// Build interruption summary
				const gapMs = Date.now() - updatedMs;
				const gapHours = (gapMs / 3600_000).toFixed(1);
				const date = meta.created.slice(0, 10);
				const time = meta.updated.slice(11, 16);

				// Get last 2 meaningful turns for context
				const recentTurns = session.turns.slice(-3)
					.map((t) => `[${t.role}]: ${t.content.slice(0, 150)}`)
					.join("\n  ");

				return `**Interrupted Session** (${gapHours}h ago, ${date} at ${time})\n` +
					`Session: ${meta.title || meta.id}\n` +
					`Last exchange:\n  ${recentTurns}`;
			} catch {
				// Skip unloadable
			}
		}
	} catch {
		// Best-effort
	}
	return "";
}

// ─── Truncation Helper ──────────────────────────────────────────────────────

/** Truncate text to budget, preferring to break at line boundaries. */
function truncateTobudget(text: string, budget: number): string {
	if (text.length <= budget) return text;
	// Try to break at last newline within budget
	const truncated = text.slice(0, budget);
	const lastNewline = truncated.lastIndexOf("\n");
	if (lastNewline > budget * 0.7) {
		return truncated.slice(0, lastNewline) + "\n...(truncated)";
	}
	return truncated + "\n...(truncated)";
}

// ─── Provider Bridge ────────────────────────────────────────────────────────

/**
 * Load memory context for a new provider session.
 *
 * Uses adaptive context budget based on provider's context window size.
 * Allocates budget proportionally across sections (no fixed 1/3 splits).
 * Detects interrupted sessions for cross-device continuity.
 *
 * @param project - Project path (optional, for project-specific memory).
 * @param options - Context loading options with adaptive budget support.
 * @returns Assembled context for injection into provider.
 */
export async function loadProviderContext(
	project?: string,
	options?: ContextOptions,
): Promise<ProviderContext> {
	const providerTokens = options?.providerContextWindow ?? 8192;
	const budget = computeBudget(providerTokens);

	const maxLen = options?.maxContextLength ?? budget.totalChars;
	const recentLimit = options?.recentSessionLimit ?? budget.recentSessions;

	let globalFacts = "";
	let projectMemory = "";
	let recentContext = "";
	let vasanaContext = "";
	let interruptedSession = "";

	// 1. Load global memory (facts, preferences, identity)
	try {
		const { getMemory } = await import("./memory-store.js");
		globalFacts = getMemory({ type: "global" });
	} catch {
		// Best-effort
	}

	// 2. Load project memory (if project provided)
	if (project) {
		try {
			const { getMemory } = await import("./memory-store.js");
			projectMemory = getMemory({ type: "project", path: project });
		} catch {
			// Best-effort
		}
	}

	// 3. Load top vasanas (learned behavioral patterns)
	try {
		const { VasanaEngine } = await import("./vasana-engine.js");
		const engine = new VasanaEngine();
		const vasanas = engine.getVasanas(project ?? "__global__", budget.vasanaCount);
		if (vasanas.length > 0) {
			vasanaContext = vasanas.map((v) =>
				`- ${v.tendency} (strength: ${(v.strength * 100).toFixed(0)}%): ${v.description}`,
			).join("\n");
		}
	} catch {
		// Best-effort
	}

	// 4. Load recent sessions for continuity
	try {
		const { listSessions, loadSession } = await import("./session-store.js");
		const sessions = project
			? listSessions(project).slice(0, recentLimit)
			: listSessions().slice(0, recentLimit);

		const summaries: string[] = [];
		for (const meta of sessions) {
			try {
				const session = loadSession(meta.id, meta.project);
				const date = meta.created.slice(0, 10);
				const provider = (meta.metadata?.provider as string) ?? meta.agent;
				const turnCount = session.turns.length;

				const firstUser = session.turns.find((t) => t.role === "user");
				const topic = firstUser
					? firstUser.content.slice(0, 100)
					: meta.title;

				summaries.push(`- ${date} (${provider}, ${turnCount} turns): ${topic}`);
			} catch {
				// Skip unloadable
			}
		}

		if (summaries.length > 0) {
			recentContext = summaries.join("\n");
		}
	} catch {
		// Best-effort
	}

	// 5. Detect interrupted sessions for cross-device pickup
	interruptedSession = await detectInterruptedSession(
		project,
		budget.interruptedLookbackHours,
	);

	// ─── Adaptive Budget Allocation ──────────────────────────────────────
	// Allocate budget proportionally to available content (no fixed 1/3 splits)
	const rawSections = new Map<string, number>([
		["globalFacts", globalFacts.length],
		["projectMemory", projectMemory.length],
		["recentContext", recentContext.length],
		["vasanaContext", vasanaContext.length],
		["interruptedSession", interruptedSession.length],
	]);

	const allocated = allocateBudget(rawSections, maxLen);

	// Apply budget to each section
	globalFacts = truncateTobudget(globalFacts, allocated.get("globalFacts") ?? 0);
	projectMemory = truncateTobudget(projectMemory, allocated.get("projectMemory") ?? 0);
	recentContext = truncateTobudget(recentContext, allocated.get("recentContext") ?? 0);
	vasanaContext = truncateTobudget(vasanaContext, allocated.get("vasanaContext") ?? 0);
	interruptedSession = truncateTobudget(interruptedSession, allocated.get("interruptedSession") ?? 0);

	// ─── Assemble Context ────────────────────────────────────────────────
	const parts: string[] = [];
	let itemCount = 0;

	// Interrupted session goes FIRST — most actionable context
	if (interruptedSession.trim()) {
		parts.push("## Interrupted Conversation\n" + interruptedSession.trim());
		itemCount += 1;
	}

	if (globalFacts.trim()) {
		parts.push("## Known Facts\n" + globalFacts.trim());
		itemCount += globalFacts.split("\n").filter((l) => l.trim()).length;
	}

	if (projectMemory.trim()) {
		parts.push("## Project Context\n" + projectMemory.trim());
		itemCount += projectMemory.split("\n").filter((l) => l.trim()).length;
	}

	if (recentContext.trim()) {
		parts.push("## Recent Sessions\n" + recentContext.trim());
		itemCount += recentContext.split("\n").filter((l) => l.trim()).length;
	}

	if (vasanaContext.trim()) {
		parts.push("## Behavioral Patterns\n" + vasanaContext.trim());
		itemCount += vasanaContext.split("\n").filter((l) => l.trim()).length;
	}

	const assembled = parts.join("\n\n");

	return {
		globalFacts: globalFacts.trim(),
		projectMemory: projectMemory.trim(),
		recentContext: recentContext.trim(),
		interruptedSession: interruptedSession.trim(),
		assembled: assembled.slice(0, maxLen),
		itemCount,
	};
}
