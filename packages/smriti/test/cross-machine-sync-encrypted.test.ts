import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

let tmpDir: string;

vi.mock("@chitragupta/core", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		getChitraguptaHome: () => tmpDir,
	};
});

import type { CrossMachineSnapshot } from "../src/cross-machine-sync.js";
import {
	importEncryptedCrossMachineSnapshot,
	readEncryptedCrossMachineSnapshot,
	writeEncryptedCrossMachineSnapshot,
} from "../src/cross-machine-sync-encrypted.js";

function sha256(content: string): string {
	return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}

function makeSnapshot(relPath?: string): CrossMachineSnapshot {
	const snapshotPath = relPath ?? `memory/test-${crypto.randomBytes(6).toString("hex")}.md`;
	const content = "# Memory\n\n---\n\n- prefers strict TypeScript\n";
	return {
		version: 1,
		exportedAt: new Date().toISOString(),
		source: {
			machine: "test-machine",
			platform: "darwin-arm64",
			home: tmpDir,
		},
		files: [
			{
				path: snapshotPath,
				kind: "memory",
				content,
				sha256: sha256(content),
				bytes: Buffer.byteLength(content, "utf-8"),
				mtimeMs: Date.now(),
			},
		],
	};
}

describe("cross-machine-sync encrypted", () => {
	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-sync-enc-"));
		fs.mkdirSync(path.join(tmpDir, "memory"), { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("round-trips encrypted snapshots", () => {
		const snapshot = makeSnapshot();
		const outPath = path.join(tmpDir, "snapshot.enc.json");
		writeEncryptedCrossMachineSnapshot(snapshot, outPath, "top-secret-passphrase");

		const parsedEnvelope = JSON.parse(fs.readFileSync(outPath, "utf-8")) as Record<string, unknown>;
		expect(parsedEnvelope.kind).toBe("chitragupta-sync-encrypted");
		expect(parsedEnvelope.version).toBe(1);

		const decrypted = readEncryptedCrossMachineSnapshot(outPath, "top-secret-passphrase");
		expect(decrypted).toEqual(snapshot);
	});

	it("rejects wrong passphrases", () => {
		const snapshot = makeSnapshot();
		const outPath = path.join(tmpDir, "snapshot.enc.json");
		writeEncryptedCrossMachineSnapshot(snapshot, outPath, "correct-passphrase");

		expect(() => readEncryptedCrossMachineSnapshot(outPath, "wrong-passphrase"))
			.toThrow(/wrong passphrase|corrupted payload/i);
	});

	it("detects payload tampering", () => {
		const snapshot = makeSnapshot();
		const outPath = path.join(tmpDir, "snapshot.enc.json");
		writeEncryptedCrossMachineSnapshot(snapshot, outPath, "integrity-passphrase");

		const envelope = JSON.parse(fs.readFileSync(outPath, "utf-8")) as {
			payloadB64: string;
		};
		const replacementChar = envelope.payloadB64.endsWith("A") ? "B" : "A";
		envelope.payloadB64 = `${envelope.payloadB64.slice(0, -1)}${replacementChar}`;
		fs.writeFileSync(outPath, JSON.stringify(envelope, null, "\t"), "utf-8");

		expect(() => readEncryptedCrossMachineSnapshot(outPath, "integrity-passphrase"))
			.toThrow(/wrong passphrase|corrupted payload/i);
	});

	it("imports encrypted snapshots through the standard dry-run path", () => {
		const relPath = `memory/import-${crypto.randomBytes(6).toString("hex")}.md`;
		const snapshot = makeSnapshot(relPath);
		const outPath = path.join(tmpDir, "snapshot.enc.json");
		writeEncryptedCrossMachineSnapshot(snapshot, outPath, "import-passphrase");

		const result = importEncryptedCrossMachineSnapshot(outPath, "import-passphrase", {
			dryRun: true,
			strategy: "safe",
		});

		expect(result.dryRun).toBe(true);
		expect(result.totals.files).toBe(1);
		expect(result.totals.created).toBe(1);
		expect(result.changedPaths).toContain(relPath);
		expect(fs.existsSync(path.join(tmpDir, relPath))).toBe(false);
	});
});
