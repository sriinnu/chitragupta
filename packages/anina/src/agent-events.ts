import type { AgentEventType } from "./types.js";

export function bridgeEventPayload(
	ev: AgentEventType,
	data: Record<string, unknown>,
): { type: string; payload: Record<string, unknown> } | null {
	if (ev === "stream:text" || ev === "stream:thinking") {
		return { type: ev, payload: { text: String(data.text ?? "") } };
	}
	if (ev === "tool:start") {
		return {
			type: ev,
			payload: {
				toolName: String(data.toolName ?? data.name ?? ""),
				input: (data.input ?? {}) as Record<string, unknown>,
			},
		};
	}
	if (ev === "tool:done") {
		return {
			type: ev,
			payload: {
				toolName: String(data.toolName ?? data.name ?? ""),
				durationMs: Number(data.durationMs ?? 0),
				isError: Boolean(data.isError),
			},
		};
	}
	if (ev === "turn:start" || ev === "turn:done") {
		return { type: ev, payload: { turnNumber: Number(data.turnNumber ?? 0) } };
	}
	return null;
}
