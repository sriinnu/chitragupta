/**
 * Pratiksha Types & Utility Functions.
 *
 * Extracted from pratiksha.ts to stay within 450 LOC limit.
 * Contains all type definitions, constants, and filesystem utility
 * functions for the skill staging manager.
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { QuarantinedSkill } from "./skill-sandbox.js";

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

export const DIR_PERMS = 0o700;
export const FILE_PERMS = 0o600;

/** Valid quarantine ID pattern: lowercase alphanumeric + underscore. */
export const VALID_ID_RE = /^[a-z0-9_]+$/;

/** Valid skill name pattern: lowercase alphanumeric + hyphens. */
export const VALID_NAME_RE = /^[a-z][a-z0-9-]*$/;

/** Ceiling for expiration: 30 days. */
export const CEILING_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000;

/** Default expiration: 7 days. */
export const DEFAULT_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Manifest on disk ───────────────────────────────────────────────────────

/** What gets persisted as manifest.json in staging/approved/archived dirs. */
export interface DiskManifest {
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

// ─── Secure File Operations ─────────────────────────────────────────────────

/**
 * Create a directory with owner-only permissions.
 * Creates parent directories as needed.
 */
export async function ensureDir(dirPath: string): Promise<void> {
	await fs.promises.mkdir(dirPath, { recursive: true, mode: DIR_PERMS });
}

/**
 * Write a file with owner-only permissions.
 * Never follows symlinks — uses lstat to verify first.
 */
export async function writeSecure(filePath: string, content: string): Promise<void> {
	try {
		const stat = await fs.promises.lstat(filePath);
		if (stat.isSymbolicLink()) {
			throw new Error(`Refusing to write to symlink: ${filePath}`);
		}
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
			if (err instanceof Error && err.message.startsWith("Refusing")) throw err;
		}
	}

	await fs.promises.writeFile(filePath, content, { mode: FILE_PERMS });
}

/**
 * Read and parse a manifest.json from a skill directory.
 */
export async function readManifest(dirPath: string): Promise<DiskManifest> {
	const manifestPath = path.join(dirPath, "manifest.json");
	const raw = await fs.promises.readFile(manifestPath, "utf-8");
	return JSON.parse(raw) as DiskManifest;
}

/**
 * Assert that a path exists and is a directory (not a symlink).
 */
export async function assertExists(dirPath: string): Promise<void> {
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
export function validateId(id: string): void {
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
export function sanitizeSkillName(name: string): string {
	const sanitized = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
	if (!sanitized || !VALID_NAME_RE.test(sanitized)) {
		throw new Error(`Invalid skill name: "${name}". Cannot be sanitized to a valid directory name.`);
	}
	return sanitized;
}
