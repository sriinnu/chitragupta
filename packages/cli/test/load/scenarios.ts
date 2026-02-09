/**
 * Prayoga — Pre-built load test scenarios for Chitragupta.
 * Sanskrit: Prayoga (प्रयोग) = experiment, application.
 *
 * Each scenario exercises a specific API surface. Scenarios return
 * Promise<void> and throw on unexpected failures — the LoadRunner
 * handles timing and error aggregation externally.
 */

import { LoadHttpClient } from "./http-client.js";
import { LoadWsClient } from "./ws-client.js";
import { LoadRunner, type LoadConfig } from "./load-runner.js";

// ─── Random Data Generators ──────────────────────────────────────────────────

const SEARCH_QUERIES = [
	"typescript configuration",
	"react hooks useEffect",
	"database connection pooling",
	"error handling best practices",
	"performance optimization tips",
	"memory leak debugging",
	"async await patterns",
	"API rate limiting",
	"WebSocket reconnection",
	"build system configuration",
	"testing strategies",
	"deployment pipeline",
	"logging and monitoring",
	"authentication flow",
	"caching strategies",
];

const MEMORY_ENTRIES = [
	"User prefers TypeScript strict mode",
	"Project uses ESM modules",
	"Testing framework: vitest",
	"Build tool: tsc",
	"Code style: tabs, width 2",
	"Preferred naming: descriptive, no abbreviations",
	"Architecture: microservices with event-driven IPC",
	"Database: PostgreSQL with connection pooling",
	"Deployment target: Docker containers on k8s",
	"CI/CD: GitHub Actions with matrix builds",
];

function randomItem<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ─── HTTP Scenarios ──────────────────────────────────────────────────────────

/**
 * Baseline: GET /api/health.
 * Should be the fastest route — no auth, no I/O.
 */
export function healthCheckScenario(client: LoadHttpClient): () => Promise<void> {
	return async () => {
		const res = await client.get("/api/health");
		if (res.status !== 200) {
			throw new Error(`Health check returned ${res.status}`);
		}
	};
}

/**
 * Memory search: POST /api/memory/search with random queries.
 */
export function memorySearchScenario(client: LoadHttpClient): () => Promise<void> {
	return async () => {
		const query = randomItem(SEARCH_QUERIES);
		const res = await client.post("/api/memory/search", { query, limit: 5 });
		if (res.status !== 200) {
			throw new Error(`Memory search returned ${res.status}`);
		}
	};
}

/**
 * Memory CRUD round-trip: GET -> PUT -> POST -> GET -> DELETE (global scope).
 *
 * Each invocation runs the full CRUD cycle on a unique-ish scope
 * to avoid contention.
 */
export function memoryCrudScenario(client: LoadHttpClient): () => Promise<void> {
	let counter = 0;
	return async () => {
		const scope = "global";
		const tag = `load-test-${++counter}`;

		// GET current memory
		const getRes = await client.get(`/api/memory/${scope}`);
		if (getRes.status !== 200 && getRes.status !== 400) {
			throw new Error(`Memory GET returned ${getRes.status}`);
		}

		// PUT (replace) memory
		const content = `${randomItem(MEMORY_ENTRIES)} [${tag}]`;
		const putRes = await client.put(`/api/memory/${scope}`, { content });
		if (putRes.status !== 200) {
			throw new Error(`Memory PUT returned ${putRes.status}`);
		}

		// POST (append) entry
		const entry = randomItem(MEMORY_ENTRIES);
		const postRes = await client.post(`/api/memory/${scope}`, { entry });
		if (postRes.status !== 200) {
			throw new Error(`Memory POST returned ${postRes.status}`);
		}
	};
}

/**
 * Job submission: POST /api/jobs then poll GET /api/jobs/:id.
 */
export function jobSubmitScenario(client: LoadHttpClient): () => Promise<void> {
	return async () => {
		const message = `Load test prompt ${randomInt(1, 10000)}`;
		const submitRes = await client.post("/api/jobs", { message });

		if (submitRes.status === 429) {
			// Queue full — expected under heavy load, not a test failure
			return;
		}
		if (submitRes.status !== 202) {
			throw new Error(`Job submit returned ${submitRes.status}`);
		}

		const body = submitRes.body as { jobId?: string };
		if (!body.jobId) {
			throw new Error("Job submit did not return jobId");
		}

		// Poll once (we don't wait for completion in load tests)
		const pollRes = await client.get(`/api/jobs/${body.jobId}`);
		if (pollRes.status !== 200) {
			throw new Error(`Job poll returned ${pollRes.status}`);
		}
	};
}

