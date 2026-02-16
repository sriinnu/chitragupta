/**
 * Pratyaya-OAuth — OAuth provider token verification.
 * Sanskrit: Pratyaya (प्रत्यय) = trust, credential.
 *
 * Verifies ID tokens from Google, Apple, and GitHub.
 * Uses Node.js built-in crypto for RS256 verification.
 * JWKS keys are cached with a 1-hour TTL.
 * All functions return null on failure (no throws).
 */

import { createVerify, createPublicKey } from "node:crypto";
import { base64urlDecode } from "./jwt.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OAuthProviderConfig {
	/** Provider identifier: "google", "apple", "github". */
	providerId: string;
	/** OAuth client ID for audience verification. */
	clientId: string;
	/** URL of the JWKS endpoint (for Google/Apple). */
	jwksUrl?: string;
	/** Expected issuer claim. */
	issuer?: string;
	/** Expected audience claim. */
	audience?: string;
}

export interface OAuthTokenClaims {
	/** Subject — unique user ID from the provider. */
	sub: string;
	/** User's email address. */
	email?: string;
	/** Display name. */
	name?: string;
	/** Profile picture URL. */
	picture?: string;
	/** Provider that issued the token. */
	provider: string;
}

/** A single JSON Web Key from a JWKS response. */
interface JWK {
	kty: string;
	kid: string;
	use?: string;
	alg?: string;
	n?: string; // RSA modulus
	e?: string; // RSA exponent
}

/** Cached JWKS entry with TTL. */
interface CachedJWKS {
	keys: JWK[];
	fetchedAt: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
const APPLE_ISSUER = "https://appleid.apple.com";

const GITHUB_USER_API = "https://api.github.com/user";

/** JWKS cache TTL: 1 hour. */
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;

// ─── JWKS Cache ──────────────────────────────────────────────────────────────

const jwksCache = new Map<string, CachedJWKS>();

/**
 * Fetch JWKS keys from a URL, using a 1-hour in-memory cache.
 */
async function fetchJWKS(url: string): Promise<JWK[] | null> {
	const now = Date.now();
	const cached = jwksCache.get(url);

	if (cached && now - cached.fetchedAt < JWKS_CACHE_TTL_MS) {
		return cached.keys;
	}

	try {
		const response = await fetch(url, {
			headers: { "Accept": "application/json" },
			signal: AbortSignal.timeout(10_000),
		});

		if (!response.ok) {
			// Fetch failed — fall back to stale cached keys if available
			return cached?.keys ?? null;
		}

		const body = (await response.json()) as { keys?: JWK[] };
		if (!body.keys || !Array.isArray(body.keys)) {
			return cached?.keys ?? null;
		}

		jwksCache.set(url, { keys: body.keys, fetchedAt: now });
		return body.keys;
	} catch {
		// Network error — fall back to stale cached keys if available
		return cached?.keys ?? null;
	}
}

/**
 * Clear the JWKS cache. Useful for testing.
 */
export function clearJWKSCache(): void {
	jwksCache.clear();
}

// ─── RS256 Verification ─────────────────────────────────────────────────────

/**
 * Convert a JWK RSA key to a PEM-formatted public key.
 */
function jwkToPEM(jwk: JWK): string | null {
	if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) return null;

	try {
		const key = createPublicKey({
			key: {
				kty: jwk.kty,
				n: jwk.n,
				e: jwk.e,
			},
			format: "jwk",
		});
		return key.export({ type: "spki", format: "pem" }) as string;
	} catch {
		return null;
	}
}

/**
 * Verify an RS256 JWT signature using a JWK.
 */
function verifyRS256(
	headerB64: string,
	payloadB64: string,
	signatureB64: string,
	jwk: JWK,
): boolean {
	const pem = jwkToPEM(jwk);
	if (!pem) return false;

	try {
		const signingInput = `${headerB64}.${payloadB64}`;
		const signature = base64urlDecode(signatureB64);

		const verifier = createVerify("RSA-SHA256");
		verifier.update(signingInput);
		return verifier.verify(pem, signature);
	} catch {
		return false;
	}
}

/**
 * Decode and verify an RS256 JWT against a JWKS key set.
 *
 * Returns the decoded payload or null.
 */
