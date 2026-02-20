/**
 * Kavach — Certificate generation using system OpenSSL.
 *
 * Generates a local CA (5-year validity) and leaf certificates (1-year)
 * using ECDSA P-256 keys. Uses the system `openssl` binary which ships
 * on macOS (LibreSSL) and virtually all Linux distributions.
 *
 * Node.js can parse X.509 (`crypto.X509Certificate`) but cannot create
 * signed certificates natively — OpenSSL is the pragmatic choice.
 * @module tls/tls-ca
 */

import crypto from "node:crypto";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLogger } from "@chitragupta/core";

const log = createLogger("tls:ca");
const execFile = promisify(execFileCb);

/** SANs for the leaf certificate — covers all common local addresses. */
const LEAF_SANS = ["localhost", "127.0.0.1", "::1"];

/** CA validity: 5 years in days. */
const CA_VALIDITY_DAYS = Math.ceil(5 * 365.25);

/** Leaf validity: 1 year in days. */
const LEAF_VALIDITY_DAYS = 365;

/** Result of generating a CA or leaf certificate. */
export interface GeneratedCert {
	/** PEM-encoded certificate. */
	certPem: string;
	/** PEM-encoded ECDSA P-256 private key (SEC1/traditional). */
	keyPem: string;
	/** Certificate expiry date. */
	expiresAt: Date;
	/** SHA-256 fingerprint (colon-separated hex). */
	fingerprint: string;
}

/**
 * Generate a self-signed ECDSA P-256 CA certificate.
 *
 * - Subject: CN=Chitragupta Local CA, O=Chitragupta
 * - BasicConstraints: critical, CA:TRUE
 * - KeyUsage: critical, keyCertSign, cRLSign
 * - Validity: 5 years
 */
export async function generateCA(): Promise<GeneratedCert> {
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kavach-ca-"));

	try {
		const keyFile = path.join(tmpDir, "ca.key");
		const certFile = path.join(tmpDir, "ca.crt");
		const extFile = path.join(tmpDir, "ca-ext.cnf");

		// Generate EC P-256 private key
		await execFile("openssl", [
			"ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", keyFile,
		]);
		await fs.chmod(keyFile, 0o600);

		// Write extensions config
		await fs.writeFile(extFile, [
			"basicConstraints=critical,CA:TRUE",
			"keyUsage=critical,keyCertSign,cRLSign",
		].join("\n"));

		// Self-signed CA cert
		await execFile("openssl", [
			"req", "-x509", "-new", "-key", keyFile,
			"-out", certFile,
			"-days", String(CA_VALIDITY_DAYS),
			"-sha256",
			"-subj", "/CN=Chitragupta Local CA/O=Chitragupta",
			"-extensions", "v3_ext",
			"-config", await writeOpenSSLConfig(tmpDir, extFile),
		]);

		const certPem = await fs.readFile(certFile, "utf8");
		const keyPem = await fs.readFile(keyFile, "utf8");
		const fingerprint = computeFingerprint(certPem);
		const expiresAt = getExpiry(certPem);

		log.info("CA generated", { fingerprint, expiresAt: expiresAt.toISOString() });
		return { certPem, keyPem, expiresAt, fingerprint };
	} finally {
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
	}
}

/**
 * Generate a leaf (server) certificate signed by the given CA.
 *
 * - Subject: CN=localhost, O=Chitragupta
 * - SAN: DNS:localhost, IP:127.0.0.1, IP:::1
 * - BasicConstraints: CA:FALSE
 * - KeyUsage: critical, digitalSignature, keyEncipherment
 * - ExtKeyUsage: serverAuth
 * - Validity: 1 year
 */
export async function generateLeaf(
	caCertPem: string,
	caKeyPem: string,
): Promise<GeneratedCert> {
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kavach-leaf-"));

	try {
		const keyFile = path.join(tmpDir, "leaf.key");
		const csrFile = path.join(tmpDir, "leaf.csr");
		const certFile = path.join(tmpDir, "leaf.crt");
		const extFile = path.join(tmpDir, "leaf-ext.cnf");
		const caKeyFile = path.join(tmpDir, "ca.key");
		const caCertFile = path.join(tmpDir, "ca.crt");

		// Write CA material to temp files for signing
		await fs.writeFile(caCertFile, caCertPem, { mode: 0o600 });
		await fs.writeFile(caKeyFile, caKeyPem, { mode: 0o600 });

		// Generate leaf EC P-256 private key
		await execFile("openssl", [
			"ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", keyFile,
		]);
		await fs.chmod(keyFile, 0o600);

		// Create CSR
		await execFile("openssl", [
			"req", "-new", "-key", keyFile, "-out", csrFile,
			"-sha256", "-subj", "/CN=localhost/O=Chitragupta",
		]);

		// Build SAN extension entries
		const sanEntries = LEAF_SANS.map((s) => {
			if (/^\d+\.\d+\.\d+\.\d+$/.test(s) || s.includes(":")) return `IP:${s}`;
			return `DNS:${s}`;
		});

		await fs.writeFile(extFile, [
			"basicConstraints=CA:FALSE",
			"keyUsage=critical,digitalSignature,keyEncipherment",
			"extendedKeyUsage=serverAuth",
			`subjectAltName=${sanEntries.join(",")}`,
		].join("\n"));

		// Sign leaf CSR with CA
		await execFile("openssl", [
			"x509", "-req", "-in", csrFile,
			"-CA", caCertFile, "-CAkey", caKeyFile, "-CAcreateserial",
			"-out", certFile,
			"-days", String(LEAF_VALIDITY_DAYS),
			"-sha256", "-extfile", extFile,
		]);

		const certPem = await fs.readFile(certFile, "utf8");
		const keyPem = await fs.readFile(keyFile, "utf8");
		const fingerprint = computeFingerprint(certPem);
		const expiresAt = getExpiry(certPem);

		log.info("Leaf cert generated", {
			fingerprint,
			expiresAt: expiresAt.toISOString(),
			sans: LEAF_SANS.join(", "),
		});
		return { certPem, keyPem, expiresAt, fingerprint };
	} finally {
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
	}
}

/** SHA-256 fingerprint of a PEM certificate (colon-separated hex). */
export function computeFingerprint(certPem: string): string {
	const x509 = new crypto.X509Certificate(certPem);
	return x509.fingerprint256;
}

/** Check whether a PEM certificate expires before the given date. */
export function isExpiringSoon(certPem: string, thresholdDate: Date): boolean {
	return getExpiry(certPem).getTime() <= thresholdDate.getTime();
}

/** Extract the expiry date from a PEM certificate. */
function getExpiry(certPem: string): Date {
	const x509 = new crypto.X509Certificate(certPem);
	return new Date(x509.validTo);
}

/**
 * Write a minimal openssl.cnf that includes a named extension section.
 * Required because `-extensions v3_ext` needs a config file reference.
 */
async function writeOpenSSLConfig(tmpDir: string, extFile: string): Promise<string> {
	const confPath = path.join(tmpDir, "openssl.cnf");
	const extContent = await fs.readFile(extFile, "utf8");
	await fs.writeFile(confPath, [
		"[req]",
		"distinguished_name = req_dn",
		"x509_extensions = v3_ext",
		"prompt = no",
		"",
		"[req_dn]",
		"CN = Chitragupta Local CA",
		"O = Chitragupta",
		"",
		"[v3_ext]",
		extContent,
	].join("\n"));
	return confPath;
}
