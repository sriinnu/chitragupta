#!/usr/bin/env tsx
/**
 * Sutra P2P mesh soak + churn harness.
 *
 * Runs a live multi-node mesh, continuously sends ask/reply traffic, and
 * repeatedly restarts one node to validate churn tolerance.
 *
 * Optional gates:
 *   --assert-success-rate <0..1>
 *   --assert-p95-ms <n>
 */

import { performance } from "node:perf_hooks";
import process from "node:process";
import { ActorSystem } from "../packages/sutra/src/mesh/actor-system.js";
import type { ActorBehavior } from "../packages/sutra/src/mesh/types.js";

type SoakArgs = {
	durationSec: number;
	churnEverySec: number;
	nodes: number;
	askIntervalMs: number;
	askTimeoutMs: number;
	json: boolean;
	assertSuccessRate?: number;
	assertP95Ms?: number;
};

type NodeRuntime = {
	label: string;
	port: number;
	system: ActorSystem;
};

type SoakStats = {
	attempts: number;
	successes: number;
	failures: number;
	successRate: number;
	p50Ms: number;
	p95Ms: number;
	p99Ms: number;
	maxMs: number;
	avgMs: number;
	churnEvents: number;
};

const ECHO_BEHAVIOR: ActorBehavior = (envelope, ctx) => {
	if (envelope.type === "ask") {
		ctx.reply({ ok: true, seq: (envelope.payload as { seq?: number })?.seq ?? null });
	}
};

function parseArgs(argv: string[]): SoakArgs {
	const args: SoakArgs = {
		durationSec: 45,
		churnEverySec: 8,
		nodes: 3,
		askIntervalMs: 70,
		askTimeoutMs: 2_500,
		json: false,
	};
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		switch (token) {
			case "--duration-sec":
				args.durationSec = clampPositiveInt(argv[i + 1], 45);
				i += 1;
				break;
			case "--churn-every-sec":
				args.churnEverySec = clampPositiveInt(argv[i + 1], 8);
				i += 1;
				break;
			case "--nodes":
				args.nodes = Math.max(2, clampPositiveInt(argv[i + 1], 3));
				i += 1;
				break;
			case "--ask-interval-ms":
				args.askIntervalMs = clampPositiveInt(argv[i + 1], 70);
				i += 1;
				break;
			case "--ask-timeout-ms":
				args.askTimeoutMs = clampPositiveInt(argv[i + 1], 2_500);
				i += 1;
				break;
			case "--assert-success-rate":
				args.assertSuccessRate = clampRangeFloat(argv[i + 1], 0.95, 0, 1);
				i += 1;
				break;
			case "--assert-p95-ms":
				args.assertP95Ms = clampPositiveFloat(argv[i + 1], 900);
				i += 1;
				break;
			case "--json":
				args.json = true;
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

function clampRangeFloat(value: string | undefined, fallback: number, min: number, max: number): number {
	const parsed = Number.parseFloat(value ?? "");
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(max, Math.max(min, parsed));
}

function percentile(sortedValues: readonly number[], p: number): number {
	if (sortedValues.length === 0) return 0;
	const idx = Math.min(
		sortedValues.length - 1,
		Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1),
	);
	return sortedValues[idx] ?? 0;
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
	condition: () => boolean | Promise<boolean>,
	timeoutMs: number,
	intervalMs = 100,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await condition()) return;
		await sleep(intervalMs);
	}
	throw new Error(`waitFor timeout ${timeoutMs}ms`);
}

async function createNode(label: string, staticPeers?: string[]): Promise<NodeRuntime> {
	const system = new ActorSystem({
		maxMailboxSize: 5_000,
		gossipIntervalMs: 500,
		gossipFanout: 3,
		suspectTimeoutMs: 2_000,
		deadTimeoutMs: 5_000,
		defaultAskTimeout: 4_000,
	});
	system.start();
	const port = await system.bootstrapP2P({
		listenPort: 0,
		listenHost: "127.0.0.1",
		staticPeers,
		pingIntervalMs: 1_500,
		maxMissedPings: 2,
		gossipIntervalMs: 700,
		peerExchangeIntervalMs: 1_500,
		label,
	});
	return { label, port, system };
}

