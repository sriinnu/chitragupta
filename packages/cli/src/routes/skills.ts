/**
 * Skill API Routes — REST endpoints for the Vidya ecosystem.
 *
 * Mounts onto the existing ChitraguptaServer via `server.route()`.
 * Returns JSON responses for CLI, Vaayu, and external consumers.
 */

// Duck-typed orchestrator to avoid hard import dependency
interface OrchestratorLike {
	getEcosystemStats(): Record<string, unknown>;
	getSkillReport(name?: string): unknown;
	promoteSkill(name: string, reviewer?: string): boolean;
	deprecateSkill(name: string, reason?: string): boolean;
	evaluateLifecycles(): Record<string, unknown>;
	learnSkill(query: string): Promise<{
		success: boolean;
		skillName?: string;
		status: string;
		quarantineId?: string;
		error?: string;
		durationMs: number;
	}>;
	yoga: { getAll(): unknown[] };
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

/**
 * Mount all skill API routes onto the server.
 *
 * @param server - ChitraguptaServer instance
 * @param getOrchestrator - Lazy getter (orchestrator may not be ready at mount time)
 */
export function mountSkillRoutes(
	server: ServerLike,
	getOrchestrator: () => OrchestratorLike | undefined,
): void {
	// ─── GET /api/skills ─────────────────────────────────────────────
	server.route("GET", "/api/skills", async (req) => {
		const orch = getOrchestrator();
		if (!orch) {
			return { status: 503, body: { error: "Vidya Orchestrator not available" } };
		}

		try {
			const reports = orch.getSkillReport() as unknown[];
			return { status: 200, body: { skills: reports } };
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── GET /api/skills/ecosystem ───────────────────────────────────
	server.route("GET", "/api/skills/ecosystem", async () => {
		const orch = getOrchestrator();
		if (!orch) {
			return { status: 503, body: { error: "Vidya Orchestrator not available" } };
		}

		try {
			const stats = orch.getEcosystemStats();
			return { status: 200, body: stats };
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── GET /api/skills/compositions ────────────────────────────────
	server.route("GET", "/api/skills/compositions", async () => {
		const orch = getOrchestrator();
		if (!orch) {
			return { status: 503, body: { error: "Vidya Orchestrator not available" } };
		}

		try {
			const compositions = orch.yoga.getAll();
			return { status: 200, body: { compositions } };
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── GET /api/skills/:name ───────────────────────────────────────
	server.route("GET", "/api/skills/:name", async (req) => {
		const orch = getOrchestrator();
		if (!orch) {
			return { status: 503, body: { error: "Vidya Orchestrator not available" } };
		}

		try {
			const report = orch.getSkillReport(req.params.name);
			return { status: 200, body: report };
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── POST /api/skills/:name/promote ─────────────────────────────
	server.route("POST", "/api/skills/:name/promote", async (req) => {
		const orch = getOrchestrator();
		if (!orch) {
			return { status: 503, body: { error: "Vidya Orchestrator not available" } };
		}

		try {
			const body = req.body as { reviewer?: string } | undefined;
			const success = orch.promoteSkill(req.params.name, body?.reviewer);
			if (success) {
				return { status: 200, body: { promoted: true, skill: req.params.name } };
			}
			return { status: 400, body: { promoted: false, error: "Transition not allowed" } };
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── POST /api/skills/:name/deprecate ────────────────────────────
	server.route("POST", "/api/skills/:name/deprecate", async (req) => {
		const orch = getOrchestrator();
		if (!orch) {
			return { status: 503, body: { error: "Vidya Orchestrator not available" } };
		}

		try {
			const body = req.body as { reason?: string } | undefined;
			const success = orch.deprecateSkill(req.params.name, body?.reason);
			if (success) {
				return { status: 200, body: { deprecated: true, skill: req.params.name } };
			}
			return { status: 400, body: { deprecated: false, error: "Transition not allowed" } };
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── POST /api/skills/learn ──────────────────────────────────────
	server.route("POST", "/api/skills/learn", async (req) => {
		const orch = getOrchestrator();
		if (!orch) {
			return { status: 503, body: { error: "Vidya Orchestrator not available" } };
		}

		try {
			const body = req.body as { query?: string } | undefined;
			if (!body?.query) {
				return { status: 400, body: { error: "Missing 'query' field" } };
			}

			const result = await orch.learnSkill(body.query);
			return { status: result.success ? 200 : 422, body: result };
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── POST /api/skills/evaluate ───────────────────────────────────
	server.route("POST", "/api/skills/evaluate", async () => {
		const orch = getOrchestrator();
		if (!orch) {
			return { status: 503, body: { error: "Vidya Orchestrator not available" } };
		}

		try {
			const report = orch.evaluateLifecycles();
			return { status: 200, body: report };
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});
}
