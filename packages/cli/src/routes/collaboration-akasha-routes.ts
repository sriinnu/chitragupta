import { persistAkashaField } from "../nervous-system-wiring.js";
import type {
	CollaborationDeps,
	ServerLike,
	StigmergicTraceLike,
} from "./collaboration-types.js";
import {
	collaborationFailure,
	collaborationUnavailable,
} from "./collaboration-route-helpers.js";

export function mountAkashaCollaborationRoutes(
	server: ServerLike,
	deps: CollaborationDeps,
): void {
	server.route("GET", "/api/akasha/traces", async (req) => {
		const akasha = deps.getAkasha();
		if (!akasha) return collaborationUnavailable("Akasha knowledge field");

		try {
			const topic = req.query.topic;
			const type = req.query.type;
			const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;

			let traces: StigmergicTraceLike[];
			if (topic) {
				traces = await akasha.query(topic, { type, limit });
			} else {
				traces = await akasha.strongest(limit);
			}

			return { status: 200, body: { traces, count: traces.length } };
		} catch (err) {
			return collaborationFailure(err);
		}
	});

	server.route("POST", "/api/akasha/traces", async (req) => {
		const akasha = deps.getAkasha();
		if (!akasha) return collaborationUnavailable("Akasha knowledge field");

		try {
			const body = (req.body ?? {}) as Record<string, unknown>;
			if (typeof body.agentId !== "string" || body.agentId.trim().length === 0) {
				return { status: 400, body: { error: "Missing or empty 'agentId' field" } };
			}
			if (typeof body.traceType !== "string" || body.traceType.trim().length === 0) {
				return { status: 400, body: { error: "Missing or empty 'traceType' field" } };
			}
			if (typeof body.topic !== "string" || body.topic.trim().length === 0) {
				return { status: 400, body: { error: "Missing or empty 'topic' field" } };
			}
			if (typeof body.content !== "string" || body.content.trim().length === 0) {
				return { status: 400, body: { error: "Missing or empty 'content' field" } };
			}

			const metadata = (
				typeof body.metadata === "object" &&
				body.metadata !== null &&
				!Array.isArray(body.metadata)
			)
				? body.metadata as Record<string, unknown>
				: undefined;

			const trace = await akasha.leave(
				body.agentId as string,
				body.traceType as string,
				body.topic as string,
				body.content as string,
				metadata,
			);
			persistAkashaField(akasha);
			return { status: 201, body: { trace } };
		} catch (err) {
			return collaborationFailure(err);
		}
	});

	server.route("GET", "/api/akasha/stats", async () => {
		const akasha = deps.getAkasha();
		if (!akasha) return collaborationUnavailable("Akasha knowledge field");

		try {
			const stats = await akasha.stats();
			return { status: 200, body: stats };
		} catch (err) {
			return collaborationFailure(err);
		}
	});
}
