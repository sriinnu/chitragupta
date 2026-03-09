import type { MeshEnvelope } from "./types.js";

export type RouterEvent =
	| { type: "delivered"; envelope: MeshEnvelope }
	| { type: "undeliverable"; envelope: MeshEnvelope; reason: string }
	| { type: "broadcast"; envelope: MeshEnvelope; recipientCount: number };

export type RouterEventHandler = (event: RouterEvent) => void;

export interface PendingAsk {
	resolve: (envelope: MeshEnvelope) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

export const DEFAULT_TTL = 30_000;
export const DEFAULT_ASK_TIMEOUT = 10_000;
