import type { ActorSystemLike } from "./modes/mcp-subsystems-types.js";

let sharedActorSystem: ActorSystemLike | undefined;
let sharedBootstrapPromise: Promise<void> | undefined;

/**
 * Return the process-local shared ActorSystem used by CLI runtime surfaces.
 *
 * MCP tools, serve mode, and TUI should all route through this singleton so
 * mesh liveness, capability routing, and built-in actors share one source.
 */
export async function getSharedMeshActorSystem(): Promise<ActorSystemLike> {
	if (!sharedActorSystem) {
		const { ActorSystem } = await import("@chitragupta/sutra");
		const sys = new ActorSystem({
			maxMailboxSize: 5_000,
			gossipIntervalMs: 5_000,
			defaultAskTimeout: 5_000,
		});
		sys.start();
		sharedActorSystem = sys as unknown as ActorSystemLike;
	}
	return sharedActorSystem;
}

/**
 * Ensure built-in mesh actors and the default soul are bootstrapped exactly
 * once for the shared runtime.
 */
export async function ensureSharedMeshRuntime(): Promise<ActorSystemLike> {
	const actorSystem = await getSharedMeshActorSystem();
	if (!sharedBootstrapPromise) {
		sharedBootstrapPromise = import("./modes/mesh-bootstrap.js")
			.then(({ ensureMeshAndSoulBootstrapped }) =>
				ensureMeshAndSoulBootstrapped({ actorSystem }),
			)
			.catch((error) => {
				sharedBootstrapPromise = undefined;
				throw error;
			});
	}
	await sharedBootstrapPromise;
	return actorSystem;
}

export async function shutdownSharedMeshRuntime(): Promise<void> {
	if (sharedActorSystem) {
		await sharedActorSystem.shutdown();
	}
	sharedActorSystem = undefined;
	sharedBootstrapPromise = undefined;
}

export async function _resetSharedMeshRuntimeForTests(): Promise<void> {
	await shutdownSharedMeshRuntime();
}
