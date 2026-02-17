import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	computeIntegrity,
	verifyIntegrity,
	writeIntegrity,
	readIntegrity,
	generateKeyPair,
	signIntegrity,
	verifySignature,
	writeSignature,
	readSignature,
	sealSkill,
	verifySeal,
} from "../src/mudra.js";

describe("Mudra — Integrity Hashing & Signing", () => {
	let skillDir: string;

	beforeEach(async () => {
		skillDir = await mkdtemp(join(tmpdir(), "mudra-test-"));
		// Create a minimal skill directory
		await writeFile(join(skillDir, "SKILL.md"), "---\nname: test-skill\n---\n# Test\n");
		await mkdir(join(skillDir, "scripts"), { recursive: true });
		await writeFile(join(skillDir, "scripts", "run.sh"), "#!/bin/bash\necho hello\n");
	});

	afterEach(async () => {
		await rm(skillDir, { recursive: true, force: true });
	});

	describe("computeIntegrity", () => {
		it("should hash all files and produce a root hash", async () => {
			const integrity = await computeIntegrity(skillDir);

			expect(integrity.algorithm).toBe("sha256");
			expect(integrity.rootHash).toMatch(/^[a-f0-9]{64}$/);
			expect(integrity.timestamp).toBeTruthy();
			expect(Object.keys(integrity.files)).toHaveLength(2);
			expect(integrity.files["SKILL.md"]).toMatch(/^[a-f0-9]{64}$/);
			expect(integrity.files["scripts/run.sh"]).toMatch(/^[a-f0-9]{64}$/);
		});

		it("should exclude INTEGRITY.json and SIGNATURE.json", async () => {
			await writeFile(join(skillDir, "INTEGRITY.json"), "{}");
			await writeFile(join(skillDir, "SIGNATURE.json"), "{}");

			const integrity = await computeIntegrity(skillDir);
			expect(Object.keys(integrity.files)).not.toContain("INTEGRITY.json");
			expect(Object.keys(integrity.files)).not.toContain("SIGNATURE.json");
		});

		it("should produce deterministic hashes", async () => {
			const a = await computeIntegrity(skillDir);
			const b = await computeIntegrity(skillDir);

			expect(a.rootHash).toBe(b.rootHash);
			expect(a.files).toEqual(b.files);
		});
	});

	describe("verifyIntegrity", () => {
		it("should pass for unmodified directory", async () => {
			const integrity = await computeIntegrity(skillDir);
			const result = await verifyIntegrity(skillDir, integrity);

			expect(result.valid).toBe(true);
			expect(result.modified).toEqual([]);
			expect(result.missing).toEqual([]);
			expect(result.added).toEqual([]);
		});

		it("should detect modified files", async () => {
			const integrity = await computeIntegrity(skillDir);
			await writeFile(join(skillDir, "SKILL.md"), "---\nname: changed\n---\n# Changed\n");

			const result = await verifyIntegrity(skillDir, integrity);

			expect(result.valid).toBe(false);
			expect(result.modified).toContain("SKILL.md");
		});

		it("should detect missing files", async () => {
			const integrity = await computeIntegrity(skillDir);
			await rm(join(skillDir, "scripts", "run.sh"));

			const result = await verifyIntegrity(skillDir, integrity);

			expect(result.valid).toBe(false);
			expect(result.missing).toContain("scripts/run.sh");
		});

		it("should detect added files", async () => {
			const integrity = await computeIntegrity(skillDir);
			await writeFile(join(skillDir, "new-file.txt"), "sneaky");

			const result = await verifyIntegrity(skillDir, integrity);

			expect(result.valid).toBe(false);
			expect(result.added).toContain("new-file.txt");
		});
	});

	describe("writeIntegrity / readIntegrity", () => {
		it("should round-trip integrity manifest", async () => {
			const integrity = await computeIntegrity(skillDir);
			await writeIntegrity(skillDir, integrity);
			const read = await readIntegrity(skillDir);

			expect(read).toEqual(integrity);
		});

		it("should return null if INTEGRITY.json missing", async () => {
			const result = await readIntegrity(skillDir);
			expect(result).toBeNull();
		});
	});

	describe("Ed25519 signing", () => {
		it("should generate a key pair", async () => {
			const keys = await generateKeyPair();
			expect(keys.publicKey).toBeTruthy();
			expect(keys.privateKey).toBeTruthy();
			// Base64 encoded
			expect(() => Buffer.from(keys.publicKey, "base64")).not.toThrow();
			expect(() => Buffer.from(keys.privateKey, "base64")).not.toThrow();
		});

		it("should sign and verify", async () => {
			const keys = await generateKeyPair();
			const integrity = await computeIntegrity(skillDir);
			const sig = await signIntegrity(integrity.rootHash, keys.privateKey);

			expect(sig.algorithm).toBe("ed25519");
			expect(sig.rootHash).toBe(integrity.rootHash);
			expect(sig.signature).toBeTruthy();
			expect(sig.publicKey).toBeTruthy();

			const valid = await verifySignature(sig);
			expect(valid).toBe(true);
		});

		it("should reject tampered signatures", async () => {
			const keys = await generateKeyPair();
			const integrity = await computeIntegrity(skillDir);
			const sig = await signIntegrity(integrity.rootHash, keys.privateKey);

			// Tamper with the root hash
			const tampered = { ...sig, rootHash: "0".repeat(64) };
			const valid = await verifySignature(tampered);
			expect(valid).toBe(false);
		});

		it("should round-trip signature file", async () => {
			const keys = await generateKeyPair();
			const integrity = await computeIntegrity(skillDir);
			const sig = await signIntegrity(integrity.rootHash, keys.privateKey);

			await writeSignature(skillDir, sig);
			const read = await readSignature(skillDir);
			expect(read).toEqual(sig);
		});

		it("should return null if SIGNATURE.json missing", async () => {
			const result = await readSignature(skillDir);
			expect(result).toBeNull();
		});
	});

	describe("sealSkill / verifySeal", () => {
		it("should seal without signing", async () => {
			const result = await sealSkill(skillDir);

			expect(result.integrity).toBeTruthy();
			expect(result.integrity.rootHash).toMatch(/^[a-f0-9]{64}$/);
			expect(result.signature).toBeUndefined();

			// INTEGRITY.json should exist
			const read = await readIntegrity(skillDir);
			expect(read).toEqual(result.integrity);
		});

		it("should seal with signing", async () => {
			const keys = await generateKeyPair();
			const result = await sealSkill(skillDir, keys.privateKey);

			expect(result.integrity).toBeTruthy();
			expect(result.signature).toBeTruthy();
			expect(result.signature!.rootHash).toBe(result.integrity.rootHash);
		});

		it("should verify a sealed skill", async () => {
			const keys = await generateKeyPair();
			await sealSkill(skillDir, keys.privateKey);

			const verification = await verifySeal(skillDir);
			expect(verification.integrity).toBeTruthy();
			expect(verification.integrity!.valid).toBe(true);
			expect(verification.signatureValid).toBe(true);
		});

		it("should detect tampering after seal", async () => {
			await sealSkill(skillDir);
			// Tamper
			await writeFile(join(skillDir, "SKILL.md"), "---\nname: tampered\n---\n# Evil\n");

			const verification = await verifySeal(skillDir);
			expect(verification.integrity).toBeTruthy();
			expect(verification.integrity!.valid).toBe(false);
			expect(verification.integrity!.modified).toContain("SKILL.md");
		});

		it("should return nulls for unsealed skill", async () => {
			const result = await verifySeal(skillDir);
			expect(result.integrity).toBeNull();
			expect(result.signatureValid).toBeNull();
		});
	});
});
