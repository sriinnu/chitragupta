/**
 * Wire 5: Mesh Bootstrap — auto-spawn functional system actors + default soul.
 *
 * Ensures `mesh_status` returns non-zero actors and `atman_report` has identity
 * from the moment the MCP server starts. Uses the shared singletons from
 * mcp-subsystems.ts (same instances the mesh/soul tools use).
 *
 * Actors are now functional (not stubs): sys:memory handles search/recall/store,
 * sys:skills handles find/recommend/list, sys:session handles list/show/handover.
 * See mesh-actors.ts for the full behavior implementations.
 *
 * @module
 */

import type { McpServer } from "@chitragupta/tantra";
import { getActorSystem } from "./mcp-subsystems.js";
import {
	createMemoryActorBehavior,
	createSkillsActorBehavior,
	createSessionActorBehavior,
} from "./mesh-actors.js";
import type { ActorBehaviorSpec } from "./mesh-actors.js";

// ─── Bootstrap ───────────────────────────────────────────────────────────────

/**
 * Bootstrap built-in mesh actors and ensure a default soul exists.
 * Idempotent: existing actors/souls are not duplicated.
 *
 * System actors spawned:
 * - sys:memory  — memory search, recall, store via daemon-bridge
 * - sys:skills  — skill find, recommend, list via SkillRegistry + TVM
 * - sys:session — session list, show, handover via daemon-bridge
 */
export async function bootstrapMeshAndSoul(_server: McpServer): Promise<void> {
	let actorsSpawned = 0;
	let soulCreated = false;

	// ─── 1. Spawn functional system actors ─────────────────────────
	try {
		const sys = await getActorSystem();
		const actors: Array<{ id: string; behavior: ActorBehaviorSpec }> = [
			{ id: "sys:memory", behavior: createMemoryActorBehavior() },
			{ id: "sys:skills", behavior: createSkillsActorBehavior() },
			{ id: "sys:session", behavior: createSessionActorBehavior() },
		];
		for (const { id, behavior } of actors) {
			try {
				sys.spawn(id, behavior);
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
