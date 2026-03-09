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
import { resolveSessionProvider } from "./provider-labels.js";
import { renderConsolidationMetadata } from "./consolidation-provenance.js";
import type { DayConsolidationMetadata } from "./consolidation-provenance.js";

/** Increment when day-file markdown schema/semantics change. */
export const DAY_CONSOLIDATION_FORMAT_VERSION = 4;

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

interface ProjectSessionView {
	session: SessionMeta;
	chain?: EventChain;
	turnCount: number;
	keyEvents: SessionEvent[];
	toolCount: number;
	filesTouched: string[];
	compact: boolean;
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
	metadata: DayConsolidationMetadata,
): string {
	const lines: string[] = [];

	// Header
	const dayName = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long" });
	lines.push(`# ${date} — ${dayName}`);
	lines.push("");
	lines.push(`> ${sessionCount} sessions | ${projectMap.size} projects | ${totalTurns} turns`);
	lines.push("");
	lines.push(renderConsolidationMetadata(metadata));
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
	lines.push(`*Consolidated by Chitragupta at ${new Date().toISOString()} | format v${DAY_CONSOLIDATION_FORMAT_VERSION}*`);
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
	const sessionViews = buildProjectSessionViews(activity);
	const compactSessions = sessionViews.filter((view) => view.compact);
	const expandedSessions = sessionViews.filter((view) => !view.compact);

	lines.push(`## Project: ${activity.project}`);
	lines.push("");

	// Metadata
	const meta: string[] = [];
	if (activity.branch) meta.push(`**Branch**: ${activity.branch}`);
	meta.push(`**Providers**: ${[...activity.providers].join(", ")}`);
	meta.push(`**Sessions**: ${activity.sessions.length}`);
	if (compactSessions.length > 0) {
		meta.push(`**Compacted Sessions**: ${compactSessions.length}`);
	}
	if (activity.filesModified.size > 0) {
		meta.push(`**Files Modified**: ${activity.filesModified.size}`);
	}
	lines.push(meta.join(" | "));
	lines.push("");

	if (activity.sessions.length > 0) {
		lines.push("### Source Sessions");
		lines.push("");
		for (const session of activity.sessions) {
			const compact = compactSessions.some((view) => view.session.id === session.id);
			const time = new Date(session.created).toLocaleTimeString("en-US", {
				hour: "2-digit",
				minute: "2-digit",
				hour12: false,
			});
			const provider = resolveSessionProvider(session);
			const branch = session.branch ? ` | ${session.branch}` : "";
			const detail = compact ? " | compacted in day view" : "";
			lines.push(`- \`${session.id}\` | ${time} | ${provider}${branch}${detail}`);
		}
		lines.push("");
	}

	// Per-session sections with event chain narratives
	for (const sessionView of expandedSessions) {
		renderSessionSection(lines, sessionView);
	}

	if (compactSessions.length > 0) {
		renderCompactSessionsSection(lines, compactSessions);
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
	sessionView: ProjectSessionView,
): void {
	const { session, chain, turnCount, keyEvents } = sessionView;
	const time = formatSessionTime(session.created);
	const provider = resolveSessionProvider(session);

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
		if (keyEvents.length > 0) {
			for (const event of keyEvents.slice(0, 10)) {
				const icon = eventIcon(event.type);
				lines.push(`- ${icon} ${event.summary}`);
			}
			lines.push("");
		}
	}
}

function renderCompactSessionsSection(lines: string[], compactSessions: ProjectSessionView[]): void {
	lines.push("### Compact Sessions");
	lines.push("");
	lines.push("> Low-signal sessions are compacted here for readability. Raw sessions remain canonical and are preserved in source provenance.");
	lines.push("");
	for (const sessionView of compactSessions) {
		lines.push(`- ${formatCompactSessionLine(sessionView)}`);
	}
	lines.push("");
}

function buildProjectSessionViews(activity: ProjectDayActivity): ProjectSessionView[] {
	return activity.sessions.map((session, index) => {
		const chain = activity.eventChains[index];
		const turnCount = activity.turns.filter((turn) => turn.sessionId === session.id).length;
		const keyEvents = chain?.events.filter(isKeySessionEvent) ?? [];
		const filesTouched = [...new Set(chain?.events.flatMap((event) => event.files ?? []) ?? [])];
		const toolCount = new Set(chain?.events.map((event) => event.tool).filter((tool): tool is string => Boolean(tool)) ?? []).size;
		return {
			session,
			chain,
			turnCount,
			keyEvents,
			toolCount,
			filesTouched,
			compact: shouldCompactSession(activity, turnCount, keyEvents, filesTouched.length, toolCount),
		};
	});
}

function shouldCompactSession(
	activity: ProjectDayActivity,
	turnCount: number,
	keyEvents: SessionEvent[],
	filesTouched: number,
	toolCount: number,
): boolean {
	if (activity.sessions.length <= 1) return false;
	if (turnCount > 4) return false;
	if (keyEvents.length > 0) return false;
	if (filesTouched > 0) return false;
	if (toolCount > 0) return false;
	return true;
}

function isKeySessionEvent(event: SessionEvent): boolean {
	return event.type === "decision" || event.type === "error" || event.type === "commit" ||
		event.type === "fact" || event.type === "preference";
}

function formatCompactSessionLine(sessionView: ProjectSessionView): string {
	const { session, chain, turnCount } = sessionView;
	const time = formatSessionTime(session.created);
	const provider = resolveSessionProvider(session);
	const parts = [`\`${session.id}\``, time, provider, `${turnCount} turns`, chain?.sessionType ?? "unknown"];
	if (chain?.topics.length) {
		parts.push(`topics: ${chain.topics.slice(0, 3).join(", ")}`);
	}
	if (chain?.narrative) {
		parts.push(chain.narrative);
	}
	return parts.join(" | ");
}

function formatSessionTime(createdAt: string): string {
	return new Date(createdAt).toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
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
