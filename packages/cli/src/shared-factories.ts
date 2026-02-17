/**
 * @chitragupta/cli — Shared factory functions.
 *
 * Extracts heavily duplicated infrastructure creation code that was copy-pasted
 * across coding-setup.ts (setupCodingEnvironment + setupFromAgent) and main.ts
 * (serve mode + interactive mode).
 *
 * Three factory functions:
 *   - createPolicyAdapter()  — PolicyEngine + synchronous check() adapter
 *   - createMeshInfrastructure() — Samiti, Lokapala, ActorSystem, KaalaBrahma
 *   - loadSkillTiers() — 4-tier skill discovery with live-reload watchers
 */

import path from "path";

// ─── Types ──────────────────────────────────────────────────────────────────

/** The synchronous policy check interface expected by agents and orchestrators. */
export interface PolicyCheckAdapter {
	check(toolName: string, args: Record<string, unknown>): { allowed: boolean; reason?: string };
}

/** Options for createPolicyAdapter(). */
export interface CreatePolicyAdapterOptions {
	/** Session ID for policy context (e.g. "cli", "coding-mcp", "coding-serve"). */
	sessionId: string;
	/** Agent ID for policy context (e.g. "root", "kartru"). */
	agentId?: string;
	/** Project root directory for policy scoping. */
	projectPath: string;
}

/** Return value of createMeshInfrastructure(). */
export interface MeshInfrastructure {
	samiti?: import("@chitragupta/anina").MeshSamiti;
	lokapala?: import("@chitragupta/anina").LokapalaGuardians;
	actorSystem?: import("@chitragupta/anina").MeshActorSystem;
	actorSystemShutdown?: () => void;
	kaala?: import("@chitragupta/anina").KaalaLifecycle;
}

/** Options for createMeshInfrastructure(). */
export interface CreateMeshInfrastructureOptions {
	/** External Samiti instance to inject (avoids creating a new one). */
	samiti?: import("@chitragupta/anina").MeshSamiti;
}

/** A loaded skill registry with watcher cleanups. */
export interface SkillTierResult {
	/** Number of skills loaded. */
	loadedCount: number;
	/** Cleanup functions for live-reload watchers — call on shutdown. */
	watcherCleanups: Array<() => void>;
}

/** Options for loadSkillTiers(). */
export interface LoadSkillTiersOptions {
	/** Project root directory for skills-core lookup. */
	projectPath: string;
	/** The skill registry to populate. */
	skillRegistry: {
		registerWithPriority(manifest: unknown, priority: number, sourcePath?: string): void;
		unregisterBySourcePath(sourcePath: string): void;
	};
}

// ─── createPolicyAdapter ────────────────────────────────────────────────────

/**
 * Create a synchronous PolicyEngine + PolicyAdapter from @chitragupta/dharma.
 *
 * Builds the STANDARD_PRESET engine and returns a `check()` adapter that maps
 * tool names to action types and evaluates all rules synchronously.
 *
 * Returns undefined if dharma is not installed or initialization fails.
 */
export async function createPolicyAdapter(
	options: CreatePolicyAdapterOptions,
): Promise<PolicyCheckAdapter | undefined> {
	const { sessionId, agentId = "kartru", projectPath } = options;

	try {
		const { PolicyEngine, STANDARD_PRESET } = await import("@chitragupta/dharma");
		const { getActionType } = await import("./bootstrap.js");

		const preset = STANDARD_PRESET;
		const engine = new PolicyEngine(preset.config);
		for (const ps of preset.policySets) {
			engine.addPolicySet(ps);
		}

		return {
			check(toolName: string, toolArgs: Record<string, unknown>): { allowed: boolean; reason?: string } {
				const actionType = getActionType(toolName);
				const action = {
					type: actionType,
					tool: toolName,
					args: toolArgs,
					filePath: (toolArgs.path ?? toolArgs.file_path ?? toolArgs.filePath) as string | undefined,
					command: (toolArgs.command ?? toolArgs.cmd) as string | undefined,
					content: (toolArgs.content ?? toolArgs.text) as string | undefined,
					url: (toolArgs.url ?? toolArgs.uri) as string | undefined,
				};
				const context = {
					sessionId,
					agentId,
					agentDepth: 0,
					projectPath,
					totalCostSoFar: 0,
					costBudget: preset.config.costBudget,
					filesModified: [] as string[],
					commandsRun: [] as string[],
					timestamp: Date.now(),
				};

				try {
					for (const ps of preset.policySets) {
						for (const rule of ps.rules) {
							const verdict = rule.evaluate(action, context);
							if (verdict && typeof verdict === "object" && "status" in verdict && !("then" in verdict)) {
								const v = verdict as { status: string; reason: string };
								if (v.status === "deny") {
									return { allowed: false, reason: v.reason };
								}
							}
						}
					}
				} catch {
					// Rule evaluation failed — allow by default
				}
				return { allowed: true };
			},
		};
	} catch {
		// dharma is optional — continue without policy engine
		return undefined;
	}
}

// ─── createMeshInfrastructure ───────────────────────────────────────────────

/**
 * Create the mesh collaboration infrastructure: Samiti, Lokapala, ActorSystem, KaalaBrahma.
 *
 * Each component is optional — if its package is not installed or initialization fails,
 * the corresponding field is undefined.
 */
