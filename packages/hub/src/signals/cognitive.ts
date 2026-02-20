/**
 * Cognitive system signals for the consciousness dashboard.
 * Fetchers for Triguna, Vasana, Nidra, Vidhi, and Turiya v2 stats.
 * @module signals/cognitive
 */

import { signal } from "@preact/signals";
import { apiGet, apiPost } from "../api.js";

// ── Types ─────────────────────────────────────────────────────────

/** Triguna guna breakdown from /api/health/guna. */
export interface TrigunaData {
	state: { sattva: number; rajas: number; tamas: number };
	dominant: "sattva" | "rajas" | "tamas";
	trend: { sattva: string; rajas: string; tamas: string };
	mode: "harmonious" | "hyperactive" | "degraded";
}

/** Vasana (learned tendency) entry from /api/vasanas. */
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

/** Nidra (sleep/consolidation) status from /api/nidra/status. */
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

/** Vidhi (procedure) entry from /api/vidhi. */
export interface VidhiEntry {
	id: string;
	name: string;
	steps: Array<{ index: number; toolName: string; description: string }>;
	successRate: number;
	successCount: number;
	failureCount: number;
	confidence?: number;
}

/** Turiya routing stats from /api/turiya/status. */
export interface TuriyaStats {
	totalRequests: number;
	totalCost: number;
	opusBaselineCost: number;
	costSavings: number;
	savingsPercent: number;
	activeTiers: string[];
}

/** Turiya budget state from /api/turiya/budget-state. */
export interface TuriyaBudgetState {
	budgetLambda: number;
	dailySpend: number;
	totalRequests: number;
	savingsPercent: number;
}

// ── Signals ───────────────────────────────────────────────────────

export const trigunaData = signal<TrigunaData | null>(null);
export const vasanas = signal<VasanaEntry[]>([]);
export const nidraData = signal<NidraData | null>(null);
export const vidhis = signal<VidhiEntry[]>([]);
export const turiyaStats = signal<TuriyaStats | null>(null);
export const cognitiveLoading = signal<boolean>(false);

/** Turiya budget state (lambda, daily spend, savings). */
export const turiyaBudgetState = signal<TuriyaBudgetState | null>(null);

/** User preference dial: 0 = cheapest, 1 = best quality. */
export const turiyaPreference = signal<number>(0.5);

// ── Fetchers ──────────────────────────────────────────────────────

export async function fetchTriguna(): Promise<void> {
	try {
		trigunaData.value = await apiGet<TrigunaData>("/api/health/guna");
	} catch { /* best-effort */ }
}

export async function fetchVasanas(): Promise<void> {
	try {
		const data = await apiGet<{ vasanas: VasanaEntry[] }>("/api/vasanas");
		vasanas.value = data.vasanas ?? [];
	} catch { /* best-effort */ }
}

export async function fetchNidra(): Promise<void> {
	try {
		nidraData.value = await apiGet<NidraData>("/api/nidra/status");
	} catch { /* best-effort */ }
}

export async function fetchVidhis(): Promise<void> {
	try {
		const data = await apiGet<{ vidhis: VidhiEntry[] }>("/api/vidhi");
		vidhis.value = data.vidhis ?? [];
	} catch { /* best-effort */ }
}

export async function fetchTuriyaStats(): Promise<void> {
	try {
		turiyaStats.value = await apiGet<TuriyaStats>("/api/turiya/status");
	} catch { /* best-effort */ }
}

/** Fetch Turiya budget state (lambda, daily spend). */
export async function fetchTuriyaBudgetState(): Promise<void> {
	try {
		turiyaBudgetState.value = await apiGet<TuriyaBudgetState>("/api/turiya/budget-state");
	} catch { /* best-effort */ }
}

/** Push the user's cost/quality preference dial to the backend. */
export async function setTuriyaPreference(costWeight: number): Promise<void> {
	turiyaPreference.value = costWeight;
	try {
		await apiPost("/api/turiya/preference", { costWeight });
	} catch { /* best-effort — preference is still applied locally */ }
}

/** Fetch all cognitive data in parallel. */
export async function fetchAllCognitive(): Promise<void> {
	cognitiveLoading.value = true;
	try {
		await Promise.all([
			fetchTriguna(),
			fetchVasanas(),
			fetchNidra(),
			fetchVidhis(),
			fetchTuriyaStats(),
			fetchTuriyaBudgetState(),
		]);
	} finally {
		cognitiveLoading.value = false;
	}
}
