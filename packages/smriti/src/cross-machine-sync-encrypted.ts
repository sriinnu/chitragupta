/**
 * @chitragupta/smriti — Encrypted cross-machine snapshot helpers.
 *
 * Provides an opt-in encrypted envelope for cross-device snapshot transport.
 * Plaintext snapshot APIs remain unchanged and fully supported.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getChitraguptaHome, SessionError } from "@chitragupta/core";
import type {
	CrossMachineImportOptions,
	CrossMachineImportResult,
	CrossMachineSnapshot,
} from "./cross-machine-sync.js";
import { importCrossMachineSnapshot } from "./sync-import.js";

const SNAPSHOT_VERSION = 1 as const;
const ENCRYPTED_KIND = "chitragupta-sync-encrypted" as const;
const ENCRYPTED_VERSION = 1 as const;
const PBKDF2_NAME = "pbkdf2-sha256" as const;
const CIPHER_NAME = "aes-256-gcm" as const;

const KEY_BYTES = 32;
const IV_BYTES = 12;
const SALT_BYTES = 16;
const DEFAULT_ITERATIONS = 210_000;
const MIN_ITERATIONS = 10_000;

interface CrossMachineSyncState {
	lastExportAt?: string;
	lastExportPath?: string;
	lastImportAt?: string;
	lastImportSource?: string;
	lastImportTotals?: {
		files: number;
		created: number;
		updated: number;
		merged: number;
		skipped: number;
		conflicts: number;
		errors: number;
	};
}

/** Optional tuning controls for encrypted snapshot key derivation. */
export interface CrossMachineSnapshotEncryptionOptions {
	iterations?: number;
}

/** JSON envelope written to disk when encrypted snapshot export is used. */
export interface CrossMachineEncryptedSnapshotEnvelope {
	kind: "chitragupta-sync-encrypted";
	version: 1;
	encryptedAt: string;
	kdf: {
		name: "pbkdf2-sha256";
		iterations: number;
		saltB64: string;
	};
	cipher: {
		name: "aes-256-gcm";
		ivB64: string;
		tagB64: string;
	};
	payloadB64: string;
}

function validatePassphrase(passphrase: string): string {
	if (typeof passphrase !== "string" || passphrase.length === 0) {
		throw new SessionError("Encrypted sync requires a non-empty passphrase");
	}
	return passphrase;
}

function normalizeIterations(options?: CrossMachineSnapshotEncryptionOptions): number {
	const raw = options?.iterations;
	if (raw === undefined) return DEFAULT_ITERATIONS;
	if (!Number.isFinite(raw)) {
		throw new SessionError("Encryption iterations must be a finite number");
	}
	const normalized = Math.floor(raw);
	if (normalized < MIN_ITERATIONS) {
		throw new SessionError(`Encryption iterations must be >= ${MIN_ITERATIONS}`);
	}
	return normalized;
}

function sha256(content: string): string {
	return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}

function aadBuffer(): Buffer {
	return Buffer.from(`${ENCRYPTED_KIND}:${ENCRYPTED_VERSION}`, "utf-8");
}

function deriveKey(passphrase: string, salt: Buffer, iterations: number): Buffer {
	return crypto.pbkdf2Sync(passphrase, salt, iterations, KEY_BYTES, "sha256");
}

