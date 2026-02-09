/**
 * Prativedan — Load test reporting for Chitragupta.
 * Sanskrit: Prativedan (प्रतिवेदन) = report, statement.
 *
 * Formats LoadResult data into human-readable ASCII tables,
 * comparison deltas, JSON, and CSV exports. Pure functions,
 * no side effects.
 */

import type { LoadConfig, LoadResult } from "./load-runner.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LoadReport {
	/** Descriptive name for this test run. */
	name: string;
	/** ISO timestamp when the test started. */
	timestamp: string;
	/** Configuration used for this run. */
	config: LoadConfig;
	/** Measured results. */
	result: LoadResult;
	/** Scenario name (e.g. "health-check", "mixed-api"). */
	scenarioName: string;
}

// ─── ASCII Table Formatter ───────────────────────────────────────────────────

/**
 * Format a LoadReport as a human-readable ASCII table.
 *
 * ```
 * +--------------------------------------------+
 * | Load Test: health-check                     |
 * | Duration: 30s | Target RPS: 1000           |
 * +--------------+-----------------------------+
 * | Total        | 29,847 requests              |
 * | Success      | 29,845 (99.99%)              |
 * | Failed       | 2 (0.01%)                    |
 * | Throughput   | 994.9 req/s                  |
 * +--------------+-----------------------------+
 * | Latency p50  | 0.8ms                        |
 * | Latency p95  | 2.1ms                        |
 * | Latency p99  | 5.3ms                        |
 * | Latency avg  | 1.2ms                        |
 * | Latency max  | 45.2ms                       |
 * +--------------+-----------------------------+
 * ```
 */
export function formatReport(report: LoadReport): string {
	const { result, config } = report;
	const durationSec = (result.duration / 1000).toFixed(1);
	const successPct = result.totalRequests > 0
		? ((result.successfulRequests / result.totalRequests) * 100).toFixed(2)
		: "0.00";
	const failPct = result.totalRequests > 0
		? ((result.failedRequests / result.totalRequests) * 100).toFixed(2)
		: "0.00";

	const rows: [string, string][] = [
		["Total", `${fmt(result.totalRequests)} requests`],
		["Success", `${fmt(result.successfulRequests)} (${successPct}%)`],
		["Failed", `${fmt(result.failedRequests)} (${failPct}%)`],
		["Throughput", `${result.throughput.toFixed(1)} req/s`],
	];

	const latencyRows: [string, string][] = [
		["Latency p50", `${result.p50.toFixed(1)}ms`],
		["Latency p95", `${result.p95.toFixed(1)}ms`],
		["Latency p99", `${result.p99.toFixed(1)}ms`],
		["Latency avg", `${result.avgLatency.toFixed(1)}ms`],
		["Latency max", `${result.maxLatency.toFixed(1)}ms`],
		["Latency min", `${result.minLatency.toFixed(1)}ms`],
	];

	const col1Width = 14;
	const col2Width = 30;
	const totalWidth = col1Width + col2Width + 3; // 3 for | separators

	const hLine = `+${"-".repeat(col1Width)}+${"-".repeat(col2Width)}+`;
	const fullLine = `+${"-".repeat(totalWidth - 2)}+`;

	const lines: string[] = [];

	// Header
	lines.push(fullLine);
	lines.push(`| ${padRight(`Load Test: ${report.scenarioName}`, totalWidth - 4)} |`);
	lines.push(`| ${padRight(`Duration: ${durationSec}s | Target RPS: ${config.targetRps}`, totalWidth - 4)} |`);
	lines.push(hLine);

	// Request stats
	for (const [label, value] of rows) {
		lines.push(`| ${padRight(label, col1Width - 2)} | ${padRight(value, col2Width - 2)} |`);
	}

	lines.push(hLine);

	// Latency stats
	for (const [label, value] of latencyRows) {
		lines.push(`| ${padRight(label, col1Width - 2)} | ${padRight(value, col2Width - 2)} |`);
	}

	lines.push(hLine);

	// Errors (if any)
	if (result.errors.size > 0) {
		lines.push(`| ${padRight("Errors:", totalWidth - 4)} |`);
		for (const [msg, count] of result.errors) {
			const truncated = msg.length > totalWidth - 10
				? msg.slice(0, totalWidth - 13) + "..."
				: msg;
			lines.push(`|   ${padRight(`${truncated}: ${count}`, totalWidth - 6)} |`);
		}
		lines.push(fullLine);
	}

	return lines.join("\n");
}

