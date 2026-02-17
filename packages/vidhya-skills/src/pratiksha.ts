/**
 * Pratiksha (प्रतीक्षा — Waiting) — Filesystem Staging Manager for Skills.
 *
 * Manages the disk-based staging area where quarantined skills wait for
 * human review. Skills are staged as human-readable files (Markdown + JSON)
 * that can be inspected with any editor before promotion.
 *
 * ## Directory Structure
 *
 * ```
 * ~/.chitragupta/skills/
 *   staging/<quarantine-id>/
 *     manifest.json          # QuarantinedSkill + metadata
 *     skill.md               # Original skill content
 *     scan-report.json       # SurakshaScanResult
 *   approved/<skill-name>/
 *     skill.md + manifest.json
 *   archived/<quarantine-id>/
 *     manifest.json + skill.md + rejection-reason.txt
 *   evolution.json           # Serialized SkillEvolutionState
 * ```
 *
 * ## Security
 *
 * - Directories: 0o700 (owner-only rwx)
 * - Files: 0o600 (owner-only rw)
 * - Quarantine IDs validated: ^[a-z0-9_]+$
 * - fs.lstat (never follow symlinks)
 * - Path traversal prevention on all inputs
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getChitraguptaHome } from "@chitragupta/core";
import type { QuarantinedSkill } from "./skill-sandbox.js";
import type { SurakshaScanResult } from "./suraksha.js";
import type { SkillEvolutionState } from "./skill-evolution.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Summary of a staged (pending review) skill. */
export interface StagedSkillSummary {
	/** Quarantine ID. */
	quarantineId: string;
	/** Skill name. */
	skillName: string;
	/** Why the skill is in quarantine. */
	reason: string;
	/** Current status. */
	status: string;
	/** Health score from sandbox validation. */
	healthScore: number;
	/** Risk score from Suraksha scan (if available). */
	riskScore?: number;
	/** Source of the skill. */
	source?: string;
	/** When the skill was staged (ISO timestamp). */
	stagedAt: string;
	/** Absolute path to the staging directory. */
	path: string;
}

/** Summary of an approved skill. */
export interface ApprovedSkillSummary {
	/** Skill name. */
	skillName: string;
	/** When the skill was approved (ISO timestamp). */
	approvedAt: string;
	/** Absolute path to the approved directory. */
	path: string;
}

/** Summary of an archived (rejected) skill. */
export interface ArchivedSkillSummary {
	/** Quarantine ID. */
	quarantineId: string;
	/** Skill name. */
	skillName: string;
	/** Why the skill was rejected. */
	rejectionReason: string;
	/** When the skill was archived (ISO timestamp). */
	archivedAt: string;
	/** Absolute path to the archive directory. */
	path: string;
}

/** Configuration for PratikshaManager. */
export interface PratikshaConfig {
	/** Base directory for skills. Default: ~/.chitragupta/skills */
	baseDir?: string;
	/** Auto-expire staged skills older than this (ms). Default: 604800000 (7 days), ceiling: 2592000000 (30 days). */
	expirationMs?: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DIR_PERMS = 0o700;
const FILE_PERMS = 0o600;

/** Valid quarantine ID pattern: lowercase alphanumeric + underscore. */
const VALID_ID_RE = /^[a-z0-9_]+$/;

/** Valid skill name pattern: lowercase alphanumeric + hyphens. */
const VALID_NAME_RE = /^[a-z][a-z0-9-]*$/;

/** Ceiling for expiration: 30 days. */
const CEILING_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000;

/** Default expiration: 7 days. */
const DEFAULT_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Manifest on disk ───────────────────────────────────────────────────────

/** What gets persisted as manifest.json in staging/approved/archived dirs. */
interface DiskManifest {
	quarantineId: string;
	skillName: string;
	reason: string;
	status: string;
	healthScore: number;
	riskScore?: number;
	source?: string;
	stagedAt: string;
	approvedAt?: string;
	archivedAt?: string;
	rejectionReason?: string;
	skill: QuarantinedSkill["skill"];
}

// ─── PratikshaManager ───────────────────────────────────────────────────────

/**
 * Pratiksha (प्रतीक्षा) — Filesystem staging manager for quarantined skills.
 *
 * Skills go through: staging → (approve → approved) or (reject → archived).
 * All operations are owner-only permissions, symlink-safe, and path-traversal-resistant.
 *
 * @example
 * ```ts
 * const mgr = new PratikshaManager();
 * const id = await mgr.stage(quarantinedSkill, scanResult);
 * const pending = await mgr.listStaged();
 * await mgr.promote(id);    // → approved/
 * // or
 * await mgr.reject(id, "Contains network calls");  // → archived/
 * ```
 */
export class PratikshaManager {
	private baseDir: string;
	private stagingDir: string;
	private approvedDir: string;
	private archivedDir: string;
	private expirationMs: number;

