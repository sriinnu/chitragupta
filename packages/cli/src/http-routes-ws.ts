/**
 * WebSocket chat handler and dynamic route module mounting.
 * @module http-routes-ws
 */

import { randomUUID } from "node:crypto";
import type { ChitraguptaServer } from "./http-server.js";
import type { ApiDeps, ServerConfig } from "./http-server-types.js";

/** Job runner function signature (returned by mountJobRoutes). */
type JobRunner = (
	message: string,
	onEvent: (type: string, data: unknown) => void,
	signal: AbortSignal,
) => Promise<string>;

/** Mount optional dynamic route modules (skills, evolution, intelligence, etc.). */
export function mountDynamicRoutes(
	server: ChitraguptaServer,
	deps: ApiDeps,
	config?: ServerConfig,
): void {
	if (deps.getVidyaOrchestrator) {
		const getOrch = deps.getVidyaOrchestrator;
		import("./routes/skills.js").then(({ mountSkillRoutes }) => {
			mountSkillRoutes(server, getOrch as never);
		}).catch(() => { /* skill routes are optional */ });
	}

	if (deps.getVasanaEngine || deps.getNidraDaemon || deps.getVidhiEngine) {
		import("./routes/evolution.js").then(({ mountEvolutionRoutes }) => {
			mountEvolutionRoutes(server, {
				getVasanaEngine: (deps.getVasanaEngine ?? (() => undefined)) as never,
				getNidraDaemon: (deps.getNidraDaemon ?? (() => undefined)) as never,
				getVidhiEngine: (deps.getVidhiEngine ?? (() => undefined)) as never,
				getProjectPath: deps.getProjectPath ?? (() => process.cwd()),
			});
		}).catch(() => { /* evolution routes are optional */ });
	}

	if (deps.getTuriyaRouter || deps.getTriguna || deps.getRtaEngine || deps.getBuddhi) {
		import("./routes/intelligence.js").then(({ mountIntelligenceRoutes }) => {
			mountIntelligenceRoutes(server, {
				getTuriyaRouter: (deps.getTuriyaRouter ?? (() => undefined)) as never,
				getTriguna: (deps.getTriguna ?? (() => undefined)) as never,
				getRtaEngine: (deps.getRtaEngine ?? (() => undefined)) as never,
				getBuddhi: (deps.getBuddhi ?? (() => undefined)) as never,
				getDatabase: (deps.getDatabase ?? (() => undefined)) as never,
				getProjectPath: deps.getProjectPath ?? (() => process.cwd()),
			});
		}).catch(() => { /* intelligence routes are optional */ });
	}

	import("./routes/workflow.js").then(({ mountWorkflowRoutes }) => {
		mountWorkflowRoutes(server);
	}).catch(() => { /* workflow routes are optional */ });

	if (deps.getSamiti || deps.getSabhaEngine || deps.getLokapala || deps.getAkasha) {
		import("./routes/collaboration.js").then(({ mountCollaborationRoutes }) => {
			mountCollaborationRoutes(server, {
				getSamiti: (deps.getSamiti ?? (() => undefined)) as never,
				getSabhaEngine: (deps.getSabhaEngine ?? (() => undefined)) as never,
				getLokapala: (deps.getLokapala ?? (() => undefined)) as never,
				getAkasha: (deps.getAkasha ?? (() => undefined)) as never,
			});
		}).catch(() => { /* collaboration routes are optional */ });
	}

	if (deps.getKartavyaEngine || deps.getKalaChakra) {
		import("./routes/autonomy.js").then(({ mountAutonomyRoutes }) => {
			mountAutonomyRoutes(server, {
				getKartavyaEngine: (deps.getKartavyaEngine ?? (() => undefined)) as never,
				getKalaChakra: (deps.getKalaChakra ?? (() => undefined)) as never,
				getProjectPath: deps.getProjectPath ?? (() => process.cwd()),
			});
		}).catch(() => { /* autonomy routes are optional */ });
	}

	import("./openapi.js").then(({ generateOpenAPISpec }) => {
		server.route("GET", "/api/openapi.json", async () => {
			try {
				const spec = generateOpenAPISpec("0.1.0");
				return { status: 200, body: spec };
			} catch (err) {
				return { status: 500, body: { error: `Failed to generate OpenAPI spec: ${(err as Error).message}` } };
			}
		});
	}).catch(() => { /* openapi module is optional */ });
}

/**
 * Wire WebSocket chat/abort handlers and override server.start() to attach them post-listen.
 */
export function wireWebSocket(
	server: ChitraguptaServer,
	jobRunner: JobRunner,
): void {
	const activeAborts = new Map<string, AbortController>();

	const wireEvents = () => {
		if (!server.ws) return;

		server.ws.events.onMessage = (client, msg) => {
			switch (msg.type) {
				case "chat": {
					const data = msg.data as { message?: string } | undefined;
					const message = data?.message;
					if (typeof message !== "string" || message.trim().length === 0) {
						client.send({
							type: "chat:error",
							data: { error: "Missing or empty 'message' in data" },
							requestId: msg.requestId,
						});
						return;
					}
					const requestId = msg.requestId ?? randomUUID();
					const ac = new AbortController();
					activeAborts.set(requestId, ac);
					client.send({ type: "chat:start", requestId });

					const onEvent = (type: string, eventData: unknown) => {
						const ed = eventData as Record<string, unknown>;
						switch (type) {
							case "stream:text":
								client.send({ type: "stream:text", data: ed.text, requestId });
								break;
							case "stream:thinking":
								client.send({ type: "stream:thinking", data: ed.text, requestId });
								break;
							case "tool:start":
								client.send({ type: "tool:start", data: { name: ed.name, input: ed.input }, requestId });
								break;
							case "tool:done":
								client.send({ type: "tool:done", data: { name: ed.name, result: ed.result }, requestId });
								break;
							default:
								if (server.ws) {
									server.ws.sendTo(client.id, type, eventData, requestId);
								}
								break;
						}
					};

					jobRunner(message.trim(), onEvent, ac.signal)
						.then((response) => {
							client.send({ type: "chat:done", data: { response }, requestId });
						})
						.catch((err) => {
							client.send({
								type: "chat:error",
								data: { error: err instanceof Error ? err.message : String(err) },
								requestId,
							});
						})
						.finally(() => { activeAborts.delete(requestId); });
					break;
				}
				case "abort": {
					const requestId = msg.requestId;
					if (requestId && activeAborts.has(requestId)) {
						activeAborts.get(requestId)!.abort();
						activeAborts.delete(requestId);
						client.send({ type: "chat:aborted", requestId });
					} else {
						client.send({ type: "error", data: { error: `No active request with id: ${requestId}` } });
					}
					break;
				}
				default: break;
			}
		};
	};

	// Override start() so WS events are wired after the server is listening
	const originalStart = server.start.bind(server);
	server.start = async function () {
		const port = await originalStart();
		wireEvents();
		return port;
	};
}
