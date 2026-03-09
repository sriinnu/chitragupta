import {
	PACK_MIN_LENGTH,
	LIVE_CONTEXT_PACK_MIN_LENGTH,
	PREFERRED_RUNTIME,
	REQUIRED_PAKT_TOOLS,
	SUPPORTED_RUNTIMES,
	buildUnavailableStatus,
	isPaktEnabled,
	resolveRuntimePreference,
	type CompressionPolicyStatus,
	type CompressionRuntime,
	type CompressionRuntimeStatus,
	type PackedLiveContextResult,
	type PackedSummaryResult,
	type SummaryPacker,
} from "./pakt-compression-types.js";
import {
	PaktCoreCompressionRuntime,
	PaktMcpCompressionRuntime,
} from "./pakt-compression-runtimes.js";

export type {
	CompressionPolicyStatus,
	CompressionRuntime,
	CompressionRuntimeName,
	CompressionRuntimeStatus,
	PackedLiveContextResult,
	PackedSummaryResult,
	SummaryPacker,
} from "./pakt-compression-types.js";

let sharedSummaryPacker: SummaryPacker | null = null;
let sharedCompressionRuntime: CompressionRuntime | null = null;
let sharedCoreRuntime: CompressionRuntime | null = null;
let sharedMcpRuntime: CompressionRuntime | null = null;

class CompressionBackedSummaryPacker implements SummaryPacker {
	async packSummary(text: string): Promise<PackedSummaryResult | null> {
		if (!text.trim() || text.length < PACK_MIN_LENGTH) return null;
		const result = await compressTextThroughPolicy({
			text,
			format: "text",
		});
		const packedText = typeof result.compressed === "string" ? result.compressed : "";
		if (!packedText || packedText.length >= text.length) return null;
		const savings = typeof result.savings === "number" ? result.savings : 0;
		if (savings < 5) return null;
		return {
			runtime: result.runtime === "pakt" ? "pakt" : "pakt-core",
			packedText,
			format: typeof result.format === "string" && result.format.trim() ? result.format : "text",
			savings,
		};
	}
}

function getCoreRuntime(): CompressionRuntime {
	if (!sharedCoreRuntime) {
		sharedCoreRuntime = new PaktCoreCompressionRuntime();
	}
	return sharedCoreRuntime;
}

function getMcpRuntime(): CompressionRuntime {
	if (!sharedMcpRuntime) {
		sharedMcpRuntime = new PaktMcpCompressionRuntime();
	}
	return sharedMcpRuntime;
}

function getRuntimeCandidates(): CompressionRuntime[] {
	const preference = resolveRuntimePreference();
	if (preference === "pakt-core") return [getCoreRuntime()];
	if (preference === "pakt") return [getMcpRuntime()];
	return [getCoreRuntime(), getMcpRuntime()];
}

async function resolveRuntimePolicy(): Promise<{
	selected: CompressionRuntime | null;
	statuses: CompressionRuntimeStatus[];
}> {
	if (sharedCompressionRuntime) {
		const status = await sharedCompressionRuntime.status();
		return {
			selected: status.available ? sharedCompressionRuntime : null,
			statuses: [status],
		};
	}
	if (!isPaktEnabled()) {
		const statuses = [
			buildUnavailableStatus("pakt-core", "inproc", "PAKT runtime disabled"),
			buildUnavailableStatus("pakt", "stdio", "PAKT runtime disabled"),
		];
		return {
			selected: null,
			statuses,
		};
	}

	const candidates = getRuntimeCandidates();
	const statuses: CompressionRuntimeStatus[] = [];
	let selected: CompressionRuntime | null = null;
	for (const candidate of candidates) {
		const status = await candidate.status();
		statuses.push(status);
		if (!selected && status.available) {
			selected = candidate;
		}
	}

	for (const runtime of SUPPORTED_RUNTIMES) {
		if (!statuses.some((status) => status.runtime === runtime)) {
			statuses.push(buildUnavailableStatus(
				runtime,
				runtime === "pakt" ? "stdio" : "inproc",
				`Runtime ${runtime} not selected by current policy`,
			));
		}
	}

	return {
		selected,
		statuses,
	};
}

async function runCompressionOperation<T>(
	run: (runtime: CompressionRuntime) => Promise<T>,
): Promise<T> {
	if (sharedCompressionRuntime) {
		return run(sharedCompressionRuntime);
	}
	const candidates = getRuntimeCandidates();
	let primaryError: unknown = null;
	for (const runtime of candidates) {
		try {
			return await run(runtime);
		} catch (error) {
			if (!primaryError) primaryError = error;
		}
	}
	throw primaryError ?? new Error("PAKT compression runtime unavailable");
}

function getSummaryPacker(): SummaryPacker {
	if (!sharedSummaryPacker) {
		sharedSummaryPacker = new CompressionBackedSummaryPacker();
	}
	return sharedSummaryPacker;
}

export function _setSummaryPackerForTests(packer: SummaryPacker | null): void {
	sharedSummaryPacker = packer;
}

export function _setCompressionRuntimeForTests(runtime: CompressionRuntime | null): void {
	sharedCompressionRuntime = runtime;
	sharedCoreRuntime = null;
	sharedMcpRuntime = null;
}

export async function getCompressionPolicyStatus(): Promise<CompressionPolicyStatus> {
	const { selected, statuses } = await resolveRuntimePolicy();
	const selectedStatus = selected
		? statuses.find((status) => status.runtime === selected.name) ?? statuses[0] ?? buildUnavailableStatus("pakt-core", "inproc", "PAKT runtime unavailable")
		: statuses[0] ?? buildUnavailableStatus("pakt-core", "inproc", "PAKT runtime unavailable");
	return {
		supports: [...SUPPORTED_RUNTIMES],
		preferredRuntime: PREFERRED_RUNTIME,
		defaultRuntime: selected?.name ?? null,
		requiredTools: [...REQUIRED_PAKT_TOOLS],
		status: selectedStatus,
		runtimes: statuses,
	};
}

export async function compressTextThroughPolicy(args: {
	text: string;
	format?: string;
}): Promise<Record<string, unknown>> {
	return runCompressionOperation((runtime) => runtime.compress(args));
}

export async function autoProcessTextThroughPolicy(args: {
	text: string;
}): Promise<Record<string, unknown>> {
	return runCompressionOperation((runtime) => runtime.auto(args));
}

export async function packCuratedSummaryText(text: string): Promise<PackedSummaryResult | null> {
	try {
		return await getSummaryPacker().packSummary(text);
	} catch {
		return null;
	}
}

export async function packLiveContextText(text: string): Promise<PackedLiveContextResult | null> {
	if (!text.trim() || text.length < LIVE_CONTEXT_PACK_MIN_LENGTH) return null;
	try {
		const packed = await getSummaryPacker().packSummary(text);
		if (!packed) return null;
		return {
			...packed,
			originalLength: text.length,
		};
	} catch {
		return null;
	}
}