	constructor(config?: PratikshaConfig) {
		this.baseDir = config?.baseDir ?? path.join(getChitraguptaHome(), "skills");
		this.stagingDir = path.join(this.baseDir, "staging");
		this.approvedDir = path.join(this.baseDir, "approved");
		this.archivedDir = path.join(this.baseDir, "archived");
		this.expirationMs = Math.min(
			config?.expirationMs ?? DEFAULT_EXPIRATION_MS,
			CEILING_EXPIRATION_MS,
		);
	}

	/**
	 * Stage a quarantined skill to disk for human review.
	 *
	 * @param entry - The quarantined skill from SkillSandbox.
	 * @param scanResult - Optional Suraksha scan result.
	 * @returns The quarantine ID used for the staging directory.
	 */
	async stage(
		entry: QuarantinedSkill,
		scanResult?: SurakshaScanResult,
	): Promise<string> {
		validateId(entry.id);

		const skillDir = path.join(this.stagingDir, entry.id);
		await ensureDir(skillDir);

		// Write manifest.json
		const manifest: DiskManifest = {
			quarantineId: entry.id,
			skillName: entry.skill.name,
			reason: entry.reason,
			status: entry.status,
			healthScore: entry.healthScore,
			riskScore: scanResult?.riskScore,
			source: entry.reason,
			stagedAt: new Date().toISOString(),
			skill: entry.skill,
		};
		await writeSecure(
			path.join(skillDir, "manifest.json"),
			JSON.stringify(manifest, null, "\t"),
		);

		// Write skill.md (original content)
		if (entry.skill.content) {
			await writeSecure(
				path.join(skillDir, "skill.md"),
				entry.skill.content,
			);
		}

		// Write scan-report.json (if available)
		if (scanResult) {
			await writeSecure(
				path.join(skillDir, "scan-report.json"),
				JSON.stringify(scanResult, null, "\t"),
			);
		}

		return entry.id;
	}

	/**
	 * Promote a staged skill to the approved directory.
	 *
	 * Moves the skill from staging/ to approved/<skill-name>/.
	 *
	 * @param quarantineId - The quarantine ID to promote.
	 * @returns Path to the approved skill directory.
	 */
	async promote(quarantineId: string): Promise<string> {
		validateId(quarantineId);

		const stagingPath = path.join(this.stagingDir, quarantineId);
		await assertExists(stagingPath);

		const manifest = await readManifest(stagingPath);
		const skillName = sanitizeSkillName(manifest.skillName);
		const approvedPath = path.join(this.approvedDir, skillName);

		// Ensure approved dir exists, overwrite if re-approving
		await ensureDir(approvedPath);

		// Copy files from staging to approved
		const entries = await fs.promises.readdir(stagingPath);
		for (const entry of entries) {
			const src = path.join(stagingPath, entry);
			const dst = path.join(approvedPath, entry);
			const stat = await fs.promises.lstat(src);
			if (stat.isFile()) {
				const content = await fs.promises.readFile(src, "utf-8");
				await writeSecure(dst, content);
			}
		}

		// Update manifest with approval timestamp
		manifest.status = "approved";
		manifest.approvedAt = new Date().toISOString();
		await writeSecure(
			path.join(approvedPath, "manifest.json"),
			JSON.stringify(manifest, null, "\t"),
		);

		// Remove staging directory
		await fs.promises.rm(stagingPath, { recursive: true, force: true });

		return approvedPath;
	}

