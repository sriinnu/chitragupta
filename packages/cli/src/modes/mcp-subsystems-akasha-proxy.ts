import type { AkashaFieldLike } from "./mcp-subsystems-types.js";
import type { DaemonAkashaProxy } from "./mcp-subsystems-lucy-types.js";

export function isDaemonAkashaProxy(value: AkashaFieldLike | undefined): value is DaemonAkashaProxy {
	return Boolean(value && (value as unknown as Record<string, unknown>).__daemonProxy === true);
}

export async function createDaemonAkashaProxy(): Promise<DaemonAkashaProxy> {
	const {
		getAkashaStatsViaDaemon,
		leaveAkashaViaDaemon,
		onDaemonNotification,
		queryAkashaViaDaemon,
		strongestAkashaViaDaemon,
	} = await import("./daemon-bridge.js");
	await getAkashaStatsViaDaemon();

	const listeners = new Set<(event: { type: string; trace?: unknown }) => void>();
	let notificationBound = false;
	const bindNotifications = async (): Promise<void> => {
		if (notificationBound) return;
		notificationBound = true;
		await onDaemonNotification("akasha.trace_added", (params) => {
			const event = {
				type: typeof params?.type === "string" ? params.type : "trace_added",
				trace: params?.trace,
			};
			for (const listener of listeners) listener(event);
		});
	};

	return {
		__daemonProxy: true,
		async query(topic: string, opts?: { type?: string; limit?: number }) {
			return queryAkashaViaDaemon(topic, opts) as Promise<Array<{
				id: string;
				agentId: string;
				traceType: string;
				topic: string;
				content: string;
				strength: number;
				reinforcements: number;
			}>>;
		},
		async leave(agentId: string, type: string, topic: string, content: string, metadata?: Record<string, unknown>) {
			return leaveAkashaViaDaemon({ agentId, type, topic, content, metadata }) as Promise<{ id: string }>;
		},
		async strongest(limit?: number) {
			return strongestAkashaViaDaemon(limit ?? 20);
		},
		async stats() {
			return getAkashaStatsViaDaemon();
		},
		setOnEvent(handler: (event: { type: string; trace?: unknown }) => void): void {
			listeners.add(handler);
			void bindNotifications();
		},
	};
}
