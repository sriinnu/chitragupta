/**
 * Collaboration API Routes — REST endpoints for Phase 3 Multi-Agent Collaboration.
 *
 * Exposes Samiti (ambient channels), Sabha (deliberation), Lokapala (guardians),
 * and Akasha (shared knowledge) via JSON endpoints. Mounts onto the existing
 * ChitraguptaServer via `server.route()`.
 */

// ─── Duck-Typed Interfaces ──────────────────────────────────────────────────
// Avoid hard import dependencies — the actual classes are structurally
// compatible at runtime.

// ─── Samiti ─────────────────────────────────────────────────────────────────

interface SamitiMessageLike {
	id: string;
	channel: string;
	sender: string;
	severity: string;
	category: string;
	content: string;
	data?: unknown;
	timestamp: number;
	ttl: number;
	references?: string[];
}

interface SamitiChannelLike {
	name: string;
	description: string;
	maxHistory: number;
	subscribers: Set<string>;
	messages: SamitiMessageLike[];
	createdAt: number;
}

interface SamitiLike {
	listChannels(): SamitiChannelLike[];
	getChannel(name: string): SamitiChannelLike | undefined;
	listen(channel: string, opts?: {
		since?: number;
		severity?: string;
		limit?: number;
	}): SamitiMessageLike[];
	broadcast(
		channel: string,
		message: {
			sender: string;
			severity: string;
			category: string;
			content: string;
			data?: unknown;
			references?: string[];
			ttl?: number;
		},
	): SamitiMessageLike;
	stats(): { channels: number; totalMessages: number; subscribers: number };
}

// ─── Sabha ──────────────────────────────────────────────────────────────────

interface SabhaLike {
	id: string;
	topic: string;
	status: string;
	convener: string;
	participants: Array<{ id: string; role: string; expertise: number; credibility: number }>;
	rounds: Array<{
		roundNumber: number;
		proposal: Record<string, string>;
		challenges: unknown[];
		votes: unknown[];
		verdict: string | null;
	}>;
	finalVerdict: string | null;
	createdAt: number;
	concludedAt: number | null;
}

interface SabhaEngineLike {
	convene(
		topic: string,
		convener: string,
		participants: Array<{ id: string; role: string; expertise: number; credibility: number }>,
	): SabhaLike;
	getSabha(id: string): SabhaLike | undefined;
	listActive(): SabhaLike[];
	propose(sabhaId: string, proposerId: string, syllogism: Record<string, string>): unknown;
	vote(sabhaId: string, participantId: string, position: string, reasoning: string): unknown;
	conclude(sabhaId: string): SabhaLike;
	explain(sabhaId: string): string;
}

// ─── Lokapala ───────────────────────────────────────────────────────────────

interface FindingLike {
	id: string;
	guardianId: string;
	domain: string;
	severity: string;
	title: string;
	description: string;
	location?: string;
	suggestion?: string;
	confidence: number;
	autoFixable: boolean;
	timestamp: number;
}

interface GuardianStatsLike {
	scansCompleted: number;
	findingsTotal: number;
	findingsBySeverity: Record<string, number>;
	autoFixesApplied: number;
	lastScanAt: number;
	avgScanDurationMs: number;
}

interface LokapalaLike {
	allFindings(limit?: number): FindingLike[];
	findingsByDomain(domain: string): FindingLike[];
	criticalFindings(): FindingLike[];
	stats(): Record<string, GuardianStatsLike>;
}

// ─── Akasha ─────────────────────────────────────────────────────────────────

interface StigmergicTraceLike {
	id: string;
	agentId: string;
	traceType: string;
	topic: string;
	content: string;
	strength: number;
	reinforcements: number;
	metadata: Record<string, unknown>;
	createdAt: number;
	lastReinforcedAt: number;
}

