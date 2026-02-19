/**
 * Dvara-Bandhu — Pairing Engine for secure device authentication.
 * Sanskrit: Dvara-Bandhu (द्वार-बन्धु) = friend of the gateway.
 *
 * Implements a 4-method pairing state machine: passphrase, QR code,
 * visual icon matching, and numeric code. The terminal displays the
 * challenge; the browser submits the answer. On success a JWT is issued.
 *
 * @module pairing-engine
 */

import { randomUUID, randomInt } from "node:crypto";
import { signJWT, verifyJWT, refreshJWT, decodeJWT } from "@chitragupta/core";
import type { JWTConfig, JWTPayload } from "@chitragupta/core";

// ─── Public Types ─────────────────────────────────────────────────────────────

/** Supported pairing verification methods. */
export type PairingMethod = "passphrase" | "qr" | "visual" | "number";

/** Finite-state for the pairing flow. */
export type PairingState =
	| "idle"
	| "challenge_issued"
	| "waiting_response"
	| "verified"
	| "locked";

/** A pairing challenge presented in the terminal. */
export interface PairingChallenge {
	/** Unique challenge identifier. */
	id: string;
	/** 4-word passphrase the user types in the browser. */
	passphrase: string[];
	/** 6-7 digit numeric code (first part of the challenge). */
	numberCode: string;
	/** 4 icons from the 16-icon set shown in the terminal. */
	icons: string[];
	/** QR-scannable deep link. */
	qrData: string;
	/** One-time token embedded in the QR deep link. */
	qrToken: string;
	/** Unix-ms when the challenge was created. */
	createdAt: number;
	/** Unix-ms when the challenge expires. */
	expiresAt: number;
}

/** A device that has successfully paired. */
export interface PairedDevice {
	/** Unique device identifier. */
	id: string;
	/** Human-readable device name (e.g. "Srinivas's MacBook"). */
	name: string;
	/** Browser user-agent or short label. */
	browser: string;
	/** Unix-ms when pairing succeeded. */
	pairedAt: number;
	/** Unix-ms of last authenticated request. */
	lastSeen: number;
	/** JWT ID for revocation tracking. */
	jti: string;
}

/** Configuration for the PairingEngine. */
export interface PairingEngineConfig {
	/** Port the HTTP server listens on (used in QR deep links). */
	port: number;
	/** HMAC secret for JWT signing. */
	jwtSecret: string;
	/** JWT lifetime in seconds. Default: 86400 (24 h). */
	jwtExpiresIn?: number;
	/** Challenge time-to-live in milliseconds. Default: 300 000 (5 min). */
	challengeTtlMs?: number;
	/** Maximum failed verification attempts before lockout. Default: 3. */
	maxAttempts?: number;
	/** Lockout duration in milliseconds after max failures. Default: 30 000 (30 s). */
	lockoutMs?: number;
}

// ─── Icon Set ─────────────────────────────────────────────────────────────────

/** The 16 icons available for visual pairing. */
export const PAIRING_ICONS = [
	"\u{1F537}", "\u{1F33F}", "\u26A1", "\u{1F3AF}",
	"\u{1F525}", "\u{1F30A}", "\u{1F48E}", "\u{1F319}",
	"\u{1F98B}", "\u{1F340}", "\u{1F338}", "\u2B50",
	"\u{1F52E}", "\u{1F308}", "\u{1FAB6}", "\u{1F341}",
] as const;

// ─── Word List (256 common, easy-to-spell English words) ──────────────────────

