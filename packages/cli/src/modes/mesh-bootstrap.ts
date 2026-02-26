/**
 * Wire 5: Mesh Bootstrap — auto-spawn system actors + default soul on MCP server start.
 *
 * Ensures `mesh_status` returns non-zero actors and `atman_report` has identity
 * from the moment the MCP server starts. Uses the shared singletons from
 * mcp-subsystems.ts (same instances the mesh/soul tools use).
 *
 * @module
 */

import type { McpServer } from "@chitragupta/tantra";
import { getActorSystem } from "./mcp-subsystems.js";

// ─── Actor Behaviors ─────────────────────────────────────────────────────────

/** System actor behavior: responds to ping/status, acks everything else. */
function createSystemBehavior(actorName: string) {
	return {
		capabilities: [`${actorName}-query`, `${actorName}-status`],
		expertise: [actorName],
		handle: async (
			msg: { type: string; payload?: unknown },
			ctx: { self: string; reply: (payload: unknown) => void },
		): Promise<void> => {
			if (msg.type === "ping") {
				ctx.reply({ type: "pong", actor: ctx.self, name: actorName });
			} else if (msg.type === "status") {
				ctx.reply({ type: "status", actor: ctx.self, name: actorName, alive: true });
			} else {
				ctx.reply({ type: "ack", actor: ctx.self, received: msg.type });
			}
		},
	};
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

/**
 * Bootstrap built-in mesh actors and ensure a default soul exists.
 * Idempotent: existing actors/souls are not duplicated.
 */
export async function bootstrapMeshAndSoul(_server: McpServer): Promise<void> {
	let actorsSpawned = 0;
	let soulCreated = false;

	// ─── 1. Spawn system actors via shared singleton ─────────────────
	try {
		const sys = await getActorSystem();
		const actors = [
			{ id: "sys:memory", name: "memory-agent" },
			{ id: "sys:skills", name: "skill-agent" },
			{ id: "sys:session", name: "session-agent" },
		];
		for (const { id, name } of actors) {
			try {
				sys.spawn(id, createSystemBehavior(name));
				actorsSpawned++;
			} catch { /* actor already exists — idempotent */ }
		}
	} catch { /* ActorSystem not available — best-effort */ }

	// ─── 2. Ensure default soul exists ───────────────────────────────
	// Create soul BEFORE the singleton is lazily initialized, so when
	// getSoulManager() is first called (e.g. by atman_report), it loads
	// the persisted soul from disk.
	try {
		const { SoulManager } = await import("@chitragupta/anina");
		const mgr = new SoulManager({ persist: true });
		if (mgr.getAll().length === 0) {
			mgr.create({
				id: "chitragupta",
				name: "Chitragupta",
				archetype: "curious-scholar",
				purpose: "Observe, remember, and assist with wisdom",
			});
			soulCreated = true;
		}
	} catch { /* SoulManager not available — best-effort */ }

	process.stderr.write(
		`[mesh-bootstrap] actors: ${actorsSpawned}, soul: ${soulCreated ? "created" : "exists"}\n`,
	);
}
