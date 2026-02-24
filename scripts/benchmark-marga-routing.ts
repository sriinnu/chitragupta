#!/usr/bin/env tsx
/**
 * Marga routing benchmark harness.
 *
 * Measures task classification throughput and latency percentiles for
 * `margaDecide()` with a multilingual + mixed-intent corpus.
 *
 * Optional gates:
 *   --assert-p95-ms <n>      fail if wall-clock p95 exceeds threshold
 *   --assert-throughput <n>   fail if requests/sec is below threshold
 *
 * Examples:
 *   pnpm benchmark:marga
 *   pnpm benchmark:marga -- --runs 200 --assert-p95-ms 2 --json
 */

import { performance } from "node:perf_hooks";
import process from "node:process";
import { margaDecide, type MargaDecideRequest } from "../packages/swara/src/marga-decide.js";

type BenchmarkArgs = {
	runs: number;
	warmup: number;
	json: boolean;
	assertP95Ms?: number;
	assertThroughput?: number;
};

type Sample = Pick<MargaDecideRequest, "message" | "hasTools" | "hasImages">;

type Stats = {
	count: number;
	minMs: number;
	p50Ms: number;
	p95Ms: number;
	p99Ms: number;
	maxMs: number;
	avgMs: number;
	throughputRps: number;
};

const SAMPLE_CORPUS: readonly Sample[] = [
	{ message: "hi" },
	{ message: "namaste" },
	{ message: "namaskaram bagunnava" },
	{ message: "hola como estas" },
	{ message: "bonjour comment ca va" },
	{ message: "wie gehts dir" },
	{ message: "konnichiwa genki desu ka" },
	{ message: "run /forecast Vienna for next 3 days", hasTools: true },
	{ message: "what is in this image?", hasImages: true },
	{ message: "translate this to Telugu: We are shipping tonight" },
	{ message: "summarize this changelog in three bullets" },
	{ message: "search all files for provider_cooldown_set", hasTools: true },
	{ message: "remember that I prefer local models first" },
	{ message: "open notes and show what we discussed yesterday", hasTools: true },
	{ message: "write a TypeScript retry helper with exponential backoff" },
	{ message: "implement a circuit breaker with half-open state and tests" },
	{
		message:
			"analyze this distributed systems design, compare raft and paxos, and explain failure modes",
	},
	{ message: "ping" },
	{ message: "status" },
	{ message: "thanks got it" },
];

function parseArgs(argv: string[]): BenchmarkArgs {
	const args: BenchmarkArgs = { runs: 100, warmup: 30, json: false };
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		switch (token) {
			case "--runs":
				args.runs = clampPositiveInt(argv[i + 1], 100);
				i += 1;
				break;
			case "--warmup":
				args.warmup = clampPositiveInt(argv[i + 1], 30);
				i += 1;
				break;
			case "--json":
				args.json = true;
				break;
			case "--assert-p95-ms":
				args.assertP95Ms = clampPositiveFloat(argv[i + 1], 2);
				i += 1;
				break;
			case "--assert-throughput":
				args.assertThroughput = clampPositiveFloat(argv[i + 1], 5_000);
				i += 1;
				break;
		}
	}
	return args;
}

