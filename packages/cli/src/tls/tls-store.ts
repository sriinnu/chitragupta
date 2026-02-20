/**
 * Kavach — TLS certificate filesystem store.
 *
 * Manages the `~/.chitragupta/tls/` directory:
 * - Reads/writes CA and leaf certificate PEM files
 * - Tracks certificate metadata (expiry, fingerprint)
 * - Auto-renews leaf certificates 30 days before expiry
 * - Provisions fresh CA + leaf on first run
 * @module tls/tls-store
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getChitraguptaHome, createLogger } from "@chitragupta/core";
import { generateCA, generateLeaf, computeFingerprint, isExpiringSoon } from "./tls-ca.js";
import type { TlsCertificates, CertMeta, ProvisionResult, TlsStoreOptions } from "./tls-types.js";

const log = createLogger("tls:store");

/** Default renewal threshold: 30 days before expiry. */
const DEFAULT_RENEWAL_DAYS = 30;

/** Filenames within the TLS store directory. */
const FILES = {
	caCert: "ca.crt",
	caKey: "ca.key",
	leafCert: "leaf.crt",
	leafKey: "leaf.key",
	meta: "meta.json",
} as const;

/** Resolve the TLS store directory path. */
function resolveStoreDir(override?: string): string {
	return override ?? path.join(getChitraguptaHome(), "tls");
}

/**
 * Provision TLS certificates for the local server.
 *
 * Handles the full lifecycle:
 * 1. If no CA exists → generate CA + leaf
 * 2. If CA exists but leaf is missing or expiring → regenerate leaf
 * 3. If both are valid → return existing certs
 *
 * @returns Provision result with cert material or failure reason.
 */
export async function provisionTls(
	opts: TlsStoreOptions = {},
): Promise<ProvisionResult> {
	const storeDir = resolveStoreDir(opts.storeDir);
	const renewalDays = opts.renewalThresholdDays ?? DEFAULT_RENEWAL_DAYS;

	try {
		await fs.mkdir(storeDir, { recursive: true, mode: 0o700 });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, reason: `Cannot create TLS store: ${msg}` };
	}

	let freshCA = false;
	let freshLeaf = false;

	// ── Step 1: Ensure CA exists and is valid ─────────────────────
	let caCert: string | undefined;
	let caKey: string | undefined;

	try {
		caCert = await readFile(storeDir, FILES.caCert);
		caKey = await readFile(storeDir, FILES.caKey);
	} catch {
		// CA files don't exist yet
	}

	if (!caCert || !caKey) {
		log.info("No CA found, generating fresh CA...");
		try {
			const ca = await generateCA();
			caCert = ca.certPem;
			caKey = ca.keyPem;
			await writeFile(storeDir, FILES.caCert, caCert);
			await writeFile(storeDir, FILES.caKey, caKey, 0o600);
			freshCA = true;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { ok: false, reason: `CA generation failed: ${msg}` };
		}
	}

	// Check CA expiry (extremely unlikely for 5yr cert, but be safe)
	let caExpiring = false;
	try {
		const caThreshold = new Date(Date.now() + renewalDays * 86_400_000);
		caExpiring = isExpiringSoon(caCert, caThreshold);
	} catch {
		// Corrupted cert — regenerate
		caExpiring = true;
	}
	if (caExpiring) {
		log.info("CA expiring soon, regenerating...");
		try {
			const ca = await generateCA();
			caCert = ca.certPem;
			caKey = ca.keyPem;
			await writeFile(storeDir, FILES.caCert, caCert);
			await writeFile(storeDir, FILES.caKey, caKey, 0o600);
			freshCA = true;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { ok: false, reason: `CA renewal failed: ${msg}` };
		}
	}

	// ── Step 2: Ensure leaf exists and is valid ───────────────────
	let leafCert: string | undefined;
	let leafKey: string | undefined;
	let needNewLeaf = false;

	try {
		leafCert = await readFile(storeDir, FILES.leafCert);
		leafKey = await readFile(storeDir, FILES.leafKey);
	} catch {
		needNewLeaf = true;
	}

	// If CA was freshly generated, leaf must be regenerated too
	if (freshCA) needNewLeaf = true;

	// Check leaf expiry
	if (leafCert && !needNewLeaf) {
		try {
			const leafThreshold = new Date(Date.now() + renewalDays * 86_400_000);
			if (isExpiringSoon(leafCert, leafThreshold)) {
				log.info("Leaf cert expiring within renewal window, renewing...");
				needNewLeaf = true;
			}
		} catch {
			needNewLeaf = true; // Corrupted cert — regenerate
		}
	}

	if (needNewLeaf) {
		log.info("Generating leaf certificate...");
		try {
			const leaf = await generateLeaf(caCert, caKey);
			leafCert = leaf.certPem;
			leafKey = leaf.keyPem;
			await writeFile(storeDir, FILES.leafCert, leafCert);
			await writeFile(storeDir, FILES.leafKey, leafKey, 0o600);
			freshLeaf = true;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { ok: false, reason: `Leaf generation failed: ${msg}` };
		}
	}

	// ── Step 3: Write metadata ────────────────────────────────────
	const meta: CertMeta = {
		createdAt: new Date().toISOString(),
		expiresAt: getExpiryFromPem(leafCert!),
		caFingerprint: computeFingerprint(caCert),
		leafCN: "localhost",
	};
	await writeFile(storeDir, FILES.meta, JSON.stringify(meta, null, 2));

	log.info("TLS provisioned", {
		freshCA,
		freshLeaf,
		caFingerprint: meta.caFingerprint.slice(0, 20) + "...",
	});

	return {
		ok: true,
		certs: { cert: leafCert!, key: leafKey!, ca: caCert },
		freshCA,
		freshLeaf,
	};
}

/** Load existing TLS certificates from the store (no generation). */
export async function loadTls(
	opts: TlsStoreOptions = {},
): Promise<TlsCertificates | null> {
	const storeDir = resolveStoreDir(opts.storeDir);

	try {
		const cert = await readFile(storeDir, FILES.leafCert);
		const key = await readFile(storeDir, FILES.leafKey);
		const ca = await readFile(storeDir, FILES.caCert);
		return { cert, key, ca };
	} catch {
		return null;
	}
}

/** Read the stored metadata, or null if not present. */
export async function loadMeta(
	opts: TlsStoreOptions = {},
): Promise<CertMeta | null> {
	const storeDir = resolveStoreDir(opts.storeDir);
	try {
		const raw = await readFile(storeDir, FILES.meta);
		return JSON.parse(raw) as CertMeta;
	} catch {
		return null;
	}
}

/** Delete all TLS material from the store. */
export async function clearTls(opts: TlsStoreOptions = {}): Promise<void> {
	const storeDir = resolveStoreDir(opts.storeDir);
	await fs.rm(storeDir, { recursive: true, force: true });
	log.info("TLS store cleared");
}

// ── Helpers ───────────────────────────────────────────────────────

async function readFile(dir: string, name: string): Promise<string> {
	return fs.readFile(path.join(dir, name), "utf8");
}

async function writeFile(
	dir: string,
	name: string,
	content: string,
	mode?: number,
): Promise<void> {
	const filePath = path.join(dir, name);
	await fs.writeFile(filePath, content, { mode: mode ?? 0o644 });
}

function getExpiryFromPem(certPem: string): string {
	const x509 = new crypto.X509Certificate(certPem);
	return new Date(x509.validTo).toISOString();
}
