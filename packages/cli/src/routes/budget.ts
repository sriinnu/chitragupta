/**
 * Budget API Routes -- REST endpoints for cost tracking and budget status.
 *
 * Exposes the BudgetTracker state and historical usage data from the
 * usage-ledger.jsonl file. All file I/O errors return graceful defaults.
 *
 * @module routes/budget
 */

import fs from "node:fs";
import path from "node:path";
import { getChitraguptaHome } from "@chitragupta/core";

// ── Duck-Typed Interfaces ──────────────────────────────────────────────────

/** Duck-typed BudgetTracker -- avoids hard import dependency. */
interface BudgetTrackerLike {
	getStatus(): {
		sessionCost: number;
		dailyCost: number;
		sessionLimit: number;
		dailyLimit: number;
		sessionWarning: boolean;
		sessionExceeded: boolean;
		dailyWarning: boolean;
		dailyExceeded: boolean;
	};
	canProceed(): { allowed: boolean; reason?: string };
}

/** Single ledger entry persisted in usage-ledger.jsonl. */
interface LedgerEntry {
	date: string;
	cost: number;
	provider?: string;
	model?: string;
	sessionId?: string;
	timestamp: number;
}

/** Aggregated daily cost summary returned by the history endpoint. */
interface DailyAggregate {
	date: string;
	totalCost: number;
	entries: number;
}

/** Breakdown bucket for provider or model aggregation. */
interface BreakdownBucket {
	key: string;
	totalCost: number;
	entries: number;
}

/** Duck-typed server for route registration. */
interface ServerLike {
	route(
		method: string,
		path: string,
		handler: (req: {
			params: Record<string, string>;
			query: Record<string, string>;
			body: unknown;
			headers: Record<string, string>;
			requestId: string;
		}) => Promise<{ status: number; body: unknown }>,
	): void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Read and parse all entries from the usage ledger file. */
function readLedger(): LedgerEntry[] {
	const ledgerPath = path.join(getChitraguptaHome(), "usage-ledger.jsonl");
	try {
		if (!fs.existsSync(ledgerPath)) return [];
		const raw = fs.readFileSync(ledgerPath, "utf-8");
		const entries: LedgerEntry[] = [];
		for (const line of raw.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				const parsed = JSON.parse(trimmed) as Record<string, unknown>;
				if (typeof parsed.date === "string" && typeof parsed.cost === "number" && typeof parsed.timestamp === "number") {
					entries.push(parsed as unknown as LedgerEntry);
				}
			} catch {
				// Skip malformed lines
			}
		}
		return entries;
	} catch {
		return [];
	}
}

/** Calculate the cutoff timestamp for a given range string. */
function rangeCutoff(range: string): number {
	const now = Date.now();
	if (range === "7d") return now - 7 * 24 * 60 * 60 * 1000;
	if (range === "30d") return now - 30 * 24 * 60 * 60 * 1000;
	return 0; // "all" -- no cutoff
}

// ── Route Mounter ──────────────────────────────────────────────────────────

/**
 * Mount budget-related API routes onto the server.
 *
 * @param server           - ChitraguptaServer instance (duck-typed)
 * @param getBudgetTracker - Lazy getter for the active BudgetTracker
 */
export function mountBudgetRoutes(
	server: ServerLike,
	getBudgetTracker: () => BudgetTrackerLike | undefined,
): void {
	// ── GET /api/budget/status ─────────────────────────────────────
	server.route("GET", "/api/budget/status", async () => {
		const tracker = getBudgetTracker();
		if (!tracker) {
			return { status: 503, body: { error: "Budget tracker not available" } };
		}
		try {
			const status = tracker.getStatus();
			const proceed = tracker.canProceed();
			return { status: 200, body: { ...status, canProceed: proceed } };
		} catch (err) {
			return { status: 500, body: { error: `Budget status failed: ${(err as Error).message}` } };
		}
	});

	// ── GET /api/budget/history ────────────────────────────────────
	server.route("GET", "/api/budget/history", async () => {
		try {
			const entries = readLedger();
			const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
			const recent = entries.filter((e) => e.timestamp >= cutoff);

			// Aggregate by date
			const byDate = new Map<string, DailyAggregate>();
			for (const entry of recent) {
				const existing = byDate.get(entry.date);
				if (existing) {
					existing.totalCost += entry.cost;
					existing.entries += 1;
				} else {
					byDate.set(entry.date, { date: entry.date, totalCost: entry.cost, entries: 1 });
				}
			}

			const history = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
			return { status: 200, body: { history } };
		} catch (err) {
			return { status: 500, body: { error: `Budget history failed: ${(err as Error).message}` } };
		}
	});

	// ── GET /api/budget/breakdown ──────────────────────────────────
	server.route("GET", "/api/budget/breakdown", async (req) => {
		try {
			const range = req.query.range ?? "30d";
			const cutoff = rangeCutoff(range);
			const entries = readLedger().filter((e) => e.timestamp >= cutoff);

			// Aggregate by provider
			const byProvider = new Map<string, BreakdownBucket>();
			for (const entry of entries) {
				const key = entry.provider ?? "unknown";
				const existing = byProvider.get(key);
				if (existing) {
					existing.totalCost += entry.cost;
					existing.entries += 1;
				} else {
					byProvider.set(key, { key, totalCost: entry.cost, entries: 1 });
				}
			}

			// Aggregate by model
			const byModel = new Map<string, BreakdownBucket>();
			for (const entry of entries) {
				const key = entry.model ?? "unknown";
				const existing = byModel.get(key);
				if (existing) {
					existing.totalCost += entry.cost;
					existing.entries += 1;
				} else {
					byModel.set(key, { key, totalCost: entry.cost, entries: 1 });
				}
			}

			return {
				status: 200,
				body: {
					range,
					totalCost: entries.reduce((sum, e) => sum + e.cost, 0),
					totalEntries: entries.length,
					byProvider: Array.from(byProvider.values()),
					byModel: Array.from(byModel.values()),
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Budget breakdown failed: ${(err as Error).message}` } };
		}
	});
}
