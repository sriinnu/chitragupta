import type { CollaborationDeps, ServerLike } from "./collaboration-types.js";
import {
	collaborationFailure,
	collaborationUnavailable,
} from "./collaboration-route-helpers.js";

export function mountSabhaCollaborationRoutes(
	server: ServerLike,
	deps: CollaborationDeps,
): void {
	server.route("GET", "/api/sabha/deliberations", async () => {
		const engine = deps.getSabhaEngine();
		if (!engine) return collaborationUnavailable("Sabha deliberation engine");

		try {
			const active = await Promise.resolve(engine.listActive());
			const deliberations = active.map(s => ({
				id: s.id,
				topic: s.topic,
				status: s.status,
				convener: s.convener,
				participantCount: s.participants.length,
				roundCount: s.rounds.length,
				finalVerdict: s.finalVerdict,
				createdAt: s.createdAt,
				concludedAt: s.concludedAt,
			}));
			return {
				status: 200,
				body: { deliberations, count: deliberations.length },
			};
		} catch (err) {
			return collaborationFailure(err);
		}
	});

	server.route("POST", "/api/sabha/deliberate", async (req) => {
		const engine = deps.getSabhaEngine();
		if (!engine) return collaborationUnavailable("Sabha deliberation engine");

		try {
			const body = (req.body ?? {}) as Record<string, unknown>;
			if (typeof body.topic !== "string" || body.topic.trim().length === 0) {
				return { status: 400, body: { error: "Missing or empty 'topic' field" } };
			}
			if (typeof body.convener !== "string" || body.convener.trim().length === 0) {
				return { status: 400, body: { error: "Missing or empty 'convener' field" } };
			}
			if (!Array.isArray(body.participants) || body.participants.length < 2) {
				return { status: 400, body: { error: "Must provide at least 2 participants" } };
			}

			const sabha = await Promise.resolve(engine.convene(
				body.topic as string,
				body.convener as string,
				body.participants as Array<{
					id: string;
					role: string;
					expertise: number;
					credibility: number;
				}>,
			));
			return {
				status: 201,
				body: {
					id: sabha.id,
					topic: sabha.topic,
					status: sabha.status,
					participants: sabha.participants,
					createdAt: sabha.createdAt,
				},
			};
		} catch (err) {
			return collaborationFailure(err);
		}
	});

	server.route("GET", "/api/sabha/deliberations/:id", async (req) => {
		const engine = deps.getSabhaEngine();
		if (!engine) return collaborationUnavailable("Sabha deliberation engine");

		try {
			const sabha = await Promise.resolve(engine.getSabha(req.params.id));
			if (!sabha) {
				return { status: 404, body: { error: `Deliberation not found: ${req.params.id}` } };
			}

			let explanation: string | undefined;
			try {
				explanation = await Promise.resolve(engine.explain(req.params.id));
			} catch {
				// explain() might fail for edge cases; non-critical
			}

			return {
				status: 200,
				body: { ...sabha, explanation },
			};
		} catch (err) {
			return collaborationFailure(err);
		}
	});

	server.route("POST", "/api/sabha/deliberations/:id/perspectives", async (req) => {
		const engine = deps.getSabhaEngine();
		if (!engine || typeof engine.submitPerspective !== "function") {
			return collaborationUnavailable("Sabha consultation perspectives");
		}

		try {
			const body = (req.body ?? {}) as Record<string, unknown>;
			if (typeof body.participantId !== "string" || body.participantId.trim().length === 0) {
				return { status: 400, body: { error: "Missing or empty 'participantId' field" } };
			}
			const summary = typeof body.summary === "string" && body.summary.trim().length > 0
				? body.summary
				: typeof body.reasoning === "string" && body.reasoning.trim().length > 0
					? body.reasoning
					: "";
			if (!summary) {
				return { status: 400, body: { error: "Missing or empty 'summary' or 'reasoning' field" } };
			}

			const sabha = await Promise.resolve(engine.submitPerspective(req.params.id, {
				participantId: body.participantId as string,
				summary,
				reasoning: typeof body.reasoning === "string" ? body.reasoning : undefined,
				position: typeof body.position === "string"
					? body.position as "support" | "oppose" | "abstain" | "observe"
					: undefined,
				recommendedAction: typeof body.recommendedAction === "string" ? body.recommendedAction : undefined,
				evidence: Array.isArray(body.evidence) ? body.evidence as Array<Record<string, unknown>> : undefined,
				metadata: typeof body.metadata === "object" && body.metadata !== null && !Array.isArray(body.metadata)
					? body.metadata as Record<string, unknown>
					: undefined,
			})) as Record<string, unknown>;

			return {
				status: 201,
				body: {
					sabha,
					perspective: {
						participantId: body.participantId,
						summary,
						reasoning: typeof body.reasoning === "string" ? body.reasoning : summary,
						position: typeof body.position === "string" ? body.position : "observe",
						recommendedAction: typeof body.recommendedAction === "string" ? body.recommendedAction : null,
					},
				},
			};
		} catch (err) {
			return collaborationFailure(err);
		}
	});
}