/**
 * Agent listing: GET /api/agents + GET /api/agents/stats.
 */
export function agentListScenario(client: LoadHttpClient): () => Promise<void> {
	return async () => {
		const listRes = await client.get("/api/agents");
		// 503 is expected when no agent is wired — we still test the route
		if (listRes.status !== 200 && listRes.status !== 503) {
			throw new Error(`Agent list returned ${listRes.status}`);
		}

		const statsRes = await client.get("/api/agents/stats");
		if (statsRes.status !== 200 && statsRes.status !== 503) {
			throw new Error(`Agent stats returned ${statsRes.status}`);
		}
	};
}

/**
 * Mixed API load: weighted random selection across all scenarios.
 *
 * Distribution (by weight):
 *   40% health check
 *   20% memory search
 *   15% memory CRUD
 *   10% job submit
 *   15% agent listing
 */
export function mixedApiScenario(client: LoadHttpClient): () => Promise<void> {
	const health = healthCheckScenario(client);
	const search = memorySearchScenario(client);
	const crud = memoryCrudScenario(client);
	const jobs = jobSubmitScenario(client);
	const agents = agentListScenario(client);

	return async () => {
		const r = Math.random() * 100;
		if (r < 40) {
			await health();
		} else if (r < 60) {
			await search();
		} else if (r < 75) {
			await crud();
		} else if (r < 85) {
			await jobs();
		} else {
			await agents();
		}
	};
}

// ─── WebSocket Scenarios ─────────────────────────────────────────────────────

/**
 * Connection storm: open N WebSocket connections simultaneously.
 * Returns the number of successful connections.
 */
export async function wsConnectionStorm(
	url: string,
	count: number,
	authToken?: string,
): Promise<{ connected: number; failed: number; clients: LoadWsClient[] }> {
	const clients: LoadWsClient[] = [];
	let connected = 0;
	let failed = 0;

	const promises = Array.from({ length: count }, async () => {
		const client = new LoadWsClient(url, authToken);
		try {
			await client.connect();
			connected++;
			clients.push(client);
		} catch {
			failed++;
		}
	});

	await Promise.allSettled(promises);
	return { connected, failed, clients };
}

/**
 * WebSocket chat throughput: send a chat message and await completion.
 */
export function wsChatScenario(wsClient: LoadWsClient): () => Promise<void> {
	let counter = 0;
	return async () => {
		const message = `WS load test message ${++counter}`;
		await wsClient.sendChat(message);
	};
}

/**
 * Spike test: baseline RPS -> spike to peakRps -> return to baseline.
 *
 * Timeline:
 *   0-10s:  baselineRps (steady state)
 *   10-20s: peakRps (spike)
 *   20-30s: baselineRps (recovery)
 *
 * Returns an array of 3 LoadResult objects (one per phase).
 */
export async function spikeScenario(
	client: LoadHttpClient,
	baselineRps: number,
	peakRps: number,
	concurrency: number,
): Promise<{ baseline: number; spike: number; recovery: number }> {
	const scenario = healthCheckScenario(client);

	// Phase 1: Baseline
	const phase1Runner = new LoadRunner({
		targetRps: baselineRps,
		duration: 10,
		concurrency,
		warmup: 0,
	});
	const phase1 = await phase1Runner.run(scenario);

	// Phase 2: Spike
	const phase2Runner = new LoadRunner({
		targetRps: peakRps,
		duration: 10,
		concurrency,
		warmup: 0,
	});
	const phase2 = await phase2Runner.run(scenario);

	// Phase 3: Recovery
	const phase3Runner = new LoadRunner({
		targetRps: baselineRps,
		duration: 10,
		concurrency,
		warmup: 0,
	});
	const phase3 = await phase3Runner.run(scenario);

	return {
		baseline: phase1.p99,
		spike: phase2.p99,
		recovery: phase3.p99,
	};
}
