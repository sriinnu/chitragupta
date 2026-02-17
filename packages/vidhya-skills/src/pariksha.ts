/**
 * Pariksha (परीक्षा — Examination) — Skill Pipeline Orchestrator.
 *
 * Wires Suraksha (scan) + SkillSandbox (quarantine) + Pratiksha (staging)
 * + SkillRegistry (promotion) + SkillEvolution (tracking) into a single
 * ingestion → review → promotion pipeline.
 *
 * ## Flow
 *
 * ```
 * content → [Suraksha scan] → [SkillSandbox quarantine] → [Pratiksha stage]
 *                                                               ↓
 *                                   approve → [Registry + Evolution]
 *                                   reject  → [Pratiksha archive]
 * ```
 *
 * ## Events
 *
 * The pipeline emits events via the `onEvent` callback for external observers:
 * - skill:submitted, skill:scanned, skill:quarantined, skill:staged
 * - skill:promoted, skill:rejected, skill:archived, skill:error
 *
 * @packageDocumentation
 */

import type { SkillSandbox, QuarantinedSkill } from "./skill-sandbox.js";
import type { SurakshaScanner, SurakshaScanResult } from "./suraksha.js";
import type { PratikshaManager, StagedSkillSummary } from "./pratiksha.js";
import type { SkillRegistry } from "./registry.js";
import type { SkillEvolution } from "./skill-evolution.js";
import type { SkillManifest, SkillSource } from "./types.js";
import { parseSkillMarkdown } from "./parser.js";
import { computeTraitVector } from "./fingerprint.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Source information for a skill being ingested. */
export interface SkillIngestSource {
	/** Where the skill content came from. */
	type: "npm" | "github" | "generated" | "manual" | "porter" | "discovery";
	/** Optional identifier (e.g., npm package name, GitHub URL). */
	identifier?: string;
}

/** Result of ingesting a skill into the pipeline. */
export interface IngestResult {
	/** Quarantine ID assigned. */
	quarantineId: string;
	/** Skill name extracted from content. */
	skillName: string;
	/** Suraksha scan verdict. */
	verdict: string;
	/** Risk score from scan. */
	riskScore: number;
	/** Whether the skill was auto-rejected due to malicious content. */
	autoRejected: boolean;
	/** Whether the skill was staged for review. */
	staged: boolean;
}

/** Full review detail for a staged skill. */
export interface FullSkillReview {
	/** Quarantine ID. */
	quarantineId: string;
	/** Skill name. */
	skillName: string;
	/** Full scan result. */
	scanResult?: SurakshaScanResult;
	/** Quarantine entry. */
	quarantine: QuarantinedSkill;
	/** Staging summary. */
	staging?: StagedSkillSummary;
}

/** Pipeline event types. */
export type PipelineEventType =
	| "skill:submitted"
	| "skill:scanned"
	| "skill:quarantined"
	| "skill:staged"
	| "skill:promoted"
	| "skill:rejected"
	| "skill:archived"
	| "skill:error";

/** Pipeline event payload. */
export interface PipelineEvent {
	type: PipelineEventType;
	quarantineId?: string;
	skillName?: string;
	verdict?: string;
	riskScore?: number;
	error?: string;
	timestamp: number;
}

/** Configuration for the SkillPipeline. */
export interface SkillPipelineConfig {
	/** The SkillSandbox for quarantine management. */
	sandbox: SkillSandbox;
	/** The SurakshaScanner for security analysis. */
	scanner: SurakshaScanner;
	/** The PratikshaManager for filesystem staging. */
	staging: PratikshaManager;
	/** The SkillRegistry for live skill storage. */
	registry: SkillRegistry;
	/** Optional SkillEvolution for tracking promoted skills. */
	evolution?: SkillEvolution;
	/** Event callback for pipeline lifecycle events. */
	onEvent?: (event: PipelineEvent) => void;
}