// ─── Comparison ──────────────────────────────────────────────────────────────

/**
 * Compare two reports and show improvement/regression as percentages.
 */
export function compareReports(before: LoadReport, after: LoadReport): string {
	const b = before.result;
	const a = after.result;

	const lines: string[] = [];

	lines.push(`Comparison: "${before.name}" vs "${after.name}"`);
	lines.push("=".repeat(60));
	lines.push("");

	const metrics: [string, number, number, boolean][] = [
		// [label, before, after, higherIsBetter]
		["Throughput (req/s)", b.throughput, a.throughput, true],
		["p50 Latency (ms)", b.p50, a.p50, false],
		["p95 Latency (ms)", b.p95, a.p95, false],
		["p99 Latency (ms)", b.p99, a.p99, false],
		["Avg Latency (ms)", b.avgLatency, a.avgLatency, false],
		["Max Latency (ms)", b.maxLatency, a.maxLatency, false],
		["Error Rate", b.errorRate, a.errorRate, false],
	];

	for (const [label, bv, av, higherBetter] of metrics) {
		const delta = bv !== 0 ? ((av - bv) / bv) * 100 : 0;
		const sign = delta >= 0 ? "+" : "";
		const improved = higherBetter ? delta > 0 : delta < 0;
		const indicator = Math.abs(delta) < 1 ? "~" : improved ? "[OK]" : "[!!]";

		lines.push(
			`  ${padRight(label, 25)} ${padLeft(bv.toFixed(2), 10)} -> ${padLeft(av.toFixed(2), 10)}  ${sign}${delta.toFixed(1)}%  ${indicator}`,
		);
	}

	lines.push("");
	return lines.join("\n");
}

// ─── Export Formats ──────────────────────────────────────────────────────────

/** Export reports as JSON (for CI artifact storage). */
export function exportJson(reports: LoadReport[]): string {
	const serializable = reports.map((r) => ({
		...r,
		result: {
			...r.result,
			errors: Object.fromEntries(r.result.errors),
		},
	}));
	return JSON.stringify(serializable, null, 2);
}

/** Export reports as CSV (for spreadsheets). */
export function exportCsv(reports: LoadReport[]): string {
	const headers = [
		"name",
		"scenario",
		"timestamp",
		"targetRps",
		"duration_s",
		"totalRequests",
		"successfulRequests",
		"failedRequests",
		"throughput",
		"p50_ms",
		"p95_ms",
		"p99_ms",
		"avgLatency_ms",
		"maxLatency_ms",
		"minLatency_ms",
		"errorRate",
	];

	const rows = reports.map((r) => [
		csvEscape(r.name),
		csvEscape(r.scenarioName),
		csvEscape(r.timestamp),
		r.config.targetRps,
		r.config.duration,
		r.result.totalRequests,
		r.result.successfulRequests,
		r.result.failedRequests,
		r.result.throughput.toFixed(2),
		r.result.p50.toFixed(2),
		r.result.p95.toFixed(2),
		r.result.p99.toFixed(2),
		r.result.avgLatency.toFixed(2),
		r.result.maxLatency.toFixed(2),
		r.result.minLatency.toFixed(2),
		r.result.errorRate.toFixed(4),
	].join(","));

	return [headers.join(","), ...rows].join("\n");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number): string {
	return n.toLocaleString("en-US");
}

function padRight(s: string, len: number): string {
	return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

function padLeft(s: string, len: number): string {
	return s.length >= len ? s : " ".repeat(len - s.length) + s;
}

function csvEscape(s: string): string {
	if (s.includes(",") || s.includes('"') || s.includes("\n")) {
		return `"${s.replace(/"/g, '""')}"`;
	}
	return s;
}
