/**
 * @chitragupta/smriti — Day Consolidation Renderer
 *
 * Generates the consolidated day-file markdown from project activity data
 * and event chains. Extracted from day-consolidation.ts to keep files
 * under 450 LOC.
 */

import type { SessionTurn } from "./types.js";
import type { EventChain, SessionEvent } from "./event-extractor.js";
import type { SessionMeta } from "./types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** A project's activity for the day (enriched by event extractor). */
export interface ProjectDayActivity {
	project: string;
	branch: string | null;
	providers: Set<string>;
	sessions: SessionMeta[];
	eventChains: EventChain[];
	turns: Array<SessionTurn & { sessionId: string; createdAt: number }>;
	filesModified: Set<string>;
}

// ─── Markdown Generation ────────────────────────────────────────────────────

/**
 * Generate the consolidated day file markdown.
 * Uses event chains for structured, type-aware content.
 *
 * @param date - Date in YYYY-MM-DD format.
 * @param projectMap - Map of project key to its day activity.
 * @param sessionCount - Total sessions for the day.
 * @param totalTurns - Total conversation turns for the day.
 * @param facts - Extracted facts for the global memory section.
 * @returns Rendered markdown string.
 */
export function generateDayMarkdown(
	date: string,
	projectMap: Map<string, ProjectDayActivity>,
	sessionCount: number,
	totalTurns: number,
	facts: string[],
): string {
	const lines: string[] = [];

	// Header
	const dayName = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long" });
	lines.push(`# ${date} — ${dayName}`);
	lines.push("");
	lines.push(`> ${sessionCount} sessions | ${projectMap.size} projects | ${totalTurns} turns`);
	lines.push("");

	// Facts section (if any)
	if (facts.length > 0) {
		lines.push("## Facts Learned");
		lines.push("");
		for (const fact of facts) {
			lines.push(`- ${fact}`);
		}
		lines.push("");
	}

	// Per-project sections
	for (const [, activity] of projectMap) {
		renderProjectSection(lines, activity);
	}

	// Footer
	lines.push("---");
	lines.push(`*Consolidated by Chitragupta at ${new Date().toISOString()}*`);
	lines.push("");

	return lines.join("\n");
}

/**
 * Render a single project section into the lines array.
 *
 * @param lines - Mutable array of markdown lines to append to.
 * @param activity - The project's day activity data.
 */
function renderProjectSection(lines: string[], activity: ProjectDayActivity): void {
	lines.push(`## Project: ${activity.project}`);
	lines.push("");

	// Metadata
	const meta: string[] = [];
	if (activity.branch) meta.push(`**Branch**: ${activity.branch}`);
	meta.push(`**Providers**: ${[...activity.providers].join(", ")}`);
	meta.push(`**Sessions**: ${activity.sessions.length}`);
	if (activity.filesModified.size > 0) {
		meta.push(`**Files Modified**: ${activity.filesModified.size}`);
	}
	lines.push(meta.join(" | "));
	lines.push("");

	// Per-session sections with event chain narratives
	for (let i = 0; i < activity.sessions.length; i++) {
		const session = activity.sessions[i];
		const chain = activity.eventChains[i];
		renderSessionSection(lines, session, chain, activity);
	}

	// Tool usage summary (aggregated from event chains)
	renderToolUsage(lines, activity.eventChains);

	// Files modified
	if (activity.filesModified.size > 0) {
		lines.push("### Files Modified");
		lines.push("");
		for (const f of activity.filesModified) {
			lines.push(`- ${f}`);
		}
		lines.push("");
	}
}

/**
 * Render a single session section into the lines array.
 */
function renderSessionSection(
	lines: string[],
	session: SessionMeta,
	chain: EventChain | undefined,
	activity: ProjectDayActivity,
): void {
	const time = new Date(session.created).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
	const provider = (session.metadata?.provider as string) ?? session.agent ?? "unknown";
	const turnCount = activity.turns.filter((t) => t.sessionId === session.id).length;

	lines.push(`### Session: ${session.id}`);
	lines.push(`*${time} | ${provider} | ${turnCount} turns | ${chain?.sessionType ?? "unknown"} session*`);
	lines.push("");

	// Event chain narrative (the gist)
	if (chain) {
		// Narrative summary line
		if (chain.narrative) {
			lines.push(`> ${chain.narrative}`);
			lines.push("");
		}

		// Topics discussed
		if (chain.topics.length > 0) {
			lines.push(`**Topics**: ${chain.topics.slice(0, 5).join(", ")}`);
			lines.push("");
		}

		// Key events (decisions, errors, commits — not every action)
		const keyEvents = chain.events.filter((e) =>
			e.type === "decision" || e.type === "error" || e.type === "commit" ||
			e.type === "fact" || e.type === "preference",
		);
		if (keyEvents.length > 0) {
			for (const event of keyEvents.slice(0, 10)) {
				const icon = eventIcon(event.type);
				lines.push(`- ${icon} ${event.summary}`);
			}
			lines.push("");
		}
	}
}

/**
 * Render aggregated tool usage from event chains.
 */
function renderToolUsage(lines: string[], eventChains: EventChain[]): void {
	const toolCounts = new Map<string, number>();
	for (const chain of eventChains) {
		for (const event of chain.events) {
			if (event.tool) {
				toolCounts.set(event.tool, (toolCounts.get(event.tool) ?? 0) + 1);
			}
		}
	}
	if (toolCounts.size > 0) {
		lines.push("### Tools Used");
		lines.push("");
		for (const [tool, count] of toolCounts) {
			lines.push(`- **${tool}**: ${count} calls`);
		}
		lines.push("");
	}
}

/**
 * Map event types to markdown icons/labels.
 *
 * @param type - The session event type.
 * @returns A markdown-formatted label string.
 */
export function eventIcon(type: SessionEvent["type"]): string {
	switch (type) {
		case "decision": return "**Decision**:";
		case "error": return "**Error**:";
		case "commit": return "**Commit**:";
		case "fact": return "**Fact**:";
		case "preference": return "**Pref**:";
		case "question": return "**Q**:";
		case "action": return "**Action**:";
		case "topic": return "**Topic**:";
		case "problem": return "**Problem**:";
		default: return "-";
	}
}
