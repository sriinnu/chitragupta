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

/**
 * Canonical engine-owned execution object.
 *
 * I keep the shape intentionally small here: the bridge only needs stable
 * task/lane references, and wider execution policy still lives in the engine
 * route envelope and daemon-owned task records.
 */
export interface TakumiExecutionObject {
	/** Stable engine-owned task reference. */
	task: {
		/** Canonical task id minted by the engine. */
		id: string;
	};
	/** Stable engine-owned executor lane reference. */
	lane: {
		/** Canonical lane id minted by the engine. */
		id: string;
	};
}

/** Structured request sent to the Takumi bridge. */
export interface TakumiRequest {
	/** Discriminator — always "task" for now. */
	type: "task";
	/** Preferred canonical execution object from the engine. */
	execution?: TakumiExecutionObject;
	/** Compatibility alias for callers that still send a top-level task id. */
	taskId?: string;
	/** Compatibility alias for callers that still send a top-level lane id. */
	laneId?: string;
	/** The coding task description. */
	task: string;
	/** Optional context to inject before execution. */
	context?: TakumiContext;
}

/** Canonical artifact emitted by the bridge compatibility layer. */
export interface TakumiArtifact {
	/** Stable artifact id scoped to the task/lane pair. */
	artifactId: string;
	/** Canonical execution object that produced the artifact. */
	execution: TakumiExecutionObject;
	/** Compatibility alias for consumers still keyed on task id. */
	taskId: string;
	/** Compatibility alias for consumers still keyed on lane id. */
	laneId: string;
	/** Artifact kind aligned with the executor contract. */
	kind: "patch" | "validation" | "log";
	/** Producer identity for compatibility artifacts. */
	producer: "takumi-bridge";
	/** Human-readable artifact summary. */
	summary: string;
	/** Inlined content when the bridge can synthesize it safely. */
	body?: string;
	/** Stable content hash for replay/debug comparisons. */
	contentHash: string;
	/** Millisecond timestamp when the artifact was synthesized. */
	createdAt: number;
	/** Whether the engine has promoted this artifact canonically. */
	promoted: boolean;
}

/** Bridge-shaped final execution report aligned to the Takumi contract. */
export interface TakumiFinalReport {
	/** Canonical execution object for the completed run. */
	execution: TakumiExecutionObject;
	/** Compatibility alias for consumers still keyed on task id. */
	taskId: string;
	/** Compatibility alias for consumers still keyed on lane id. */
	laneId: string;
	/** Terminal execution status synthesized by the bridge. */
	status: "completed" | "failed" | "cancelled";
	/** Concise execution summary. */
	summary: string;
	/** Best-effort route/use data visible to the bridge. */
	usedRoute?: {
		routeClass?: string;
		capability?: string | null;
		selectedCapabilityId?: string | null;
		selectedProviderId?: string | null;
		selectedModelId?: string | null;
	};
	/** Best-effort selected provider observed or enforced by the engine. */
	selectedProviderId?: string | null;
	/** Best-effort selected model observed or enforced by the engine. */
	selectedModelId?: string | null;
	/** Tool names observed during the bridge run. */
	toolCalls: string[];
	/** Validation summary when the bridge parsed tests. */
	validation?: { passed: number; failed: number; total: number };
	/** Final artifacts emitted by the bridge compatibility layer. */
	artifacts: TakumiArtifact[];
	/** Best-effort error summary when the run failed. */
	error?: string | null;
	/** Typed failure kind when the run did not complete cleanly. */
	failureKind?: "route-incompatible" | "executor-unavailable" | "runtime-failure" | "contract-violation" | "cancelled" | null;
}

/** Structured result synthesized by the bridge from Takumi output. */
export interface TakumiResponse {
	/** Discriminator — always "result". */
	type: "result";
	/** Canonical execution object attached by the bridge contract layer. */
	execution?: TakumiExecutionObject;
	/** Compatibility alias for consumers still keyed on task id. */
	taskId: string;
	/** Compatibility alias for consumers still keyed on lane id. */
	laneId: string;
	/** Files modified during the task. */
	filesModified: string[];
	/** Test results, if tests were run. */
	testsRun?: { passed: number; failed: number; total: number };
	/** Tool names observed during execution. */
	toolCalls?: string[];
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
	/** Canonical final execution report synthesized by the bridge. */
	finalReport: TakumiFinalReport;
	/** Compatibility artifact list synthesized by the bridge. */
	artifacts: TakumiArtifact[];
}

/**
 * Public compatibility result after the bridge contract layer has normalized
 * execution identity.
 *
 * I keep the raw `TakumiResponse` shape slightly looser because the internal
 * child-process adapters build it up in phases, but higher public seams should
 * use this normalized contract once the bridge has attached execution identity.
 */
export type TakumiNormalizedResponse =
	TakumiResponse
	& {
		execution: TakumiExecutionObject;
	};

/** Streaming event emitted by Takumi during execution. */
export interface TakumiEvent {
	/** Canonical execution object for this streamed update. */
	execution: TakumiExecutionObject;
	/** Engine-owned task identity for this event stream. */
	taskId: string;
	/** Engine-owned lane identity for this event stream. */
	laneId: string;
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
