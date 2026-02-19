/**
 * @chitragupta/anina — Daemon periodic operations.
 *
 * Standalone async functions for monthly/yearly consolidation, periodic
 * backfill, day-file archiving, and long-timeout scheduling. Extracted
 * from ChitraguptaDaemon to keep the main class under 450 LOC.
 */

import fs from "node:fs";
import path from "node:path";
import type { ConsolidationEvent, ChitraguptaDaemonConfig } from "./chitragupta-daemon.js";

/** Callback for emitting consolidation events. */
export type EmitFn = (event: string, data: ConsolidationEvent | Error | string) => void;

// ─── Date Formatting ────────────────────────────────────────────────────────

/** Format a Date as YYYY-MM-DD. */
export function formatDate(date: Date): string {
	const yyyy = date.getFullYear();
	const mm = (date.getMonth() + 1).toString().padStart(2, "0");
	const dd = date.getDate().toString().padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

// ─── Long Timeout Scheduling ────────────────────────────────────────────────

/** Max safe setTimeout value (2^31 - 1 ms ~ 24.8 days). */
const MAX_TIMEOUT = 2_147_483_647;

/**
 * Schedule a callback at an absolute target time, handling setTimeout's 32-bit limit.
 * If targetTime exceeds MAX_TIMEOUT from now, re-schedules in chunks.
 */
export function scheduleLongTimeout(
	callback: () => Promise<void>,
	targetTime: number,
	isRunning: () => boolean,
): ReturnType<typeof setTimeout> {
	const remaining = targetTime - Date.now();
	if (remaining <= 0) {
		const timer = setTimeout(() => { if (isRunning()) callback(); }, 0);
		if (timer.unref) timer.unref();
		return timer;
	}
	const delay = Math.min(remaining, MAX_TIMEOUT);
	const timer = setTimeout(() => {
		if (!isRunning()) return;
		if (Date.now() >= targetTime) {
			callback();
		} else {
			scheduleLongTimeout(callback, targetTime, isRunning);
		}
	}, delay);
	if (timer.unref) timer.unref();
	return timer;
}

// ─── Monthly Consolidation ──────────────────────────────────────────────────

/** Consolidate last month's data for all projects. */
export async function consolidateLastMonth(emit: EmitFn): Promise<void> {
	const now = new Date();
	const lastMonth = now.getMonth() === 0 ? 12 : now.getMonth();
	const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
	const dateLabel = `monthly-${year}-${String(lastMonth).padStart(2, "0")}`;

	emit("consolidation", { type: "start", date: dateLabel });

	try {
		const { PeriodicConsolidation } = await import("@chitragupta/smriti/periodic-consolidation");
		const { listSessionProjects } = await import("@chitragupta/smriti/session-store");
		const projectEntries = listSessionProjects();

		for (const entry of projectEntries) {
			try {
				const pc = new PeriodicConsolidation({ project: entry.project });
				if (!pc.hasMonthlyReport(year, lastMonth)) {
					await pc.monthly(year, lastMonth);
					emit("consolidation", {
						type: "progress", date: dateLabel, phase: "monthly", detail: entry.project,
					});
				}
			} catch (err) {
				emit("consolidation", {
					type: "error", date: dateLabel,
					detail: `${entry.project}: ${err instanceof Error ? err.message : String(err)}`,
				});
			}
		}
		emit("consolidation", { type: "complete", date: dateLabel });
	} catch (err) {
		emit("consolidation", {
			type: "error", date: dateLabel,
			detail: err instanceof Error ? err.message : String(err),
		});
	}
}

// ─── Yearly Consolidation ───────────────────────────────────────────────────

/** Consolidate last year's data for all projects. */
export async function consolidateLastYear(emit: EmitFn): Promise<void> {
	const lastYear = new Date().getFullYear() - 1;
	const dateLabel = `yearly-${lastYear}`;

	emit("consolidation", { type: "start", date: dateLabel });

	try {
		const { PeriodicConsolidation } = await import("@chitragupta/smriti/periodic-consolidation");
		const { listSessionProjects } = await import("@chitragupta/smriti/session-store");
		const projectEntries = listSessionProjects();

		for (const entry of projectEntries) {
			try {
				const pc = new PeriodicConsolidation({ project: entry.project });
				if (!pc.hasYearlyReport(lastYear)) {
					await pc.yearly(lastYear);
					emit("consolidation", {
						type: "progress", date: dateLabel, phase: "yearly", detail: entry.project,
					});
				}
			} catch (err) {
				emit("consolidation", {
					type: "error", date: dateLabel,
					detail: `${entry.project}: ${err instanceof Error ? err.message : String(err)}`,
				});
			}
		}
		emit("consolidation", { type: "complete", date: dateLabel });
	} catch (err) {
		emit("consolidation", {
			type: "error", date: dateLabel,
			detail: err instanceof Error ? err.message : String(err),
		});
	}
}

// ─── Backfill Periodic Reports ──────────────────────────────────────────────

/**
 * Backfill missing periodic reports and vector indices on startup.
 * Checks last 3 months for missing monthly reports and last year for yearly.
 */
export async function backfillPeriodicReports(
	config: ChitraguptaDaemonConfig,
	emit: EmitFn,
	archiveFn: () => Promise<number>,
): Promise<void> {
	try {
		const { PeriodicConsolidation } = await import("@chitragupta/smriti/periodic-consolidation");
		const { listSessionProjects } = await import("@chitragupta/smriti/session-store");
		const projectEntries = listSessionProjects();
		const now = new Date();

		for (const entry of projectEntries) {
			const pc = new PeriodicConsolidation({ project: entry.project });
			for (let i = 1; i <= 3; i++) {
				const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
				const year = d.getFullYear();
				const month = d.getMonth() + 1;
				if (!pc.hasMonthlyReport(year, month)) {
					try { await pc.monthly(year, month); } catch { /* skip */ }
				}
			}
			const lastYear = now.getFullYear() - 1;
			if (!pc.hasYearlyReport(lastYear)) {
				try { await pc.yearly(lastYear); } catch { /* skip */ }
			}
		}

		try {
			const { backfillConsolidationIndices } = await import("@chitragupta/smriti/consolidation-indexer");
			await backfillConsolidationIndices();
		} catch { /* best-effort */ }

		await archiveFn();
	} catch {
		// Best-effort — don't break startup
	}
}

// ─── Day File Archiving ─────────────────────────────────────────────────────

/**
 * Archive day files older than the retention window.
 * Moves from `<home>/days/YYYY/MM/DD.md` to `<home>/archive/days/YYYY/MM/DD.md`.
 */
export async function archiveOldDayFiles(
	config: ChitraguptaDaemonConfig,
	emit: EmitFn,
): Promise<number> {
	if (config.dayFileRetentionMonths <= 0) return 0;

	try {
		const { listDayFiles, getDayFilePath } = await import("@chitragupta/smriti/day-consolidation");
		const { getChitraguptaHome } = await import("@chitragupta/core");
		const cutoff = new Date();
		cutoff.setMonth(cutoff.getMonth() - config.dayFileRetentionMonths);
		cutoff.setHours(0, 0, 0, 0);
		const home = getChitraguptaHome();

		let archived = 0;
		for (const date of listDayFiles()) {
			const parts = date.split("-").map((v) => Number.parseInt(v, 10));
			if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value))) continue;
			const dayTs = new Date(parts[0], parts[1] - 1, parts[2]).getTime();
			if (dayTs >= cutoff.getTime()) continue;

			const sourcePath = getDayFilePath(date);
			if (!fs.existsSync(sourcePath)) continue;

			const [year, month, day] = date.split("-");
			const archivePath = path.join(home, "archive", "days", year, month, `${day}.md`);
			fs.mkdirSync(path.dirname(archivePath), { recursive: true });

			try {
				fs.renameSync(sourcePath, archivePath);
			} catch {
				fs.copyFileSync(sourcePath, archivePath);
				fs.unlinkSync(sourcePath);
			}
			archived += 1;
		}

		if (archived > 0) {
			emit("consolidation", {
				type: "progress",
				date: formatDate(new Date()),
				phase: "archive-days",
				detail: `${archived} day files archived (> ${config.dayFileRetentionMonths} months old)`,
			});
		}
		return archived;
	} catch {
		return 0;
	}
}