	/**
	 * Reject a staged skill and move to archive.
	 *
	 * @param quarantineId - The quarantine ID to reject.
	 * @param reason - Human-readable rejection reason.
	 */
	async reject(quarantineId: string, reason: string): Promise<void> {
		validateId(quarantineId);

		const stagingPath = path.join(this.stagingDir, quarantineId);
		await assertExists(stagingPath);

		const archivedPath = path.join(this.archivedDir, quarantineId);
		await ensureDir(archivedPath);

		// Copy files from staging to archived
		const entries = await fs.promises.readdir(stagingPath);
		for (const entry of entries) {
			const src = path.join(stagingPath, entry);
			const dst = path.join(archivedPath, entry);
			const stat = await fs.promises.lstat(src);
			if (stat.isFile()) {
				const content = await fs.promises.readFile(src, "utf-8");
				await writeSecure(dst, content);
			}
		}

		// Update manifest with rejection info
		const manifest = await readManifest(stagingPath);
		manifest.status = "rejected";
		manifest.archivedAt = new Date().toISOString();
		manifest.rejectionReason = reason;
		await writeSecure(
			path.join(archivedPath, "manifest.json"),
			JSON.stringify(manifest, null, "\t"),
		);

		// Write rejection reason as separate readable file
		await writeSecure(
			path.join(archivedPath, "rejection-reason.txt"),
			reason,
		);

		// Remove staging directory
		await fs.promises.rm(stagingPath, { recursive: true, force: true });
	}

	/**
	 * Delete a staged skill permanently (no archival).
	 *
	 * @param quarantineId - The quarantine ID to delete.
	 */
	async delete(quarantineId: string): Promise<void> {
		validateId(quarantineId);
		const stagingPath = path.join(this.stagingDir, quarantineId);
		await assertExists(stagingPath);
		await fs.promises.rm(stagingPath, { recursive: true, force: true });
	}

	/**
	 * List all skills currently in staging (pending review).
	 */
	async listStaged(): Promise<StagedSkillSummary[]> {
		return this.listDir(this.stagingDir, (manifest, dirPath) => ({
			quarantineId: manifest.quarantineId,
			skillName: manifest.skillName,
			reason: manifest.reason,
			status: manifest.status,
			healthScore: manifest.healthScore,
			riskScore: manifest.riskScore,
			source: manifest.source,
			stagedAt: manifest.stagedAt,
			path: dirPath,
		}));
	}

	/**
	 * List all approved skills.
	 */
	async listApproved(): Promise<ApprovedSkillSummary[]> {
		return this.listDir(this.approvedDir, (manifest, dirPath) => ({
			skillName: manifest.skillName,
			approvedAt: manifest.approvedAt ?? manifest.stagedAt,
			path: dirPath,
		}));
	}

	/**
	 * List all archived (rejected) skills.
	 */
	async listArchived(): Promise<ArchivedSkillSummary[]> {
		return this.listDir(this.archivedDir, (manifest, dirPath) => ({
			quarantineId: manifest.quarantineId,
			skillName: manifest.skillName,
			rejectionReason: manifest.rejectionReason ?? "Unknown",
			archivedAt: manifest.archivedAt ?? manifest.stagedAt,
			path: dirPath,
		}));
	}

	/**
	 * Clean expired staged skills. Returns count of cleaned entries.
	 */
	async cleanExpired(): Promise<number> {
		const now = Date.now();
		let count = 0;

		try {
			const entries = await fs.promises.readdir(this.stagingDir, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				try {
					const manifestPath = path.join(this.stagingDir, entry.name, "manifest.json");
					const stat = await fs.promises.lstat(manifestPath);
					if (stat.isFile()) {
						const raw = await fs.promises.readFile(manifestPath, "utf-8");
						const manifest = JSON.parse(raw) as DiskManifest;
						const stagedTime = new Date(manifest.stagedAt).getTime();
						if (now - stagedTime > this.expirationMs) {
							await fs.promises.rm(
								path.join(this.stagingDir, entry.name),
								{ recursive: true, force: true },
							);
							count++;
						}
					}
				} catch {
					// Skip unreadable entries
				}
			}
		} catch {
			// Staging dir may not exist yet
		}

		return count;
	}

