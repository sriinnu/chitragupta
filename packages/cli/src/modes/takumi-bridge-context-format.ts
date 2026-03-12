import {
	normalizeContextForReuse,
	packContextWithFallback,
} from "../context-packing.js";
import type { TakumiContext } from "./takumi-bridge-types.js";

export const MAX_REPO_MAP_CHARS = 4_000;
export const MAX_HINT_CHARS = 280;
export const MAX_HINT_COUNT = 8;
export const MAX_FILE_CONTEXT_FILES = 3;
export const MAX_FILE_CONTEXT_CHARS = 1_200;
export const MAX_PACKED_CONTEXT_CHARS = 1_800;
export const MAX_PACKED_HINT_CHARS = 1_400;
export const MIN_PACK_HINT_SECTION_CHARS = 420;
export const MIN_PACK_HINT_SECTION_ITEMS = 4;

/**
 * Build the human-readable prompt block that carries Chitragupta context into Takumi.
 * This is the high-signal prompt representation of the structured route envelope and hints.
 */
export async function buildTakumiPrompt(
	task: string,
	projectPath: string,
	context?: TakumiContext,
): Promise<string> {
	const trimmedTask = task.trim();
	if (!context) return trimmedTask;

	const sections: string[] = [
		"Use the following Chitragupta context when it helps complete the task.",
		`Project root: ${projectPath}`,
	];

	if (isFreshContext(context)) {
		sections.unshift(
			"Fresh mode is required for this run. Do not rely on cached summaries or stale assumptions. Re-read the relevant files and base your answer on the current workspace state.",
		);
	}

	if (context.repoMap) {
		sections.push(
			await formatPackedSection({
				title: "Repo map",
				text: context.repoMap,
				maxChars: MAX_REPO_MAP_CHARS,
			}),
		);
	}
	if (context.episodicHints?.length) {
		sections.push(await formatHintSection("Episodic hints", context.episodicHints));
	}
	if (context.recentDecisions?.length) {
		sections.push(await formatHintSection("Recent decisions", context.recentDecisions));
	}
	if (context.fileContext) {
		const files = Object.entries(context.fileContext)
			.slice(0, MAX_FILE_CONTEXT_FILES)
			.map(([path, content]) => `File: ${path}\n${truncate(content, MAX_FILE_CONTEXT_CHARS)}`);
		if (files.length > 0) {
			sections.push(
				await formatPackedSection({
					title: "Relevant file excerpts",
					text: files.join("\n\n"),
					maxChars: MAX_PACKED_CONTEXT_CHARS,
				}),
			);
		}
	}
	if (context.engineRoute) {
		sections.push(`Engine route:\n${formatEngineRouteSummary(context.engineRoute)}`);
	}
	if (context.engineRouteEnvelope?.lanes.length) {
		const envelopeLines = [
			`Primary lane: ${context.engineRouteEnvelope.primaryKey}`,
			...context.engineRouteEnvelope.lanes.map(
				(lane) => `${lane.key}:\n${indentBlock(formatEngineRouteSummary(lane))}`,
			),
		].join("\n\n");
		sections.push(
			await formatPackedSection({
				title: "Engine lane envelope",
				text: envelopeLines,
				maxChars: MAX_PACKED_CONTEXT_CHARS,
			}),
		);
	}

	return `${trimmedTask}\n\n## Chitragupta Context\n${sections.join("\n\n")}`.trim();
}

async function formatPackedSection(args: {
	title: string;
	text: string;
	maxChars: number;
}): Promise<string> {
	const normalized = await normalizeContextForReuse(args.text);
	const sourceText = typeof normalized === "string" && normalized.trim() ? normalized : args.text;
	const packed = await packContextWithFallback(sourceText);
	if (packed) {
		const packedText = truncate(packed.packedText, args.maxChars);
		return `${args.title} (packed via ${packed.runtime}, saved ${formatSavingsPercent(packed.savings)}):\n${packedText}`;
	}
	return `${args.title}:\n${truncate(sourceText, args.maxChars)}`;
}