function clampPositiveInt(value: string | undefined, fallback: number): number {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampPositiveFloat(value: string | undefined, fallback: number): number {
	const parsed = Number.parseFloat(value ?? "");
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function percentile(sortedValues: readonly number[], p: number): number {
	if (sortedValues.length === 0) return 0;
	const idx = Math.min(
		sortedValues.length - 1,
		Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1),
	);
	return sortedValues[idx] ?? 0;
}

function summarize(durations: readonly number[], elapsedMs: number): Stats {
	const sorted = [...durations].sort((a, b) => a - b);
	const total = durations.reduce((sum, d) => sum + d, 0);
	return {
		count: durations.length,
		minMs: sorted[0] ?? 0,
		p50Ms: percentile(sorted, 50),
		p95Ms: percentile(sorted, 95),
		p99Ms: percentile(sorted, 99),
		maxMs: sorted[sorted.length - 1] ?? 0,
		avgMs: durations.length ? total / durations.length : 0,
		throughputRps: elapsedMs > 0 ? (durations.length * 1000) / elapsedMs : 0,
	};
}

function runWarmup(iterations: number): void {
	for (let i = 0; i < iterations; i += 1) {
		const sample = SAMPLE_CORPUS[i % SAMPLE_CORPUS.length];
		margaDecide({
			message: sample.message,
			hasTools: sample.hasTools,
			hasImages: sample.hasImages,
		});
	}
}

function runBenchmark(runs: number): {
	wallClock: Stats;
	decisionClock: Stats;
	observedTaskTypes: number;
} {
	const wallDurations: number[] = [];
	const decisionDurations: number[] = [];
	const taskTypes = new Set<string>();

	const start = performance.now();
	for (let run = 0; run < runs; run += 1) {
		for (const sample of SAMPLE_CORPUS) {
			const t0 = performance.now();
			const decision = margaDecide({
				message: sample.message,
				hasTools: sample.hasTools,
				hasImages: sample.hasImages,
			});
			const t1 = performance.now();
			wallDurations.push(t1 - t0);
			decisionDurations.push(decision.decisionTimeMs);
			taskTypes.add(decision.taskType);
		}
	}
	const elapsed = performance.now() - start;

	return {
		wallClock: summarize(wallDurations, elapsed),
		decisionClock: summarize(decisionDurations, elapsed),
		observedTaskTypes: taskTypes.size,
	};
}

function printTextReport(args: BenchmarkArgs, report: ReturnType<typeof runBenchmark>): void {
	const lines: string[] = [];
	lines.push("Marga routing benchmark");
	lines.push(
		`runs=${args.runs} corpus=${SAMPLE_CORPUS.length} invocations=${args.runs * SAMPLE_CORPUS.length} warmup=${args.warmup}`,
	);
	lines.push(
		`observedTaskTypes=${report.observedTaskTypes}`,
	);
	lines.push("");
	lines.push("wall-clock (external)");
	lines.push(
		`  avg=${report.wallClock.avgMs.toFixed(3)}ms p50=${report.wallClock.p50Ms.toFixed(3)}ms p95=${report.wallClock.p95Ms.toFixed(3)}ms p99=${report.wallClock.p99Ms.toFixed(3)}ms max=${report.wallClock.maxMs.toFixed(3)}ms throughput=${report.wallClock.throughputRps.toFixed(1)} req/s`,
	);
	lines.push("decision-time (internal)");
	lines.push(
		`  avg=${report.decisionClock.avgMs.toFixed(3)}ms p50=${report.decisionClock.p50Ms.toFixed(3)}ms p95=${report.decisionClock.p95Ms.toFixed(3)}ms p99=${report.decisionClock.p99Ms.toFixed(3)}ms max=${report.decisionClock.maxMs.toFixed(3)}ms throughput=${report.decisionClock.throughputRps.toFixed(1)} req/s`,
	);
	process.stdout.write(`${lines.join("\n")}\n`);
}

function runAssertions(args: BenchmarkArgs, report: ReturnType<typeof runBenchmark>): void {
	const failures: string[] = [];
	if (args.assertP95Ms !== undefined && report.wallClock.p95Ms > args.assertP95Ms) {
		failures.push(
			`p95 wall-clock latency ${report.wallClock.p95Ms.toFixed(3)}ms exceeds ${args.assertP95Ms.toFixed(3)}ms`,
		);
	}
	if (args.assertThroughput !== undefined && report.wallClock.throughputRps < args.assertThroughput) {
		failures.push(
			`throughput ${report.wallClock.throughputRps.toFixed(1)} req/s below ${args.assertThroughput.toFixed(1)} req/s`,
		);
	}
	if (failures.length > 0) {
		for (const failure of failures) {
			process.stderr.write(`ASSERTION FAILED: ${failure}\n`);
		}
		process.exit(1);
	}
}

function main(): void {
	const args = parseArgs(process.argv.slice(2));
	runWarmup(args.warmup);
	const report = runBenchmark(args.runs);
	if (args.json) {
		process.stdout.write(
			`${JSON.stringify(
				{
					timestamp: new Date().toISOString(),
					args,
					corpusSize: SAMPLE_CORPUS.length,
					results: report,
				},
				null,
				2,
			)}\n`,
		);
	} else {
		printTextReport(args, report);
	}
	runAssertions(args, report);
}

main();
