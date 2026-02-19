/**
 * @chitragupta/smriti — Day Consolidation Query API
 *
 * Read, list, search, and check day files. Extracted from
 * day-consolidation.ts to keep files under 450 LOC.
 */

import fs from "fs";
import path from "path";
import { getDaysRoot, getDayFilePath } from "./day-consolidation.js";

// ─── Query API ──────────────────────────────────────────────────────────────

/**
 * Read a consolidated day file.
 *
 * @param date - Date in YYYY-MM-DD format.
 * @returns The day file content, or null if not consolidated yet.
 */
export function readDayFile(date: string): string | null {
	const dayPath = getDayFilePath(date);
	if (!fs.existsSync(dayPath)) return null;
	return fs.readFileSync(dayPath, "utf-8");
}

/**
 * List all consolidated day files.
 * Returns dates in YYYY-MM-DD format, most recent first.
 *
 * @returns Array of date strings sorted most-recent-first.
 */
export function listDayFiles(): string[] {
	const daysRoot = getDaysRoot();
	if (!fs.existsSync(daysRoot)) return [];

	const dates: string[] = [];

	try {
		const years = fs.readdirSync(daysRoot, { withFileTypes: true });
		for (const year of years) {
			if (!year.isDirectory()) continue;
			const yearPath = path.join(daysRoot, year.name);
			const months = fs.readdirSync(yearPath, { withFileTypes: true });
			for (const month of months) {
				if (!month.isDirectory()) continue;
				const monthPath = path.join(yearPath, month.name);
				const days = fs.readdirSync(monthPath);
				for (const day of days) {
					if (!day.endsWith(".md")) continue;
					const dd = day.replace(".md", "");
					dates.push(`${year.name}-${month.name}-${dd}`);
				}
			}
		}
	} catch {
		// Best-effort
	}

	return dates.sort().reverse();
}

/**
 * Search across all day files for a query string (case-insensitive).
 * Returns matching day files with context snippets.
 *
 * @param query - Case-insensitive search string.
 * @param options - Optional limit on results (default 10).
 * @returns Array of matching day entries with line-level matches.
 */
export function searchDayFiles(
	query: string,
	options?: { limit?: number },
): Array<{ date: string; matches: Array<{ line: number; text: string }> }> {
	const limit = options?.limit ?? 10;
	const dates = listDayFiles();
	const results: Array<{ date: string; matches: Array<{ line: number; text: string }> }> = [];
	const queryLower = query.toLowerCase();

	for (const date of dates) {
		if (results.length >= limit) break;

		const content = readDayFile(date);
		if (!content) continue;

		const lines = content.split("\n");
		const matches: Array<{ line: number; text: string }> = [];

		for (let i = 0; i < lines.length; i++) {
			if (lines[i].toLowerCase().includes(queryLower)) {
				matches.push({ line: i + 1, text: lines[i].trim() });
			}
		}

		if (matches.length > 0) {
			results.push({ date, matches: matches.slice(0, 5) }); // Max 5 matches per day
		}
	}

	return results;
}

/**
 * Check if a date has been consolidated.
 *
 * @param date - Date in YYYY-MM-DD format.
 * @returns True if the day file exists.
 */
export function isDayConsolidated(date: string): boolean {
	return fs.existsSync(getDayFilePath(date));
}

/**
 * Get dates that have sessions but haven't been consolidated yet.
 *
 * @param limit - Maximum number of dates to return (default 30).
 * @returns Array of unconsolidated date strings.
 */
export async function getUnconsolidatedDates(limit?: number): Promise<string[]> {
	const { listSessionDates } = await import("./session-store.js");
	const sessionDates = listSessionDates();
	const unconsolidated: string[] = [];

	for (const date of sessionDates) {
		if (unconsolidated.length >= (limit ?? 30)) break;
		if (!isDayConsolidated(date)) {
			unconsolidated.push(date);
		}
	}

	return unconsolidated;
}
