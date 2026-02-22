/**
 * Vidya Orchestrator Types.
 *
 * Configuration, result, and report interfaces for the VidyaOrchestrator.
 *
 * @packageDocumentation
 */

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

import type { SkillHealthReport, SkillEvolutionState } from "./skill-evolution.js";
import type { SerializedSamskaraState } from "./samskara-skill.js";
import type { YogaEngine } from "./yoga.js";

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
