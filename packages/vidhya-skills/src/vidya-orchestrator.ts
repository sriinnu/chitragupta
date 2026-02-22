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
// Re-export types for consumers
export type {
	VidyaOrchestratorConfig,
	InitResult,
	LifecycleReport,
	LearnResult,
	SkillReport,
	EcosystemStats,
	VidyaPersistedState,
} from "./vidya-orchestrator-types.js";
import type {
	VidyaOrchestratorConfig,
	InitResult,
	LifecycleReport,
	LearnResult,
	SkillReport,
	EcosystemStats,
	VidyaPersistedState,
} from "./vidya-orchestrator-types.js";
import {
	evaluateLifecycles as doEvaluateLifecycles,
	learnSkill as doLearnSkill,
	promoteSkill as doPromoteSkill,
	deprecateSkill as doDeprecateSkill,
	recommend as doRecommend,
	getSkillReport as doGetSkillReport,
	getEcosystemStats as doGetEcosystemStats,
	persist as doPersist,
	restore as doRestore,
	buildSkillReport as doBuildSkillReport,
} from "./vidya-orchestrator-lifecycle.js";


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

	// ─── Delegated Lifecycle Methods ──────────────────────────────────────

	/** Evaluate all skill lifecycles. */
	evaluateLifecycles(): LifecycleReport { return doEvaluateLifecycles(this); }

	/** Learn a new skill from a query. */
	async learnSkill(query: string): Promise<LearnResult> { return doLearnSkill(this, query); }

	/** Promote a skill to grihastha stage. */
	promoteSkill(skillName: string, reviewer?: string): boolean { return doPromoteSkill(this, skillName, reviewer); }

	/** Deprecate a skill. */
	deprecateSkill(skillName: string, reason?: string): boolean { return doDeprecateSkill(this, skillName, reason); }

	/** Recommend skills for a query. */
	recommend(query: string, context?: Partial<MatchContext>): VidyaTantraMatch[] { return doRecommend(this, query, context); }

	/** Get a skill report or all reports. */
	getSkillReport(skillName?: string): SkillReport | SkillReport[] { return doGetSkillReport(this, skillName); }

	/** Get ecosystem statistics. */
	getEcosystemStats(): EcosystemStats { return doGetEcosystemStats(this); }

	/** Persist orchestrator state. */
	async persist(): Promise<void> { return doPersist(this); }

	/** Restore orchestrator state. */
	async restore(): Promise<boolean> { return doRestore(this); }

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
