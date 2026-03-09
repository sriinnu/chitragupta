import type { DaemonAnomalyAlert, SharedRegressionSignal } from "./mcp-subsystems-lucy-types.js";

export function normalizeSeverity(value: unknown): "info" | "warning" | "critical" {
	const normalized = String(value ?? "warning").toLowerCase();
	if (normalized === "critical") return "critical";
	if (normalized === "info") return "info";
	return "warning";
}

function extractSignalEntity(details: Record<string, unknown>, type: string): string {
	if (typeof details.entity === "string" && details.entity.trim()) return details.entity.trim();
	if (typeof details.tool === "string" && details.tool.trim()) return details.tool.trim();
	if (typeof details.probe === "string" && details.probe.trim()) return details.probe.trim();
	return type || "scarlett";
}

export function buildLiveRegressionSignal(params: DaemonAnomalyAlert): SharedRegressionSignal | null {
	const details =
		typeof params.details === "object" && params.details !== null
			? params.details as Record<string, unknown>
			: {};
	const type = typeof params.type === "string" ? params.type : "";
	const entity = extractSignalEntity(details, type);
	if (!entity) return null;
	const severity = normalizeSeverity(params.severity ?? details.severity);
	const description =
		typeof params.suggestion === "string" && params.suggestion
			? params.suggestion
			: typeof details.summary === "string" && details.summary
				? details.summary
				: typeof details.title === "string" && details.title
					? details.title
					: type || "scarlett alert";
	const now = Date.now();
	return {
		errorSignature: entity,
		description: String(description),
		currentOccurrences: severity === "critical" ? 5 : severity === "warning" ? 3 : 1,
		previousOccurrences: 0,
		severity,
		lastSeenBefore: new Date(Math.max(0, now - 60_000)).toISOString(),
		detectedAt: new Date(now).toISOString(),
	};
}
