import type { CuratedConsolidationArtifact } from "./consolidation-indexer.js";

/**
 * Configuration for the engine-owned remote semantic mirror.
 */
export interface RemoteSemanticMirrorConfig {
	provider: "qdrant";
	baseUrl: string;
	apiKey?: string;
	collection: string;
	timeoutMs: number;
	batchSize: number;
}

/**
 * Drift or quality issue detected while comparing curated local artifacts
 * against the remote semantic mirror.
 */
export interface RemoteSemanticSyncIssue {
	id: string;
	level: CuratedConsolidationArtifact["level"];
	period: string;
	project?: string;
	reason:
		| "deferred_quality"
		| "missing_remote"
		| "stale_remote"
		| "stale_remote_epoch"
		| "stale_remote_quality"
		| "remote_error";
	error?: string | null;
}

/**
 * Inspection snapshot for the remote semantic mirror.
 */
export interface RemoteSemanticSyncStatus {
	enabled: boolean;
	provider: "qdrant" | "disabled";
	configured: boolean;
	scanned: number;
	syncedCount: number;
	missingCount: number;
	driftCount: number;
	qualityDeferredCount: number;
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

/**
 * Result returned from a remote semantic sync run.
 */
export interface RemoteSemanticSyncResult {
	status: RemoteSemanticSyncStatus;
	synced: number;
}