const PAIRING_WORDS: readonly string[] = [
	"castle", "orange", "helium", "dolphin", "rocket", "violet", "meadow", "crystal",
	"bridge", "falcon", "garden", "sunset", "silver", "jungle", "planet", "candle",
	"forest", "harbor", "lemon", "frozen", "anchor", "beacon", "canyon", "desert",
	"eagle", "flame", "golden", "island", "marble", "nectar", "ocean", "palace",
	"quartz", "ranger", "sphinx", "throne", "unity", "velvet", "walnut", "zenith",
	"alpine", "bamboo", "carbon", "dagger", "emblem", "feather", "galaxy", "hermit",
	"ivory", "jasper", "kitten", "lantern", "magnet", "nebula", "orchid", "pirate",
	"quiver", "ripple", "scarlet", "timber", "umbra", "voyage", "whisper", "zephyr",
	"arctic", "breeze", "cobalt", "dragon", "empire", "floral", "garnet", "hollow",
	"indigo", "jester", "knight", "locket", "mellow", "nimble", "oyster", "pepper",
	"quench", "riddle", "summit", "tundra", "utmost", "virtue", "wander", "yonder",
	"acorn", "bison", "cipher", "dawn", "ember", "fable", "grain", "haven",
	"iris", "jewel", "karma", "lunar", "maple", "novel", "oasis", "plume",
	"quest", "raven", "storm", "trail", "urban", "vigor", "wheat", "yield",
	"atlas", "bloom", "charm", "drift", "epoch", "frost", "glide", "haste",
	"petal", "joker", "koala", "lyric", "marsh", "noble", "omega", "prism",
	"quota", "river", "solar", "torch", "ultra", "vivid", "wraith", "xerox",
	"agate", "blaze", "coral", "delta", "elite", "fiber", "globe", "hydra",
	"ignite", "junco", "kiosk", "lotus", "mirage", "nexus", "optic", "pearl",
	"quasar", "realm", "siren", "titan", "umbral", "vortex", "willow", "yacht",
	"amber", "birch", "comet", "drive", "ether", "forge", "grove", "heron",
	"inlet", "judge", "kayak", "lever", "mango", "north", "olive", "pilot",
	"quill", "robin", "slate", "tiger", "triad", "valve", "wired", "youth",
	"azure", "brave", "crest", "dusty", "facet", "flock", "giant", "hover",
	"shield", "jolly", "knack", "light", "motto", "nerve", "oxide", "pulse",
	"query", "rustic", "spark", "tempo", "upper", "vault", "woven", "zones",
	"apex", "blade", "cloak", "dune", "evoke", "flora", "glint", "helix",
	"image", "badge", "kappa", "latch", "merit", "talon", "onyx", "plank",
	"radar", "rivet", "scale", "twist", "spire", "visor", "witch", "xerus",
	"alloy", "basil", "cedar", "drum", "elfin", "plaid", "glyph", "hazel",
	"nymph", "moose", "sigma", "theta", "fjord", "vapor", "whisk", "topaz",
	"aspen", "beryl", "cliff", "diver", "entry", "sabre", "grape", "hound",
] as const;

