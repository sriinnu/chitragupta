/**
 * Vidya Orchestrator Lifecycle and Persistence Methods.
 * @packageDocumentation
 */

import type { SkillManifest } from "./types.js";
import type {
	KulaType,
	AshramamStage,
	AshramamState,
	PanchaKoshaScores,
	AnandamayaMastery,
	VidyaTantraMatch,
	EnhancedSkillManifest,
	YogaComposition,
	VamshaLineage,
	ParamparaChain,
} from "./types-v2.js";
import { INITIAL_ANANDAMAYA } from "./types-v2.js";
import { createInitialState } from "./ashrama.js";
import { buildPanchaKosha } from "./pancha-kosha.js";
import { createLogger } from "@chitragupta/core";
import type { MatchContext } from "./matcher.js";
import {
	appendLink,
	computeContentHash,
	serializeChain,
	deserializeChain,
} from "./parampara.js";
import { SkillEvolution } from "./skill-evolution.js";
import type { SkillEvolutionState } from "./skill-evolution.js";
import type {
	LifecycleReport,
	LearnResult,
	SkillReport,
	EcosystemStats,
	VidyaPersistedState,
} from "./vidya-orchestrator-types.js";

import { writeFile, readFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";

const log = createLogger("vidhya:orchestrator");

/** Interface for orchestrator state access from lifecycle functions. */
export interface OrchestratorState {
	readonly kula: import("./kula.js").KulaRegistry;
	readonly ashrama: import("./ashrama.js").AshramamMachine;
	readonly samskara: import("./samskara-skill.js").SamskaraSkillBridge;
	readonly yoga: import("./yoga.js").YogaEngine;
	readonly vamsha: import("./vamsha.js").VamshaTracker;
	readonly evolution: SkillEvolution;
	readonly registry: import("./registry.js").SkillRegistry;
	readonly bridge: import("./bridge.js").VidyaBridge;
	readonly config: import("./vidya-orchestrator-types.js").VidyaOrchestratorConfig;
	readonly ashramamStates: Map<string, AshramamState>;
	readonly koshaScores: Map<string, PanchaKoshaScores>;
	readonly chains: Map<string, ParamparaChain>;
	readonly shiksha?: { learn(q: string): Promise<{ success: boolean; skill?: { manifest: SkillManifest }; autoApproved: boolean; quarantineId?: string; durationMs: number; error?: string }> };
	onToolRegistered(toolDef: { name: string; description: string; inputSchema?: Record<string, unknown> }, kula: KulaType): void;
}

export function evaluateLifecycles(self: OrchestratorState): LifecycleReport {
	const promotions: string[] = [];
	const demotions: string[] = [];
	const archived: string[] = [];

	// Evaluate all Ashrama states
	for (const [skillName, state] of self.ashramamStates) {
		const health = self.evolution.getSkillHealth(skillName);
		const chain = self.chains.get(skillName);
		const trustScore = chain?.trust.score ?? 0.5;
		const observations = health.useCount;

		const oldStage = state.stage;
		const newState = self.ashrama.evaluate(state, health.health, trustScore, observations);
		self.ashramamStates.set(skillName, newState);

		if (newState.stage !== oldStage) {
			if (newState.stage === "grihastha") promotions.push(skillName);
			else if (newState.stage === "vanaprastha") demotions.push(skillName);
			else if (newState.stage === "sannyasa") archived.push(skillName);
		}
	}

	// Detect Vamsha candidates
	const masteryMap = self.samskara.getAllMastery();
	const healthMap = new Map<string, number>();
	for (const [name] of self.ashramamStates) {
		healthMap.set(name, self.evolution.getSkillHealth(name).health);
	}

	const extinctionCandidates = self.vamsha.detectExtinctionCandidates(masteryMap, healthMap);

	// Get manifests for speciation detection
	const allEntries = self.kula.getAll();
	const manifests = allEntries.map((e) => e.manifest);
	const speciationCandidates = self.vamsha.detectSpeciationCandidates(manifests);

	// Check SkillEvolution deprecation candidates
	const deprecationCandidates = self.evolution.getDeprecationCandidates().map((r) => r.name);

	// Discover new Yoga compositions
	let newCompositions: YogaComposition[] = [];
	if (self.config.enableAutoComposition) {
		const activeSkills = Array.from(self.ashramamStates.entries())
			.filter(([, s]) => s.stage === "grihastha")
			.map(([name]) => name);
		newCompositions = self.yoga.suggestCompositions(activeSkills);
	}

	return {
		promotions,
		demotions,
		archived,
		extinctionCandidates,
		speciationCandidates,
		deprecationCandidates,
		newCompositions,
	};
}

export async function learnSkill(self: OrchestratorState, query: string): Promise<LearnResult> {
	if (!self.shiksha) {
		return { success: false, status: "failed", error: "Shiksha controller not available", durationMs: 0 };
	}

	const start = Date.now();
	try {
		const result = await self.shiksha.learn(query);
		const durationMs = Date.now() - start;

		if (result.success && result.skill) {
			if (result.autoApproved) {
				// Register via onToolRegistered in shiksha kula
				self.onToolRegistered(
					{
						name: result.skill.manifest.name,
						description: result.skill.manifest.description,
						inputSchema: result.skill.manifest.inputSchema as Record<string, unknown>,
					},
					"shiksha",
				);
				return {
					success: true,
					skillName: result.skill.manifest.name,
					status: "registered",
					durationMs,
				};
			}

			return {
				success: true,
				skillName: result.skill.manifest.name,
				status: "quarantined",
				quarantineId: result.quarantineId,
				durationMs,
			};
		}

		return { success: false, status: "failed", error: result.error, durationMs };
	} catch (err) {
		return {
			success: false,
			status: "failed",
			error: err instanceof Error ? err.message : String(err),
			durationMs: Date.now() - start,
		};
	}
}

export function promoteSkill(self: OrchestratorState, skillName: string, reviewer?: string): boolean {
	const state = self.ashramamStates.get(skillName);
	if (!state) return false;

	const { allowed } = self.ashrama.canTransition(state, "grihastha");
	if (!allowed) return false;

	try {
		const health = self.evolution.getSkillHealth(skillName);
		const newState = self.ashrama.transition(
			state, "grihastha",
			`promoted by ${reviewer ?? "system"}`,
			health.health,
		);
		self.ashramamStates.set(skillName, newState);

		// Append Parampara "promoted" link
		const chain = self.chains.get(skillName);
		if (chain) {
			const contentHash = computeContentHash(`${skillName}:promoted`);
			self.chains.set(
				skillName,
				appendLink(chain, "promoted", reviewer ?? "system", contentHash, "promoted to grihastha"),
			);
		}

		// Recompute PanchaKosha
		const entry = self.kula.get(skillName);
		if (entry) {
			const mastery = self.samskara.getMastery(skillName);
			self.koshaScores.set(skillName, buildPanchaKosha(entry.manifest, mastery));
		}

		return true;
	} catch {
		return false;
	}
}

export function deprecateSkill(self: OrchestratorState, skillName: string, reason?: string): boolean {
	const state = self.ashramamStates.get(skillName);
	if (!state) return false;

	const { allowed } = self.ashrama.canTransition(state, "vanaprastha");
	if (!allowed) return false;

	try {
		const health = self.evolution.getSkillHealth(skillName);
		const newState = self.ashrama.transition(
			state, "vanaprastha",
			reason ?? "deprecated by system",
			health.health,
		);
		self.ashramamStates.set(skillName, newState);

		// Append Parampara "demoted" link
		const chain = self.chains.get(skillName);
		if (chain) {
			const contentHash = computeContentHash(`${skillName}:deprecated`);
			self.chains.set(
				skillName,
				appendLink(chain, "demoted", "system", contentHash, reason ?? "deprecated"),
			);
		}

		// Record Vamsha extinction event
		self.vamsha.recordExtinction(skillName, reason ?? "deprecated");

		return true;
	} catch {
		return false;
	}
}

export function recommend(self: OrchestratorState, query: string, context?: Partial<MatchContext>): VidyaTantraMatch[] {
	const samskaraContext = self.bridge.buildContextFromSamskara();
	const mergedContext: MatchContext | undefined = samskaraContext
		? { ...samskaraContext, ...context } as MatchContext
		: context as MatchContext | undefined;

	return self.bridge.recommendSkillsV2(query, mergedContext);
}

export function getSkillReport(self: OrchestratorState, skillName?: string): SkillReport | SkillReport[] {
	if (skillName) {
		return buildSkillReport(self, skillName);
	}

	const reports: SkillReport[] = [];
	const allEntries = self.kula.getAll();
	for (const entry of allEntries) {
		reports.push(buildSkillReport(self, entry.manifest.name));
	}
	return reports;
}

export function buildSkillReport(self: OrchestratorState, skillName: string): SkillReport {
	const entry = self.kula.get(skillName);
	const manifest = (entry?.manifest ?? self.registry.get(skillName) ?? {
		name: skillName,
		version: "0.0.0",
		description: "",
		capabilities: [],
		tags: [],
		source: { type: "tool" as const, toolName: skillName },
		updatedAt: new Date().toISOString(),
	}) as EnhancedSkillManifest;

	const ashrama = self.ashramamStates.get(skillName) ?? createInitialState();
	const kosha = self.koshaScores.get(skillName) ?? buildPanchaKosha(manifest, INITIAL_ANANDAMAYA);
	const mastery = self.samskara.getMastery(skillName);
	const health = self.evolution.getSkillHealth(skillName);
	const parampara = self.chains.get(skillName);
	const vamsha = self.vamsha.getLineage(skillName) ?? undefined;
	const compositions = self.yoga.findCompositions(skillName);
	const kula = entry?.kula ?? self.kula.getTier(skillName);

	return { name: skillName, manifest, ashrama, kosha, mastery, health, parampara, vamsha, compositions, kula };
}

export function getEcosystemStats(self: OrchestratorState): EcosystemStats {
	const byKula: Record<KulaType, number> = { antara: 0, bahya: 0, shiksha: 0 };
	const byAshrama: Record<AshramamStage, number> = {
		brahmacharya: 0, grihastha: 0, vanaprastha: 0, sannyasa: 0,
	};

	const allEntries = self.kula.getAll();
	for (const entry of allEntries) {
		byKula[entry.kula]++;
		const state = self.ashramamStates.get(entry.manifest.name);
		if (state) {
			byAshrama[state.stage]++;
		}
	}

	// Compute average kosha scores
	let totalAnnamaya = 0, totalPranamaya = 0, totalManomaya = 0;
	let totalVijnanamaya = 0, totalAnandamaya = 0, totalOverall = 0;
	let count = 0;

	for (const scores of self.koshaScores.values()) {
		totalAnnamaya += scores.annamaya;
		totalPranamaya += scores.pranamaya;
		totalManomaya += scores.manomaya;
		totalVijnanamaya += scores.vijnanamaya;
		totalAnandamaya += scores.anandamaya;
		totalOverall += scores.overall;
		count++;
	}

	const avg = (v: number) => count > 0 ? v / count : 0;
	const avgKosha: PanchaKoshaScores = {
		annamaya: avg(totalAnnamaya),
		pranamaya: avg(totalPranamaya),
		manomaya: avg(totalManomaya),
		vijnanamaya: avg(totalVijnanamaya),
		anandamaya: avg(totalAnandamaya),
		overall: avg(totalOverall),
	};

	// Get top compositions
	const topCompositions = self.yoga.getAll().slice(0, 5);

	// Get candidates
	const masteryMap = self.samskara.getAllMastery();
	const healthMap = new Map<string, number>();
	for (const [name] of self.ashramamStates) {
		healthMap.set(name, self.evolution.getSkillHealth(name).health);
	}
	const extinctionCandidates = self.vamsha.detectExtinctionCandidates(masteryMap, healthMap);
	const deprecationCandidates = self.evolution.getDeprecationCandidates().map((r) => r.name);

	return {
		totalSkills: allEntries.length,
		byKula,
		byAshrama,
		avgKosha,
		topCompositions,
		extinctionCandidates,
		deprecationCandidates,
	};
}

export async function persist(self: OrchestratorState): Promise<void> {
	if (!self.config.persistPath) return;

	const paramparaMap: Record<string, string> = {};
	for (const [name, chain] of self.chains) {
		paramparaMap[name] = serializeChain(chain);
	}

	const ashramamMap: Record<string, AshramamState> = {};
	for (const [name, state] of self.ashramamStates) {
		ashramamMap[name] = state;
	}

	const koshaMap: Record<string, PanchaKoshaScores> = {};
	for (const [name, scores] of self.koshaScores) {
		koshaMap[name] = scores;
	}

	const state: VidyaPersistedState = {
		version: 1,
		timestamp: new Date().toISOString(),
		samskara: self.samskara.serialize(),
		yoga: self.yoga.serialize(),
		vamsha: self.vamsha.serialize(),
		evolution: self.evolution.serialize(),
		parampara: paramparaMap,
		ashrama: ashramamMap,
		kosha: koshaMap,
	};

	const json = JSON.stringify(state);
	const dir = dirname(self.config.persistPath);
	await mkdir(dir, { recursive: true });

	// Atomic write: tmp → rename (fall back to direct write if rename fails)
	const tmpPath = self.config.persistPath + ".tmp";
	await writeFile(tmpPath, json, "utf-8");
	try {
		await rename(tmpPath, self.config.persistPath);
	} catch {
		// rename can fail on some OS/FS combos — fall back to direct write
		await writeFile(self.config.persistPath, json, "utf-8");
	}
}

export async function restore(self: OrchestratorState): Promise<boolean> {
	if (!self.config.persistPath) return false;

	try {
		const json = await readFile(self.config.persistPath, "utf-8");
		const state = JSON.parse(json) as VidyaPersistedState;

		if (state.version !== 1) return false;

		// Deserialize all subsystems
		self.samskara.deserialize(state.samskara);
		self.yoga.deserialize(state.yoga);
		self.vamsha.deserialize(state.vamsha);

		// Restore evolution via static deserialize
		const restoredEvolution = SkillEvolution.deserialize(state.evolution);
		// Copy internal state — SkillEvolution.deserialize returns a new instance,
		// so we replicate its state into our owned instance via serialize/deserialize cycle
		const evoState = restoredEvolution.serialize();
		// Re-create and assign
		Object.assign(self.evolution, SkillEvolution.deserialize(evoState));

		// Restore Parampara chains
		for (const [name, chainStr] of Object.entries(state.parampara)) {
			try {
				const kula = self.kula.getTier(name) ?? "bahya";
				self.chains.set(name, deserializeChain(chainStr, kula));
			} catch {
				// Skip corrupted chains
			}
		}

		// Restore Ashrama states
		for (const [name, ashramamState] of Object.entries(state.ashrama)) {
			self.ashramamStates.set(name, ashramamState);
		}

		// Restore Kosha scores
		for (const [name, koshaScore] of Object.entries(state.kosha)) {
			self.koshaScores.set(name, koshaScore);
		}

		return true;
	} catch {
		return false;
	}
}