function summarize(latencies: readonly number[], attempts: number, failures: number, churnEvents: number): SoakStats {
	const sorted = [...latencies].sort((a, b) => a - b);
	const successes = latencies.length;
	const total = latencies.reduce((sum, n) => sum + n, 0);
	const successRate = attempts > 0 ? successes / attempts : 0;
	return {
		attempts,
		successes,
		failures,
		successRate,
		p50Ms: percentile(sorted, 50),
		p95Ms: percentile(sorted, 95),
		p99Ms: percentile(sorted, 99),
		maxMs: sorted[sorted.length - 1] ?? 0,
		avgMs: successes > 0 ? total / successes : 0,
		churnEvents,
	};
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const nodes: NodeRuntime[] = [];
	const targetActorId = "echo-churn";
	const callerId = "soak-client";
	let churnEvents = 0;
	let attempts = 0;
	let failures = 0;
	let running = true;
	const latencies: number[] = [];

	try {
		const seed = await createNode("seed");
		nodes.push(seed);
		seed.system.spawn("echo-seed", { behavior: ECHO_BEHAVIOR });

		const seedEndpoint = `ws://127.0.0.1:${seed.port}/mesh`;
		for (let i = 1; i < args.nodes; i += 1) {
			const node = await createNode(`node-${i + 1}`, [seedEndpoint]);
			nodes.push(node);
			node.system.spawn(`echo-${i + 1}`, { behavior: ECHO_BEHAVIOR });
		}

		let churnNode = nodes[1];
		churnNode.system.spawn(targetActorId, { behavior: ECHO_BEHAVIOR });

		await waitFor(
			() => seed.system.getNetworkGossip()?.findNode(targetActorId) !== undefined,
			12_000,
			120,
		);

		const endAt = Date.now() + args.durationSec * 1000;

		const askLoop = (async () => {
			while (running && Date.now() < endAt) {
				attempts += 1;
				const t0 = performance.now();
				try {
					await seed.system.ask(
						callerId,
						targetActorId,
						{ seq: attempts },
						{ timeout: args.askTimeoutMs },
					);
					latencies.push(performance.now() - t0);
				} catch {
					failures += 1;
				}
				await sleep(args.askIntervalMs);
			}
		})();

		const churnLoop = (async () => {
			while (running && Date.now() < endAt) {
				await sleep(args.churnEverySec * 1000);
				if (!running || Date.now() >= endAt) break;
				churnEvents += 1;

				const idx = nodes.indexOf(churnNode);
				if (idx <= 0) continue;

				await churnNode.system.shutdown();
				nodes.splice(idx, 1);

				const replacement = await createNode(churnNode.label, [seedEndpoint]);
				replacement.system.spawn(targetActorId, { behavior: ECHO_BEHAVIOR });
				nodes.push(replacement);
				churnNode = replacement;
			}
		})();

		await Promise.all([askLoop, churnLoop]);
	} finally {
		running = false;
		await Promise.all(
			nodes.map(async (node) => {
				try {
					await node.system.shutdown();
				} catch {
					// best-effort cleanup
				}
			}),
		);
	}

	const stats = summarize(latencies, attempts, failures, churnEvents);
	const payload = {
		timestamp: new Date().toISOString(),
		args,
		stats,
	};

	if (args.json) {
		process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
	} else {
		process.stdout.write("Sutra mesh soak/churn benchmark\n");
		process.stdout.write(
			`duration=${args.durationSec}s nodes=${args.nodes} churnEvery=${args.churnEverySec}s askInterval=${args.askIntervalMs}ms\n`,
		);
		process.stdout.write(
			`attempts=${stats.attempts} successes=${stats.successes} failures=${stats.failures} successRate=${(stats.successRate * 100).toFixed(2)}% churnEvents=${stats.churnEvents}\n`,
		);
		process.stdout.write(
			`latency avg=${stats.avgMs.toFixed(2)}ms p50=${stats.p50Ms.toFixed(2)}ms p95=${stats.p95Ms.toFixed(2)}ms p99=${stats.p99Ms.toFixed(2)}ms max=${stats.maxMs.toFixed(2)}ms\n`,
		);
	}

	const failuresOut: string[] = [];
	if (args.assertSuccessRate !== undefined && stats.successRate < args.assertSuccessRate) {
		failuresOut.push(
			`successRate ${(stats.successRate * 100).toFixed(2)}% below ${(args.assertSuccessRate * 100).toFixed(2)}%`,
		);
	}
	if (args.assertP95Ms !== undefined && stats.p95Ms > args.assertP95Ms) {
		failuresOut.push(`p95 ${stats.p95Ms.toFixed(2)}ms exceeds ${args.assertP95Ms.toFixed(2)}ms`);
	}
	if (failuresOut.length > 0) {
		for (const line of failuresOut) {
			process.stderr.write(`ASSERTION FAILED: ${line}\n`);
		}
		process.exit(1);
	}
}

main().catch((err: unknown) => {
	const message = err instanceof Error ? err.stack ?? err.message : String(err);
	process.stderr.write(`Soak benchmark failed: ${message}\n`);
	process.exit(1);
});
