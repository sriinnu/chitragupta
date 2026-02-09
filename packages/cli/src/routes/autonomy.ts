/**
 * Autonomy API Routes — REST endpoints for Phase 4 Behavioral Autonomy.
 *
 * Exposes Kartavya (auto-execution pipeline) and Kala Chakra (temporal
 * awareness) via JSON endpoints. Mounts onto the existing ChitraguptaServer
 * via `server.route()`.
 */

// ─── Duck-Typed Interfaces ──────────────────────────────────────────────────
// Avoid hard import dependencies — the actual classes are structurally
// compatible at runtime.

// ─── Kartavya ───────────────────────────────────────────────────────────────

interface KartavyaTriggerLike {
	type: string;
	condition: string;
	cooldownMs: number;
	lastFired?: number;
}

interface KartavyaActionLike {
	type: string;
	payload: Record<string, unknown>;
}

interface KartavyaLike {
	id: string;
	name: string;
	description: string;
	status: string;
	sourceVasanaId?: string;
	sourceNiyamaId?: string;
	trigger: KartavyaTriggerLike;
	action: KartavyaActionLike;
	confidence: number;
	successCount: number;
	failureCount: number;
	lastExecuted?: number;
	createdAt: number;
	updatedAt: number;
	project?: string;
}

interface NiyamaProposalLike {
	id: string;
	vasanaId: string;
	name: string;
	description: string;
	proposedTrigger: KartavyaTriggerLike;
	proposedAction: KartavyaActionLike;
	confidence: number;
	evidence: string[];
	status: string;
	createdAt: number;
}

interface KartavyaEngineLike {
	listAll(project?: string): KartavyaLike[];
	listActive(project?: string): KartavyaLike[];
	getKartavya(id: string): KartavyaLike | undefined;
	getPendingNiyamas(): NiyamaProposalLike[];
	evaluateTriggers(context: {
		now: number;
		events: string[];
		metrics: Record<string, number>;
		patterns: string[];
	}): KartavyaLike[];
	recordExecution(kartavyaId: string, success: boolean, result?: string): void;
	stats(): {
		total: number;
		active: number;
		paused: number;
		proposed: number;
		successRate: number;
		executionsThisHour: number;
	};
}

// ─── Kala Chakra ────────────────────────────────────────────────────────────

interface KalaChakraLike {
	relevanceScore(documentTimestamp: number, now?: number): number;
	dominantScale(elapsedMs: number): string;
	boostScore(originalScore: number, documentTimestamp: number, now?: number): number;
	decayFactor(elapsedMs: number, scale: string): number;
	serialize(): {
		decayRates: Record<string, number>;
		scaleWeights: Record<string, number>;
	};
}

// ─── Server ─────────────────────────────────────────────────────────────────

interface ServerLike {
	route(
		method: string,
		path: string,
		handler: (req: {
			params: Record<string, string>;
			query: Record<string, string>;
			body: unknown;
		}) => Promise<{ status: number; body: unknown; headers?: Record<string, string> }>,
	): void;
}

// ─── Route Mounter ──────────────────────────────────────────────────────────

/**
 * Mount all Phase 4 Behavioral Autonomy API routes onto the server.
 *
 * @param server - ChitraguptaServer instance
 * @param deps   - Lazy getters for autonomy modules
 */
