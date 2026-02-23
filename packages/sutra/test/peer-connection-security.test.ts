import { describe, it, expect } from "vitest";
import { signMessage } from "../src/mesh/peer-envelope.js";
import { PeerConnectionManager } from "../src/mesh/peer-connection.js";

describe("PeerConnectionManager auth hardening", () => {
	it("accepts a valid nonce once and rejects replay", () => {
		const secret = "mesh-secret";
		const manager = new PeerConnectionManager({ meshSecret: secret }) as unknown as {
			verifyAuth: (raw: string) => boolean;
		};

		const nonce = `node-a:${Date.now()}:abc123`;
		const hmac = signMessage(nonce, secret);
		const raw = JSON.stringify({ nonce, hmac });

		expect(manager.verifyAuth(raw)).toBe(true);
		expect(manager.verifyAuth(raw)).toBe(false);
	});

	it("rejects stale nonce timestamps outside the window", () => {
		const secret = "mesh-secret";
		const manager = new PeerConnectionManager({ meshSecret: secret, authNonceWindowMs: 1_000 }) as unknown as {
			verifyAuth: (raw: string) => boolean;
		};

		const nonce = `node-a:${Date.now() - 5_000}:old`;
		const hmac = signMessage(nonce, secret);
		const raw = JSON.stringify({ nonce, hmac });

		expect(manager.verifyAuth(raw)).toBe(false);
	});

	it("rejects malformed nonce timestamps", () => {
		const secret = "mesh-secret";
		const manager = new PeerConnectionManager({ meshSecret: secret }) as unknown as {
			verifyAuth: (raw: string) => boolean;
		};

		const nonce = "node-a:not-a-number:nonce";
		const hmac = signMessage(nonce, secret);
		const raw = JSON.stringify({ nonce, hmac });

		expect(manager.verifyAuth(raw)).toBe(false);
	});
});

