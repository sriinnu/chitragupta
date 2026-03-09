export const DEFAULT_PAKT_COMMAND = "pakt";
export const DEFAULT_PAKT_ARGS = ["serve", "--stdio"];
export const REQUIRED_PAKT_TOOLS = ["pakt_compress", "pakt_auto"];
export const PACK_MIN_LENGTH = 400;
export const LIVE_CONTEXT_PACK_MIN_LENGTH = 700;
export const FAILURE_COOLDOWN_MS = 30_000;
export const STATUS_CACHE_TTL_MS = 5_000;
export const PREFERRED_RUNTIME: CompressionRuntimeName = "pakt-core";
export const SUPPORTED_RUNTIMES: CompressionRuntimeName[] = ["pakt-core", "pakt"];

export type CompressionRuntimeName = "pakt-core" | "pakt";
export type CompressionRuntimeTransport = "inproc" | "stdio";

export interface PackedSummaryResult {
	runtime: CompressionRuntimeName;
	packedText: string;
	format: string;
	savings: number;
}

export interface SummaryPacker {
	packSummary(text: string): Promise<PackedSummaryResult | null>;
}

export interface PackedLiveContextResult extends PackedSummaryResult {
	originalLength: number;
}

export interface CompressionRuntimeStatus {
	runtime: CompressionRuntimeName;
	transport: CompressionRuntimeTransport;
	available: boolean;
	command: string | null;
	args: string[];
	connected: boolean;
	tools: string[];
	missingTools?: string[];
	error?: string;
}

export interface CompressionPolicyStatus {
	supports: CompressionRuntimeName[];
	preferredRuntime: CompressionRuntimeName;
	defaultRuntime: CompressionRuntimeName | null;
	requiredTools: string[];
	status: CompressionRuntimeStatus;
	runtimes: CompressionRuntimeStatus[];
}

export interface CompressionRuntime {
	name: CompressionRuntimeName;
	status(): Promise<CompressionRuntimeStatus>;
	compress(args: { text: string; format?: string }): Promise<Record<string, unknown>>;
	auto(args: { text: string }): Promise<Record<string, unknown>>;
}

export function resolvePaktCommand(): string {
	const raw = process.env.CHITRAGUPTA_PAKT_COMMAND?.trim();
	return raw && raw.length > 0 ? raw : DEFAULT_PAKT_COMMAND;
}

export function resolvePaktArgs(): string[] {
	const raw = process.env.CHITRAGUPTA_PAKT_ARGS?.trim();
	if (!raw) return [...DEFAULT_PAKT_ARGS];
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed) && parsed.every((value) => typeof value === "string")) {
			return parsed.map((value) => value.trim()).filter(Boolean);
		}
	} catch {
		// fall through to whitespace splitting
	}
	return raw.split(/\s+/).map((value) => value.trim()).filter(Boolean);
}

export function isPaktEnabled(): boolean {
	const raw = process.env.CHITRAGUPTA_PAKT_ENABLED?.trim().toLowerCase();
	if (raw && ["0", "false", "no", "off", "disabled"].includes(raw)) return false;
	if (process.env.VITEST && !raw) return false;
	return true;
}

export function resolveRuntimePreference(): "auto" | CompressionRuntimeName {
	const raw = process.env.CHITRAGUPTA_PAKT_RUNTIME?.trim().toLowerCase();
	if (!raw) return "auto";
	if (raw === "auto") return "auto";
	if (raw === "core" || raw === "pakt-core" || raw === "library" || raw === "inproc") return "pakt-core";
	if (raw === "pakt" || raw === "mcp" || raw === "stdio") return "pakt";
	return "auto";
}

export function buildUnavailableStatus(
	runtime: CompressionRuntimeName,
	transport: CompressionRuntimeTransport,
	error: string,
): CompressionRuntimeStatus {
	return {
		runtime,
		transport,
		available: false,
		command: runtime === "pakt" ? resolvePaktCommand() : "@sriinnu/pakt",
		args: runtime === "pakt" ? resolvePaktArgs() : [],
		connected: false,
		tools: runtime === "pakt-core" ? [...REQUIRED_PAKT_TOOLS] : [],
		missingTools: runtime === "pakt" ? [...REQUIRED_PAKT_TOOLS] : undefined,
		error,
	};
}

export function normalizePaktRuntimeResult(
	runtime: CompressionRuntimeName,
	result: Record<string, unknown>,
): Record<string, unknown> {
	return { runtime, ...result };
}
