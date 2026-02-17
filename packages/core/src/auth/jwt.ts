/**
 * Kavach-JWT — JSON Web Token signing and verification.
 * Sanskrit: Kavach (कवच) = armour, shield.
 *
 * Pure Node.js crypto — no external dependencies.
 * Implements HMAC-SHA256 (HS256) JWTs with base64url encoding.
 * All error paths return null (caller decides error handling).
 */

import { createHmac, randomUUID } from "node:crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface JWTConfig {
	/** HMAC secret key for signing/verification. */
	secret: string;
	/** Token lifetime in seconds. Default: 3600 (1 hour). */
	expiresIn?: number;
	/** Issuer claim (iss). */
	issuer?: string;
	/** Audience claim (aud). */
	audience?: string;
}

export interface JWTPayload {
	/** Subject — user or entity ID. */
	sub: string;
	/** Roles assigned to the subject. */
	roles: string[];
	/** Tenant identifier for multi-tenant isolation. */
	tenantId: string;
	/** Permission scopes granted to this token. */
	scope: string[];
	/** Issued-at timestamp (Unix seconds). */
	iat: number;
	/** Expiration timestamp (Unix seconds). */
	exp: number;
	/** Unique token identifier (for revocation tracking). */
	jti: string;
	/** Issuer claim. */
	iss?: string;
	/** Audience claim. */
	aud?: string;
}

/** The subset of fields the caller provides when signing. */
export type JWTSignInput = Pick<JWTPayload, "sub" | "roles" | "tenantId" | "scope">;

// ─── Base64url Helpers ───────────────────────────────────────────────────────

/**
 * Encode a Buffer or string to base64url (RFC 4648 section 5).
 * No padding characters.
 */
export function base64urlEncode(input: Buffer | string): string {
	const buf = typeof input === "string" ? Buffer.from(input, "utf-8") : input;
	return buf
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

/**
 * Decode a base64url string to a Buffer.
 * Re-adds padding before decoding.
 */
export function base64urlDecode(input: string): Buffer {
	// Restore standard base64 characters
	let b64 = input.replace(/-/g, "+").replace(/_/g, "/");
	// Re-add padding
	const pad = b64.length % 4;
	if (pad === 2) b64 += "==";
	else if (pad === 3) b64 += "=";
	return Buffer.from(b64, "base64");
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/** HMAC-SHA256 signature over `data` using `secret`. */
function hmacSign(data: string, secret: string): string {
	return base64urlEncode(
		createHmac("sha256", secret).update(data, "utf-8").digest(),
	);
}

/** Build the JWT header (always HS256). */
function encodeHeader(): string {
	return base64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
}

/** Encode a payload object to a base64url JSON segment. */
function encodePayload(payload: JWTPayload): string {
	return base64urlEncode(JSON.stringify(payload));
}

/** Constant-time comparison to prevent timing attacks. */
function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	const bufA = Buffer.from(a, "utf-8");
	const bufB = Buffer.from(b, "utf-8");
	// Node's timingSafeEqual requires equal-length buffers
	if (bufA.length !== bufB.length) return false;
	let result = 0;
	for (let i = 0; i < bufA.length; i++) {
		result |= bufA[i] ^ bufB[i];
	}
	return result === 0;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Sign a JWT with HMAC-SHA256.
 *
 * Fills in `iat`, `exp`, `jti`, `iss`, and `aud` automatically from config.
 * Returns the compact JWT string (header.payload.signature).
 */
export function signJWT(input: JWTSignInput, config: JWTConfig): string {
	const now = Math.floor(Date.now() / 1000);
	const expiresIn = config.expiresIn ?? 3600;

	const payload: JWTPayload = {
		sub: input.sub,
		roles: input.roles,
		tenantId: input.tenantId,
		scope: input.scope,
		iat: now,
		exp: now + expiresIn,
		jti: randomUUID(),
	};

	if (config.issuer) payload.iss = config.issuer;
	if (config.audience) payload.aud = config.audience;

	const header = encodeHeader();
	const payloadSeg = encodePayload(payload);
	const signingInput = `${header}.${payloadSeg}`;
	const signature = hmacSign(signingInput, config.secret);

	return `${signingInput}.${signature}`;
}

/**
 * Verify a JWT token: decode, check signature, validate expiry and claims.
 *
 * Returns the decoded payload on success, or null on any failure.
 */
export function verifyJWT(token: string, config: JWTConfig): JWTPayload | null {
	if (typeof token !== "string") return null;

	const parts = token.split(".");
	if (parts.length !== 3) return null;

	const [headerSeg, payloadSeg, signatureSeg] = parts;

	// Verify signature
	const signingInput = `${headerSeg}.${payloadSeg}`;
	const expectedSig = hmacSign(signingInput, config.secret);

	if (!timingSafeEqual(signatureSeg, expectedSig)) {
		return null;
	}

	// Decode header — must be HS256
	let header: Record<string, unknown>;
	try {
		header = JSON.parse(base64urlDecode(headerSeg).toString("utf-8"));
	} catch {
		return null;
	}
	if (header.alg !== "HS256") return null;

	// Decode payload
	let payload: JWTPayload;
	try {
		payload = JSON.parse(base64urlDecode(payloadSeg).toString("utf-8"));
	} catch {
		return null;
	}

	// Check required fields
	if (
		typeof payload.sub !== "string" ||
		!Array.isArray(payload.roles) ||
		typeof payload.tenantId !== "string" ||
		!Array.isArray(payload.scope) ||
		typeof payload.iat !== "number" ||
		typeof payload.exp !== "number" ||
		typeof payload.jti !== "string"
	) {
		return null;
	}

	// Check expiry
	const now = Math.floor(Date.now() / 1000);
	if (payload.exp <= now) return null;

	// Check issuer if configured
	if (config.issuer && payload.iss !== config.issuer) return null;

	// Check audience if configured
	if (config.audience && payload.aud !== config.audience) return null;

	return payload;
}

/**
 * Decode a JWT without verification (for inspection/debugging).
 *
 * Returns the payload or null if the token is malformed.
 */
export function decodeJWT(token: string): JWTPayload | null {
	if (typeof token !== "string") return null;

	const parts = token.split(".");
	if (parts.length !== 3) return null;

	try {
		const payload = JSON.parse(base64urlDecode(parts[1]).toString("utf-8"));
		return payload as JWTPayload;
	} catch {
		return null;
	}
}

/**
 * Refresh a JWT: verify the existing token, then issue a new one
 * with a fresh `iat`, `exp`, and `jti`.
 *
 * Returns the new token string or null if the old token is invalid.
 */
export function refreshJWT(token: string, config: JWTConfig): string | null {
	const payload = verifyJWT(token, config);
	if (!payload) return null;

	return signJWT(
		{
			sub: payload.sub,
			roles: payload.roles,
			tenantId: payload.tenantId,
			scope: payload.scope,
		},
		config,
	);
}
