export interface MeshPerspectiveReply {
	summary?: unknown;
	reasoning?: unknown;
	position?: unknown;
	recommendedAction?: unknown;
	evidence?: unknown;
	metadata?: unknown;
}

export interface SabhaConsultPayload {
	type?: unknown;
	sabhaId?: unknown;
	topic?: unknown;
	participantId?: unknown;
	convener?: unknown;
	status?: unknown;
	project?: unknown;
	sessionId?: unknown;
}

export function asConsultPayload(value: unknown): SabhaConsultPayload | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	return value as SabhaConsultPayload;
}

export function trimString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function compactWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

export function evidenceDetail(text: string, maxLength = 180): string {
	const clean = compactWhitespace(text);
	if (clean.length <= maxLength) return clean;
	return `${clean.slice(0, maxLength - 1).trimEnd()}…`;
}

export function buildObserveReply(params: {
	summary: string;
	reasoning: string;
	recommendedAction?: string;
	evidence?: Array<{ label: string; detail: string; source?: string }>;
	metadata?: Record<string, unknown>;
}): MeshPerspectiveReply {
	return {
		summary: params.summary,
		reasoning: params.reasoning,
		position: "observe",
		recommendedAction: params.recommendedAction ?? null,
		evidence: params.evidence ?? [],
		metadata: params.metadata ?? {},
	};
}
