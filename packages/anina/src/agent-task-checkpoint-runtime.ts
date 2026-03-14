import crypto from "node:crypto";
import { createLogger } from "@chitragupta/core";
import type { AgentEventType } from "./types.js";
import type {
	AgentTaskCheckpointRecentEvent,
	AgentTaskCheckpointSnapshot,
	AgentTaskCheckpointStatus,
	AgentTaskCheckpointStore,
	StoredAgentTaskCheckpointRecord,
} from "./agent-task-checkpoint-types.js";

const log = createLogger("anina:task-checkpoint");

const PERSISTED_EVENTS = new Set<AgentEventType>([
	"turn:start",
	"tool:start",
	"tool:done",
	"tool:error",
	"subagent:spawn",
	"subagent:done",
	"subagent:error",
	"agent:abort",
]);

const MAX_RECENT_EVENTS = 12;

/**
 * Event-driven checkpoint writer for a logical agent task.
 *
 * Writes are serialized to preserve the last known good phase without forcing
 * the agent loop to await every event emission synchronously.
 */
export class AgentTaskCheckpointRuntime {
	private readonly store: AgentTaskCheckpointStore;
	private readonly projectPath: string;
	private readonly taskKey: string;
	private readonly taskType: string;
	private readonly agentId: string;
	private readonly purpose: string;
	private readonly depth: number;
	private readonly parentTaskKey: string | null;
	private readonly sessionLineageKey: string | null;
	private chain: Promise<void> = Promise.resolve();
	private promptSequence = 0;
	private snapshot: AgentTaskCheckpointSnapshot | null = null;
	private snapshotStatus: AgentTaskCheckpointStatus | null = null;
	private persistedSnapshot: AgentTaskCheckpointSnapshot | null = null;
	private persistedSnapshotStatus: AgentTaskCheckpointStatus | null = null;
	private lastPersistError: Error | null = null;
	private hydrated = false;

	constructor(options: {
		store: AgentTaskCheckpointStore;
		projectPath: string;
		taskKey: string;
		taskType: string;
		agentId: string;
		purpose: string;
		depth: number;
		parentTaskKey?: string | null;
		sessionLineageKey?: string | null;
	}) {
		this.store = options.store;
		this.projectPath = options.projectPath;
		this.taskKey = options.taskKey;
		this.taskType = options.taskType;
		this.agentId = options.agentId;
		this.purpose = options.purpose;
		this.depth = options.depth;
		this.parentTaskKey = options.parentTaskKey ?? null;
		this.sessionLineageKey = options.sessionLineageKey ?? null;
	}

	/** Persist the start of a new prompt/task run. */
	async beginPrompt(input: {
		prompt: string;
		sessionId: string;
		memorySessionId: string | null;
		messagesCount: number;
	}): Promise<void> {
		const previous = await this.hydrateExistingCheckpoint();
		const resumeSource = resolveResumeBoundary(previous);
		this.promptSequence += 1;
		this.snapshot = {
			version: 1,
			taskKey: this.taskKey,
			taskType: this.taskType,
			agentId: this.agentId,
			purpose: this.purpose,
			depth: this.depth,
			sessionId: input.sessionId,
			memorySessionId: input.memorySessionId,
			parentTaskKey: this.parentTaskKey,
			sessionLineageKey: this.sessionLineageKey,
			promptRunId: crypto.randomUUID(),
			promptSequence: this.promptSequence,
			phase: "prompt:start",
			latestEvent: "prompt:start",
			promptPreview: truncatePreview(input.prompt),
			latestToolName: null,
			latestSubagentId: null,
			latestSubagentPurpose: null,
			latestError: null,
			resumeFromStatus: resumeSource?.status ?? null,
			resumeFromPhase: resumeSource?.phase ?? null,
			resumeFromPromptRunId: resumeSource?.promptRunId ?? null,
			resumeFromPromptPreview: resumeSource?.promptPreview ?? null,
			resumeFromUpdatedAt: resumeSource?.updatedAt ?? null,
			recentEvents: appendRecentEvent(previous?.snapshot.recentEvents ?? [], {
				event: "prompt:start",
				phase: "prompt:start",
				at: Date.now(),
				summary: truncatePreview(input.prompt),
			}),
			messagesCount: input.messagesCount,
			updatedAt: Date.now(),
		};
		await this.persist("active", "prompt:start");
		if (this.lastPersistError) {
			throw this.lastPersistError;
		}
	}

	/** Record a significant lifecycle event without blocking the agent loop. */
	recordEvent(event: AgentEventType, data: unknown, messagesCount: number): void {
		if (
			!this.snapshot
			|| !PERSISTED_EVENTS.has(event)
			|| isTerminalTaskCheckpointStatus(this.snapshotStatus)
		) return;
		this.applyEvent(event, data, messagesCount);
		void this.persist(event === "agent:abort" ? "aborted" : "active", this.snapshot.phase);
	}

