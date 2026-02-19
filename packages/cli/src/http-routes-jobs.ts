/**
 * Job queue (Karya) HTTP route handlers.
 * @module http-routes-jobs
 */

import type { ChitraguptaServer } from "./http-server.js";
import type { ApiDeps, ServerConfig } from "./http-server-types.js";
import { JobQueue, QueueFullError } from "./job-queue.js";
import type { JobStatus } from "./job-queue.js";

/**
 * Create a job runner function that delegates to deps.prompt or agent.run.
 */
function createJobRunner(deps: ApiDeps): (
	message: string,
	onEvent: (type: string, data: unknown) => void,
	signal: AbortSignal,
) => Promise<string> {
	return async (message, onEvent, signal) => {
		if (deps.prompt) {
			return deps.prompt(message, onEvent, signal);
		}
		const agent = deps.getAgent() as Record<string, unknown> | null;
		if (!agent || typeof agent.run !== "function") {
			throw new Error("Agent not available");
		}
		return (agent.run as (msg: string) => Promise<string>)(message);
	};
}

/**
 * Mount job queue routes and return the runner for WebSocket reuse.
 *
 * @returns The job runner function (needed by WebSocket chat handler).
 */
export function mountJobRoutes(
	server: ChitraguptaServer,
	deps: ApiDeps,
	config?: ServerConfig,
): (message: string, onEvent: (type: string, data: unknown) => void, signal: AbortSignal) => Promise<string> {
	const jobRunner = createJobRunner(deps);
	const jobQueue = new JobQueue(jobRunner, config?.jobQueue);

	// NOTE: /api/jobs/stats registered before /api/jobs/:id so "stats" is not captured as :id.
	server.route("GET", "/api/jobs/stats", async () => {
		try {
			return { status: 200, body: jobQueue.getStats() };
		} catch (err) {
			return { status: 500, body: { error: `Failed to get stats: ${(err as Error).message}` } };
		}
	});

	server.route("POST", "/api/jobs", async (req) => {
		try {
			const body = (req.body ?? {}) as Record<string, unknown>;
			const message = body.message;
			if (typeof message !== "string" || message.trim().length === 0) {
				return { status: 400, body: { error: "Missing or empty 'message' field in request body" } };
			}
			const metadata = (typeof body.metadata === "object" && body.metadata !== null && !Array.isArray(body.metadata))
				? body.metadata as Record<string, unknown>
				: undefined;
			const job = jobQueue.submit(message.trim(), metadata);
			return {
				status: 202,
				body: { jobId: job.id, status: job.status, createdAt: job.createdAt },
			};
		} catch (err) {
			if (err instanceof QueueFullError) {
				return { status: 429, body: { error: err.message, maxQueueSize: err.maxQueueSize } };
			}
			return { status: 500, body: { error: `Failed to submit job: ${(err as Error).message}` } };
		}
	});

	server.route("GET", "/api/jobs", async (req) => {
		try {
			const statusFilter = req.query.status as JobStatus | undefined;
			const filter = statusFilter ? { status: statusFilter } : undefined;
			const jobs = jobQueue.listJobs(filter);
			const summaries = jobs.map((j) => ({
				id: j.id,
				status: j.status,
				message: j.message,
				createdAt: j.createdAt,
				startedAt: j.startedAt,
				completedAt: j.completedAt,
				eventCount: j.events.length,
				hasResponse: j.response !== undefined,
				hasError: j.error !== undefined,
				metadata: j.metadata,
			}));
			return { status: 200, body: { jobs: summaries } };
		} catch (err) {
			return { status: 500, body: { error: `Failed to list jobs: ${(err as Error).message}` } };
		}
	});

	server.route("GET", "/api/jobs/:id", async (req) => {
		try {
			const job = jobQueue.getJob(req.params.id);
			if (!job) {
				return { status: 404, body: { error: `Job not found: ${req.params.id}` } };
			}
			const includeEvents = req.query.events !== "false";
			const result: Record<string, unknown> = {
				id: job.id, status: job.status, message: job.message,
				response: job.response, error: job.error,
				createdAt: job.createdAt, startedAt: job.startedAt, completedAt: job.completedAt,
				cost: job.cost, tokens: job.tokens, metadata: job.metadata,
			};
			if (includeEvents) {
				result.events = job.events;
			} else {
				result.eventCount = job.events.length;
			}
			return { status: 200, body: result };
		} catch (err) {
			return { status: 500, body: { error: `Failed to get job: ${(err as Error).message}` } };
		}
	});

	server.route("POST", "/api/jobs/:id/cancel", async (req) => {
		try {
			const job = jobQueue.getJob(req.params.id);
			if (!job) {
				return { status: 404, body: { error: `Job not found: ${req.params.id}` } };
			}
			const cancelled = jobQueue.cancelJob(req.params.id);
			if (!cancelled) {
				return {
					status: 409,
					body: { error: `Cannot cancel job in '${job.status}' state`, jobId: job.id, status: job.status },
				};
			}
			return { status: 200, body: { jobId: job.id, status: "cancelled" } };
		} catch (err) {
			return { status: 500, body: { error: `Failed to cancel job: ${(err as Error).message}` } };
		}
	});

	return jobRunner;
}
