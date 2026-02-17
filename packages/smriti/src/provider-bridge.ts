/**
 * @chitragupta/smriti — Provider Bridge
 *
 * Loads relevant memory context when a provider starts a session.
 * This is what makes switching between Claude, Codex, and Vaayu seamless —
 * every provider gets the same memory context.
 *
 * Called on session start, returns a context string for injection
 * into the provider's system prompt or first message.
 */

import type { MemoryScope } from "./types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Context assembled for a provider session. */
export interface ProviderContext {
	/** Global facts (identity, location, preferences). */
	globalFacts: string;
	/** Project-specific memory (decisions, patterns). */
	projectMemory: string;
	/** Recent session summary for continuity. */
	recentContext: string;
	/** Full assembled context string. */
	assembled: string;
	/** Number of memory items loaded. */
	itemCount: number;
}

// ─── Provider Bridge ────────────────────────────────────────────────────────

/**
 * Load memory context for a new provider session.
 *
 * @param project - Project path (optional, for project-specific memory).
 * @param options - Additional options.
 * @returns Assembled context for injection into provider.
 */
export async function loadProviderContext(
	project?: string,
	options?: {
		/** Max recent sessions to summarize. Default: 3. */
		recentSessionLimit?: number;
		/** Max total context length in chars. Default: 4000. */
		maxContextLength?: number;
	},
): Promise<ProviderContext> {
	const maxLen = options?.maxContextLength ?? 4000;
	const recentLimit = options?.recentSessionLimit ?? 3;

	let globalFacts = "";
	let projectMemory = "";
	let recentContext = "";

	// 1. Load global memory (facts, preferences, identity)
	try {
		const { getMemory } = await import("./memory-store.js");
		globalFacts = getMemory({ type: "global" });
		// Trim to reasonable size
		if (globalFacts.length > maxLen / 3) {
			globalFacts = globalFacts.slice(0, maxLen / 3) + "\n...(truncated)";
		}
	} catch {
		// Best-effort
	}

	// 2. Load project memory (if project provided)
	if (project) {
		try {
			const { getMemory } = await import("./memory-store.js");
			projectMemory = getMemory({ type: "project", path: project });
			if (projectMemory.length > maxLen / 3) {
				projectMemory = projectMemory.slice(0, maxLen / 3) + "\n...(truncated)";
			}
		} catch {
			// Best-effort
		}
	}

	// 3. Load top vasanas (learned behavioral patterns)
	let vasanaContext = "";
	try {
		const { VasanaEngine } = await import("./vasana-engine.js");
		const engine = new VasanaEngine();
		const vasanas = engine.getVasanas(project ?? "__global__", 5);
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

				// Get first user message as topic indicator
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

	// Assemble full context
	const parts: string[] = [];
	let itemCount = 0;

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
		assembled: assembled.slice(0, maxLen),
		itemCount,
	};
}