interface AkashaLike {
	query(
		topic: string,
		opts?: { type?: string; minStrength?: number; limit?: number },
	): StigmergicTraceLike[];
	leave(
		agentId: string,
		type: string,
		topic: string,
		content: string,
		metadata?: Record<string, unknown>,
	): StigmergicTraceLike;
	strongest(limit?: number): StigmergicTraceLike[];
	stats(): {
		totalTraces: number;
		activeTraces: number;
		byType: Record<string, number>;
		avgStrength: number;
		strongestTopic: string | null;
		totalReinforcements: number;
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
 * Mount all Phase 3 Collaboration API routes onto the server.
 *
 * @param server - ChitraguptaServer instance
 * @param deps   - Lazy getters for collaboration modules
 */
export function mountCollaborationRoutes(
	server: ServerLike,
	deps: {
		getSamiti: () => SamitiLike | undefined;
		getSabhaEngine: () => SabhaEngineLike | undefined;
		getLokapala: () => LokapalaLike | undefined;
		getAkasha: () => AkashaLike | undefined;
	},
): void {

	// ═════════════════════════════════════════════════════════════════════
	// Samiti — Ambient Communication Channels
	// ═════════════════════════════════════════════════════════════════════

	// ─── GET /api/samiti/channels ───────────────────────────────────
	server.route("GET", "/api/samiti/channels", async () => {
		const samiti = deps.getSamiti();
		if (!samiti) {
			return { status: 503, body: { error: "Samiti ambient channels not available" } };
		}

		try {
			const channels = samiti.listChannels();
			const summary = channels.map(ch => ({
				name: ch.name,
				description: ch.description,
				maxHistory: ch.maxHistory,
				subscribers: [...ch.subscribers],
				messageCount: ch.messages.length,
				createdAt: ch.createdAt,
			}));

			const stats = samiti.stats();

			return {
				status: 200,
				body: {
					channels: summary,
					count: summary.length,
					stats,
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── GET /api/samiti/channels/:name ─────────────────────────────
	server.route("GET", "/api/samiti/channels/:name", async (req) => {
		const samiti = deps.getSamiti();
		if (!samiti) {
			return { status: 503, body: { error: "Samiti ambient channels not available" } };
		}

		try {
			const channelName = req.params.name.startsWith("#")
				? req.params.name
				: `#${req.params.name}`;

			const channel = samiti.getChannel(channelName);
			if (!channel) {
				return { status: 404, body: { error: `Channel not found: ${channelName}` } };
			}

			// Apply optional filters
			const opts: { since?: number; severity?: string; limit?: number } = {};
			if (req.query.since) opts.since = parseInt(req.query.since, 10);
			if (req.query.severity) opts.severity = req.query.severity;
			if (req.query.limit) opts.limit = parseInt(req.query.limit, 10);

			const messages = samiti.listen(channelName, opts);

			return {
				status: 200,
				body: {
					name: channel.name,
					description: channel.description,
					subscribers: [...channel.subscribers],
					messages,
					messageCount: messages.length,
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── POST /api/samiti/channels/:name/broadcast ──────────────────
	server.route("POST", "/api/samiti/channels/:name/broadcast", async (req) => {
		const samiti = deps.getSamiti();
		if (!samiti) {
			return { status: 503, body: { error: "Samiti ambient channels not available" } };
		}

		try {
			const channelName = req.params.name.startsWith("#")
				? req.params.name
				: `#${req.params.name}`;

			const body = (req.body ?? {}) as Record<string, unknown>;

			if (typeof body.sender !== "string" || body.sender.trim().length === 0) {
				return { status: 400, body: { error: "Missing or empty 'sender' field" } };
			}
			if (typeof body.content !== "string" || body.content.trim().length === 0) {
				return { status: 400, body: { error: "Missing or empty 'content' field" } };
			}

			const msg = samiti.broadcast(channelName, {
				sender: body.sender as string,
				severity: (body.severity as string) ?? "info",
				category: (body.category as string) ?? "general",
				content: body.content as string,
				data: body.data,
				references: Array.isArray(body.references) ? body.references as string[] : undefined,
				ttl: typeof body.ttl === "number" ? body.ttl : undefined,
			});

			return { status: 201, body: { message: msg } };
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ═════════════════════════════════════════════════════════════════════
	// Sabha — Multi-Agent Deliberation
	// ═════════════════════════════════════════════════════════════════════

	// ─── GET /api/sabha/deliberations ───────────────────────────────
	server.route("GET", "/api/sabha/deliberations", async () => {
		const engine = deps.getSabhaEngine();
		if (!engine) {
			return { status: 503, body: { error: "Sabha deliberation engine not available" } };
		}

		try {
			const active = engine.listActive();
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
				body: {
					deliberations,
					count: deliberations.length,
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── POST /api/sabha/deliberate ─────────────────────────────────
	server.route("POST", "/api/sabha/deliberate", async (req) => {
		const engine = deps.getSabhaEngine();
		if (!engine) {
			return { status: 503, body: { error: "Sabha deliberation engine not available" } };
		}

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

			const sabha = engine.convene(
				body.topic as string,
				body.convener as string,
				body.participants as Array<{
					id: string;
					role: string;
					expertise: number;
					credibility: number;
				}>,
			);

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
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── GET /api/sabha/deliberations/:id ───────────────────────────
	server.route("GET", "/api/sabha/deliberations/:id", async (req) => {
		const engine = deps.getSabhaEngine();
		if (!engine) {
			return { status: 503, body: { error: "Sabha deliberation engine not available" } };
		}

		try {
			const sabha = engine.getSabha(req.params.id);
			if (!sabha) {
				return { status: 404, body: { error: `Deliberation not found: ${req.params.id}` } };
			}

			// Include explanation if concluded
			let explanation: string | undefined;
			try {
				explanation = engine.explain(req.params.id);
			} catch {
				// explain() might fail for edge cases; non-critical
			}

			return {
				status: 200,
				body: {
					...sabha,
					explanation,
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ═════════════════════════════════════════════════════════════════════
	// Lokapala — Guardian Agents
	// ═════════════════════════════════════════════════════════════════════

	// ─── GET /api/lokapala/guardians ────────────────────────────────
	server.route("GET", "/api/lokapala/guardians", async () => {
		const lokapala = deps.getLokapala();
		if (!lokapala) {
			return { status: 503, body: { error: "Lokapala guardians not available" } };
		}

		try {
			const allStats = lokapala.stats();
			const guardians = Object.entries(allStats).map(([domain, stats]) => ({
				domain,
				scansCompleted: stats.scansCompleted,
				findingsTotal: stats.findingsTotal,
				findingsBySeverity: stats.findingsBySeverity,
				autoFixesApplied: stats.autoFixesApplied,
				lastScanAt: stats.lastScanAt,
				avgScanDurationMs: stats.avgScanDurationMs,
			}));

			return {
				status: 200,
				body: {
					guardians,
					count: guardians.length,
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── GET /api/lokapala/violations ───────────────────────────────
	server.route("GET", "/api/lokapala/violations", async (req) => {
		const lokapala = deps.getLokapala();
		if (!lokapala) {
			return { status: 503, body: { error: "Lokapala guardians not available" } };
		}

		try {
			const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
			const domain = req.query.domain;
			const severity = req.query.severity;

			let findings: FindingLike[];
			if (domain) {
				findings = lokapala.findingsByDomain(domain);
			} else if (severity === "critical") {
				findings = lokapala.criticalFindings();
			} else {
				findings = lokapala.allFindings(limit);
			}

			// Apply severity filter if both domain and severity are provided
			if (domain && severity) {
				findings = findings.filter(f => f.severity === severity);
			}

			// Apply limit
			if (findings.length > limit) {
				findings = findings.slice(0, limit);
			}

			return {
				status: 200,
				body: {
					violations: findings,
					count: findings.length,
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── GET /api/lokapala/stats ────────────────────────────────────
	server.route("GET", "/api/lokapala/stats", async () => {
		const lokapala = deps.getLokapala();
		if (!lokapala) {
			return { status: 503, body: { error: "Lokapala guardians not available" } };
		}

		try {
			const allStats = lokapala.stats();
			const criticalCount = lokapala.criticalFindings().length;
			const totalFindings = lokapala.allFindings().length;

			return {
				status: 200,
				body: {
					domains: allStats,
					summary: {
						totalFindings,
						criticalFindings: criticalCount,
						guardianCount: Object.keys(allStats).length,
					},
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ═════════════════════════════════════════════════════════════════════
	// Akasha — Shared Knowledge Field
	// ═════════════════════════════════════════════════════════════════════

	// ─── GET /api/akasha/traces ─────────────────────────────────────
	server.route("GET", "/api/akasha/traces", async (req) => {
		const akasha = deps.getAkasha();
		if (!akasha) {
			return { status: 503, body: { error: "Akasha knowledge field not available" } };
		}

		try {
			const topic = req.query.topic;
			const type = req.query.type;
			const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;

			let traces: StigmergicTraceLike[];
			if (topic) {
				traces = akasha.query(topic, { type, limit });
			} else {
				traces = akasha.strongest(limit);
			}

			return {
				status: 200,
				body: {
					traces,
					count: traces.length,
				},
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── POST /api/akasha/traces ────────────────────────────────────
	server.route("POST", "/api/akasha/traces", async (req) => {
		const akasha = deps.getAkasha();
		if (!akasha) {
			return { status: 503, body: { error: "Akasha knowledge field not available" } };
		}

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

			const metadata = (typeof body.metadata === "object" && body.metadata !== null && !Array.isArray(body.metadata))
				? body.metadata as Record<string, unknown>
				: undefined;

			const trace = akasha.leave(
				body.agentId as string,
				body.traceType as string,
				body.topic as string,
				body.content as string,
				metadata,
			);

			return { status: 201, body: { trace } };
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});

	// ─── GET /api/akasha/stats ──────────────────────────────────────
	server.route("GET", "/api/akasha/stats", async () => {
		const akasha = deps.getAkasha();
		if (!akasha) {
			return { status: 503, body: { error: "Akasha knowledge field not available" } };
		}

		try {
			const stats = akasha.stats();
			return { status: 200, body: stats };
		} catch (err) {
			return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
		}
	});
}
