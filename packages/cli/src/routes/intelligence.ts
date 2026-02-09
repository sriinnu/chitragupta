/**
 * Intelligence API Routes — REST endpoints for Phase 2 Intelligence Layer.
 *
 * Exposes Turiya (model routing), Triguna (system health), Rta (invariant
 * rules + audit), and Buddhi (decisions + Nyaya reasoning) via JSON
 * endpoints. Mounts onto the existing ChitraguptaServer via `server.route()`.
 */

// ─── Duck-Typed Interfaces ──────────────────────────────────────────────────
// Avoid hard import dependencies — the actual classes are structurally
// compatible at runtime.

// ─── Turiya ─────────────────────────────────────────────────────────────────

interface TuriyaTierStatsLike {
	tier: string;
	calls: number;
	totalCost: number;
	averageReward: number;
	alpha: number;
	beta: number;
}

interface TuriyaStatsLike {
	totalRequests: number;
	tiers: TuriyaTierStatsLike[];
	totalCost: number;
	opusBaselineCost: number;
	costSavings: number;
	savingsPercent: number;
}

interface TuriyaRouterLike {
	getStats(): TuriyaStatsLike;
	serialize(): unknown;
}

// ─── Triguna ────────────────────────────────────────────────────────────────

interface GunaStateLike {
	sattva: number;
	rajas: number;
	tamas: number;
}

interface GunaTrendLike {
	sattva: string;
	rajas: string;
	tamas: string;
}

interface TrigunaLike {
	getState(): GunaStateLike;
	getDominant(): string;
	getTrend(): GunaTrendLike;
	serialize(): unknown;
}

// ─── Rta ────────────────────────────────────────────────────────────────────

interface RtaRuleLike {
	id: string;
	name: string;
	description: string;
	severity: string;
}

interface RtaAuditEntryLike {
	timestamp: number;
	ruleId: string;
	allowed: boolean;
	toolName: string;
	reason?: string;
	sessionId?: string;
}

interface RtaEngineLike {
	getRules(): RtaRuleLike[];
	getAuditLog(limit?: number): RtaAuditEntryLike[];
}

// ─── Buddhi ─────────────────────────────────────────────────────────────────

interface DecisionLike {
	id: string;
	timestamp: number;
	sessionId: string;
	project: string;
	category: string;
	description: string;
	reasoning: {
		thesis: string;
		reason: string;
		example: string;
		application: string;
		conclusion: string;
	};
	confidence: number;
	alternatives: Array<{ description: string; reason_rejected: string }>;
	outcome?: { success: boolean; feedback?: string; timestamp: number };
	metadata: Record<string, unknown>;
}

interface DatabaseManagerLike {
	get(name: string): unknown;
}

