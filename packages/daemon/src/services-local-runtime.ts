import { loadGlobalSettings } from "@chitragupta/core";

const LOCAL_RUNTIME_STATUS_TTL_MS = 5_000;

export type LocalRuntimeId = "llamacpp" | "ollama";

export interface LocalRuntimeStatus {
	runtime: LocalRuntimeId;
	label: string;
	endpoint: string;
	configured: boolean;
	available: boolean;
	preferred: boolean;
	source: {
		envVar?: string;
		setting?: string;
	};
	lastError?: string | null;
}

export interface LocalRuntimePolicyStatus {
	supports: LocalRuntimeId[];
	defaultRuntime: LocalRuntimeId;
	fallbackRuntime: LocalRuntimeId;
	statuses: LocalRuntimeStatus[];
}

interface CachedLocalRuntimePolicyStatus {
	value: LocalRuntimePolicyStatus;
	recordedAt: number;
}

interface RuntimeProbeConfig {
	runtime: LocalRuntimeId;
	label: string;
	envVar: string;
	setting: "llamacppEndpoint" | "ollamaEndpoint";
	defaultEndpoint: string;
	probePath: string;
}

const RUNTIME_PROBES: RuntimeProbeConfig[] = [
	{
		runtime: "llamacpp",
		label: "llama.cpp",
		envVar: "LLAMACPP_BASE_URL",
		setting: "llamacppEndpoint",
		defaultEndpoint: "http://localhost:8080/v1",
		probePath: "/models",
	},
	{
		runtime: "ollama",
		label: "Ollama",
		envVar: "OLLAMA_HOST",
		setting: "ollamaEndpoint",
		defaultEndpoint: "http://localhost:11434",
		probePath: "/api/tags",
	},
];

let cachedLocalRuntimePolicyStatus: CachedLocalRuntimePolicyStatus | null = null;

function normalizeEndpoint(endpoint: string, probePath: string): string {
	const trimmed = endpoint.trim().replace(/\/+$/, "");
	if (!trimmed) return trimmed;
	if (probePath === "/models" && trimmed.endsWith("/v1")) return `${trimmed}${probePath}`;
	if (probePath === "/models" && /\/v1\//.test(trimmed)) return trimmed;
	return `${trimmed}${probePath}`;
}

async function probeRuntime(config: RuntimeProbeConfig): Promise<LocalRuntimeStatus> {
	const settings = loadGlobalSettings() as {
		llamacppEndpoint?: string;
		ollamaEndpoint?: string;
	};
	const configuredEndpoint = process.env[config.envVar]
		?? settings[config.setting]
		?? config.defaultEndpoint;
	const configured = typeof configuredEndpoint === "string" && configuredEndpoint.trim().length > 0;
	const endpoint = configuredEndpoint.trim();

	if (!configured) {
		return {
			runtime: config.runtime,
			label: config.label,
			endpoint,
			configured: false,
			available: false,
			preferred: config.runtime === "llamacpp",
			source: { envVar: config.envVar, setting: config.setting },
			lastError: "No endpoint configured",
		};
	}

	try {
		const response = await fetch(normalizeEndpoint(endpoint, config.probePath), {
			signal: AbortSignal.timeout(2_000),
		});
		return {
			runtime: config.runtime,
			label: config.label,
			endpoint,
			configured: true,
			available: response.ok,
			preferred: config.runtime === "llamacpp",
			source: { envVar: config.envVar, setting: config.setting },
			lastError: response.ok ? null : `HTTP ${response.status}`,
		};
	} catch (error) {
		return {
			runtime: config.runtime,
			label: config.label,
			endpoint,
			configured: true,
			available: false,
			preferred: config.runtime === "llamacpp",
			source: { envVar: config.envVar, setting: config.setting },
			lastError: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function getLocalRuntimePolicyStatus(): Promise<LocalRuntimePolicyStatus> {
	if (
		cachedLocalRuntimePolicyStatus
		&& Date.now() - cachedLocalRuntimePolicyStatus.recordedAt < LOCAL_RUNTIME_STATUS_TTL_MS
	) {
		return cachedLocalRuntimePolicyStatus.value;
	}
	const statuses = await Promise.all(RUNTIME_PROBES.map((probe) => probeRuntime(probe)));
	const value: LocalRuntimePolicyStatus = {
		supports: ["llamacpp", "ollama"],
		defaultRuntime: "llamacpp",
		fallbackRuntime: "ollama",
		statuses,
	};
	cachedLocalRuntimePolicyStatus = {
		value,
		recordedAt: Date.now(),
	};
	return value;
}

export function _resetLocalRuntimePolicyStatusCacheForTests(): void {
	cachedLocalRuntimePolicyStatus = null;
}
