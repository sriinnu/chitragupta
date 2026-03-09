import type { DaemonAuthContext } from "./auth.js";
import type { RpcNotification } from "./protocol.js";

/** Invocation metadata attached to an RPC call. */
export interface RpcInvocationContext {
	clientId?: string;
	transport?: "socket" | "http" | "internal" | "unknown";
	kind?: "request" | "notification";
	auth?: DaemonAuthContext;
}

/** Handler function for a single RPC method. */
export type RpcHandler = (
	params: Record<string, unknown>,
	context?: RpcInvocationContext,
) => Promise<unknown>;

/** Method metadata for introspection. */
export interface MethodMeta {
	name: string;
	description: string;
}

/** Derived pattern summary from repeated observations. */
export interface RpcPatternSummary {
	clientId: string;
	key: string;
	type: string;
	entity: string | null;
	severity: string | null;
	count: number;
	lastSeenAt: number;
	sample: string;
}

/** Normalized observation retained in router memory. */
export interface RpcObservationRecord {
	clientId: string;
	recordedAt: number;
	type: string;
	entity: string | null;
	severity: string | null;
	summary: string;
	data: Record<string, unknown>;
}

/** Snapshot of a connected client tracked by the daemon. */
export interface RpcClientSnapshot {
	id: string;
	transport: "socket" | "http" | "internal" | "unknown";
	connectedAt: number;
	lastSeenAt: number;
	requestCount: number;
	notificationCount: number;
	preferences: Record<string, unknown>;
	observationCount: number;
	lastObservationAt: number | null;
	topPatterns: RpcPatternSummary[];
}

/** Notification delivery surface supplied by the daemon socket server. */
export type RpcNotifier = (notification: RpcNotification, targetClientIds?: readonly string[]) => number;

export interface TrackedClient {
	id: string;
	transport: "socket" | "http" | "internal" | "unknown";
	connectedAt: number;
	lastSeenAt: number;
	requestCount: number;
	notificationCount: number;
	preferences: Record<string, unknown>;
	observations: RpcObservationRecord[];
	patterns: Map<string, RpcPatternSummary>;
	lastObservationAt: number | null;
}
