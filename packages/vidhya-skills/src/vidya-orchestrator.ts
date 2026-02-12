/**
 * Vidya Orchestrator (विद्या सूत्रधार) — Unified Skill Lifecycle Controller
 *
 * Sūtradhāra (सूत्रधार) — "string-holder", the puppet master in Sanskrit drama
 * who controls all actors from behind the stage. This controller owns the
 * lifecycle of all Vidya-Tantra subsystems and exposes clean APIs for CLI,
 * HTTP, and Vaayu integration.
 *
 * Ownership model:
 * - **Creates and owns**: KulaRegistry, AshramamMachine, SamskaraSkillBridge,
 *   YogaEngine, VamshaTracker, SkillEvolution
 * - **Receives (injected)**: SkillRegistry, VidyaBridge, SurakshaScanner,
 *   ShikshaController
 *
 * @module vidya-orchestrator
 */

import { writeFile, readFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { createLogger } from "@chitragupta/core";

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

import type { SkillRegistry } from "./registry.js";
import type { VidyaBridge } from "./bridge.js";
import type { MatchContext } from "./matcher.js";
import type { SurakshaScanner, SurakshaScanResult } from "./suraksha.js";
import type { SkillHealthReport, SkillEvolutionState } from "./skill-evolution.js";
import type { SerializedSamskaraState } from "./samskara-skill.js";

import { KulaRegistry } from "./kula.js";
import { AshramamMachine, createInitialState } from "./ashrama.js";
import { SamskaraSkillBridge } from "./samskara-skill.js";
import { YogaEngine } from "./yoga.js";
import { VamshaTracker } from "./vamsha.js";
import { SkillEvolution } from "./skill-evolution.js";
import { buildPanchaKosha } from "./pancha-kosha.js";
import { generateSkillFromTool } from "./generator.js";
import {
	createChain,
	appendLink,
	computeContentHash,
	serializeChain,
	deserializeChain,
} from "./parampara.js";


const log = createLogger("vidhya:orchestrator");
// ─── Types ──────────────────────────────────────────────────────────────────

export interface VidyaOrchestratorConfig {
	/** Paths to scan for skill.md files, with kula tier per path. */
	readonly skillPaths?: ReadonlyArray<{ path: string; kula: KulaType }>;
	/** Path for persisting orchestrator state. Default: .chitragupta/vidya-state.json */
	readonly persistPath?: string;
	/** Auto-trigger Shiksha on detected skill gaps. */
	readonly enableAutoLearn?: boolean;
	/** Auto-discover Yoga compositions from session patterns. */
	readonly enableAutoComposition?: boolean;
}

export interface InitResult {
	readonly loaded: number;
	readonly shadowed: number;
	readonly excluded: number;
	readonly errors: ReadonlyArray<{ name: string; error: string }>;
	readonly restored: boolean;
}

export interface LifecycleReport {
	readonly promotions: string[];
	readonly demotions: string[];
	readonly archived: string[];
	readonly extinctionCandidates: string[];
	readonly speciationCandidates: Array<{ skill: string; suggestedVariant: string; reason: string }>;
	readonly deprecationCandidates: string[];
	readonly newCompositions: YogaComposition[];
}

export interface LearnResult {
	readonly success: boolean;
	readonly skillName?: string;
	readonly status: "registered" | "quarantined" | "failed";
	readonly quarantineId?: string;
	readonly error?: string;
	readonly durationMs: number;
}

export interface SkillReport {
	readonly name: string;
	readonly manifest: EnhancedSkillManifest;
	readonly ashrama: AshramamState;
	readonly kosha: PanchaKoshaScores;
	readonly mastery: AnandamayaMastery;
	readonly health: SkillHealthReport;
	readonly parampara?: ParamparaChain;
	readonly vamsha?: VamshaLineage;
	readonly compositions: YogaComposition[];
	readonly kula: KulaType | null;
}

export interface EcosystemStats {
	readonly totalSkills: number;
	readonly byKula: Record<KulaType, number>;
	readonly byAshrama: Record<AshramamStage, number>;
	readonly avgKosha: PanchaKoshaScores;
	readonly topCompositions: YogaComposition[];
	readonly extinctionCandidates: string[];
	readonly deprecationCandidates: string[];
}

export interface VidyaPersistedState {
	readonly version: 1;
	readonly timestamp: string;
	readonly samskara: SerializedSamskaraState;
	readonly yoga: ReturnType<YogaEngine["serialize"]>;
	readonly vamsha: Array<[string, VamshaLineage]>;
	readonly evolution: SkillEvolutionState;
	readonly parampara: Record<string, string>;
	readonly ashrama: Record<string, AshramamState>;
	readonly kosha: Record<string, PanchaKoshaScores>;
}

// ─── Dependencies (injected) ────────────────────────────────────────────────

interface ShikshaLike {
	learn(query: string): Promise<{
		success: boolean;
		skill?: { manifest: SkillManifest };
		autoApproved: boolean;
		quarantineId?: string;
		durationMs: number;
		error?: string;
	}>;
}

interface ScannerLike {
	scan(skillName: string, content: string): SurakshaScanResult;
}

// ─── VidyaOrchestrator ─────────────────────────────────────────────────────

export class VidyaOrchestrator {
	// ── Owned subsystems ──
	readonly kula: KulaRegistry;
	readonly ashrama: AshramamMachine;
	readonly samskara: SamskaraSkillBridge;
	readonly yoga: YogaEngine;
	readonly vamsha: VamshaTracker;
	readonly evolution: SkillEvolution;

	// ── Injected deps ──
	private readonly registry: SkillRegistry;
	private readonly bridge: VidyaBridge;
	private readonly scanner?: ScannerLike;
	private readonly shiksha?: ShikshaLike;

	// ── Internal state ──
	private readonly config: VidyaOrchestratorConfig;
	private readonly ashramamStates: Map<string, AshramamState> = new Map();
	private readonly koshaScores: Map<string, PanchaKoshaScores> = new Map();
	private readonly chains: Map<string, ParamparaChain> = new Map();
	private initialized = false;

	constructor(
		deps: {
			registry: SkillRegistry;
			bridge: VidyaBridge;
			scanner?: ScannerLike;
			shiksha?: ShikshaLike;
		},
		config?: Partial<VidyaOrchestratorConfig>,
	) {
		this.registry = deps.registry;
		this.bridge = deps.bridge;
		this.scanner = deps.scanner;
		this.shiksha = deps.shiksha;

		this.config = {
			persistPath: config?.persistPath,
			skillPaths: config?.skillPaths,
			enableAutoLearn: config?.enableAutoLearn ?? false,
			enableAutoComposition: config?.enableAutoComposition ?? true,
		};

		// Create owned subsystems
		this.kula = new KulaRegistry();
		this.ashrama = new AshramamMachine();
		this.samskara = new SamskaraSkillBridge();
		this.yoga = new YogaEngine();
		this.vamsha = new VamshaTracker();
		this.evolution = new SkillEvolution();

		// Wire VidyaBridge with Samskara
		this.bridge.setVidyaTantra({
			samskaraBridge: this.samskara,
			ashramamMachine: this.ashrama,
		});
	}

	// ─── 1. Initialize ──────────────────────────────────────────────────────

	async initialize(): Promise<InitResult> {
		let loaded = 0;
		let shadowed = 0;
		let excluded = 0;
		const errors: Array<{ name: string; error: string }> = [];
		let restored = false;

		// Attempt to restore persisted state first
		if (this.config.persistPath) {
			restored = await this.restore();
		}

		// Register all skills from the SkillRegistry into KulaRegistry
		const allSkills = this.registry.getAll();
		for (const skill of allSkills) {
			const enhanced = skill as EnhancedSkillManifest;
			const kula: KulaType = enhanced.kula ?? "antara";

			try {
				this.kula.register(enhanced, kula);
				loaded++;

				// Create initial ashrama state if not restored
				if (!this.ashramamStates.has(skill.name)) {
					const initialStage: AshramamStage = kula === "antara" ? "grihastha" : "brahmacharya";
					this.ashramamStates.set(skill.name, createInitialState(initialStage));
				}

				// Create Parampara genesis chain if not restored
				if (!this.chains.has(skill.name)) {
					this.chains.set(
						skill.name,
						createChain(skill.name, "system", JSON.stringify(skill), kula),
					);
				}

				// Build initial PanchaKosha if not restored
				if (!this.koshaScores.has(skill.name)) {
					const mastery = this.samskara.getMastery(skill.name);
					this.koshaScores.set(
						skill.name,
						buildPanchaKosha(enhanced, mastery),
					);
				}
			} catch (err) {
				errors.push({
					name: skill.name,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}

		this.initialized = true;
		return { loaded, shadowed, excluded, errors, restored };
	}

	// ─── 2. onToolRegistered ────────────────────────────────────────────────

	onToolRegistered(
		toolDef: { name: string; description: string; inputSchema?: Record<string, unknown> },
		kula: KulaType = "bahya",
	): void {
		const skill = generateSkillFromTool({
			name: toolDef.name,
			description: toolDef.description,
			inputSchema: toolDef.inputSchema ?? {},
		});
		const enhanced = skill as EnhancedSkillManifest;

		// Register in KulaRegistry
		this.kula.register(enhanced, kula);

		// Create initial Ashrama state
		const initialStage: AshramamStage = kula === "antara" ? "grihastha" : "brahmacharya";
		this.ashramamStates.set(skill.name, createInitialState(initialStage));

		// Create Parampara genesis chain
		this.chains.set(
			skill.name,
			createChain(skill.name, "system", JSON.stringify(skill), kula),
		);

		// Build PanchaKosha baseline
		const mastery = this.samskara.getMastery(skill.name);
		this.koshaScores.set(skill.name, buildPanchaKosha(enhanced, mastery));
	}

	// ─── 3. onSkillExecuted ─────────────────────────────────────────────────

	onSkillExecuted(
		skillName: string,
		success: boolean,
		latencyMs: number,
		sessionId?: string,
	): void {
		// Record Samskara impression (mastery, Thompson, Dreyfus)
		this.samskara.updateMastery(skillName, success, latencyMs);

		// Record in SkillEvolution
		this.evolution.recordUsage(skillName, success, sessionId);

		// Record Ashrama activity (reset inactivity)
		const state = this.ashramamStates.get(skillName);
		if (state) {
			this.ashramamStates.set(skillName, this.ashrama.recordActivity(state));
		}

		// Append Parampara link on milestones
		const mastery = this.samskara.getMastery(skillName);
		const isMilestone =
			mastery.totalInvocations % 50 === 0 ||
			(mastery.totalInvocations > 10 && !success && mastery.failureCount === 1);

		if (isMilestone) {
			const chain = this.chains.get(skillName);
			if (chain) {
				const contentHash = computeContentHash(
					`${skillName}:${mastery.totalInvocations}:${mastery.successRate.toFixed(3)}`,
				);
				this.chains.set(
					skillName,
					appendLink(chain, "updated", "system", contentHash, `milestone: ${mastery.totalInvocations} invocations`),
				);
			}
		}

		// Recompute Anandamaya kosha score
		const existing = this.koshaScores.get(skillName);
		if (existing) {
			const entry = this.kula.get(skillName);
			if (entry) {
				this.koshaScores.set(
					skillName,
					buildPanchaKosha(entry.manifest, mastery),
				);
			}
		}
	}

	// ─── 4. onSkillMatched ──────────────────────────────────────────────────

	onSkillMatched(skillName: string, query: string, score: number): void {
		this.evolution.recordMatch(skillName, query, score);
	}

	// ─── 5. onSkillRejected ─────────────────────────────────────────────────

	onSkillRejected(skillName: string, _preferredSkill?: string): void {
		this.evolution.recordReject(skillName);
	}

	// ─── 6. onSessionEnd ────────────────────────────────────────────────────

	async onSessionEnd(sessionId: string, skillsUsed: string[]): Promise<void> {
		// Flush Samskara session co-occurrences
		this.samskara.flushSession(sessionId);

		// Flush SkillEvolution session
		this.evolution.flushSession();

		// Record Yoga session (composition discovery)
		if (this.config.enableAutoComposition) {
			this.yoga.recordSession(skillsUsed);
		}

		// Auto-persist if configured
		if (this.config.persistPath) {
			await this.persist().catch((e) => { log.debug("state persistence failed", { error: String(e) }); });
		}
	}

	// ─── 7. evaluateLifecycles ──────────────────────────────────────────────

	evaluateLifecycles(): LifecycleReport {
		const promotions: string[] = [];
		const demotions: string[] = [];
		const archived: string[] = [];

		// Evaluate all Ashrama states
		for (const [skillName, state] of this.ashramamStates) {
			const health = this.evolution.getSkillHealth(skillName);
			const chain = this.chains.get(skillName);
			const trustScore = chain?.trust.score ?? 0.5;
			const observations = health.useCount;

			const oldStage = state.stage;
			const newState = this.ashrama.evaluate(state, health.health, trustScore, observations);
			this.ashramamStates.set(skillName, newState);

			if (newState.stage !== oldStage) {
				if (newState.stage === "grihastha") promotions.push(skillName);
				else if (newState.stage === "vanaprastha") demotions.push(skillName);
				else if (newState.stage === "sannyasa") archived.push(skillName);
			}
		}

		// Detect Vamsha candidates
		const masteryMap = this.samskara.getAllMastery();
		const healthMap = new Map<string, number>();
		for (const [name] of this.ashramamStates) {
			healthMap.set(name, this.evolution.getSkillHealth(name).health);
		}

		const extinctionCandidates = this.vamsha.detectExtinctionCandidates(masteryMap, healthMap);

		// Get manifests for speciation detection
		const allEntries = this.kula.getAll();
		const manifests = allEntries.map((e) => e.manifest);
		const speciationCandidates = this.vamsha.detectSpeciationCandidates(manifests);

		// Check SkillEvolution deprecation candidates
		const deprecationCandidates = this.evolution.getDeprecationCandidates().map((r) => r.name);

		// Discover new Yoga compositions
		let newCompositions: YogaComposition[] = [];
		if (this.config.enableAutoComposition) {
			const activeSkills = Array.from(this.ashramamStates.entries())
				.filter(([, s]) => s.stage === "grihastha")
				.map(([name]) => name);
			newCompositions = this.yoga.suggestCompositions(activeSkills);
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

	// ─── 8. learnSkill ──────────────────────────────────────────────────────

	async learnSkill(query: string): Promise<LearnResult> {
		if (!this.shiksha) {
			return { success: false, status: "failed", error: "Shiksha controller not available", durationMs: 0 };
		}

		const start = Date.now();
		try {
			const result = await this.shiksha.learn(query);
			const durationMs = Date.now() - start;

			if (result.success && result.skill) {
				if (result.autoApproved) {
					// Register via onToolRegistered in shiksha kula
					this.onToolRegistered(
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

	// ─── 9. promoteSkill ────────────────────────────────────────────────────

	promoteSkill(skillName: string, reviewer?: string): boolean {
		const state = this.ashramamStates.get(skillName);
		if (!state) return false;

		const { allowed } = this.ashrama.canTransition(state, "grihastha");
		if (!allowed) return false;

		try {
			const health = this.evolution.getSkillHealth(skillName);
			const newState = this.ashrama.transition(
				state, "grihastha",
				`promoted by ${reviewer ?? "system"}`,
				health.health,
			);
			this.ashramamStates.set(skillName, newState);

			// Append Parampara "promoted" link
			const chain = this.chains.get(skillName);
			if (chain) {
				const contentHash = computeContentHash(`${skillName}:promoted`);
				this.chains.set(
					skillName,
					appendLink(chain, "promoted", reviewer ?? "system", contentHash, "promoted to grihastha"),
				);
			}

			// Recompute PanchaKosha
			const entry = this.kula.get(skillName);
			if (entry) {
				const mastery = this.samskara.getMastery(skillName);
				this.koshaScores.set(skillName, buildPanchaKosha(entry.manifest, mastery));
			}

			return true;
		} catch {
			return false;
		}
	}

	// ─── 10. deprecateSkill ─────────────────────────────────────────────────

	deprecateSkill(skillName: string, reason?: string): boolean {
		const state = this.ashramamStates.get(skillName);
		if (!state) return false;

		const { allowed } = this.ashrama.canTransition(state, "vanaprastha");
		if (!allowed) return false;

		try {
			const health = this.evolution.getSkillHealth(skillName);
			const newState = this.ashrama.transition(
				state, "vanaprastha",
				reason ?? "deprecated by system",
				health.health,
			);
			this.ashramamStates.set(skillName, newState);

			// Append Parampara "demoted" link
			const chain = this.chains.get(skillName);
			if (chain) {
				const contentHash = computeContentHash(`${skillName}:deprecated`);
				this.chains.set(
					skillName,
					appendLink(chain, "demoted", "system", contentHash, reason ?? "deprecated"),
				);
			}

			// Record Vamsha extinction event
			this.vamsha.recordExtinction(skillName, reason ?? "deprecated");

			return true;
		} catch {
			return false;
		}
	}

	// ─── 11. recommend ──────────────────────────────────────────────────────

	recommend(query: string, context?: Partial<MatchContext>): VidyaTantraMatch[] {
		const samskaraContext = this.bridge.buildContextFromSamskara();
		const mergedContext: MatchContext | undefined = samskaraContext
			? { ...samskaraContext, ...context } as MatchContext
			: context as MatchContext | undefined;

		return this.bridge.recommendSkillsV2(query, mergedContext);
	}

	// ─── 12. getSkillReport ─────────────────────────────────────────────────

	getSkillReport(skillName?: string): SkillReport | SkillReport[] {
		if (skillName) {
			return this.buildSkillReport(skillName);
		}

		const reports: SkillReport[] = [];
		const allEntries = this.kula.getAll();
		for (const entry of allEntries) {
			reports.push(this.buildSkillReport(entry.manifest.name));
		}
		return reports;
	}

	private buildSkillReport(skillName: string): SkillReport {
		const entry = this.kula.get(skillName);
		const manifest = (entry?.manifest ?? this.registry.get(skillName) ?? {
			name: skillName,
			version: "0.0.0",
			description: "",
			capabilities: [],
			tags: [],
			source: { type: "tool" as const, toolName: skillName },
			updatedAt: new Date().toISOString(),
		}) as EnhancedSkillManifest;

		const ashrama = this.ashramamStates.get(skillName) ?? createInitialState();
		const kosha = this.koshaScores.get(skillName) ?? buildPanchaKosha(manifest, INITIAL_ANANDAMAYA);
		const mastery = this.samskara.getMastery(skillName);
		const health = this.evolution.getSkillHealth(skillName);
		const parampara = this.chains.get(skillName);
		const vamsha = this.vamsha.getLineage(skillName) ?? undefined;
		const compositions = this.yoga.findCompositions(skillName);
		const kula = entry?.kula ?? this.kula.getTier(skillName);

		return { name: skillName, manifest, ashrama, kosha, mastery, health, parampara, vamsha, compositions, kula };
	}

	// ─── 13. getEcosystemStats ──────────────────────────────────────────────

	getEcosystemStats(): EcosystemStats {
		const byKula: Record<KulaType, number> = { antara: 0, bahya: 0, shiksha: 0 };
		const byAshrama: Record<AshramamStage, number> = {
			brahmacharya: 0, grihastha: 0, vanaprastha: 0, sannyasa: 0,
		};

		const allEntries = this.kula.getAll();
		for (const entry of allEntries) {
			byKula[entry.kula]++;
			const state = this.ashramamStates.get(entry.manifest.name);
			if (state) {
				byAshrama[state.stage]++;
			}
		}

		// Compute average kosha scores
		let totalAnnamaya = 0, totalPranamaya = 0, totalManomaya = 0;
		let totalVijnanamaya = 0, totalAnandamaya = 0, totalOverall = 0;
		let count = 0;

		for (const scores of this.koshaScores.values()) {
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
		const topCompositions = this.yoga.getAll().slice(0, 5);

		// Get candidates
		const masteryMap = this.samskara.getAllMastery();
		const healthMap = new Map<string, number>();
		for (const [name] of this.ashramamStates) {
			healthMap.set(name, this.evolution.getSkillHealth(name).health);
		}
		const extinctionCandidates = this.vamsha.detectExtinctionCandidates(masteryMap, healthMap);
		const deprecationCandidates = this.evolution.getDeprecationCandidates().map((r) => r.name);

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

	// ─── 14. persist ────────────────────────────────────────────────────────

	async persist(): Promise<void> {
		if (!this.config.persistPath) return;

		const paramparaMap: Record<string, string> = {};
		for (const [name, chain] of this.chains) {
			paramparaMap[name] = serializeChain(chain);
		}

		const ashramamMap: Record<string, AshramamState> = {};
		for (const [name, state] of this.ashramamStates) {
			ashramamMap[name] = state;
		}

		const koshaMap: Record<string, PanchaKoshaScores> = {};
		for (const [name, scores] of this.koshaScores) {
			koshaMap[name] = scores;
		}

		const state: VidyaPersistedState = {
			version: 1,
			timestamp: new Date().toISOString(),
			samskara: this.samskara.serialize(),
			yoga: this.yoga.serialize(),
			vamsha: this.vamsha.serialize(),
			evolution: this.evolution.serialize(),
			parampara: paramparaMap,
			ashrama: ashramamMap,
			kosha: koshaMap,
		};

		const json = JSON.stringify(state);
		const dir = dirname(this.config.persistPath);
		await mkdir(dir, { recursive: true });

		// Atomic write: tmp → rename (fall back to direct write if rename fails)
		const tmpPath = this.config.persistPath + ".tmp";
		await writeFile(tmpPath, json, "utf-8");
		try {
			await rename(tmpPath, this.config.persistPath);
		} catch {
			// rename can fail on some OS/FS combos — fall back to direct write
			await writeFile(this.config.persistPath, json, "utf-8");
		}
	}

	// ─── 15. restore ────────────────────────────────────────────────────────

	async restore(): Promise<boolean> {
		if (!this.config.persistPath) return false;

		try {
			const json = await readFile(this.config.persistPath, "utf-8");
			const state = JSON.parse(json) as VidyaPersistedState;

			if (state.version !== 1) return false;

			// Deserialize all subsystems
			this.samskara.deserialize(state.samskara);
			this.yoga.deserialize(state.yoga);
			this.vamsha.deserialize(state.vamsha);

			// Restore evolution via static deserialize
			const restoredEvolution = SkillEvolution.deserialize(state.evolution);
			// Copy internal state — SkillEvolution.deserialize returns a new instance,
			// so we replicate its state into our owned instance via serialize/deserialize cycle
			const evoState = restoredEvolution.serialize();
			// Re-create and assign
			Object.assign(this.evolution, SkillEvolution.deserialize(evoState));

			// Restore Parampara chains
			for (const [name, chainStr] of Object.entries(state.parampara)) {
				try {
					const kula = this.kula.getTier(name) ?? "bahya";
					this.chains.set(name, deserializeChain(chainStr, kula));
				} catch {
					// Skip corrupted chains
				}
			}

			// Restore Ashrama states
			for (const [name, ashramamState] of Object.entries(state.ashrama)) {
				this.ashramamStates.set(name, ashramamState);
			}

			// Restore Kosha scores
			for (const [name, koshaScore] of Object.entries(state.kosha)) {
				this.koshaScores.set(name, koshaScore);
			}

			return true;
		} catch {
			return false;
		}
	}

	// ─── Accessors ──────────────────────────────────────────────────────────

	get isInitialized(): boolean {
		return this.initialized;
	}

	getAshramamState(skillName: string): AshramamState | undefined {
		return this.ashramamStates.get(skillName);
	}

	getKoshaScores(skillName: string): PanchaKoshaScores | undefined {
		return this.koshaScores.get(skillName);
	}

	getParamparaChain(skillName: string): ParamparaChain | undefined {
		return this.chains.get(skillName);
	}
}
