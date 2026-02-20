/**
 * Unit tests for the Dvara-Bandhu pairing engine.
 * @module test/pairing-engine
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PairingEngine, PAIRING_ICONS, getPairingWordList } from "../src/pairing-engine.js";
import type { PairingChallenge, PairingMethod } from "../src/pairing-engine.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEngine(overrides: Record<string, unknown> = {}): PairingEngine {
	return new PairingEngine({
		port: 3141,
		jwtSecret: "test-secret-must-be-long-enough-32chars",
		challengeTtlMs: 300_000,
		maxAttempts: 3,
		lockoutMs: 1_000,
		...overrides,
	});
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("PairingEngine", () => {
	let engine: PairingEngine;

	beforeEach(() => {
		engine = makeEngine();
	});

	// ═══ Challenge Generation ═══════════════════════════════════════════════

	describe("challenge generation", () => {
		it("should generate a challenge with all required fields", () => {
			const ch = engine.generateChallenge();
			expect(ch.id).toBeTruthy();
			expect(ch.passphrase).toHaveLength(4);
			expect(ch.numberCode).toMatch(/^\d{7}$/);
			expect(ch.icons).toHaveLength(4);
			expect(ch.qrToken).toBeTruthy();
			expect(ch.qrData).toContain("chitragupta://pair");
			expect(ch.expiresAt).toBeGreaterThan(Date.now());
		});

		it("should produce passphrase words from the word list", () => {
			const ch = engine.generateChallenge();
			const wordList = getPairingWordList();
			for (const word of ch.passphrase) {
				expect(wordList).toContain(word);
			}
		});

		it("should produce icons from the icon set", () => {
			const ch = engine.generateChallenge();
			for (const icon of ch.icons) {
				expect(PAIRING_ICONS as readonly string[]).toContain(icon);
			}
		});

		it("should produce 4 unique icons", () => {
			const ch = engine.generateChallenge();
			const unique = new Set(ch.icons);
			expect(unique.size).toBe(4);
		});

		it("should expose the challenge via getChallenge()", () => {
			engine.generateChallenge();
			const ch = engine.getChallenge();
			expect(ch).not.toBeNull();
			expect(ch!.passphrase).toHaveLength(4);
		});
	});

	// ═══ Passphrase Verification ════════════════════════════════════════════

	describe("passphrase verification", () => {
		it("should verify correct passphrase", () => {
			const ch = engine.generateChallenge();
			const result = engine.verify("passphrase", {
				words: ch.passphrase,
			});
			expect(result.success).toBe(true);
			expect(result.jwt).toBeTruthy();
			expect(result.deviceId).toBeTruthy();
		});

		it("should be case-insensitive", () => {
			const ch = engine.generateChallenge();
			const result = engine.verify("passphrase", {
				words: ch.passphrase.map((w) => w.toUpperCase()),
			});
			expect(result.success).toBe(true);
		});

		it("should reject wrong passphrase", () => {
			engine.generateChallenge();
			const result = engine.verify("passphrase", {
				words: ["wrong", "words", "here", "now"],
			});
			expect(result.success).toBe(false);
			expect(result.error).toBeTruthy();
		});

		it("should reject wrong word count", () => {
			engine.generateChallenge();
			const result = engine.verify("passphrase", {
				words: ["only", "three"],
			});
			expect(result.success).toBe(false);
		});
	});

	// ═══ Number Code Verification ═══════════════════════════════════════════

	describe("number code verification", () => {
		it("should verify correct number code", () => {
			const ch = engine.generateChallenge();
			const result = engine.verify("number", { code: ch.numberCode });
			expect(result.success).toBe(true);
			expect(result.jwt).toBeTruthy();
		});

		it("should reject wrong number code", () => {
			engine.generateChallenge();
			const result = engine.verify("number", { code: "0000000" });
			expect(result.success).toBe(false);
		});
	});

	// ═══ QR Verification ════════════════════════════════════════════════════

	describe("QR verification", () => {
		it("should verify correct QR token", () => {
			const ch = engine.generateChallenge();
			const result = engine.verify("qr", { qrToken: ch.qrToken });
			expect(result.success).toBe(true);
			expect(result.jwt).toBeTruthy();
		});

		it("should reject wrong QR token", () => {
			engine.generateChallenge();
			const result = engine.verify("qr", { qrToken: "bad-token" });
			expect(result.success).toBe(false);
		});
	});

	// ═══ Visual Match Verification ══════════════════════════════════════════

	describe("visual match verification", () => {
		it("should verify correct icons in order", () => {
			const ch = engine.generateChallenge();
			const result = engine.verify("visual", { icons: ch.icons });
			expect(result.success).toBe(true);
			expect(result.jwt).toBeTruthy();
		});

		it("should reject wrong icon order", () => {
			const ch = engine.generateChallenge();
			const reversed = [...ch.icons].reverse();
			// Only reject if reversed differs (which it will for 4 items)
			if (reversed.join() !== ch.icons.join()) {
				const result = engine.verify("visual", { icons: reversed });
				expect(result.success).toBe(false);
			}
		});

		it("should reject wrong icons", () => {
			engine.generateChallenge();
			const result = engine.verify("visual", {
				icons: ["X", "Y", "Z", "W"],
			});
			expect(result.success).toBe(false);
		});
	});

	// ═══ Lockout Behaviour ══════════════════════════════════════════════════

	describe("lockout", () => {
		it("should lock after max failed attempts", () => {
			engine.generateChallenge();
			for (let i = 0; i < 3; i++) {
				engine.verify("passphrase", { words: ["a", "b", "c", "d"] });
			}
			// Next attempt should report locked
			const result = engine.verify("passphrase", {
				words: ["a", "b", "c", "d"],
			});
			expect(result.success).toBe(false);
			expect(result.error).toMatch(/locked/i);
		});
	});

	// ═══ Device Management ══════════════════════════════════════════════════

	describe("device management", () => {
		it("should record paired device on success", () => {
			const ch = engine.generateChallenge();
			engine.verify("passphrase", { words: ch.passphrase });
			const devices = engine.listDevices();
			expect(devices.length).toBeGreaterThanOrEqual(1);
		});

		it("should revoke a device", () => {
			const ch = engine.generateChallenge();
			const result = engine.verify("passphrase", { words: ch.passphrase });
			const devices = engine.listDevices();
			const deviceId = devices[0].id;
			const revoked = engine.revokeDevice(deviceId);
			expect(revoked).toBe(true);
			expect(engine.listDevices()).toHaveLength(devices.length - 1);
		});

		it("should return false for unknown device revocation", () => {
			expect(engine.revokeDevice("no-such-device")).toBe(false);
		});
	});

	// ═══ JWT ═══════════════════════════════════════════════════════════════

	describe("JWT handling", () => {
		it("should issue a valid JWT on successful pairing", () => {
			const ch = engine.generateChallenge();
			const result = engine.verify("passphrase", { words: ch.passphrase });
			expect(result.jwt).toBeTruthy();
			// JWT should have 3 parts
			const parts = result.jwt!.split(".");
			expect(parts).toHaveLength(3);
		});

		it("should refresh a valid JWT", () => {
			const ch = engine.generateChallenge();
			const result = engine.verify("passphrase", { words: ch.passphrase });
			const refreshed = engine.refreshToken(result.jwt!);
			expect(refreshed).toBeTruthy();
			expect(refreshed!.split(".")).toHaveLength(3);
		});
	});

	// ═══ Terminal Display ═══════════════════════════════════════════════════

	describe("terminal display", () => {
		it("should render challenge as boxed text", () => {
			engine.generateChallenge();
			const display = engine.getTerminalDisplay();
			expect(display).toContain("Dvara-Bandhu Pairing Challenge");
			expect(display).toContain("Passphrase:");
			expect(display).toContain("Number Code:");
			expect(display).toContain("Icons:");
		});

		it("should show locked message when locked", () => {
			engine.generateChallenge();
			for (let i = 0; i < 3; i++) {
				engine.verify("passphrase", { words: ["a", "b", "c", "d"] });
			}
			const display = engine.getTerminalDisplay();
			expect(display).toContain("Locked");
		});
	});

	// ═══ Word List ═══════════════════════════════════════════════════════════

	describe("word list", () => {
		it("should have 256 unique words", () => {
			const words = getPairingWordList();
			expect(words).toHaveLength(256);
			const unique = new Set(words);
			expect(unique.size).toBe(256);
		});
	});
});
