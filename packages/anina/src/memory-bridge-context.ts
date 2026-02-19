/**
 * @chitragupta/anina — Memory Bridge context and command handling.
 *
 * Memory context assembly for system prompts and memory CRUD
 * command handling. All functions take explicit dependencies
 * rather than accessing class state directly.
 */

import {
	getMemory,
	extractSignals,
	detectMemoryIntent,
} from "@chitragupta/smriti";
import type { StreamSignals, SmaranCategory } from "@chitragupta/smriti";
import type { StreamManager, SmaranStore, IdentityContext } from "@chitragupta/smriti";

// ─── Memory Context Assembly ────────────────────────────────────────────────

/** Dependencies for building memory context. */
export interface MemoryContextDeps {
	identityContext: IdentityContext | null;
	smaranStore: SmaranStore | null;
	streamManager: StreamManager | null;
}

/**
 * Assemble comprehensive memory context for system prompt injection.
 * Loads identity files, scoped memory, explicit memories, and 4-stream signals.
 */
export function buildMemoryContext(
	project: string,
	agentId: string,
	deps: MemoryContextDeps,
): string {
	const sections: string[] = [];

	// Identity files (SOUL.md, IDENTITY.md, personality.md, USER.md)
	if (deps.identityContext) {
		const identitySection = deps.identityContext.load();
		if (identitySection) sections.push(identitySection);
	}

	// Scoped memory (global, project, agent)
	const globalMemory = getMemory({ type: "global" });
	const projectMemory = getMemory({ type: "project", path: project });
	const agentMemory = getMemory({ type: "agent", agentId });

	if (globalMemory || projectMemory || agentMemory) {
		sections.push("## Memory Context", "");
		if (globalMemory) sections.push("### Global Knowledge", globalMemory, "");
		if (projectMemory) sections.push("### Project Knowledge", projectMemory, "");
		if (agentMemory) sections.push("### Agent Notes", agentMemory, "");
	}

	// Explicit memory (Smaran)
	if (deps.smaranStore) {
		deps.smaranStore.decayConfidence();
		const smaranSection = deps.smaranStore.buildContextSection();
		if (smaranSection) sections.push(smaranSection);
	}

	// 4-Stream memory
	if (deps.streamManager) {
		const id = deps.streamManager.readContent("identity");
		const proj = deps.streamManager.readContent("projects");
		const tasks = deps.streamManager.readContent("tasks");
		if (id) sections.push("### Identity Memory", id.slice(0, 2000), "");
		if (proj) sections.push("### Project Decisions", proj.slice(0, 2000), "");
		if (tasks) sections.push("### Active Tasks", tasks.slice(0, 1000), "");
	}

	// Memory instructions
	if (deps.smaranStore) {
		sections.push(
			"## Memory Capabilities", "",
			"You have an explicit memory system. When the user says:",
			'- "remember that..." / "note that..." → Save to memory immediately',
			'- "forget..." / "delete memory..." → Remove from memory',
			'- "what do you remember about..." → Recall from memory',
			'- "list my preferences" → Show stored preferences', "",
			"When you recall relevant memories during a conversation, use them proactively:",
			"- If the user asks about restaurants and you know their food preferences, suggest accordingly",
			"- If the user mentions a topic you have memories about, reference them naturally",
			"- Always acknowledge when you're using stored memories", "",
		);
	}

	return sections.join("\n");
}

// ─── Memory Command Handling ────────────────────────────────────────────────

/**
 * Process a user message for memory commands (remember, forget, recall, list).
 * Returns a response string if handled, null otherwise.
 */
export function handleMemoryCommand(
	userMessage: string,
	smaranStore: SmaranStore | null,
	sessionId?: string,
): string | null {
	if (!smaranStore) return null;
	const intent = detectMemoryIntent(userMessage);
	if (!intent) return null;

	switch (intent.action) {
		case "remember": {
			if (!intent.content) return null;
			const entry = smaranStore.remember(
				intent.content, intent.category ?? "fact",
				{ sessionId, source: "explicit" },
			);
			return `Remembered: "${entry.content}" (${entry.category}). ID: ${entry.id}`;
		}
		case "forget": {
			if (!intent.query) return null;
			const count = smaranStore.forgetByContent(intent.query);
			return count > 0
				? `Forgot ${count} memory${count > 1 ? " entries" : ""} matching "${intent.query}".`
				: `No memories found matching "${intent.query}".`;
		}
		case "recall": {
			if (!intent.query) return null;
			const memories = smaranStore.recall(intent.query, 5);
			if (memories.length === 0) return `I don't have any memories about "${intent.query}".`;
			const lines = memories.map(m => `- **${m.category}**: ${m.content}`);
			return `Here's what I remember about "${intent.query}":\n${lines.join("\n")}`;
		}
		case "list": {
			const entries = intent.category
				? smaranStore.listByCategory(intent.category)
				: smaranStore.listAll();
			if (entries.length === 0) {
				return `No memories stored${intent.category ? ` in category "${intent.category}"` : ""}.`;
			}
			const lines = entries.slice(0, 20).map(m =>
				`- [${m.category}] ${m.content} (confidence: ${m.confidence.toFixed(1)})`,
			);
			return `**Stored memories (${intent.category ?? "all"}):** ${entries.length} total\n${lines.join("\n")}`;
		}
		default: return null;
	}
}

// ─── Signal Persistence ─────────────────────────────────────────────────────

/** Persist extracted 4-stream signals to the stream manager. */
export function persistSignals(signals: StreamSignals, streamManager: StreamManager | null): void {
	if (!streamManager) return;
	try {
		for (const entry of signals.identity) streamManager.append("identity", entry + "\n");
		for (const entry of signals.projects) streamManager.append("projects", entry + "\n");
		for (const entry of signals.tasks) streamManager.append("tasks", entry + "\n");
		if (signals.flow.length <= 5) {
			for (const entry of signals.flow) streamManager.append("flow", entry + "\n");
		}
	} catch { /* Non-fatal */ }
}