interface BuddhiLike {
	listDecisions(
		opts: { project?: string; category?: string; limit?: number },
		db: DatabaseManagerLike,
	): DecisionLike[];
	getDecision(id: string, db: DatabaseManagerLike): DecisionLike | null;
	explainDecision(id: string, db: DatabaseManagerLike): string | null;
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
 * Mount all Phase 2 Intelligence Layer API routes onto the server.
 *
 * @param server - ChitraguptaServer instance
 * @param deps   - Lazy getters for intelligence modules
 */
export function mountIntelligenceRoutes(
	server: ServerLike,
	deps: {
		getTuriyaRouter: () => TuriyaRouterLike | undefined;
		getTriguna: () => TrigunaLike | undefined;
		getRtaEngine: () => RtaEngineLike | undefined;
		getBuddhi: () => BuddhiLike | undefined;
		getDatabase: () => DatabaseManagerLike | undefined;
		getProjectPath: () => string;
	},
): void {
	// ─── GET /api/turiya/status ─────────────────────────────────────
	server.route("GET", "/api/turiya/status", async () => {
		const router = deps.getTuriyaRouter();
		if (!router) {
			return { status: 503, body: { error: "Turiya router not available" } };
		}

		try {
			const stats = router.getStats();
			return {
				status: 200,
				body: {
					totalRequests: stats.totalRequests,
					totalCost: stats.totalCost,
					opusBaselineCost: stats.opusBaselineCost,
					costSavings: stats.costSavings,
					savingsPercent: stats.savingsPercent,
					activeTiers: stats.tiers.filter(t => t.calls > 0).map(t => t.tier),
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── GET /api/turiya/routing ────────────────────────────────────
	server.route("GET", "/api/turiya/routing", async () => {
		const router = deps.getTuriyaRouter();
		if (!router) {
			return { status: 503, body: { error: "Turiya router not available" } };
		}

		try {
			const stats = router.getStats();
			return {
				status: 200,
				body: {
					totalRequests: stats.totalRequests,
					tiers: stats.tiers.map(t => ({
						tier: t.tier,
						calls: t.calls,
						callPercent: stats.totalRequests > 0
							? Math.round((t.calls / stats.totalRequests) * 1000) / 10
							: 0,
						totalCost: t.totalCost,
						averageReward: t.averageReward,
					})),
					costSummary: {
						totalCost: stats.totalCost,
						opusBaseline: stats.opusBaselineCost,
						savings: stats.costSavings,
						savingsPercent: stats.savingsPercent,
					},
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── GET /api/health/guna ──────────────────────────────────────
	server.route("GET", "/api/health/guna", async () => {
		const triguna = deps.getTriguna();
		if (!triguna) {
			return { status: 503, body: { error: "Triguna monitor not available" } };
		}

		try {
			const state = triguna.getState();
			const dominant = triguna.getDominant();
			const trend = triguna.getTrend();

			return {
				status: 200,
				body: {
					state: {
						sattva: state.sattva,
						rajas: state.rajas,
						tamas: state.tamas,
					},
					dominant,
					trend,
					mode: dominant === "sattva" ? "harmonious"
						: dominant === "rajas" ? "hyperactive"
						: "degraded",
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── GET /api/rta/rules ────────────────────────────────────────
	server.route("GET", "/api/rta/rules", async () => {
		const rta = deps.getRtaEngine();
		if (!rta) {
			return { status: 503, body: { error: "Rta engine not available" } };
		}

		try {
			const rules = rta.getRules();
			const auditLog = rta.getAuditLog();

			return {
				status: 200,
				body: {
					rules: rules.map(rule => {
						const violations = auditLog.filter(
							e => e.ruleId === rule.id && !e.allowed,
						).length;
						const checks = auditLog.filter(
							e => e.ruleId === rule.id,
						).length;

						return {
							id: rule.id,
							name: rule.name,
							description: rule.description,
							severity: rule.severity,
							status: "active",
							violationCount: violations,
							checkCount: checks,
						};
					}),
					count: rules.length,
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── GET /api/rta/audit ────────────────────────────────────────
	server.route("GET", "/api/rta/audit", async (req) => {
		const rta = deps.getRtaEngine();
		if (!rta) {
			return { status: 503, body: { error: "Rta engine not available" } };
		}

		try {
			const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
			const entries = rta.getAuditLog(limit);

			return {
				status: 200,
				body: {
					entries,
					count: entries.length,
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── GET /api/decisions ────────────────────────────────────────
	server.route("GET", "/api/decisions", async (req) => {
		const buddhi = deps.getBuddhi();
		const db = deps.getDatabase();
		if (!buddhi || !db) {
			return { status: 503, body: { error: "Buddhi decision framework not available" } };
		}

		try {
			const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
			const project = req.query.project ?? deps.getProjectPath();
			const category = req.query.category;

			const decisions = buddhi.listDecisions(
				{ project, category, limit },
				db,
			);

			return {
				status: 200,
				body: {
					decisions: decisions.map(d => ({
						id: d.id,
						timestamp: d.timestamp,
						category: d.category,
						description: d.description,
						confidence: d.confidence,
						hasOutcome: !!d.outcome,
						outcomeSuccess: d.outcome?.success,
					})),
					count: decisions.length,
					project,
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── GET /api/decisions/:id/reasoning ──────────────────────────
	server.route("GET", "/api/decisions/:id/reasoning", async (req) => {
		const buddhi = deps.getBuddhi();
		const db = deps.getDatabase();
		if (!buddhi || !db) {
			return { status: 503, body: { error: "Buddhi decision framework not available" } };
		}

		try {
			const decision = buddhi.getDecision(req.params.id, db);
			if (!decision) {
				return { status: 404, body: { error: `Decision not found: ${req.params.id}` } };
			}

			return {
				status: 200,
				body: {
					id: decision.id,
					timestamp: decision.timestamp,
					category: decision.category,
					description: decision.description,
					confidence: decision.confidence,
					reasoning: {
						pratijña: decision.reasoning.thesis,
						hetu: decision.reasoning.reason,
						udaharana: decision.reasoning.example,
						upanaya: decision.reasoning.application,
						nigamana: decision.reasoning.conclusion,
					},
					alternatives: decision.alternatives,
					outcome: decision.outcome ?? null,
					metadata: decision.metadata,
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});
}
