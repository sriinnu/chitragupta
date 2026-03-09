import type { CollaborationDeps, ServerLike } from "./collaboration-types.js";
import {
	collaborationFailure,
	collaborationUnavailable,
	normalizeChannelName,
} from "./collaboration-route-helpers.js";

export function mountSamitiCollaborationRoutes(
	server: ServerLike,
	deps: CollaborationDeps,
): void {
	server.route("GET", "/api/samiti/channels", async () => {
		const samiti = deps.getSamiti();
		if (!samiti) return collaborationUnavailable("Samiti ambient channels");

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
			return {
				status: 200,
				body: {
					channels: summary,
					count: summary.length,
					stats: samiti.stats(),
				},
			};
		} catch (err) {
			return collaborationFailure(err);
		}
	});

	server.route("GET", "/api/samiti/channels/:name", async (req) => {
		const samiti = deps.getSamiti();
		if (!samiti) return collaborationUnavailable("Samiti ambient channels");

		try {
			const channelName = normalizeChannelName(req.params.name);
			const channel = samiti.getChannel(channelName);
			if (!channel) {
				return { status: 404, body: { error: `Channel not found: ${channelName}` } };
			}

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
			return collaborationFailure(err);
		}
	});

	server.route("POST", "/api/samiti/channels/:name/broadcast", async (req) => {
		const samiti = deps.getSamiti();
		if (!samiti) return collaborationUnavailable("Samiti ambient channels");

		try {
			const channelName = normalizeChannelName(req.params.name);
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
			return collaborationFailure(err);
		}
	});
}