function readSyncState(home: string): CrossMachineSyncState {
	const statePath = path.join(home, "sync-state.json");
	try {
		if (!fs.existsSync(statePath)) return {};
		const raw = fs.readFileSync(statePath, "utf-8");
		const parsed = JSON.parse(raw) as CrossMachineSyncState;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

function writeSyncState(home: string, patch: Partial<CrossMachineSyncState>): void {
	const statePath = path.join(home, "sync-state.json");
	const next = { ...readSyncState(home), ...patch };
	fs.mkdirSync(path.dirname(statePath), { recursive: true });
	fs.writeFileSync(statePath, JSON.stringify(next, null, "\t"), "utf-8");
}

function assertEncryptedEnvelope(value: unknown): asserts value is CrossMachineEncryptedSnapshotEnvelope {
	if (!value || typeof value !== "object") {
		throw new SessionError("Invalid encrypted sync snapshot: expected object");
	}
	const envelope = value as Record<string, unknown>;
	if (envelope.kind !== ENCRYPTED_KIND) {
		throw new SessionError("Invalid encrypted sync snapshot: missing envelope kind");
	}
	if (envelope.version !== ENCRYPTED_VERSION) {
		throw new SessionError(`Unsupported encrypted sync snapshot version: ${String(envelope.version)}`);
	}
	if (typeof envelope.payloadB64 !== "string" || envelope.payloadB64.length === 0) {
		throw new SessionError("Invalid encrypted sync snapshot: payload missing");
	}
	if (!envelope.kdf || typeof envelope.kdf !== "object") {
		throw new SessionError("Invalid encrypted sync snapshot: kdf metadata missing");
	}
	if (!envelope.cipher || typeof envelope.cipher !== "object") {
		throw new SessionError("Invalid encrypted sync snapshot: cipher metadata missing");
	}
	const kdf = envelope.kdf as Record<string, unknown>;
	const cipher = envelope.cipher as Record<string, unknown>;
	if (kdf.name !== PBKDF2_NAME || typeof kdf.iterations !== "number" || typeof kdf.saltB64 !== "string") {
		throw new SessionError("Invalid encrypted sync snapshot: unsupported or malformed kdf metadata");
	}
	if (cipher.name !== CIPHER_NAME || typeof cipher.ivB64 !== "string" || typeof cipher.tagB64 !== "string") {
		throw new SessionError("Invalid encrypted sync snapshot: unsupported or malformed cipher metadata");
	}
}

function assertSnapshot(value: unknown): asserts value is CrossMachineSnapshot {
	if (!value || typeof value !== "object") {
		throw new SessionError("Invalid sync snapshot: expected object");
	}
	const snapshot = value as Record<string, unknown>;
	if (snapshot.version !== SNAPSHOT_VERSION) {
		throw new SessionError(`Unsupported sync snapshot version: ${String(snapshot.version)}`);
	}
	if (typeof snapshot.exportedAt !== "string") {
		throw new SessionError("Invalid sync snapshot: missing exportedAt");
	}
	if (!Array.isArray(snapshot.files)) {
		throw new SessionError("Invalid sync snapshot: missing files array");
	}
	for (const file of snapshot.files) {
		if (!file || typeof file !== "object") {
			throw new SessionError("Invalid sync snapshot: file entry must be object");
		}
		const entry = file as Record<string, unknown>;
		if (typeof entry.path !== "string" || !entry.path) {
			throw new SessionError("Invalid sync snapshot: file.path must be non-empty string");
		}
		if (entry.kind !== "day" && entry.kind !== "memory") {
			throw new SessionError(`Invalid sync snapshot: unsupported kind for ${String(entry.path)}`);
		}
		if (typeof entry.content !== "string" || typeof entry.sha256 !== "string") {
			throw new SessionError(`Invalid sync snapshot: content/hash missing for ${entry.path}`);
		}
		const contentHash = sha256(entry.content);
		if (contentHash !== entry.sha256) {
			throw new SessionError(`Invalid sync snapshot: checksum mismatch for ${entry.path}`);
		}
	}
}

function encryptSnapshot(
	snapshot: CrossMachineSnapshot,
	passphrase: string,
	options?: CrossMachineSnapshotEncryptionOptions,
): CrossMachineEncryptedSnapshotEnvelope {
	validatePassphrase(passphrase);
	assertSnapshot(snapshot);

	const iterations = normalizeIterations(options);
	const salt = crypto.randomBytes(SALT_BYTES);
	const iv = crypto.randomBytes(IV_BYTES);
	const key = deriveKey(passphrase, salt, iterations);

	const plaintext = JSON.stringify(snapshot);
	const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
	cipher.setAAD(aadBuffer());
	const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
	const tag = cipher.getAuthTag();

	return {
		kind: ENCRYPTED_KIND,
		version: ENCRYPTED_VERSION,
		encryptedAt: new Date().toISOString(),
		kdf: {
			name: PBKDF2_NAME,
			iterations,
			saltB64: salt.toString("base64"),
		},
		cipher: {
			name: CIPHER_NAME,
			ivB64: iv.toString("base64"),
			tagB64: tag.toString("base64"),
		},
		payloadB64: encrypted.toString("base64"),
	};
}

function decryptSnapshot(
	envelope: CrossMachineEncryptedSnapshotEnvelope,
	passphrase: string,
): CrossMachineSnapshot {
	validatePassphrase(passphrase);
	assertEncryptedEnvelope(envelope);

	const salt = Buffer.from(envelope.kdf.saltB64, "base64");
	const iv = Buffer.from(envelope.cipher.ivB64, "base64");
	const tag = Buffer.from(envelope.cipher.tagB64, "base64");
	const payload = Buffer.from(envelope.payloadB64, "base64");

	const key = deriveKey(passphrase, salt, envelope.kdf.iterations);
	try {
		const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
		decipher.setAAD(aadBuffer());
		decipher.setAuthTag(tag);
		const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf-8");
		const parsed = JSON.parse(decrypted) as unknown;
		assertSnapshot(parsed);
		return parsed;
	} catch {
		throw new SessionError("Failed to decrypt sync snapshot: wrong passphrase or corrupted payload");
	}
}

/**
 * Write a snapshot as an encrypted JSON envelope to disk.
 *
 * @param snapshot - Plain snapshot object to encrypt.
 * @param outputPath - Destination file path.
 * @param passphrase - Non-empty passphrase used for key derivation.
 * @param options - Optional key-derivation controls.
 * @returns Resolved absolute output path.
 */
export function writeEncryptedCrossMachineSnapshot(
	snapshot: CrossMachineSnapshot,
	outputPath: string,
	passphrase: string,
	options?: CrossMachineSnapshotEncryptionOptions,
): string {
	const envelope = encryptSnapshot(snapshot, passphrase, options);
	const resolved = path.resolve(outputPath);
	fs.mkdirSync(path.dirname(resolved), { recursive: true });
	fs.writeFileSync(resolved, JSON.stringify(envelope, null, "\t"), "utf-8");
	writeSyncState(getChitraguptaHome(), {
		lastExportAt: snapshot.exportedAt,
		lastExportPath: resolved,
	});
	return resolved;
}

/**
 * Read and decrypt an encrypted snapshot envelope from disk.
 *
 * @param snapshotPath - Path to encrypted snapshot file.
 * @param passphrase - Decryption passphrase.
 * @returns Decrypted, validated plaintext snapshot.
 */
export function readEncryptedCrossMachineSnapshot(
	snapshotPath: string,
	passphrase: string,
): CrossMachineSnapshot {
	const resolved = path.resolve(snapshotPath);
	const raw = fs.readFileSync(resolved, "utf-8");
	const parsed = JSON.parse(raw) as unknown;
	assertEncryptedEnvelope(parsed);
	return decryptSnapshot(parsed, passphrase);
}

/**
 * Import an encrypted snapshot by decrypting then delegating to standard import logic.
 *
 * @param snapshotPath - Encrypted snapshot file path.
 * @param passphrase - Decryption passphrase.
 * @param options - Standard import options (`strategy`, `dryRun`).
 * @returns Standard cross-machine import result.
 */
export function importEncryptedCrossMachineSnapshot(
	snapshotPath: string,
	passphrase: string,
	options?: CrossMachineImportOptions,
): CrossMachineImportResult {
	const snapshot = readEncryptedCrossMachineSnapshot(snapshotPath, passphrase);
	return importCrossMachineSnapshot(snapshot, options);
}
