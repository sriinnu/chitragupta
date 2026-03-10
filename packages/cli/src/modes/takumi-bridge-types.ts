/**
 * Takumi Bridge — Protocol Types.
 *
 * Defines the communication contract between Chitragupta (brain)
 * and Takumi (coding agent). The preferred path uses Takumi's current
 * one-shot CLI surface with `--print --stream ndjson`; plain `--print`
 * text mode is the compatibility fallback.
 *
 * @module
 */

// ─── Spawn Configuration ───────────────────────────────────────────────────

/** Options for spawning and communicating with Takumi. */
export interface TakumiBridgeOptions {
	/** Binary name or path to the Takumi CLI (default: "takumi"). */
	command?: string;
	/** Extra CLI arguments to pass. */
	args?: string[];
	/** Working directory for the child process. */
	cwd: string;
	/** Timeout in milliseconds for the entire task (default: 120_000). */
	timeout?: number;
	/** Project root path (may differ from cwd for monorepos). */
	projectPath?: string;
}

// ─── Context Injection ─────────────────────────────────────────────────────

/** Memory/context payload injected from Chitragupta into Takumi. */
export interface TakumiContext {
	/** Tree-sitter repo map summary (from netra). */
	repoMap?: string;
	/** Force fresh inspection instead of relying on predictive summaries. */
	noCache?: boolean;
	/** Alias for `noCache` to make fresh-mode intent explicit at call sites. */
	fresh?: boolean;
	/** Episodic memory hints — past error patterns, solutions. */
	episodicHints?: string[];
	/** Recent architectural decisions from Akasha. */
	recentDecisions?: string[];
	/** Relevant file contents keyed by path. */
	fileContext?: Record<string, string>;
	/** Engine-selected execution lane metadata from route.resolve. */
	engineRoute?: {
		routeClass?: string;
		capability?: string | null;
		selectedCapabilityId?: string | null;
		executionBinding?: {
			source: "engine" | "kosha-discovery";
			kind: "executor" | "model";
			query?: {
				capability: string;
				mode?: string;
				role?: string;
			};
			selectedModelId?: string;
			selectedProviderId?: string;
			candidateModelIds?: string[];
			preferredModelIds?: string[];
			preferredProviderIds?: string[];
			preferLocalProviders?: boolean;
			allowCrossProvider?: boolean;
		} | null;
		enforced?: boolean;
		reason?: string | null;
		policyTrace?: string[];
	};
	/** Engine-selected multi-lane envelope for Takumi's internal task scheduler. */
	engineRouteEnvelope?: {
		primaryKey: string;
		lanes: Array<{
			key: string;
			routeClass?: string;
			capability?: string | null;
			selectedCapabilityId?: string | null;
			executionBinding?: {
				source: "engine" | "kosha-discovery";
				kind: "executor" | "model";
				query?: {
					capability: string;
					mode?: string;
					role?: string;
				};
				selectedModelId?: string;
				selectedProviderId?: string;
				candidateModelIds?: string[];
				preferredModelIds?: string[];
				preferredProviderIds?: string[];
				preferLocalProviders?: boolean;
				allowCrossProvider?: boolean;
			} | null;
			enforced?: boolean;
			reason?: string | null;
			policyTrace?: string[];
		}>;
	};
}

// ─── Request / Response ────────────────────────────────────────────────────

/** Structured request sent to the Takumi bridge. */
export interface TakumiRequest {
	/** Discriminator — always "task" for now. */
	type: "task";
	/** The coding task description. */
	task: string;
	/** Optional context to inject before execution. */
	context?: TakumiContext;
}

/** Structured result synthesized by the bridge from Takumi output. */
export interface TakumiResponse {
	/** Discriminator — always "result". */
	type: "result";
	/** Files modified during the task. */
	filesModified: string[];
	/** Test results, if tests were run. */
	testsRun?: { passed: number; failed: number; total: number };
	/** Git diff summary of changes. */
	diffSummary?: string;
	/** Human-readable output / summary. */
	output: string;
	/** Process exit code (0 = success). */
	exitCode: number;
	/**
	 * Bridge mode actually used for this execution.
	 * `rpc` means structured NDJSON stream compatibility mode.
	 */
	modeUsed?: "rpc" | "cli";
	/** Whether the caller requested a fresh/no-cache Takumi run. */
	cacheIntent?: "default" | "fresh";
	/** Best-effort post-run contract audit details from the bridge. */
	contractAudit?: {
		observedProviderIds?: string[];
		observedModelIds?: string[];
		violations?: string[];
	};
}

/** Streaming event emitted by Takumi during execution. */
export interface TakumiEvent {
	/** Event type discriminator. */
	type: "progress" | "tool_call" | "error";
	/** Event payload — human-readable string. */
	data: string;
}

// ─── Bridge Status ─────────────────────────────────────────────────────────

/** Detection result for Takumi availability and mode. */
export interface TakumiBridgeStatus {
	/**
	 * Communication mode: `rpc` means Takumi's structured NDJSON stream via
	 * `--print --stream ndjson`; `cli` means plain `--print` text mode.
	 */
	mode: "rpc" | "cli" | "unavailable";
	/** The resolved command used for detection. */
	command: string;
	/** Takumi version string, if detected. */
	version?: string;
}
