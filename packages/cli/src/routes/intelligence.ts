/** Intelligence API Routes — Turiya, Triguna, Rta, Buddhi endpoints. */

// Duck-typed interfaces — actual classes are structurally compatible at runtime.

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
	classify(context: Record<string, number>, preference?: { costWeight: number }): {
		tier: string;
		confidence: number;
		costEstimate: number;
		rationale: string;
	};
	cascadeDecision(decision: { tier: string; confidence: number; costEstimate: number; context: Record<string, number>; rationale: string; armIndex: number }, threshold?: number): {
		final: { tier: string; confidence: number; costEstimate: number };
		escalated: boolean;
		originalTier?: string;
	};
	extractContext(messages: Array<{ role: string; content: Array<{ type: string; text: string }> }>, systemPrompt?: string, tools?: unknown[], memoryHits?: number): Record<string, number>;
	recordOutcome(decision: { tier: string; confidence: number; costEstimate: number; context: Record<string, number>; rationale: string; armIndex: number }, reward: number): void;
	getBudgetLambda(): number;
}

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

/** Mount all Phase 2 Intelligence Layer API routes onto the server. */
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

	server.route("POST", "/api/turiya/classify", async (req) => {
		const router = deps.getTuriyaRouter();
		if (!router) {
			return { status: 503, body: { error: "Turiya router not available" } };
		}
		try {
			const body = req.body as Record<string, unknown>;
			const text = typeof body.text === "string" ? body.text : "";
			const messageCount = typeof body.messageCount === "number" ? body.messageCount : 0;
			const memoryHits = typeof body.memoryHits === "number" ? body.memoryHits : 0;

			const messages = [{ role: "user" as const, content: [{ type: "text" as const, text }] }];
			const context = router.extractContext(messages, undefined, undefined, memoryHits);
			const preference = typeof body.costWeight === "number"
				? { costWeight: body.costWeight }
				: undefined;
			const decision = router.classify(context, preference);

			return { status: 200, body: decision };
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	server.route("POST", "/api/turiya/outcome", async (req) => {
		const router = deps.getTuriyaRouter();
		if (!router) {
			return { status: 503, body: { error: "Turiya router not available" } };
		}
		try {
			const body = req.body as Record<string, unknown>;
			const tier = typeof body.tier === "string" ? body.tier : "haiku";
			const reward = typeof body.reward === "number" ? body.reward : 0.5;
			const ctx = (body.context ?? {}) as Record<string, number>;

			const context = {
				complexity: ctx.complexity ?? 0.5,
				urgency: ctx.urgency ?? 0,
				creativity: ctx.creativity ?? 0,
				precision: ctx.precision ?? 0,
				codeRatio: ctx.codeRatio ?? 0,
				conversationDepth: ctx.conversationDepth ?? 0,
				memoryLoad: ctx.memoryLoad ?? 0,
			};

			const tiers = ["no-llm", "haiku", "sonnet", "opus"];
			const decision = {
				tier, confidence: 0.5, costEstimate: 0, context,
				rationale: "outcome", armIndex: tiers.indexOf(tier),
			};
			router.recordOutcome(decision, reward);
			return { status: 200, body: { ok: true } };
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	server.route("GET", "/api/turiya/budget-state", async () => {
		const router = deps.getTuriyaRouter();
		if (!router) {
			return { status: 503, body: { error: "Turiya router not available" } };
		}
		try {
			const stats = router.getStats();
			return {
				status: 200,
				body: {
					budgetLambda: router.getBudgetLambda(),
					dailySpend: stats.totalCost,
					totalRequests: stats.totalRequests,
					savingsPercent: stats.savingsPercent,
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});
}
