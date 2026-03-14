import type { RpcInvocationContext } from "./rpc-router.js";

export type SabhaPerspectivePosition = "support" | "oppose" | "abstain" | "observe";

export interface SabhaPerspectiveEvidence {
	label: string;
	detail: string;
	source?: string;
}

export interface SabhaPerspective {
	participantId: string;
	submittedAt: number;
	summary: string;
	reasoning: string;
	position: SabhaPerspectivePosition;
	recommendedAction: string | null;
	evidence: SabhaPerspectiveEvidence[];
	clientId: string | null;
	transport: RpcInvocationContext["transport"] | "unknown";
	metadata: Record<string, unknown>;
}

export interface SabhaMeshBinding {
	participantId: string;
	target: string;
	mode: "ask" | "tell";
	timeoutMs: number;
	topic?: string;
	resolvedTarget?: string;
	resolvedAt?: number;
}

export interface SabhaMeshDispatchRecord {
	participantId: string;
	target: string;
	mode: "ask" | "tell";
	status: "pending" | "delivered" | "replied" | "accepted" | "failed";
	attemptedAt: number;
	completedAt?: number;
	error?: string;
	replySummary?: string;
	replyFrom?: string;
	resolvedTarget?: string;
	leaseOwner?: string;
	leaseExpiresAt?: number;
	resumed?: boolean;
}

export interface SabhaEventRecord {
	sabhaId: string;
	eventId: string;
	revision: number;
	parentRevision: number;
	eventType: string;
	createdAt: number;
	payload: Record<string, unknown>;
}

export type SabhaResumeAction =
	| "resume-mesh-dispatches"
	| "await-perspectives"
	| "deliberate"
	| "inspect-failed-dispatches"
	| "complete"
	| "none";

/** Machine-usable timeout-pickup summary for a Sabha consultation. */
export interface SabhaResumePlan {
	sabhaId: string;
	revision: number;
	status: string;
	nextAction: SabhaResumeAction;
	pendingParticipantIds: string[];
	pendingDispatchParticipantIds: string[];
	failedDispatchParticipantIds: string[];
	needsHumanReview: boolean;
	detail: string | null;
}