/** Returns the full word list for browser autocomplete. */
export function getPairingWordList(): readonly string[] {
	return PAIRING_WORDS;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Pick `count` random items from an array without replacement. */
function pickRandom<T>(arr: readonly T[], count: number): T[] {
	const copy = [...arr];
	const result: T[] = [];
	for (let i = 0; i < count && copy.length > 0; i++) {
		const idx = randomInt(copy.length);
		result.push(copy.splice(idx, 1)[0]);
	}
	return result;
}

// ─── PairingEngine ────────────────────────────────────────────────────────────

/**
 * Dvara-Bandhu pairing state machine.
 *
 * Generates challenges shown in the terminal and verifies responses
 * submitted from a browser. On success it issues a JWT for the paired device.
 */
export class PairingEngine {
	private currentChallenge: PairingChallenge | null = null;
	private state: PairingState = "idle";
	private failedAttempts = 0;
	private lockedUntil = 0;
	private readonly pairedDevices = new Map<string, PairedDevice>();
	private readonly revokedJtis = new Set<string>();
	private readonly config: Required<PairingEngineConfig>;
	private readonly jwtConfig: JWTConfig;

	constructor(config: PairingEngineConfig) {
		this.config = {
			port: config.port,
			jwtSecret: config.jwtSecret,
			jwtExpiresIn: config.jwtExpiresIn ?? 86_400,
			challengeTtlMs: config.challengeTtlMs ?? 300_000,
			maxAttempts: config.maxAttempts ?? 3,
			lockoutMs: config.lockoutMs ?? 30_000,
		};
		this.jwtConfig = {
			secret: this.config.jwtSecret,
			expiresIn: this.config.jwtExpiresIn,
			issuer: "chitragupta",
			audience: "dvara-bandhu",
		};
	}

	// ─── Challenge Management ───────────────────────────────────────

	/** Generate a fresh pairing challenge with all 4 methods. */
	generateChallenge(): PairingChallenge {
		const now = Date.now();
		const qrToken = randomUUID();
		const numberCode = String(randomInt(1_000_000, 9_999_999));

		const challenge: PairingChallenge = {
			id: randomUUID(),
			passphrase: pickRandom(PAIRING_WORDS, 4),
			numberCode,
			icons: pickRandom([...PAIRING_ICONS], 4),
			qrData: `chitragupta://pair?token=${qrToken}&port=${this.config.port}`,
			qrToken,
			createdAt: now,
			expiresAt: now + this.config.challengeTtlMs,
		};

		this.currentChallenge = challenge;
		this.state = "challenge_issued";
		this.failedAttempts = 0;
		return challenge;
	}

	/**
	 * Return the current challenge if still valid, otherwise generate a new one.
	 * Returns null only when the engine is locked out.
	 */
	getChallenge(): PairingChallenge | null {
		if (this.isLockedOut()) return null;

		if (
			this.currentChallenge &&
			Date.now() < this.currentChallenge.expiresAt
		) {
			return this.currentChallenge;
		}
		return this.generateChallenge();
	}

	/** Current pairing state. */
	getState(): PairingState {
		if (this.isLockedOut()) return "locked";
		return this.state;
	}

	// ─── Verification ───────────────────────────────────────────────

	/** Verification response type returned by {@link verify}. */
	verify(
		method: PairingMethod,
		response: unknown,
		meta?: { deviceName?: string; browser?: string },
	): { success: boolean; jwt?: string; deviceId?: string; error?: string } {
		if (this.isLockedOut()) {
			const remainMs = this.lockedUntil - Date.now();
			return { success: false, error: `Locked out. Retry in ${Math.ceil(remainMs / 1000)}s.` };
		}

		if (!this.currentChallenge || Date.now() >= this.currentChallenge.expiresAt) {
			return { success: false, error: "No active challenge. Request a new one." };
		}

		this.state = "waiting_response";
		const matched = this.matchResponse(method, response);

		if (!matched) {
			this.failedAttempts++;
			if (this.failedAttempts >= this.config.maxAttempts) {
				this.lockedUntil = Date.now() + this.config.lockoutMs;
				this.state = "locked";
				return { success: false, error: `Too many failures. Locked for ${this.config.lockoutMs / 1000}s.` };
			}
			return {
				success: false,
				error: `Verification failed (${this.failedAttempts}/${this.config.maxAttempts}).`,
			};
		}

		// Success — issue JWT and register device
		const deviceId = randomUUID();
		const jwt = signJWT(
			{ sub: deviceId, roles: ["device"], tenantId: "local", scope: ["pair"] },
			this.jwtConfig,
		);

		const payload = decodeJWT(jwt);
		const device: PairedDevice = {
			id: deviceId,
			name: meta?.deviceName ?? "Unknown Device",
			browser: meta?.browser ?? "Unknown Browser",
			pairedAt: Date.now(),
			lastSeen: Date.now(),
			jti: payload?.jti ?? randomUUID(),
		};

		this.pairedDevices.set(deviceId, device);
		this.state = "verified";
		this.currentChallenge = null;
		this.failedAttempts = 0;

		return { success: true, jwt, deviceId };
	}

	// ─── Token Management ───────────────────────────────────────────

	/** Refresh a JWT if it is valid and its jti has not been revoked. */
	refreshToken(token: string): string | null {
		const payload = verifyJWT(token, this.jwtConfig);
		if (!payload) return null;
		if (this.revokedJtis.has(payload.jti)) return null;

		// Update lastSeen on the device
		for (const device of this.pairedDevices.values()) {
			if (device.jti === payload.jti) {
				device.lastSeen = Date.now();
				break;
			}
		}

		return refreshJWT(token, this.jwtConfig);
	}

	/** Verify a JWT and return its payload, or null if invalid / revoked. */
	verifyToken(token: string): JWTPayload | null {
		const payload = verifyJWT(token, this.jwtConfig);
		if (!payload) return null;
		if (this.revokedJtis.has(payload.jti)) return null;
		return payload;
	}

	// ─── Device Management ──────────────────────────────────────────

	/** List all paired devices. */
	listDevices(): PairedDevice[] {
		return [...this.pairedDevices.values()];
	}

	/** Revoke a device by ID. Returns true if the device existed. */
	revokeDevice(deviceId: string): boolean {
		const device = this.pairedDevices.get(deviceId);
		if (!device) return false;
		this.revokedJtis.add(device.jti);
		this.pairedDevices.delete(deviceId);
		return true;
	}

	/** Check whether a JWT ID has been revoked. */
	isTokenRevoked(jti: string): boolean {
		return this.revokedJtis.has(jti);
	}

	// ─── Terminal Display ───────────────────────────────────────────

	/**
	 * Render a boxed terminal display of the current pairing challenge.
	 * Shows passphrase, icons, number code, and QR placeholder.
	 */
	getTerminalDisplay(): string {
		const ch = this.getChallenge();
		if (!ch) {
			return "\u250C\u2500 Pairing Locked \u2500\u2510\n\u2502 Too many failed attempts. Wait and retry. \u2502\n\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518";
		}

		const lines: string[] = [];
		const w = 50;
		const hr = "\u2500".repeat(w);

		lines.push(`\u250C${hr}\u2510`);
		lines.push(`\u2502${center("Dvara-Bandhu Pairing Challenge", w)}\u2502`);
		lines.push(`\u251C${hr}\u2524`);
		lines.push(`\u2502${center(`Passphrase: ${ch.passphrase.join(" ")}`, w)}\u2502`);
		lines.push(`\u251C${hr}\u2524`);
		lines.push(`\u2502${center(`Number Code: ${ch.numberCode}`, w)}\u2502`);
		lines.push(`\u251C${hr}\u2524`);
		lines.push(`\u2502${center(`Icons: ${ch.icons.join("  ")}`, w)}\u2502`);
		lines.push(`\u251C${hr}\u2524`);
		lines.push(`\u2502${center("QR: Scan with mobile app", w)}\u2502`);
		lines.push(`\u2502${center(ch.qrData, w)}\u2502`);
		lines.push(`\u2514${hr}\u2518`);

		return lines.join("\n");
	}

	// ─── Private ────────────────────────────────────────────────────

	/** Check whether the engine is currently in a lockout period. */
	private isLockedOut(): boolean {
		if (this.lockedUntil === 0) return false;
		if (Date.now() >= this.lockedUntil) {
			this.lockedUntil = 0;
			this.failedAttempts = 0;
			this.state = "idle";
			return false;
		}
		return true;
	}

	/** Match a verification response against the current challenge. */
	private matchResponse(method: PairingMethod, response: unknown): boolean {
		const ch = this.currentChallenge;
		if (!ch) return false;

		const resp = response as Record<string, unknown>;

		switch (method) {
			case "passphrase": {
				const words = resp.words;
				if (!Array.isArray(words) || words.length !== 4) return false;
				return ch.passphrase.every(
					(w, i) => typeof words[i] === "string" && (words[i] as string).toLowerCase() === w.toLowerCase(),
				);
			}
			case "number": {
				const code = resp.code;
				if (typeof code !== "string") return false;
				return code === ch.numberCode;
			}
			case "qr": {
				const token = resp.qrToken;
				if (typeof token !== "string") return false;
				return token === ch.qrToken;
			}
			case "visual": {
				const icons = resp.icons;
				if (!Array.isArray(icons) || icons.length !== 4) return false;
				return ch.icons.every((ic, i) => icons[i] === ic);
			}
			default:
				return false;
		}
	}
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/** Center a string inside a fixed-width field, padding with spaces. */
function center(text: string, width: number): string {
	if (text.length >= width) return text.slice(0, width);
	const pad = width - text.length;
	const left = Math.floor(pad / 2);
	const right = pad - left;
	return " ".repeat(left) + text + " ".repeat(right);
}
