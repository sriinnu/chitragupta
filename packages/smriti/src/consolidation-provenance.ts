/**
 * @chitragupta/smriti — Consolidation provenance metadata.
 *
 * Derived consolidation artifacts must preserve links back to canonical raw
 * sessions. This module provides a small machine-readable metadata envelope
 * embedded directly in markdown artifacts so sync/export keeps provenance with
 * the artifact itself.
 */

import type { SessionMeta } from "./types.js";

const START_MARKER = "<!-- chitragupta:consolidation-metadata";
const END_MARKER = "-->";

export interface SourceSessionReference {
	id: string;
	project: string;
	title: string;
	created: string;
	updated: string;
	provider?: string;
	branch?: string | null;
}

export interface ProjectSessionReference {
	project: string;
	sessionIds: string[];
}

export interface DayConsolidationMetadata {
	kind: "day";
	formatVersion: number;
	date: string;
	generatedAt: string;
	sessionCount: number;
	projectCount: number;
	sourceSessionIds: string[];
	sourceSessions: SourceSessionReference[];
	projects: ProjectSessionReference[];
}

export interface PeriodicConsolidationMetadata {
	kind: "monthly" | "yearly";
	period: string;
	project: string;
	generatedAt: string;
	sourceSessionIds: string[];
	sourceSessions: SourceSessionReference[];
	sourcePeriods?: string[];
}

export type ConsolidationMetadata =
	| DayConsolidationMetadata
	| PeriodicConsolidationMetadata;

export function toSourceSessionReference(meta: SessionMeta): SourceSessionReference {
	return {
		id: meta.id,
		project: meta.project,
		title: meta.title,
		created: meta.created,
		updated: meta.updated,
		provider: meta.provider ?? meta.agent,
		branch: meta.branch ?? null,
	};
}

export function renderConsolidationMetadata(metadata: ConsolidationMetadata): string {
	return `${START_MARKER}\n${JSON.stringify(metadata, null, "\t")}\n${END_MARKER}`;
}

export function parseConsolidationMetadata(markdown: string): ConsolidationMetadata | null {
	const start = markdown.indexOf(START_MARKER);
	if (start === -1) return null;
	const afterStart = start + START_MARKER.length;
	const end = markdown.indexOf(END_MARKER, afterStart);
	if (end === -1) return null;

	const raw = markdown.slice(afterStart, end).trim();
	if (!raw) return null;

	try {
		const parsed = JSON.parse(raw) as Partial<ConsolidationMetadata> | null;
		if (!parsed || typeof parsed !== "object" || typeof parsed.kind !== "string") {
			return null;
		}
		if (parsed.kind === "day" && typeof parsed.date === "string") {
			return parsed as DayConsolidationMetadata;
		}
		if ((parsed.kind === "monthly" || parsed.kind === "yearly") && typeof parsed.period === "string") {
			return parsed as PeriodicConsolidationMetadata;
		}
		return null;
	} catch {
		return null;
	}
}

export function stripConsolidationMetadata(markdown: string): string {
	const start = markdown.indexOf(START_MARKER);
	if (start === -1) return markdown;
	const end = markdown.indexOf(END_MARKER, start + START_MARKER.length);
	if (end === -1) return markdown;

	const stripped = markdown.slice(0, start) + markdown.slice(end + END_MARKER.length);
	return stripped.replace(/^\s+/, "");
}
