/**
 * Cognitive system signals for the consciousness dashboard.
 *
 * Fetchers for Triguna health, Vasana tendencies, Nidra sleep state,
 * Vidhi procedures, and Turiya routing stats. All data is fetched
 * from existing backend endpoints and cached in Preact signals.
 * @module signals/cognitive
 */

import { signal } from "@preact/signals";
import { apiGet } from "../api.js";

// ── Types ─────────────────────────────────────────────────────────

/** Triguna guna breakdown from /api/health/guna (matches backend shape). */
export interface TrigunaData {
	state: {
		sattva: number;
		rajas: number;
		tamas: number;
	};
	dominant: "sattva" | "rajas" | "tamas";
	trend: {
		sattva: string;
		rajas: string;
		tamas: string;
	};
	mode: "harmonious" | "hyperactive" | "degraded";
}

/** Vasana (learned tendency) entry from /api/vasanas (matches backend VasanaLike). */
export interface VasanaEntry {
	id: string;
	tendency: string;
	strength: number;
	stability: number;
	valence: "positive" | "negative" | "neutral";
	reinforcementCount: number;
	lastActivated: number;
	description?: string;
	predictiveAccuracy?: number;
}

/** Nidra (sleep/consolidation) status from /api/nidra/status (matches NidraSnapshotLike). */
export interface NidraData {
	state: string;
	lastStateChange: number;
	lastHeartbeat: number;
	lastConsolidationStart?: number;
	lastConsolidationEnd?: number;
	consolidationPhase?: string;
	consolidationProgress: number;
	uptime: number;
}

/** Vidhi (procedure) entry from /api/vidhi (matches backend VidhiLike). */
export interface VidhiEntry {
	id: string;
	name: string;
	steps: Array<{ index: number; toolName: string; description: string }>;
	successRate: number;
	successCount: number;
	failureCount: number;
	confidence?: number;
}

/** Turiya (routing) stats from /api/turiya/status (matches backend shape). */
export interface TuriyaStats {
	totalRequests: number;
	totalCost: number;
	opusBaselineCost: number;
	costSavings: number;
	savingsPercent: number;
	activeTiers: string[];
}

// ── Signals ───────────────────────────────────────────────────────

/** Triguna guna health data. `null` until first fetch. */
export const trigunaData = signal<TrigunaData | null>(null);

/** List of all Vasana tendencies. */
export const vasanas = signal<VasanaEntry[]>([]);

/** Nidra sleep/consolidation status. `null` until first fetch. */
export const nidraData = signal<NidraData | null>(null);

/** List of all Vidhi procedures. */
export const vidhis = signal<VidhiEntry[]>([]);

/** Turiya routing statistics. `null` until first fetch. */
export const turiyaStats = signal<TuriyaStats | null>(null);

/** Whether any cognitive fetch is in-flight. */
export const cognitiveLoading = signal<boolean>(false);

// ── Fetchers ──────────────────────────────────────────────────────

/**
 * Fetch Triguna guna health breakdown.
 * Updates the `trigunaData` signal on success.
 */
export async function fetchTriguna(): Promise<void> {
	try {
		const data = await apiGet<TrigunaData>("/api/health/guna");
		trigunaData.value = data;
	} catch {
		// Triguna fetch is best-effort; signal retains last value
	}
}

/**
 * Fetch all Vasana tendencies.
 * Updates the `vasanas` signal on success.
 */
export async function fetchVasanas(): Promise<void> {
	try {
		const data = await apiGet<{ vasanas: VasanaEntry[] }>("/api/vasanas");
		vasanas.value = data.vasanas ?? [];
	} catch {
		// best-effort
	}
}

/**
 * Fetch Nidra sleep/consolidation status.
 * Updates the `nidraData` signal on success.
 */
export async function fetchNidra(): Promise<void> {
	try {
		const data = await apiGet<NidraData>("/api/nidra/status");
		nidraData.value = data;
	} catch {
		// best-effort
	}
}

/**
 * Fetch all Vidhi procedures.
 * Updates the `vidhis` signal on success.
 */
export async function fetchVidhis(): Promise<void> {
	try {
		const data = await apiGet<{ vidhis: VidhiEntry[] }>("/api/vidhi");
		vidhis.value = data.vidhis ?? [];
	} catch {
		// best-effort
	}
}

/**
 * Fetch Turiya routing statistics.
 * Updates the `turiyaStats` signal on success.
 */
export async function fetchTuriyaStats(): Promise<void> {
	try {
		const data = await apiGet<TuriyaStats>("/api/turiya/status");
		turiyaStats.value = data;
	} catch {
		// best-effort
	}
}

/**
 * Fetch all cognitive data in parallel.
 * Sets `cognitiveLoading` during the fetch and clears it on completion.
 */
export async function fetchAllCognitive(): Promise<void> {
	cognitiveLoading.value = true;
	try {
		await Promise.all([
			fetchTriguna(),
			fetchVasanas(),
			fetchNidra(),
			fetchVidhis(),
			fetchTuriyaStats(),
		]);
	} finally {
		cognitiveLoading.value = false;
	}
}