	/** Persist a terminal task outcome and flush any queued writes. */
	finish(
		status: Exclude<AgentTaskCheckpointStatus, "active">,
		options: { error?: unknown; messagesCount: number },
	): Promise<void> {
		if (!this.snapshot) return Promise.resolve();
		this.snapshotStatus = status;
		this.snapshot.phase = `prompt:${status}`;
		this.snapshot.latestEvent = this.snapshot.phase;
		this.snapshot.latestError = options.error ? stringifyError(options.error) : this.snapshot.latestError;
		this.snapshot.recentEvents = appendRecentEvent(this.snapshot.recentEvents, {
			event: this.snapshot.phase,
			phase: this.snapshot.phase,
			at: Date.now(),
			error: this.snapshot.latestError,
			summary: this.snapshot.latestError ?? null,
		});
		this.snapshot.messagesCount = options.messagesCount;
		this.snapshot.updatedAt = Date.now();
		return this.persist(status, this.snapshot.phase).then(() => {
			if (this.lastPersistError) {
				throw this.lastPersistError;
			}
		});
	}

	/** Wait for all queued persistence writes to finish. */
	async flush(): Promise<void> {
		await this.chain;
		if (this.lastPersistError) {
			throw this.lastPersistError;
		}
	}

	/**
	 * Return the latest in-memory checkpoint snapshot for prompt-time resume hints.
	 *
	 * The runtime keeps only a bounded, already-sanitized snapshot in memory, so
	 * exposing it here does not create a second transcript store.
	 */
	getSnapshot(): Readonly<AgentTaskCheckpointSnapshot> | null {
		return this.persistedSnapshot
			? { ...this.persistedSnapshot, recentEvents: [...this.persistedSnapshot.recentEvents] }
			: null;
	}

	private applyEvent(event: AgentEventType, data: unknown, messagesCount: number): void {
		if (!this.snapshot) return;
		this.snapshot.phase = event;
		this.snapshot.latestEvent = event;
		this.snapshot.messagesCount = messagesCount;
		this.snapshot.updatedAt = Date.now();
		this.snapshot.recentEvents = appendRecentEvent(
			this.snapshot.recentEvents,
			buildRecentEvent(event, data, this.snapshot.phase),
		);

		if (event.startsWith("tool:")) {
			this.snapshot.latestToolName = resolveToolName(data);
			if (event === "tool:error") {
				this.snapshot.latestError = resolveErrorText(data);
			}
		}

		if (event.startsWith("subagent:")) {
			this.snapshot.latestSubagentId = resolveStringField(data, ["childId", "sourceAgentId"]);
			this.snapshot.latestSubagentPurpose = resolveStringField(data, ["purpose", "sourcePurpose"]);
			if (event === "subagent:error") {
				this.snapshot.latestError = resolveErrorText(data);
			}
		}
	}

	private persist(status: AgentTaskCheckpointStatus, phase: string): Promise<void> {
		if (!this.snapshot) return this.chain;
		const checkpoint = { ...this.snapshot, updatedAt: Date.now() } satisfies AgentTaskCheckpointSnapshot;
		this.snapshot = checkpoint;
		this.snapshotStatus = status;
		const checkpointRecord = checkpoint as unknown as Record<string, unknown>;
		const write = this.chain
			.then(async () => {
				await this.store.save({
					projectPath: this.projectPath,
					taskKey: this.taskKey,
					taskType: this.taskType,
					agentId: this.agentId,
					sessionId: checkpoint.sessionId,
					parentTaskKey: this.parentTaskKey,
					sessionLineageKey: this.sessionLineageKey,
					status,
					phase,
					checkpoint: checkpointRecord,
				});
				this.persistedSnapshot = checkpoint;
				this.persistedSnapshotStatus = status;
				this.lastPersistError = null;
			})
			.catch((error) => {
				const normalized = error instanceof Error ? error : new Error(String(error));
				this.lastPersistError = normalized;
				log.warn("Task checkpoint persistence failed", {
					taskKey: this.taskKey,
					phase,
					error: stringifyError(normalized),
				});
			});
		this.chain = write;
		return write;
	}

	private async hydrateExistingCheckpoint(): Promise<{
		status: AgentTaskCheckpointStatus;
		snapshot: AgentTaskCheckpointSnapshot;
	} | null> {
		if (this.hydrated) {
			return this.persistedSnapshot && this.persistedSnapshotStatus
				? { status: this.persistedSnapshotStatus, snapshot: this.persistedSnapshot }
				: null;
		}
		this.hydrated = true;
		const stored = await this.store.get({ projectPath: this.projectPath, taskKey: this.taskKey });
		const snapshot = parseStoredCheckpoint(stored);
		if (!snapshot) return null;
		this.promptSequence = Math.max(this.promptSequence, snapshot.promptSequence);
		this.snapshot = snapshot;
		this.snapshotStatus = stored?.status ?? null;
		this.persistedSnapshot = snapshot;
		this.persistedSnapshotStatus = stored?.status ?? null;
		return { status: stored!.status, snapshot };
	}
}

