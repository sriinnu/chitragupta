/**
 * Kavach — macOS Keychain trust operations.
 *
 * Installs the Chitragupta local CA certificate into the macOS login
 * Keychain so browsers trust `https://localhost:3141` without warnings.
 *
 * On first run, prompts the user for consent (if TTY is available).
 * On non-macOS platforms, logs a manual instruction instead.
 * @module tls/tls-trust
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLogger } from "@chitragupta/core";
import { computeFingerprint } from "./tls-ca.js";
import type { TrustResult } from "./tls-types.js";

const log = createLogger("tls:trust");
const execFile = promisify(execFileCb);

/**
 * Install the CA certificate into the system trust store.
 *
 * On macOS: uses `security add-trusted-cert` to add to the login Keychain.
 * On Linux: logs manual instructions (platform-specific trust stores vary).
 * On other platforms: skips with a message.
 *
 * @param caCertPem - PEM-encoded CA certificate to trust.
 * @param skipPrompt - Skip the TTY consent prompt (for non-interactive use).
 */
export async function installCATrust(
	caCertPem: string,
	skipPrompt = false,
): Promise<TrustResult> {
	const platform = os.platform();

	if (platform === "darwin") {
		return installMacOSTrust(caCertPem, skipPrompt);
	}

	if (platform === "linux") {
		return installLinuxTrust(caCertPem);
	}

	return {
		trusted: false,
		message: `Platform "${platform}" not supported for auto-trust. ` +
			"Import the CA cert manually into your browser.",
	};
}

/** Check whether the CA is already trusted in the macOS login Keychain. */
export async function isCATrusted(caCertPem: string): Promise<boolean> {
	if (os.platform() !== "darwin") return false;

	const fingerprint = computeFingerprint(caCertPem);
	try {
		const { stdout } = await execFile("security", [
			"find-certificate", "-a", "-Z", "-c", "Chitragupta Local CA",
			path.join(os.homedir(), "Library/Keychains/login.keychain-db"),
		]);
		// security -Z outputs SHA-256 as plain hex (no colons)
		const normalizedFp = fingerprint.replace(/:/g, "").toUpperCase();
		return stdout.toUpperCase().includes(normalizedFp);
	} catch {
		return false;
	}
}

/** Remove the Chitragupta CA from the macOS login Keychain. */
export async function removeCATrust(caCertPem: string): Promise<TrustResult> {
	if (os.platform() !== "darwin") {
		return { trusted: false, message: "Only macOS auto-removal is supported." };
	}

	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kavach-rm-"));
	try {
		const certFile = path.join(tmpDir, "ca.crt");
		await fs.writeFile(certFile, caCertPem);

		await execFile("security", [
			"remove-trusted-cert", "-d", certFile,
		]);

		log.info("CA removed from Keychain");
		return { trusted: false, message: "CA certificate removed from login Keychain." };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { trusted: false, message: `Failed to remove CA: ${msg}` };
	} finally {
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
	}
}

// ── macOS ─────────────────────────────────────────────────────────

async function installMacOSTrust(
	caCertPem: string,
	skipPrompt: boolean,
): Promise<TrustResult> {
	// Check if already trusted
	const alreadyTrusted = await isCATrusted(caCertPem);
	if (alreadyTrusted) {
		log.info("CA already trusted in Keychain");
		return { trusted: true, message: "CA already trusted in login Keychain." };
	}

	// TTY consent prompt (unless skipped)
	if (!skipPrompt && process.stdin.isTTY) {
		const consent = await promptConsent(
			"Kavach wants to install a local CA certificate into your macOS login Keychain.\n" +
			"This allows browsers to trust https://localhost without warnings.\n" +
			"You may be prompted for your macOS password.\n" +
			"Allow? [Y/n] ",
		);
		if (!consent) {
			log.info("User declined Keychain trust");
			return {
				trusted: false,
				message: "User declined. TLS will work but browsers will show a warning.",
				prompted: true,
			};
		}
	}

	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kavach-trust-"));
	try {
		const certFile = path.join(tmpDir, "ca.crt");
		await fs.writeFile(certFile, caCertPem);

		// Add to login keychain with trust for SSL
		await execFile("security", [
			"add-trusted-cert",
			"-d",                          // add to admin trust settings (per-user)
			"-r", "trustRoot",             // trust as root CA
			"-k", path.join(os.homedir(), "Library/Keychains/login.keychain-db"),
			"-p", "ssl",                   // trust for SSL/TLS only
			certFile,
		]);

		log.info("CA installed in macOS login Keychain");
		return {
			trusted: true,
			message: "CA certificate installed in login Keychain. Browsers will trust localhost.",
			prompted: !skipPrompt,
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		log.warn("Keychain trust failed", { error: msg });
		return {
			trusted: false,
			message: `Keychain installation failed: ${msg}. ` +
				"You can manually trust the CA at ~/.chitragupta/tls/ca.crt",
			prompted: !skipPrompt,
		};
	} finally {
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
	}
}

// ── Linux ─────────────────────────────────────────────────────────

async function installLinuxTrust(caCertPem: string): Promise<TrustResult> {
	// Linux trust stores vary (Debian/Ubuntu vs RHEL/Fedora vs Arch).
	// Best-effort: try the Debian/Ubuntu path.
	const certDir = "/usr/local/share/ca-certificates";
	const certName = "chitragupta-local-ca.crt";

	try {
		await fs.access(certDir);
		await fs.writeFile(path.join(certDir, certName), caCertPem);
		await execFile("update-ca-certificates", []);
		log.info("CA installed via update-ca-certificates");
		return { trusted: true, message: "CA installed via update-ca-certificates." };
	} catch {
		log.info("Auto-trust not available on this Linux — manual install needed");
		return {
			trusted: false,
			message:
				"Could not auto-install CA. To trust locally:\n" +
				"  Debian/Ubuntu: sudo cp ~/.chitragupta/tls/ca.crt /usr/local/share/ca-certificates/ && sudo update-ca-certificates\n" +
				"  RHEL/Fedora:   sudo cp ~/.chitragupta/tls/ca.crt /etc/pki/ca-trust/source/anchors/ && sudo update-ca-trust",
		};
	}
}

// ── TTY prompt ────────────────────────────────────────────────────

function promptConsent(message: string): Promise<boolean> {
	return new Promise((resolve) => {
		process.stdout.write(message);
		process.stdin.setEncoding("utf8");
		process.stdin.once("data", (data) => {
			const answer = String(data).trim().toLowerCase();
			resolve(answer === "" || answer === "y" || answer === "yes");
		});
		// If stdin ends without data (piped/non-interactive), default to yes
		process.stdin.once("end", () => resolve(true));
	});
}
