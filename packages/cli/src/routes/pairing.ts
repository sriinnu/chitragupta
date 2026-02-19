/**
 * Dvara-Bandhu Pairing API Routes — REST endpoints for device pairing.
 *
 * Mounts onto the ChitraguptaServer via `server.route()`.
 * The browser hits these endpoints; the terminal shows the challenge.
 *
 * @module routes/pairing
 */

import type {
	PairingEngine,
	PairingMethod,
	PairedDevice,
} from "../pairing-engine.js";
import { getPairingWordList, PAIRING_ICONS } from "../pairing-engine.js";

// ─── Duck-typed server interface ──────────────────────────────────────────────

interface ServerLike {
	route(
		method: string,
		path: string,
		handler: (req: {
			params: Record<string, string>;
			query: Record<string, string>;
			body: unknown;
			headers: Record<string, string>;
		}) => Promise<{ status: number; body: unknown }>,
	): void;
}

// ─── Request / Response shapes ────────────────────────────────────────────────

interface VerifyRequestBody {
	method: PairingMethod;
	response: {
		words?: string[];
		code?: string;
		icons?: string[];
		qrToken?: string;
	};
	deviceName?: string;
	browser?: string;
}

interface RefreshRequestBody {
	token: string;
}

interface ChallengeResponse {
	challengeId: string;
	methods: PairingMethod[];
	wordList: readonly string[];
	iconSet: readonly string[];
	numberCodeLength: number;
	expiresAt: number;
}

interface DeviceListResponse {
	devices: PairedDevice[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_METHODS: readonly PairingMethod[] = ["passphrase", "qr", "visual", "number"];

/**
 * Extract a Bearer token from the Authorization header.
 * Returns the raw token string or null if missing / malformed.
 */
function extractBearer(headers: Record<string, string>): string | null {
	const authHeader = headers["authorization"] ?? headers["Authorization"];
	if (!authHeader) return null;
	const parts = authHeader.split(" ");
	if (parts.length !== 2 || parts[0] !== "Bearer") return null;
	return parts[1];
}

// ─── Route Mounting ───────────────────────────────────────────────────────────

/**
 * Mount all pairing-related API routes onto the server.
 *
 * @param server - ChitraguptaServer (duck-typed)
 * @param getEngine - Lazy getter; engine may not be ready at mount time.
 */
export function mountPairingRoutes(
	server: ServerLike,
	getEngine: () => PairingEngine | undefined,
): void {
	// ─── GET /api/pair/challenge ──────────────────────────────────
	// Returns challenge metadata for the browser UI (not the answers).
	server.route("GET", "/api/pair/challenge", async () => {
		const engine = getEngine();
		if (!engine) {
			return { status: 503, body: { error: "Pairing engine not available" } };
		}

		try {
			const challenge = engine.getChallenge();
			if (!challenge) {
				return { status: 423, body: { error: "Pairing locked. Too many failed attempts." } };
			}

			const body: ChallengeResponse = {
				challengeId: challenge.id,
				methods: [...VALID_METHODS],
				wordList: getPairingWordList(),
				iconSet: [...PAIRING_ICONS],
				numberCodeLength: challenge.numberCode.length,
				expiresAt: challenge.expiresAt,
			};

			return { status: 200, body };
		} catch (err) {
			return { status: 500, body: { error: `Challenge generation failed: ${(err as Error).message}` } };
		}
	});

	// ─── POST /api/pair/verify ───────────────────────────────────
	// Browser submits a pairing response for verification.
	server.route("POST", "/api/pair/verify", async (req) => {
		const engine = getEngine();
		if (!engine) {
			return { status: 503, body: { error: "Pairing engine not available" } };
		}

		try {
			const body = req.body as Partial<VerifyRequestBody> | undefined;
			if (!body?.method || !body.response) {
				return { status: 400, body: { error: "Missing 'method' and/or 'response' fields." } };
			}

			if (!VALID_METHODS.includes(body.method)) {
				return { status: 400, body: { error: `Invalid method. Must be one of: ${VALID_METHODS.join(", ")}` } };
			}

			const result = engine.verify(body.method, body.response, {
				deviceName: body.deviceName,
				browser: body.browser,
			});

			const status = result.success ? 200 : result.error?.startsWith("Locked") ? 423 : 401;
			return { status, body: result };
		} catch (err) {
			return { status: 500, body: { error: `Verification failed: ${(err as Error).message}` } };
		}
	});

	// ─── POST /api/pair/refresh ──────────────────────────────────
	// Refresh an existing JWT before it expires.
	server.route("POST", "/api/pair/refresh", async (req) => {
		const engine = getEngine();
		if (!engine) {
			return { status: 503, body: { error: "Pairing engine not available" } };
		}

		try {
			const body = req.body as Partial<RefreshRequestBody> | undefined;
			if (!body?.token) {
				return { status: 400, body: { error: "Missing 'token' field." } };
			}

			const newToken = engine.refreshToken(body.token);
			if (!newToken) {
				return { status: 401, body: { error: "Token invalid, expired, or revoked." } };
			}

			return { status: 200, body: { token: newToken } };
		} catch (err) {
			return { status: 500, body: { error: `Token refresh failed: ${(err as Error).message}` } };
		}
	});

	// ─── GET /api/pair/devices ───────────────────────────────────
	// List all paired devices. Requires a valid JWT.
	server.route("GET", "/api/pair/devices", async (req) => {
		const engine = getEngine();
		if (!engine) {
			return { status: 503, body: { error: "Pairing engine not available" } };
		}

		const token = extractBearer(req.headers);
		if (!token) {
			return { status: 401, body: { error: "Authorization header with Bearer token required." } };
		}

		const payload = engine.verifyToken(token);
		if (!payload) {
			return { status: 401, body: { error: "Invalid or expired token." } };
		}

		const body: DeviceListResponse = { devices: engine.listDevices() };
		return { status: 200, body };
	});

	// ─── DELETE /api/pair/devices/:id ────────────────────────────
	// Revoke a paired device. Requires a valid JWT.
	server.route("DELETE", "/api/pair/devices/:id", async (req) => {
		const engine = getEngine();
		if (!engine) {
			return { status: 503, body: { error: "Pairing engine not available" } };
		}

		const token = extractBearer(req.headers);
		if (!token) {
			return { status: 401, body: { error: "Authorization header with Bearer token required." } };
		}

		const payload = engine.verifyToken(token);
		if (!payload) {
			return { status: 401, body: { error: "Invalid or expired token." } };
		}

		const deviceId = req.params.id;
		if (!deviceId) {
			return { status: 400, body: { error: "Missing device ID." } };
		}

		const revoked = engine.revokeDevice(deviceId);
		if (!revoked) {
			return { status: 404, body: { error: "Device not found." } };
		}

		return { status: 200, body: { revoked: true, deviceId } };
	});
}
