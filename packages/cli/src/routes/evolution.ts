/**
 * Evolution API Routes — REST endpoints for Phase 1 Self-Evolution.
 *
 * Exposes vasanas (crystallized tendencies), Nidra daemon status,
 * and Vidhi procedural memory via JSON endpoints. Mounts onto the
 * existing ChitraguptaServer via `server.route()`.
 */

// ─── Duck-Typed Interfaces ──────────────────────────────────────────────────
// Avoid hard import dependencies — the actual classes are structurally
// compatible at runtime.

interface VasanaLike {
	id: string;
	tendency: string;
	description: string;
	strength: number;
	stability: number;
	valence: string;
	sourceSamskaras: string[];
	reinforcementCount: number;
	lastActivated: number;
	predictiveAccuracy: number;
	project: string;
	createdAt: number;
	updatedAt: number;
}

interface VasanaEngineLike {
	getVasanas(project: string, topK?: number): VasanaLike[];
}

interface NidraSnapshotLike {
	state: string;
	lastStateChange: number;
	lastHeartbeat: number;
	lastConsolidationStart?: number;
	lastConsolidationEnd?: number;
	consolidationPhase?: string;
	consolidationProgress: number;
	uptime: number;
}

interface NidraDaemonLike {
	snapshot(): NidraSnapshotLike;
	wake(): void;
}

interface VidhiLike {
	id: string;
	project: string;
	name: string;
	learnedFrom: string[];
	confidence: number;
	steps: Array<{ index: number; toolName: string; description: string }>;
	triggers: string[];
	successRate: number;
	successCount: number;
	failureCount: number;
	parameterSchema: Record<string, unknown>;
	createdAt: number;
	updatedAt: number;
}

interface VidhiEngineLike {
	getVidhis(project: string, topK?: number): VidhiLike[];
	getVidhi(id: string): VidhiLike | null;
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

// ─── Route Mounter ──────────────────────────────────────────────────────────

/**
 * Mount all Phase 1 Self-Evolution API routes onto the server.
 *
 * @param server - ChitraguptaServer instance
 * @param deps   - Lazy getters for evolution modules
 */
export function mountEvolutionRoutes(
	server: ServerLike,
	deps: {
		getVasanaEngine: () => VasanaEngineLike | undefined;
		getNidraDaemon: () => NidraDaemonLike | undefined;
		getVidhiEngine: () => VidhiEngineLike | undefined;
		getProjectPath: () => string;
	},
): void {
	// ─── GET /api/vasanas ───────────────────────────────────────────
	server.route("GET", "/api/vasanas", async (req) => {
		const engine = deps.getVasanaEngine();
		if (!engine) {
			return { status: 503, body: { error: "Vasana engine not available" } };
		}

		try {
			const topK = req.query.limit ? parseInt(req.query.limit, 10) : 20;
			const project = req.query.project ?? deps.getProjectPath();
			const vasanas = engine.getVasanas(project, topK);
			return {
				status: 200,
				body: {
					vasanas,
					count: vasanas.length,
					project,
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── GET /api/vasanas/:id ───────────────────────────────────────
	server.route("GET", "/api/vasanas/:id", async (req) => {
		const engine = deps.getVasanaEngine();
		if (!engine) {
			return { status: 503, body: { error: "Vasana engine not available" } };
		}

		try {
			const project = deps.getProjectPath();
			const vasanas = engine.getVasanas(project, 200);
			const vasana = vasanas.find(v => v.id === req.params.id);
			if (!vasana) {
				return { status: 404, body: { error: `Vasana not found: ${req.params.id}` } };
			}
			return { status: 200, body: vasana };
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── GET /api/nidra/status ──────────────────────────────────────
	server.route("GET", "/api/nidra/status", async () => {
		const daemon = deps.getNidraDaemon();
		if (!daemon) {
			return { status: 503, body: { error: "Nidra daemon not available" } };
		}

		try {
			const snap = daemon.snapshot();
			return { status: 200, body: snap };
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── POST /api/nidra/wake ───────────────────────────────────────
	server.route("POST", "/api/nidra/wake", async () => {
		const daemon = deps.getNidraDaemon();
		if (!daemon) {
			return { status: 503, body: { error: "Nidra daemon not available" } };
		}

		try {
			daemon.wake();
			const snap = daemon.snapshot();
			return { status: 200, body: { woken: true, state: snap.state } };
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── GET /api/vidhi ─────────────────────────────────────────────
	server.route("GET", "/api/vidhi", async (req) => {
		const engine = deps.getVidhiEngine();
		if (!engine) {
			return { status: 503, body: { error: "Vidhi engine not available" } };
		}

		try {
			const topK = req.query.limit ? parseInt(req.query.limit, 10) : 20;
			const project = req.query.project ?? deps.getProjectPath();
			const vidhis = engine.getVidhis(project, topK);
			return {
				status: 200,
				body: {
					vidhis,
					count: vidhis.length,
					project,
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── GET /api/vidhi/:name ───────────────────────────────────────
	server.route("GET", "/api/vidhi/:name", async (req) => {
		const engine = deps.getVidhiEngine();
		if (!engine) {
			return { status: 503, body: { error: "Vidhi engine not available" } };
		}

		try {
			const project = deps.getProjectPath();
			const vidhis = engine.getVidhis(project, 200);
			// Match by name or ID
			const vidhi = vidhis.find(
				v => v.name === req.params.name || v.id === req.params.name,
			) ?? engine.getVidhi(req.params.name);

			if (!vidhi) {
				return { status: 404, body: { error: `Vidhi not found: ${req.params.name}` } };
			}
			return { status: 200, body: vidhi };
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});
}
