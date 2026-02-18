#!/usr/bin/env tsx
/**
 * Consolidation benchmark harness.
 *
 * Measures linear day-file search vs hierarchical temporal search latency
 * across a query set and prints p50/p95 summaries.
 */

import { performance } from "node:perf_hooks";
import process from "node:process";
import { listDayFiles, searchDayFiles } from "../packages/smriti/src/day-consolidation.js";
import { hierarchicalTemporalSearch } from "../packages/smriti/src/hierarchical-temporal-search.js";
import { PeriodicConsolidation } from "../packages/smriti/src/periodic-consolidation.js";

type Args = {
	runs: number;
	limit: number;
	project: string;
	json: boolean;
	queries: string[];
};

type LatencyStats = {
	label: string;
	runs: number;
	hitCount: number;
	minMs: number;
	p50Ms: number;
	p95Ms: number;
	maxMs: number;
	avgMs: number;
};

function parseArgs(argv: string[]): Args {
	const args: Args = {
		runs: 20,
		limit: 10,
		project: process.cwd(),
		json: false,
		queries: [],
	};

	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		switch (token) {
			case "--runs":
				args.runs = Math.max(1, Number.parseInt(argv[i + 1] ?? "20", 10) || 20);
				i += 1;
				break;
			case "--limit":
				args.limit = Math.max(1, Number.parseInt(argv[i + 1] ?? "10", 10) || 10);
				i += 1;
				break;
			case "--project":
				args.project = argv[i + 1] ?? process.cwd();
				i += 1;
				break;
			case "--query":
				if (argv[i + 1]) args.queries.push(argv[i + 1]);
				i += 1;
				break;
			case "--json":
				args.json = true;
				break;
		}
	}

	if (args.queries.length === 0) {
		args.queries = [
			"auth bug fix",
			"deployment issue",
			"memory preferences",
			"tool failure",
			"routing decision",
		];
	}

	return args;
}

function percentile(sortedValues: number[], p: number): number {
	if (sortedValues.length === 0) return 0;
	if (sortedValues.length === 1) return sortedValues[0];
	const idx = Math.min(
		sortedValues.length - 1,
		Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1),
	);
	return sortedValues[idx];
}

function summarize(label: string, durations: number[], hits: number[]): LatencyStats {
	const sorted = [...durations].sort((a, b) => a - b);
	const hitCount = hits.reduce((sum, n) => sum + n, 0);
	const total = durations.reduce((sum, n) => sum + n, 0);
	return {
		label,
		runs: durations.length,
		hitCount,
		minMs: sorted[0] ?? 0,
		p50Ms: percentile(sorted, 50),
		p95Ms: percentile(sorted, 95),
		maxMs: sorted[sorted.length - 1] ?? 0,
		avgMs: durations.length ? total / durations.length : 0,
	};
}

async function benchmarkQuery(
	query: string,
	runs: number,
	limit: number,
	project: string,
): Promise<{ linear: LatencyStats; hierarchical: LatencyStats }> {
	const linearDurations: number[] = [];
	const linearHits: number[] = [];
	const hierarchicalDurations: number[] = [];
	const hierarchicalHits: number[] = [];

	for (let i = 0; i < runs; i += 1) {
		const t0 = performance.now();
		const linear = searchDayFiles(query, { limit });
		const t1 = performance.now();
		linearDurations.push(t1 - t0);
		linearHits.push(linear.length);

		const t2 = performance.now();
		const hierarchical = await hierarchicalTemporalSearch(query, { limit, project });
		const t3 = performance.now();
		hierarchicalDurations.push(t3 - t2);
		hierarchicalHits.push(hierarchical.length);
	}

	return {
		linear: summarize(query, linearDurations, linearHits),
		hierarchical: summarize(query, hierarchicalDurations, hierarchicalHits),
	};
}

function formatStatRow(prefix: string, stats: LatencyStats): string {
	return `${prefix} runs=${stats.runs} hits=${stats.hitCount} avg=${stats.avgMs.toFixed(2)}ms p50=${stats.p50Ms.toFixed(2)}ms p95=${stats.p95Ms.toFixed(2)}ms max=${stats.maxMs.toFixed(2)}ms`;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	const dayCount = listDayFiles().length;
	const reportCount = new PeriodicConsolidation({ project: args.project }).listReports().length;
	const rows: Array<{ query: string; linear: LatencyStats; hierarchical: LatencyStats }> = [];

	for (const query of args.queries) {
		const pair = await benchmarkQuery(query, args.runs, args.limit, args.project);
		rows.push({ query, linear: pair.linear, hierarchical: pair.hierarchical });
	}

	const payload = {
		metadata: {
			timestamp: new Date().toISOString(),
			project: args.project,
			queries: args.queries,
			runs: args.runs,
			limit: args.limit,
			dayFileCount: dayCount,
			reportCount,
		},
		results: rows,
	};

	if (args.json) {
		process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
		return;
	}

	process.stdout.write(
		`Consolidation benchmark | project=${args.project} | dayFiles=${dayCount} | reports=${reportCount}\n`,
	);
	for (const row of rows) {
		process.stdout.write(`\nQuery: "${row.query}"\n`);
		process.stdout.write(`${formatStatRow("  linear       ", row.linear)}\n`);
		process.stdout.write(`${formatStatRow("  hierarchical ", row.hierarchical)}\n`);
	}
}

main().catch((err) => {
	const message = err instanceof Error ? err.stack ?? err.message : String(err);
	process.stderr.write(`Benchmark failed: ${message}\n`);
	process.exit(1);
});

