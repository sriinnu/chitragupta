import { packContextWithFallback } from "../context-packing.js";
import type { TakumiContext, TakumiResponse } from "./takumi-bridge-types.js";

export const MAX_REPO_MAP_CHARS = 4_000;
export const MAX_HINT_CHARS = 280;
export const MAX_HINT_COUNT = 8;
export const MAX_FILE_CONTEXT_FILES = 3;
export const MAX_FILE_CONTEXT_CHARS = 1_200;
export const MAX_PACKED_CONTEXT_CHARS = 1_800;
export const MAX_PACKED_HINT_CHARS = 1_400;

export function buildContextEnv(context?: TakumiContext): Record<string, string> {
	if (!context) return {};
	const env: Record<string, string> = {};

	if (isFreshContext(context)) {
		env.CHITRAGUPTA_NO_CACHE = "1";
		env.CHITRAGUPTA_FRESH = "1";
	}
	if (context.episodicHints?.length) {
		env.CHITRAGUPTA_EPISODIC_HINTS = JSON.stringify(context.episodicHints);
	}
	if (context.recentDecisions?.length) {
		env.CHITRAGUPTA_RECENT_DECISIONS = JSON.stringify(context.recentDecisions);
	}
	if (context.fileContext && Object.keys(context.fileContext).length > 0) {
		env.CHITRAGUPTA_FILE_CONTEXT = JSON.stringify(context.fileContext);
	}
	if (context.engineRoute) {
		env.CHITRAGUPTA_ENGINE_ROUTE = JSON.stringify(context.engineRoute);
		if (context.engineRoute.routeClass) {
			env.CHITRAGUPTA_ROUTE_CLASS = context.engineRoute.routeClass;
		}
		if (context.engineRoute.capability) {
			env.CHITRAGUPTA_ROUTE_CAPABILITY = context.engineRoute.capability;
		}
		if (context.engineRoute.selectedCapabilityId) {
			env.CHITRAGUPTA_SELECTED_CAPABILITY_ID = context.engineRoute.selectedCapabilityId;
		}
		if (context.engineRoute.enforced === true) {
			env.CHITRAGUPTA_ENGINE_ROUTE_ENFORCED = "1";
		}
	}
	return env;
}

export async function buildPrompt(
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
		const repoMapSection = await formatPackedSection({
			title: "Repo map",
			text: context.repoMap,
			maxChars: MAX_REPO_MAP_CHARS,
		});
		sections.push(repoMapSection);
	}
	if (context.episodicHints?.length) {
		const hints = context.episodicHints
			.slice(0, MAX_HINT_COUNT)
			.map((hint) => `- ${formatHintEntry(hint)}`)
			.join("\n");
		sections.push(`Episodic hints:\n${hints}`);
	}
	if (context.recentDecisions?.length) {
		const decisions = context.recentDecisions
			.slice(0, MAX_HINT_COUNT)
			.map((decision) => `- ${formatHintEntry(decision)}`)
			.join("\n");
		sections.push(`Recent decisions:\n${decisions}`);
	}
	if (context.fileContext) {
		const files = Object.entries(context.fileContext)
			.slice(0, MAX_FILE_CONTEXT_FILES)
			.map(([path, content]) => `File: ${path}\n${truncate(content, MAX_FILE_CONTEXT_CHARS)}`);
		if (files.length > 0) {
			const fileSection = await formatPackedSection({
				title: "Relevant file excerpts",
				text: files.join("\n\n"),
				maxChars: MAX_PACKED_CONTEXT_CHARS,
			});
			sections.push(fileSection);
		}
	}
	if (context.engineRoute) {
		const routeBits = [
			context.engineRoute.routeClass ? `routeClass=${context.engineRoute.routeClass}` : null,
			context.engineRoute.capability ? `capability=${context.engineRoute.capability}` : null,
			context.engineRoute.selectedCapabilityId ? `selected=${context.engineRoute.selectedCapabilityId}` : null,
		].filter(Boolean).join(", ");
		const trace = context.engineRoute.policyTrace?.length
			? `\nPolicy trace: ${context.engineRoute.policyTrace.join(" -> ")}`
			: "";
		const reason = context.engineRoute.reason ? `\nReason: ${context.engineRoute.reason}` : "";
		const enforcement = context.engineRoute.enforced === true
			? "\nThis engine-selected lane is authoritative. Do not override it with a different model/runtime choice."
			: "";
		sections.push(`Engine route:\n${routeBits || "engine-selected lane"}${reason}${trace}${enforcement}`);
	}

	return `${trimmedTask}\n\n## Chitragupta Context\n${sections.join("\n\n")}`.trim();
}

async function formatPackedSection(args: {
	title: string;
	text: string;
	maxChars: number;
}): Promise<string> {
	const packed = await packContextWithFallback(args.text);
	if (packed) {
		const packedText = truncate(packed.packedText, args.maxChars);
		return `${args.title} (packed via ${packed.runtime}, saved ${formatSavingsPercent(packed.savings)}):\n${packedText}`;
	}
	return `${args.title}:\n${truncate(args.text, args.maxChars)}`;
}

function formatSavingsPercent(value: number): string {
	if (!Number.isFinite(value)) return "0%";
	return `${Math.max(0, Math.round(value * 100))}%`;
}

function formatHintEntry(value: string): string {
	if (value.startsWith("[PAKT packed ")) {
		return truncate(value, MAX_PACKED_HINT_CHARS);
	}
	return truncate(value, MAX_HINT_CHARS);
}

export function shouldFallbackToCli(result: TakumiResponse): boolean {
	if (result.exitCode === 0) return false;
	return /Unknown option:\s*--stream|invalid .*--stream|unknown .*ndjson/i.test(result.output);
}

export function isFreshContext(context?: TakumiContext): boolean {
	return context?.noCache === true || context?.fresh === true;
}

export function resolveCacheIntent(context?: TakumiContext): "default" | "fresh" {
	return isFreshContext(context) ? "fresh" : "default";
}

export function extractErrorMessage(error: unknown): string {
	if (typeof error === "string") return error;
	if (error && typeof error === "object") {
		const maybeMessage = (error as { message?: unknown }).message;
		if (typeof maybeMessage === "string") return maybeMessage;
	}
	return "Takumi returned an unknown error.";
}

export function truncate(value: string, maxChars: number): string {
	return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value;
}