async function formatHintSection(title: string, values: string[]): Promise<string> {
	const entries = await Promise.all(values.slice(0, MAX_HINT_COUNT).map((value) => formatHintEntry(value)));
	const raw = entries.map((value) => `- ${value}`).join("\n");
	const shouldPack = entries.length >= MIN_PACK_HINT_SECTION_ITEMS || raw.length >= MIN_PACK_HINT_SECTION_CHARS;
	if (!shouldPack) {
		return `${title}:\n${raw}`;
	}
	return formatPackedSection({
		title,
		text: raw,
		maxChars: MAX_PACKED_HINT_CHARS,
	});
}

function formatSavingsPercent(value: number): string {
	if (!Number.isFinite(value)) return "0%";
	return `${Math.max(0, Math.round(value * 100))}%`;
}

async function formatHintEntry(value: string): Promise<string> {
	const normalized = await normalizeContextForReuse(value);
	const entry = typeof normalized === "string" && normalized.trim() ? normalized : value;
	if (value.startsWith("[PAKT packed ")) {
		return truncate(entry, MAX_PACKED_HINT_CHARS);
	}
	return truncate(entry, MAX_HINT_CHARS);
}

function formatEngineRouteSummary(route: NonNullable<TakumiContext["engineRoute"]>): string {
	const routeBits = [
		route.routeClass ? `routeClass=${route.routeClass}` : null,
		route.capability ? `capability=${route.capability}` : null,
		route.selectedCapabilityId ? `selected=${route.selectedCapabilityId}` : null,
	]
		.filter(Boolean)
		.join(", ");
	const trace = route.policyTrace?.length
		? `\nPolicy trace: ${route.policyTrace.join(" -> ")}`
		: "";
	const reason = route.reason ? `\nReason: ${route.reason}` : "";
	const enforcement =
		route.enforced === true
			? "\nThis engine-selected lane is authoritative. Do not override it with a different model/runtime choice."
			: "";
	const binding = route.executionBinding
		? [
				route.executionBinding.query
					? `\nDiscovery lane: ${route.executionBinding.query.capability}${route.executionBinding.query.mode ? ` (${route.executionBinding.query.mode})` : ""}${route.executionBinding.query.role ? ` [${route.executionBinding.query.role}]` : ""}`
					: "",
				route.executionBinding.selectedProviderId
					? `\nSelected provider: ${route.executionBinding.selectedProviderId}`
					: "",
				route.executionBinding.selectedModelId
					? `\nSelected model: ${route.executionBinding.selectedModelId}`
					: "",
				route.executionBinding.preferredProviderIds?.length
					? `\nPreferred providers: ${route.executionBinding.preferredProviderIds.join(", ")}`
					: "",
				route.executionBinding.preferredModelIds?.length
					? `\nPreferred models: ${route.executionBinding.preferredModelIds.join(", ")}`
					: "",
				route.executionBinding.candidateModelIds?.length
					? `\nAllowed models: ${route.executionBinding.candidateModelIds.join(", ")}`
					: "",
				route.executionBinding.allowCrossProvider === false
					? "\nDo not switch provider families outside the engine-selected set."
					: "",
			].join("")
		: "";
	return `${routeBits || "engine-selected lane"}${reason}${trace}${binding}${enforcement}`.trim();
}

function indentBlock(value: string): string {
	return value
		.split("\n")
		.map((line) => `  ${line}`)
		.join("\n");
}

export function isFreshContext(context?: TakumiContext): boolean {
	return context?.noCache === true || context?.fresh === true;
}

export function resolveCacheIntent(context?: TakumiContext): "default" | "fresh" {
	return isFreshContext(context) ? "fresh" : "default";
}

export function truncate(value: string, maxChars: number): string {
	return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value;
}