	/**
	 * Save skill evolution state to disk.
	 *
	 * @param state - The serialized SkillEvolutionState.
	 */
	async saveEvolutionState(state: SkillEvolutionState): Promise<void> {
		await ensureDir(this.baseDir);
		await writeSecure(
			path.join(this.baseDir, "evolution.json"),
			JSON.stringify(state, null, "\t"),
		);
	}

	/**
	 * Load skill evolution state from disk.
	 *
	 * @returns The deserialized state, or null if not found.
	 */
	async loadEvolutionState(): Promise<SkillEvolutionState | null> {
		const filePath = path.join(this.baseDir, "evolution.json");
		try {
			const stat = await fs.promises.lstat(filePath);
			if (!stat.isFile()) return null;
			const raw = await fs.promises.readFile(filePath, "utf-8");
			return JSON.parse(raw) as SkillEvolutionState;
		} catch {
			return null;
		}
	}

	/**
	 * Get the base directory path for skills.
	 */
	getBaseDir(): string {
		return this.baseDir;
	}

	/**
	 * Get the staging directory path.
	 */
	getStagingDir(): string {
		return this.stagingDir;
	}

	// ─── Private Helpers ────────────────────────────────────────────────

	/**
	 * Generic directory lister: reads subdirs, parses manifests, maps to summaries.
	 */
	private async listDir<T>(
		dirPath: string,
		mapper: (manifest: DiskManifest, entryPath: string) => T,
	): Promise<T[]> {
		const results: T[] = [];

		try {
			const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				try {
					const entryPath = path.join(dirPath, entry.name);
					const manifest = await readManifest(entryPath);
					results.push(mapper(manifest, entryPath));
				} catch {
					// Skip unreadable entries
				}
			}
		} catch {
			// Directory may not exist yet — return empty
		}

		return results;
	}
}

// ─── Secure File Operations ─────────────────────────────────────────────────

/**
 * Create a directory with owner-only permissions.
 * Creates parent directories as needed.
 */
async function ensureDir(dirPath: string): Promise<void> {
	await fs.promises.mkdir(dirPath, { recursive: true, mode: DIR_PERMS });
}

/**
 * Write a file with owner-only permissions.
 * Never follows symlinks — uses lstat to verify first.
 */
async function writeSecure(filePath: string, content: string): Promise<void> {
	// Prevent symlink attacks: if file exists and is a symlink, refuse
	try {
		const stat = await fs.promises.lstat(filePath);
		if (stat.isSymbolicLink()) {
			throw new Error(`Refusing to write to symlink: ${filePath}`);
		}
	} catch (err) {
		// ENOENT is expected (file doesn't exist yet)
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
			// Re-throw the symlink error
			if (err instanceof Error && err.message.startsWith("Refusing")) throw err;
		}
	}

	await fs.promises.writeFile(filePath, content, { mode: FILE_PERMS });
}

/**
 * Read and parse a manifest.json from a skill directory.
 */
async function readManifest(dirPath: string): Promise<DiskManifest> {
	const manifestPath = path.join(dirPath, "manifest.json");
	const raw = await fs.promises.readFile(manifestPath, "utf-8");
	return JSON.parse(raw) as DiskManifest;
}

/**
 * Assert that a path exists and is a directory (not a symlink).
 */
async function assertExists(dirPath: string): Promise<void> {
	const stat = await fs.promises.lstat(dirPath);
	if (!stat.isDirectory()) {
		throw new Error(`Not a directory: ${dirPath}`);
	}
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate a quarantine ID to prevent path traversal.
 * Only allows lowercase alphanumeric and underscores.
 */
function validateId(id: string): void {
	if (!id || !VALID_ID_RE.test(id)) {
		throw new Error(
			`Invalid quarantine ID: "${id}". Must match /^[a-z0-9_]+$/`,
		);
	}
}

/**
 * Sanitize a skill name for use as a directory name.
 * Falls back to the original if it's already valid.
 */
function sanitizeSkillName(name: string): string {
	const sanitized = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
	if (!sanitized || !VALID_NAME_RE.test(sanitized)) {
		throw new Error(`Invalid skill name: "${name}". Cannot be sanitized to a valid directory name.`);
	}
	return sanitized;
}