export function mountAutonomyRoutes(
	server: ServerLike,
	deps: {
		getKartavyaEngine: () => KartavyaEngineLike | undefined;
		getKalaChakra: () => KalaChakraLike | undefined;
		getProjectPath: () => string;
	},
): void {

	// ═════════════════════════════════════════════════════════════════════
	// Kartavya — Auto-Execution Pipeline
	// ═════════════════════════════════════════════════════════════════════

	// ─── GET /api/kartavya/pipeline ─────────────────────────────────
	server.route("GET", "/api/kartavya/pipeline", async (req) => {
		const engine = deps.getKartavyaEngine();
		if (!engine) {
			return { status: 503, body: { error: "Kartavya auto-execution engine not available" } };
		}

		try {
			const project = req.query.project ?? deps.getProjectPath();
			const stats = engine.stats();
			const allKartavyas = engine.listAll(project);

			// Group by status
			const byStatus: Record<string, number> = {};
			for (const k of allKartavyas) {
				byStatus[k.status] = (byStatus[k.status] ?? 0) + 1;
			}

			return {
				status: 200,
				body: {
					stats,
					byStatus,
					kartavyas: allKartavyas.map(k => ({
						id: k.id,
						name: k.name,
						status: k.status,
						triggerType: k.trigger.type,
						triggerCondition: k.trigger.condition,
						confidence: k.confidence,
						successCount: k.successCount,
						failureCount: k.failureCount,
						lastExecuted: k.lastExecuted ?? null,
					})),
					count: allKartavyas.length,
					project,
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── GET /api/kartavya/pending ──────────────────────────────────
	server.route("GET", "/api/kartavya/pending", async () => {
		const engine = deps.getKartavyaEngine();
		if (!engine) {
			return { status: 503, body: { error: "Kartavya auto-execution engine not available" } };
		}

		try {
			const pending = engine.getPendingNiyamas();

			return {
				status: 200,
				body: {
					proposals: pending.map(p => ({
						id: p.id,
						vasanaId: p.vasanaId,
						name: p.name,
						description: p.description,
						triggerType: p.proposedTrigger.type,
						triggerCondition: p.proposedTrigger.condition,
						actionType: p.proposedAction.type,
						confidence: p.confidence,
						evidence: p.evidence,
						status: p.status,
						createdAt: p.createdAt,
					})),
					count: pending.length,
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── POST /api/kartavya/execute/:id ─────────────────────────────
	server.route("POST", "/api/kartavya/execute/:id", async (req) => {
		const engine = deps.getKartavyaEngine();
		if (!engine) {
			return { status: 503, body: { error: "Kartavya auto-execution engine not available" } };
		}

		try {
			const kartavya = engine.getKartavya(req.params.id);
			if (!kartavya) {
				return { status: 404, body: { error: `Kartavya not found: ${req.params.id}` } };
			}

			if (kartavya.status !== "active") {
				return {
					status: 409,
					body: {
						error: `Cannot execute kartavya in '${kartavya.status}' status`,
						kartavyaId: kartavya.id,
						status: kartavya.status,
					},
				};
			}

			// Record the execution as triggered (the actual execution is
			// handled by the runtime; we mark it as initiated here).
			// The body may carry success/failure feedback for post-execution recording.
			const body = (req.body ?? {}) as Record<string, unknown>;
			const success = body.success !== false; // Default to success if not specified
			const result = typeof body.result === "string" ? body.result : undefined;

			engine.recordExecution(req.params.id, success, result);

			return {
				status: 200,
				body: {
					kartavyaId: kartavya.id,
					name: kartavya.name,
					executed: true,
					success,
					confidence: kartavya.confidence,
					successCount: kartavya.successCount,
					failureCount: kartavya.failureCount,
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ═════════════════════════════════════════════════════════════════════
	// Kala Chakra — Temporal Awareness
	// ═════════════════════════════════════════════════════════════════════

	// ─── GET /api/kala/scales ────────────────────────────────────────
	server.route("GET", "/api/kala/scales", async () => {
		const kala = deps.getKalaChakra();
		if (!kala) {
			return { status: 503, body: { error: "Kala Chakra temporal engine not available" } };
		}

		try {
			const config = kala.serialize();
			const scales = Object.entries(config.decayRates).map(([scale, halfLife]) => ({
				scale,
				halfLifeMs: halfLife,
				weight: config.scaleWeights[scale] ?? 0,
			}));

			return {
				status: 200,
				body: {
					scales,
					count: scales.length,
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── GET /api/kala/context ───────────────────────────────────────
	server.route("GET", "/api/kala/context", async (req) => {
		const kala = deps.getKalaChakra();
		if (!kala) {
			return { status: 503, body: { error: "Kala Chakra temporal engine not available" } };
		}

		try {
			const now = Date.now();

			// Compute relevance scores at different time horizons
			const horizons = [
				{ label: "5m", ms: 5 * 60_000 },
				{ label: "1h", ms: 3_600_000 },
				{ label: "1d", ms: 86_400_000 },
				{ label: "7d", ms: 7 * 86_400_000 },
				{ label: "30d", ms: 30 * 86_400_000 },
				{ label: "90d", ms: 90 * 86_400_000 },
				{ label: "365d", ms: 365 * 86_400_000 },
			];

			const relevanceByHorizon = horizons.map(h => ({
				horizon: h.label,
				elapsedMs: h.ms,
				relevance: kala.relevanceScore(now - h.ms, now),
				dominantScale: kala.dominantScale(h.ms),
				boostFactor: kala.boostScore(1.0, now - h.ms, now),
			}));

			// Optionally compute relevance for a specific timestamp
			let specificRelevance: unknown = undefined;
			if (req.query.timestamp) {
				const ts = parseInt(req.query.timestamp, 10);
				if (!isNaN(ts)) {
					specificRelevance = {
						timestamp: ts,
						elapsedMs: now - ts,
						relevance: kala.relevanceScore(ts, now),
						dominantScale: kala.dominantScale(now - ts),
						boostFactor: kala.boostScore(1.0, ts, now),
					};
				}
			}

			return {
				status: 200,
				body: {
					now,
					config: kala.serialize(),
					horizons: relevanceByHorizon,
					specificRelevance,
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});
}
