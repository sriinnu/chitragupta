/**
 * @chitragupta/swara — Environment detection for auto-configuration.
 *
 * Probes the local machine for GPU info, running inference backends,
 * and configured API keys to recommend the best provider automatically.
 * All detection is non-blocking and failure-tolerant.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

// ─── Types ──────────────────────────────────────────────────────────────────

/** Detected GPU information. */
export interface GPUInfo {
	vendor: "nvidia" | "amd" | "apple" | "none";
	name?: string;
	/** VRAM in megabytes. */
	vram?: number;
}

/** Which local inference backends are reachable. */
export interface BackendAvailability {
	ollama: boolean;
	vllm: boolean;
	localai: boolean;
	lmstudio: boolean;
}

/** Full snapshot of the runtime environment for provider selection. */
export interface Environment {
	platform: NodeJS.Platform;
	arch: string;
	gpu: GPUInfo;
	backends: BackendAvailability;
	/** Names of env vars that hold valid API keys (non-empty). */
	apiKeys: string[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** All API key env vars we scan for. */
const API_KEY_ENV_VARS = [
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"GOOGLE_AI_API_KEY",
	"XAI_API_KEY",
	"GROQ_API_KEY",
	"CEREBRAS_API_KEY",
	"MISTRAL_API_KEY",
	"DEEPSEEK_API_KEY",
	"OPENROUTER_API_KEY",
	"TOGETHER_API_KEY",
] as const;

/** Default timeout (ms) for backend health probes. */
const PROBE_TIMEOUT_MS = 2_000;

// ─── GPU Detection ──────────────────────────────────────────────────────────

/**
 * Detect the primary GPU on the system.
 *
 * - Linux/Windows: runs `nvidia-smi` to query NVIDIA GPU info.
 * - macOS ARM64: detects Apple Silicon (M-series) with unified memory.
 * - Falls back to `{ vendor: "none" }` on any failure.
 */
export async function detectGPU(): Promise<GPUInfo> {
	// Apple Silicon detection (macOS arm64)
	if (process.platform === "darwin" && process.arch === "arm64") {
		return { vendor: "apple", name: "Apple Silicon" };
	}

	// NVIDIA detection via nvidia-smi
	try {
		const { stdout } = await execFile("nvidia-smi", [
			"--query-gpu=name,memory.total",
			"--format=csv,noheader",
		]);
		const line = stdout.trim().split("\n")[0];
		if (line) {
			const [name, memStr] = line.split(",").map((s) => s.trim());
			const vramMatch = memStr?.match(/(\d+)/);
			return {
				vendor: "nvidia",
				name: name || undefined,
				vram: vramMatch ? parseInt(vramMatch[1], 10) : undefined,
			};
		}
	} catch {
		// nvidia-smi not found or failed — not an NVIDIA system
	}

	return { vendor: "none" };
}

// ─── Backend Probing ────────────────────────────────────────────────────────

/**
 * Quick health-check fetch with a timeout.
 * Returns `true` if the endpoint responds with 2xx, `false` otherwise.
 */
async function probeEndpoint(url: string, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<boolean> {
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		const response = await fetch(url, { signal: controller.signal });
		clearTimeout(timer);
		return response.ok;
	} catch {
		return false;
	}
}

/**
 * Probe all known local inference backends in parallel.
 *
 * Each probe has a configurable timeout (default 2s) and fails silently.
 */
export async function probeBackends(): Promise<BackendAvailability> {
	const [ollama, vllm, localai, lmstudio] = await Promise.all([
		probeEndpoint("http://localhost:11434/api/tags"),
		probeEndpoint("http://localhost:8000/health"),
		probeEndpoint("http://localhost:8080/readyz"),
		probeEndpoint("http://localhost:1234/v1/models"),
	]);

	return { ollama, vllm, localai, lmstudio };
}

// ─── API Key Detection ──────────────────────────────────────────────────────

/**
 * Scan the environment for known LLM API keys.
 *
 * @returns Array of env var names that are set and non-empty.
 */
export function detectApiKeys(): string[] {
	return API_KEY_ENV_VARS.filter((name) => {
		const value = process.env[name];
		return value !== undefined && value.length > 0;
	});
}

// ─── Full Detection ─────────────────────────────────────────────────────────

/**
 * Perform a full environment detection: GPU, backends, and API keys.
 *
 * GPU detection and backend probing run in parallel for speed.
 */
export async function detectEnvironment(): Promise<Environment> {
	const [gpu, backends] = await Promise.all([
		detectGPU(),
		probeBackends(),
	]);

	return {
		platform: process.platform,
		arch: process.arch,
		gpu,
		backends,
		apiKeys: detectApiKeys(),
	};
}

// ─── Recommendation ─────────────────────────────────────────────────────────

/**
 * Recommend the best provider based on detected environment.
 *
 * Priority order:
 *   1. Apple Silicon (arm64 macOS) → "ollama" (local, fast on Metal)
 *   2. NVIDIA GPU + vLLM running → "vllm" (optimised GPU inference)
 *   3. Ollama backend reachable → "ollama"
 *   4. ANTHROPIC_API_KEY set → "anthropic"
 *   5. OPENAI_API_KEY set → "openai"
 *   6. Fallback → "ollama" (user can install later)
 */
export function getRecommendedProvider(env: Environment): string {
	if (env.platform === "darwin" && env.arch === "arm64") {
		return "ollama";
	}
	if (env.gpu.vendor === "nvidia" && env.backends.vllm) {
		return "vllm";
	}
	if (env.backends.ollama) {
		return "ollama";
	}
	if (env.apiKeys.includes("ANTHROPIC_API_KEY")) {
		return "anthropic";
	}
	if (env.apiKeys.includes("OPENAI_API_KEY")) {
		return "openai";
	}
	return "ollama";
}
