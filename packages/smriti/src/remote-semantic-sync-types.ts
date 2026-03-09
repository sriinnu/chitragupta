import type { CuratedConsolidationArtifact } from "./consolidation-indexer.js";

export interface RemoteSemanticMirrorConfig {
	provider: "qdrant";
	baseUrl: string;
	apiKey?: string;
	collection: string;
	timeoutMs: number;
	batchSize: number;
}

export interface RemoteSemanticSyncIssue {
	id: string;
	level: CuratedConsolidationArtifact["level"];
	period: string;
	project?: string;
	reason: "missing_remote" | "stale_remote" | "remote_error";
	error?: string | null;
}

export interface RemoteSemanticSyncStatus {
	enabled: boolean;
	provider: "qdrant" | "disabled";
	configured: boolean;
	scanned: number;
	syncedCount: number;
	missingCount: number;
	driftCount: number;
	lastSyncAt: string | null;
	lastError: string | null;
	collection?: string;
	baseUrl?: string;
	remoteHealth?: {
		ok: boolean;
		status?: number;
		error?: string;
		durationMs?: number;
	};
	issues: RemoteSemanticSyncIssue[];
}

export interface RemoteSemanticSyncResult {
	status: RemoteSemanticSyncStatus;
	synced: number;
}