// ─── SkillPipeline ──────────────────────────────────────────────────────────

/**
 * Pariksha (परीक्षा) — The skill pipeline orchestrator.
 *
 * Composes Suraksha, SkillSandbox, Pratiksha, SkillRegistry, and
 * SkillEvolution into a unified ingestion and review workflow.
 *
 * @example
 * ```ts
 * const pipeline = new SkillPipeline({ sandbox, scanner, staging, registry });
 *
 * // Ingest a new skill
 * const result = await pipeline.ingest(skillContent, { type: "npm", identifier: "my-pkg" });
 *
 * // Review pending skills
 * const pending = await pipeline.getPendingReview();
 *
 * // Approve or reject
 * await pipeline.approve(result.quarantineId);
 * // or
 * await pipeline.reject(result.quarantineId, "Contains network calls");
 * ```
 */
export class SkillPipeline {
	private sandbox: SkillSandbox;
	private scanner: SurakshaScanner;
	private staging: PratikshaManager;
	private registry: SkillRegistry;
	private evolution?: SkillEvolution;
	private onEvent?: (event: PipelineEvent) => void;

	constructor(config: SkillPipelineConfig) {
		this.sandbox = config.sandbox;
		this.scanner = config.scanner;
		this.staging = config.staging;
		this.registry = config.registry;
		this.evolution = config.evolution;
		this.onEvent = config.onEvent;
	}

	/**
	 * Ingest skill content through the full pipeline.
	 *
	 * Flow: scan → quarantine → stage (or auto-reject if malicious).
	 *
	 * @param content - Raw skill content (markdown or source code).
	 * @param source - Where the skill came from.
	 * @param metadata - Optional additional metadata.
	 * @returns Ingestion result with quarantine ID and status.
	 */
	async ingest(
		content: string,
		source: SkillIngestSource,
		metadata?: Record<string, unknown>,
	): Promise<IngestResult> {
		// ─── 1. Extract skill name from content ────────────────────
		let skillName = "unknown-skill";
		try {
			const manifest = parseSkillMarkdown(content);
			skillName = manifest.name;
		} catch {
			// If not valid skill markdown, extract name from metadata or use default
			skillName = (metadata?.name as string) ?? `skill-${Date.now()}`;
		}

		this.emit({
			type: "skill:submitted",
			skillName,
			timestamp: Date.now(),
		});

		// ─── 2. Suraksha scan ──────────────────────────────────────
		const scanResult = this.scanner.scan(skillName, content);

		this.emit({
			type: "skill:scanned",
			skillName,
			verdict: scanResult.verdict,
			riskScore: scanResult.riskScore,
			timestamp: Date.now(),
		});

		// ─── 3. Submit to sandbox quarantine ───────────────────────
		const skill: QuarantinedSkill["skill"] = {
			name: skillName,
			description: (metadata?.description as string) ?? `Skill from ${source.type}`,
			tags: (metadata?.tags as string[]) ?? [source.type],
			content,
		};

		const reason = source.type === "generated" ? "new" as const : "external" as const;
		const quarantineId = this.sandbox.submit(skill, reason);
		const entry = this.sandbox.get(quarantineId)!;

		// Attach scan result to the entry
		(entry as QuarantinedSkill & { scanResult?: SurakshaScanResult }).scanResult = scanResult;

		this.emit({
			type: "skill:quarantined",
			quarantineId,
			skillName,
			timestamp: Date.now(),
		});

		// ─── 4. Auto-reject if malicious ───────────────────────────
		if (scanResult.verdict === "malicious") {
			try {
				this.sandbox.reject(quarantineId, `Auto-rejected: ${scanResult.verdict} (risk: ${scanResult.riskScore.toFixed(2)})`);
			} catch {
				// Already rejected by sandbox validation
			}
			this.emit({
				type: "skill:rejected",
				quarantineId,
				skillName,
				timestamp: Date.now(),
			});
			return {
				quarantineId,
				skillName,
				verdict: scanResult.verdict,
				riskScore: scanResult.riskScore,
				autoRejected: true,
				staged: false,
			};
		}

		// ─── 5. Stage for human review ─────────────────────────────
		let staged = false;
		try {
			await this.staging.stage(entry, scanResult);
			staged = true;
			this.emit({
				type: "skill:staged",
				quarantineId,
				skillName,
				timestamp: Date.now(),
			});
		} catch (err) {
			this.emit({
				type: "skill:error",
				quarantineId,
				skillName,
				error: err instanceof Error ? err.message : String(err),
				timestamp: Date.now(),
			});
		}

		return {
			quarantineId,
			skillName,
			verdict: scanResult.verdict,
			riskScore: scanResult.riskScore,
			autoRejected: false,
			staged,
		};
	}

