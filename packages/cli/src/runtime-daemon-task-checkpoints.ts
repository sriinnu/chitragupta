import type { AgentTaskCheckpointStore, StoredAgentTaskCheckpointRecord } from "@chitragupta/anina";
import { getDaemonClient } from "./modes/daemon-bridge-core.js";

export interface AgentTaskCheckpointRecordWithResume extends StoredAgentTaskCheckpointRecord {
	resumeContext?: string;
	resumePlan?: Record<string, unknown> | null;
}

/** Build the daemon-first checkpoint store used by engine-facing agent surfaces. */
export function createDaemonBackedTaskCheckpointStore(): AgentTaskCheckpointStore {
	return {
		async get(input) {
			const client = await getDaemonClient();
			const result = await client.call("agent.tasks.checkpoint.get", input) as {
				checkpoint?: StoredAgentTaskCheckpointRecord | null;
			};
			return result.checkpoint ?? null;
		},

		async save(input) {
			const client = await getDaemonClient();
			const result = await client.call("agent.tasks.checkpoint.save", input) as {
				checkpoint: StoredAgentTaskCheckpointRecord;
			};
			return result.checkpoint;
		},

		async clear(input) {
			const client = await getDaemonClient();
			const result = await client.call("agent.tasks.checkpoint.clear", input) as { cleared: boolean };
			return result.cleared;
		},
	};
}

/** List recent durable task checkpoints through the daemon-owned control plane. */
export async function listDaemonTaskCheckpoints(input: {
	projectPath?: string;
	status?: "active" | "completed" | "aborted" | "error";
	taskType?: string;
	sessionId?: string;
	limit?: number;
} = {}): Promise<AgentTaskCheckpointRecordWithResume[]> {
	const client = await getDaemonClient();
	const result = await client.call("agent.tasks.checkpoint.list", input) as {
		checkpoints?: AgentTaskCheckpointRecordWithResume[];
	};
	return Array.isArray(result.checkpoints) ? result.checkpoints : [];
}

/** Load one durable task checkpoint through the daemon-owned control plane. */
export async function getDaemonTaskCheckpoint(input: {
	projectPath: string;
	taskKey: string;
}): Promise<{
	checkpoint: AgentTaskCheckpointRecordWithResume | null;
	resumeContext?: string;
	resumePlan?: Record<string, unknown> | null;
}> {
	const client = await getDaemonClient();
	const result = await client.call("agent.tasks.checkpoint.get", input) as {
		checkpoint?: AgentTaskCheckpointRecordWithResume | null;
		resumeContext?: string;
		resumePlan?: Record<string, unknown> | null;
	};
	return {
		checkpoint: result.checkpoint ?? null,
		resumeContext: typeof result.resumeContext === "string" ? result.resumeContext : "",
		resumePlan:
			result.resumePlan && typeof result.resumePlan === "object" && !Array.isArray(result.resumePlan)
				? result.resumePlan
				: null,
	};
}