export async function createMeshInfrastructure(
	options?: CreateMeshInfrastructureOptions,
): Promise<MeshInfrastructure> {
	const result: MeshInfrastructure = {};

	// Samiti for ambient channel broadcasts — use injected or create new
	if (options?.samiti) {
		result.samiti = options.samiti;
	} else {
		try {
			const { Samiti } = await import("@chitragupta/sutra");
			result.samiti = new Samiti() as unknown as import("@chitragupta/anina").MeshSamiti;
		} catch {
			// Samiti is optional
		}
	}

	// Lokapala for guardian scanning
	try {
		const { LokapalaController } = await import("@chitragupta/anina");
		result.lokapala = new LokapalaController() as unknown as import("@chitragupta/anina").LokapalaGuardians;
	} catch {
		// Lokapala is optional
	}

	// ActorSystem for P2P mesh
	try {
		const { ActorSystem } = await import("@chitragupta/sutra");
		const system = new ActorSystem({ maxMailboxSize: 5_000 });
		system.start();
		result.actorSystem = system as unknown as import("@chitragupta/anina").MeshActorSystem;
		result.actorSystemShutdown = () => system.shutdown();
	} catch {
		// ActorSystem is optional
	}

	// KaalaBrahma for lifecycle tracking
	try {
		const { KaalaBrahma } = await import("@chitragupta/anina");
		result.kaala = new KaalaBrahma({
			heartbeatInterval: 5000,
			staleThreshold: 30000,
			maxAgentDepth: 5,
			maxSubAgents: 8,
		}) as unknown as import("@chitragupta/anina").KaalaLifecycle;
	} catch {
		// KaalaBrahma is optional
	}

	return result;
}

// ─── loadSkillTiers ─────────────────────────────────────────────────────────

/**
 * Load all 4 skill tiers with candidate-set priorities and live-reload watchers.
 *
 * Priority: skills-core=4, ecosystem/skills=3, skill-lab=2, skill-community=1
 *
 * Canonical structure per tier:
 *   core/stable/community: <tier>/<skill-name>/SKILL.md
 *   skill-lab lanes: <tier>/{auto|incubator}/<skill-name>/SKILL.md
 *
 * Returns the number of skills loaded and cleanup functions for the watchers.
 */
export async function loadSkillTiers(
	options: LoadSkillTiersOptions,
): Promise<SkillTierResult> {
	const { projectPath, skillRegistry } = options;
	const watcherCleanups: Array<() => void> = [];
	let loadedCount = 0;

	try {
		const { SkillDiscovery: SD } = await import("@chitragupta/vidhya-skills");
		const chitraguptaRoot = path.resolve(
			path.dirname(new URL(import.meta.url).pathname),
			"..", "..", "..",
		);
		const ecosystemRoot = path.resolve(chitraguptaRoot, "..", "ecosystem");
		const discovery = new SD();

		const isAllowedSkillManifestPath = (tierDir: string, filePath: string): boolean => {
			const rel = path.relative(tierDir, filePath);
			if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
			const parts = rel.split(path.sep).filter(Boolean);
			if (parts.length === 2 && parts[1].toLowerCase() === "skill.md") {
				return true;
			}
			if (
				path.basename(tierDir) === "skill-lab" &&
				parts.length === 3 &&
				(parts[0] === "auto" || parts[0] === "incubator") &&
				parts[2].toLowerCase() === "skill.md"
			) {
				return true;
			}
			return false;
		};

		const loadTier = async (dir: string, priority: number) => {
			const discovered = await discovery.discoverFromDirectory(dir);
			let count = 0;
			for (const skill of discovered) {
				const sp = skill.source?.type === "manual" ? (skill.source as { filePath?: string }).filePath : undefined;
				if (!sp || !isAllowedSkillManifestPath(dir, sp)) continue;
				skillRegistry.registerWithPriority(skill, priority, sp);
				count++;
			}
			loadedCount += count;
		};

		const watchTier = (dir: string, priority: number) => {
			const cleanup = discovery.watchDirectory(dir, (event) => {
				if (!isAllowedSkillManifestPath(dir, event.filePath)) return;
				if (event.type === "removed") {
					skillRegistry.unregisterBySourcePath(event.filePath);
				} else if (event.manifest) {
					skillRegistry.registerWithPriority(event.manifest, priority, event.filePath);
				}
			});
			watcherCleanups.push(cleanup);
		};

		// Tier 1: skills-core (project-local + builtin) — priority 4
		for (const root of [projectPath, chitraguptaRoot]) {
			const dir = path.resolve(root, "skills-core");
			await loadTier(dir, 4);
			watchTier(dir, 4);
		}
		// Tier 2: ecosystem/skills (approved, vetted) — priority 3
		{
			const dir = path.resolve(ecosystemRoot, "skills");
			await loadTier(dir, 3);
			watchTier(dir, 3);
		}
		// Tier 3: ecosystem/skill-lab (experimental) — priority 2
		{
			const dir = path.resolve(ecosystemRoot, "skill-lab");
			await loadTier(dir, 2);
			watchTier(dir, 2);
		}
		// Tier 4: ecosystem/skill-community (disabled by default) — priority 1
		if (process.env.VAAYU_SKILL_COMMUNITY_ENABLED === "true") {
			const dir = path.resolve(ecosystemRoot, "skill-community");
			await loadTier(dir, 1);
			watchTier(dir, 1);
		}
	} catch {
		// Skill loading is best-effort
	}

	return { loadedCount, watcherCleanups };
}
