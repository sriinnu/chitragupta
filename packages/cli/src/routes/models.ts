/**
 * Models API Routes -- REST endpoints for model catalog and router state.
 *
 * Builds a unified model catalog by iterating over registered providers
 * and extracting their available models. Also exposes TuriyaRouter state
 * for intelligent model selection inspection.
 *
 * @module routes/models
 */

// ── Duck-Typed Interfaces ──────────────────────────────────────────────────

/** Duck-typed TuriyaRouter -- avoids hard import dependency. */
interface TuriyaRouterLike {
	getState(): Record<string, unknown>;
}

/** Duck-typed server for route registration. */
interface ServerLike {
	route(
		method: string,
		path: string,
		handler: (req: {
			params: Record<string, string>;
			query: Record<string, string>;
			body: unknown;
			headers: Record<string, string>;
			requestId: string;
		}) => Promise<{ status: number; body: unknown }>,
	): void;
}

/** Normalized model descriptor returned in the catalog. */
interface ModelDescriptor {
	id: string;
	provider: string;
	displayName: string;
	capabilities?: string[];
	pricing?: {
		inputPer1k?: number;
		outputPer1k?: number;
	};
}

/** Dependencies for model route mounting. */
interface ModelRouteDeps {
	listProviders?: () => unknown[];
	getTuriyaRouter?: () => TuriyaRouterLike | undefined;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Safely extract a string field from a duck-typed object.
 * Returns `undefined` if the field is absent or not a string.
 */
function safeString(obj: Record<string, unknown>, key: string): string | undefined {
	const val = obj[key];
	return typeof val === "string" ? val : undefined;
}

/**
 * Extract model descriptors from a single duck-typed provider.
 * Tries `.getModels()`, then `.models`, then `.availableModels`.
 */
function extractModels(provider: unknown): ModelDescriptor[] {
	if (!provider || typeof provider !== "object") return [];
	const p = provider as Record<string, unknown>;
	const providerId = safeString(p, "id") ?? safeString(p, "name") ?? "unknown";

	let rawModels: unknown[] = [];

	// Try getModels() method first
	if (typeof p.getModels === "function") {
		try {
			const result = (p.getModels as () => unknown)();
			if (Array.isArray(result)) rawModels = result;
		} catch {
			// Fall through to field access
		}
	}

	// Fall back to .models or .availableModels fields
	if (rawModels.length === 0 && Array.isArray(p.models)) {
		rawModels = p.models;
	}
	if (rawModels.length === 0 && Array.isArray(p.availableModels)) {
		rawModels = p.availableModels;
	}

	return rawModels.map((m) => normalizeModel(m, providerId));
}

/**
 * Normalize a raw model value into a ModelDescriptor.
 * Handles both string model IDs and object-shaped model definitions.
 */
function normalizeModel(raw: unknown, providerId: string): ModelDescriptor {
	if (typeof raw === "string") {
		return { id: raw, provider: providerId, displayName: raw };
	}
	if (raw && typeof raw === "object") {
		const m = raw as Record<string, unknown>;
		const id = safeString(m, "id") ?? safeString(m, "name") ?? "unknown";
		const displayName = safeString(m, "displayName") ?? safeString(m, "label") ?? id;
		const capabilities = Array.isArray(m.capabilities)
			? (m.capabilities as unknown[]).filter((c): c is string => typeof c === "string")
			: undefined;

		let pricing: ModelDescriptor["pricing"] = undefined;
		if (m.pricing && typeof m.pricing === "object") {
			const pr = m.pricing as Record<string, unknown>;
			pricing = {
				inputPer1k: typeof pr.inputPer1k === "number" ? pr.inputPer1k : undefined,
				outputPer1k: typeof pr.outputPer1k === "number" ? pr.outputPer1k : undefined,
			};
		}

		return { id, provider: providerId, displayName, capabilities, pricing };
	}
	return { id: "unknown", provider: providerId, displayName: "unknown" };
}

// ── Route Mounter ──────────────────────────────────────────────────────────

/**
 * Mount model catalog and router API routes onto the server.
 *
 * @param server - ChitraguptaServer instance (duck-typed)
 * @param deps   - Lazy getters for providers and TuriyaRouter
 */
export function mountModelRoutes(server: ServerLike, deps: ModelRouteDeps): void {
	/** Build the full model catalog from all providers. */
	function buildCatalog(): ModelDescriptor[] {
		const providers = deps.listProviders?.() ?? [];
		const catalog: ModelDescriptor[] = [];
		for (const provider of providers) {
			catalog.push(...extractModels(provider));
		}
		return catalog;
	}

	// ── GET /api/models ────────────────────────────────────────────
	server.route("GET", "/api/models", async () => {
		try {
			const models = buildCatalog();
			return { status: 200, body: { models, count: models.length } };
		} catch (err) {
			return { status: 500, body: { error: `Failed to list models: ${(err as Error).message}` } };
		}
	});

	// ── GET /api/models/router ─────────────────────────────────────
	// Registered before :id to avoid pattern collision
	server.route("GET", "/api/models/router", async () => {
		try {
			const router = deps.getTuriyaRouter?.();
			if (!router) {
				return { status: 503, body: { error: "TuriyaRouter not available" } };
			}
			const state = router.getState();
			return { status: 200, body: { router: state } };
		} catch (err) {
			return { status: 500, body: { error: `Router state failed: ${(err as Error).message}` } };
		}
	});

	// ── GET /api/models/:id ────────────────────────────────────────
	server.route("GET", "/api/models/:id", async (req) => {
		try {
			const catalog = buildCatalog();
			const model = catalog.find((m) => m.id === req.params.id);
			if (!model) {
				return { status: 404, body: { error: `Model not found: ${req.params.id}` } };
			}
			return { status: 200, body: { model } };
		} catch (err) {
			return { status: 500, body: { error: `Failed to get model: ${(err as Error).message}` } };
		}
	});
}