	/**
	 * Approve a quarantined skill and promote it to the live registry.
	 *
	 * @param quarantineId - The quarantine ID to approve.
	 * @returns Skill name and path of the promoted skill.
	 */
	async approve(quarantineId: string): Promise<{ skillName: string; path: string }> {
		// Approve in sandbox
		const entry = this.sandbox.approve(quarantineId);

		// Promote in staging
		const approvedPath = await this.staging.promote(quarantineId);

		// Parse and register in live registry
		try {
			if (entry.skill.content) {
				const manifest = parseSkillMarkdown(entry.skill.content);
				// Ensure trait vector is computed
				if (!manifest.traitVector) {
					manifest.traitVector = Array.from(computeTraitVector(manifest));
				}
				this.registry.register(manifest);
			}
		} catch {
			// If content isn't valid skill markdown, register a minimal manifest
			const manifest: SkillManifest = {
				name: entry.skill.name,
				version: "1.0.0",
				description: entry.skill.description,
				capabilities: [],
				tags: entry.skill.tags,
				source: { type: "manual", filePath: approvedPath } as SkillSource,
				updatedAt: new Date().toISOString(),
			};
			manifest.traitVector = Array.from(computeTraitVector(manifest));
			this.registry.register(manifest);
		}

		this.emit({
			type: "skill:promoted",
			quarantineId,
			skillName: entry.skill.name,
			timestamp: Date.now(),
		});

		return { skillName: entry.skill.name, path: approvedPath };
	}

	/**
	 * Reject a quarantined skill.
	 *
	 * @param quarantineId - The quarantine ID to reject.
	 * @param reason - Human-readable rejection reason.
	 */
	async reject(quarantineId: string, reason: string): Promise<void> {
		const entry = this.sandbox.get(quarantineId);
		const skillName = entry?.skill.name ?? "unknown";

		this.sandbox.reject(quarantineId, reason);
		await this.staging.reject(quarantineId, reason);

		this.emit({
			type: "skill:rejected",
			quarantineId,
			skillName,
			timestamp: Date.now(),
		});
	}

	/**
	 * Get all skills pending review.
	 */
	async getPendingReview(): Promise<StagedSkillSummary[]> {
		return this.staging.listStaged();
	}

	/**
	 * Get full review detail for a specific skill.
	 *
	 * @param quarantineId - The quarantine ID to inspect.
	 * @returns Full review information or null if not found.
	 */
	async getSkillDetail(quarantineId: string): Promise<FullSkillReview | null> {
		const entry = this.sandbox.get(quarantineId);
		if (!entry) return null;

		const staged = await this.staging.listStaged();
		const staging = staged.find((s) => s.quarantineId === quarantineId);

		return {
			quarantineId,
			skillName: entry.skill.name,
			scanResult: (entry as QuarantinedSkill & { scanResult?: SurakshaScanResult }).scanResult,
			quarantine: entry,
			staging,
		};
	}

	// ─── Private Helpers ────────────────────────────────────────────────

	private emit(event: PipelineEvent): void {
		this.onEvent?.(event);
	}
}