function verifyRS256JWT(
	token: string,
	keys: JWK[],
	validIssuers: string[],
	audience: string,
): Record<string, unknown> | null {
	const parts = token.split(".");
	if (parts.length !== 3) return null;

	const [headerB64, payloadB64, signatureB64] = parts;

	// Decode header to get kid
	let header: Record<string, unknown>;
	try {
		header = JSON.parse(base64urlDecode(headerB64).toString("utf-8"));
	} catch {
		return null;
	}

	if (header.alg !== "RS256") return null;

	// Find matching key
	const kid = header.kid as string | undefined;
	const matchingKey = kid
		? keys.find((k) => k.kid === kid)
		: keys.find((k) => k.use === "sig" && (k.alg === "RS256" || !k.alg));

	if (!matchingKey) return null;

	// Verify signature
	if (!verifyRS256(headerB64, payloadB64, signatureB64, matchingKey)) {
		return null;
	}

	// Decode payload
	let payload: Record<string, unknown>;
	try {
		payload = JSON.parse(base64urlDecode(payloadB64).toString("utf-8"));
	} catch {
		return null;
	}

	// Check expiry
	const now = Math.floor(Date.now() / 1000);
	if (typeof payload.exp === "number" && payload.exp <= now) return null;

	// Check issuer
	const iss = payload.iss as string | undefined;
	if (iss && !validIssuers.includes(iss)) return null;

	// Check audience
	const aud = payload.aud;
	if (aud) {
		const audArray = Array.isArray(aud) ? aud : [aud];
		if (!audArray.includes(audience)) return null;
	}

	return payload;
}

// ─── Provider-Specific Verifiers ─────────────────────────────────────────────

/**
 * Verify a Google ID token.
 *
 * Fetches Google's JWKS, verifies the RS256 signature,
 * checks issuer and audience claims.
 */
export async function verifyGoogleToken(
	idToken: string,
	clientId: string,
): Promise<OAuthTokenClaims | null> {
	const keys = await fetchJWKS(GOOGLE_JWKS_URL);
	if (!keys) return null;

	const payload = verifyRS256JWT(idToken, keys, GOOGLE_ISSUERS, clientId);
	if (!payload) return null;

	const sub = payload.sub as string | undefined;
	if (!sub) return null;

	return {
		sub,
		email: payload.email as string | undefined,
		name: payload.name as string | undefined,
		picture: payload.picture as string | undefined,
		provider: "google",
	};
}

/**
 * Verify an Apple ID token.
 *
 * Fetches Apple's JWKS, verifies the RS256 signature,
 * checks issuer and audience claims.
 */
export async function verifyAppleToken(
	idToken: string,
	clientId: string,
): Promise<OAuthTokenClaims | null> {
	const keys = await fetchJWKS(APPLE_JWKS_URL);
	if (!keys) return null;

	const payload = verifyRS256JWT(idToken, keys, [APPLE_ISSUER], clientId);
	if (!payload) return null;

	const sub = payload.sub as string | undefined;
	if (!sub) return null;

	return {
		sub,
		email: payload.email as string | undefined,
		name: undefined, // Apple does not always include name in the ID token
		picture: undefined,
		provider: "apple",
	};
}

/**
 * Verify a GitHub access token by calling the GitHub API.
 *
 * Unlike Google/Apple, GitHub uses opaque access tokens, so we
 * verify by making an authenticated API call to /user.
 */
export async function verifyGitHubToken(
	accessToken: string,
): Promise<OAuthTokenClaims | null> {
	try {
		const response = await fetch(GITHUB_USER_API, {
			headers: {
				"Authorization": `Bearer ${accessToken}`,
				"Accept": "application/vnd.github+json",
				"User-Agent": "Chitragupta-Auth/1.0",
			},
			signal: AbortSignal.timeout(10_000),
		});

		if (!response.ok) return null;

		const user = (await response.json()) as Record<string, unknown>;
		const id = user.id;
		if (id === undefined || id === null) return null;

		return {
			sub: String(id),
			email: (user.email as string | undefined) ?? undefined,
			name: (user.name as string | undefined) ?? (user.login as string | undefined),
			picture: (user.avatar_url as string | undefined) ?? undefined,
			provider: "github",
		};
	} catch {
		return null;
	}
}

/**
 * Generic OAuth token verification dispatcher.
 *
 * Routes to the appropriate provider-specific verifier based on `provider`.
 */
export async function verifyOAuthToken(
	provider: string,
	token: string,
	config: OAuthProviderConfig,
): Promise<OAuthTokenClaims | null> {
	switch (provider) {
		case "google":
			return verifyGoogleToken(token, config.clientId);
		case "apple":
			return verifyAppleToken(token, config.clientId);
		case "github":
			return verifyGitHubToken(token);
		default:
			return null;
	}
}