/**
 * Preserve the last real durable boundary across repeated prompt restarts.
 *
 * A timeout can re-enter `prompt:start` several times before the task makes
 * fresh progress. In that case we keep the older `resumeFrom*` boundary so the
 * next prompt can still see the last meaningful safe pickup point.
 */
function resolveResumeBoundary(previous: {
	status: AgentTaskCheckpointStatus;
	snapshot: AgentTaskCheckpointSnapshot;
} | null): {
	status: AgentTaskCheckpointStatus;
	phase: string;
	promptRunId: string | null;
	promptPreview: string | null;
	updatedAt: number | null;
} | null {
	if (!previous) return null;
	const snapshot = previous.snapshot;
	const chainFromPriorRun = snapshot.phase === "prompt:start"
		&& typeof snapshot.resumeFromPhase === "string"
		&& snapshot.resumeFromPhase.trim().length > 0;
	return {
		status: chainFromPriorRun && snapshot.resumeFromStatus ? snapshot.resumeFromStatus : previous.status,
		phase: chainFromPriorRun ? snapshot.resumeFromPhase ?? snapshot.phase : snapshot.phase,
		promptRunId: chainFromPriorRun
			? snapshot.resumeFromPromptRunId ?? snapshot.promptRunId
			: snapshot.promptRunId,
		promptPreview: chainFromPriorRun
			? snapshot.resumeFromPromptPreview ?? snapshot.promptPreview
			: snapshot.promptPreview,
		updatedAt: chainFromPriorRun
			? snapshot.resumeFromUpdatedAt ?? snapshot.updatedAt
			: snapshot.updatedAt,
	};
}

function truncatePreview(prompt: string): string | null {
	const trimmed = prompt.trim();
	if (!trimmed) return null;
	return trimmed.length > 400 ? `${trimmed.slice(0, 397)}...` : trimmed;
}

function resolveStringField(data: unknown, keys: string[]): string | null {
	if (!data || typeof data !== "object") return null;
	for (const key of keys) {
		const value = (data as Record<string, unknown>)[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return null;
}

function resolveToolName(data: unknown): string | null {
	return resolveStringField(data, ["toolName", "name"]);
}

function resolveErrorText(data: unknown): string | null {
	const error = resolveStringField(data, ["error", "reason"]);
	if (error) return error;
	if (data instanceof Error) return data.message;
	return null;
}

function summarizeEventData(data: unknown): string | null {
	if (!data || typeof data !== "object") return null;
	return resolveStringField(data, [
		"summary",
		"reason",
		"purpose",
		"toolName",
		"name",
		"error",
	]);
}

function buildRecentEvent(
	event: string,
	data: unknown,
	phase: string,
): AgentTaskCheckpointRecentEvent {
	return {
		event,
		phase,
		at: Date.now(),
		toolName: resolveToolName(data),
		subagentId: resolveStringField(data, ["childId", "sourceAgentId"]),
		subagentPurpose: resolveStringField(data, ["purpose", "sourcePurpose"]),
		error: resolveErrorText(data),
		summary: summarizeEventData(data),
	};
}

function appendRecentEvent(
	existing: AgentTaskCheckpointRecentEvent[],
	event: AgentTaskCheckpointRecentEvent,
): AgentTaskCheckpointRecentEvent[] {
	const next = [...existing, event];
	if (next.length <= MAX_RECENT_EVENTS) return next;
	return next.slice(next.length - MAX_RECENT_EVENTS);
}

function stringifyError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isTerminalTaskCheckpointStatus(
	status: AgentTaskCheckpointStatus | null,
): status is Exclude<AgentTaskCheckpointStatus, "active"> {
	return status === "completed" || status === "aborted" || status === "error";
}

function parseStoredCheckpoint(record: StoredAgentTaskCheckpointRecord | null): AgentTaskCheckpointSnapshot | null {
	if (!record || !record.checkpoint || typeof record.checkpoint !== "object") return null;
	const checkpoint = record.checkpoint as Partial<AgentTaskCheckpointSnapshot>;
	if (checkpoint.version !== 1 || checkpoint.taskKey !== record.taskKey) return null;
	if (typeof checkpoint.promptSequence !== "number" || typeof checkpoint.phase !== "string") return null;
	if (typeof checkpoint.promptRunId !== "string" || typeof checkpoint.updatedAt !== "number") return null;
	const recentEvents = Array.isArray(checkpoint.recentEvents)
		? checkpoint.recentEvents.filter(isRecentEvent)
		: [];
	return {
		...checkpoint,
		recentEvents,
	} as AgentTaskCheckpointSnapshot;
}

function isRecentEvent(value: unknown): value is AgentTaskCheckpointRecentEvent {
	if (!value || typeof value !== "object") return false;
	const event = value as Partial<AgentTaskCheckpointRecentEvent>;
	return typeof event.event === "string"
		&& typeof event.phase === "string"
		&& typeof event.at === "number";
}
