import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	signJWT,
	verifyJWT,
	decodeJWT,
	refreshJWT,
	base64urlEncode,
	base64urlDecode,
} from "@chitragupta/core";
import type { JWTConfig, JWTSignInput } from "@chitragupta/core";

describe("JWT (Kavach)", () => {
	const config: JWTConfig = {
		secret: "test-secret-key-chitragupta-2026",
		expiresIn: 3600,
		issuer: "chitragupta",
		audience: "chitragupta-api",
	};

	const input: JWTSignInput = {
		sub: "user-123",
		roles: ["admin"],
		tenantId: "tenant-abc",
		scope: ["read:session", "write:chat"],
	};

	describe("base64url", () => {
		it("should encode and decode round-trip for ASCII", () => {
			const original = "Hello, Chitragupta!";
			const encoded = base64urlEncode(original);
			const decoded = base64urlDecode(encoded).toString("utf-8");
			expect(decoded).toBe(original);
		});

		it("should encode and decode round-trip for binary data", () => {
			const original = Buffer.from([0, 1, 2, 255, 254, 253, 128, 64]);
			const encoded = base64urlEncode(original);
			const decoded = base64urlDecode(encoded);
			expect(Buffer.compare(original, decoded)).toBe(0);
		});

		it("should not contain + / or = characters", () => {
			// Use data that would produce these in standard base64
			const data = Buffer.from([0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa]);
			const encoded = base64urlEncode(data);
			expect(encoded).not.toMatch(/[+/=]/);
		});

		it("should handle empty input", () => {
			const encoded = base64urlEncode("");
			expect(encoded).toBe("");
			const decoded = base64urlDecode("");
			expect(decoded.length).toBe(0);
		});

		it("should handle UTF-8 strings", () => {
			const original = "नमस्ते Chitragupta 🕉️";
			const encoded = base64urlEncode(original);
			const decoded = base64urlDecode(encoded).toString("utf-8");
			expect(decoded).toBe(original);
		});
	});

	describe("signJWT", () => {
		it("should produce a three-part token", () => {
			const token = signJWT(input, config);
			const parts = token.split(".");
			expect(parts).toHaveLength(3);
		});

		it("should include correct claims in payload", () => {
			const token = signJWT(input, config);
			const payload = decodeJWT(token);
			expect(payload).not.toBeNull();
			expect(payload!.sub).toBe("user-123");
			expect(payload!.roles).toEqual(["admin"]);
			expect(payload!.tenantId).toBe("tenant-abc");
			expect(payload!.scope).toEqual(["read:session", "write:chat"]);
			expect(payload!.iss).toBe("chitragupta");
			expect(payload!.aud).toBe("chitragupta-api");
		});

		it("should set iat and exp correctly", () => {
			const before = Math.floor(Date.now() / 1000);
			const token = signJWT(input, config);
			const after = Math.floor(Date.now() / 1000);
			const payload = decodeJWT(token)!;

			expect(payload.iat).toBeGreaterThanOrEqual(before);
			expect(payload.iat).toBeLessThanOrEqual(after);
			expect(payload.exp).toBe(payload.iat + 3600);
		});

		it("should generate unique jti for each token", () => {
			const token1 = signJWT(input, config);
			const token2 = signJWT(input, config);
			const p1 = decodeJWT(token1)!;
			const p2 = decodeJWT(token2)!;
			expect(p1.jti).not.toBe(p2.jti);
		});

		it("should omit iss and aud when not configured", () => {
			const minConfig: JWTConfig = { secret: "s" };
			const token = signJWT(input, minConfig);
			const payload = decodeJWT(token)!;
			expect(payload.iss).toBeUndefined();
			expect(payload.aud).toBeUndefined();
		});

		it("should use default expiresIn of 3600 when not specified", () => {
			const minConfig: JWTConfig = { secret: "s" };
			const token = signJWT(input, minConfig);
			const payload = decodeJWT(token)!;
			expect(payload.exp - payload.iat).toBe(3600);
		});
	});

	describe("verifyJWT", () => {
		it("should verify a valid token", () => {
			const token = signJWT(input, config);
			const payload = verifyJWT(token, config);
			expect(payload).not.toBeNull();
			expect(payload!.sub).toBe("user-123");
		});

		it("should return null for wrong secret", () => {
			const token = signJWT(input, config);
			const wrongConfig: JWTConfig = { ...config, secret: "wrong-secret" };
			expect(verifyJWT(token, wrongConfig)).toBeNull();
		});

		it("should return null for expired token", () => {
			const shortConfig: JWTConfig = { ...config, expiresIn: -1 };
			const token = signJWT(input, shortConfig);
			expect(verifyJWT(token, config)).toBeNull();
		});

		it("should return null for wrong issuer", () => {
			const token = signJWT(input, config);
			const wrongIssConfig: JWTConfig = { ...config, issuer: "wrong-issuer" };
			expect(verifyJWT(token, wrongIssConfig)).toBeNull();
		});

		it("should return null for wrong audience", () => {
			const token = signJWT(input, config);
			const wrongAudConfig: JWTConfig = { ...config, audience: "wrong-aud" };
			expect(verifyJWT(token, wrongAudConfig)).toBeNull();
		});

		it("should return null for malformed token (too few parts)", () => {
			expect(verifyJWT("only.two", config)).toBeNull();
		});

		it("should return null for malformed token (bad base64)", () => {
			expect(verifyJWT("not.a.jwt", config)).toBeNull();
		});

		it("should return null for tampered payload", () => {
			const token = signJWT(input, config);
			const parts = token.split(".");
			// Tamper with the payload
			const tamperedPayload = base64urlEncode(JSON.stringify({
				...JSON.parse(base64urlDecode(parts[1]).toString("utf-8")),
				roles: ["admin", "superadmin"],
			}));
			const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
			expect(verifyJWT(tampered, config)).toBeNull();
		});

		it("should return null for non-string input", () => {
			expect(verifyJWT(null as unknown as string, config)).toBeNull();
			expect(verifyJWT(123 as unknown as string, config)).toBeNull();
		});

		it("should verify without issuer/audience when not configured", () => {
			const noIssAudConfig: JWTConfig = { secret: config.secret, expiresIn: 3600 };
			const token = signJWT(input, noIssAudConfig);
			const payload = verifyJWT(token, noIssAudConfig);
			expect(payload).not.toBeNull();
		});
	});

	describe("decodeJWT", () => {
		it("should decode without verification", () => {
			const token = signJWT(input, config);
			// Decode with wrong secret — should still work
			const payload = decodeJWT(token);
			expect(payload).not.toBeNull();
			expect(payload!.sub).toBe("user-123");
		});

		it("should return null for non-JWT strings", () => {
			expect(decodeJWT("not-a-jwt")).toBeNull();
			expect(decodeJWT("a.b")).toBeNull();
		});

		it("should return null for invalid base64 in payload", () => {
			expect(decodeJWT("eyJhbGciOiJIUzI1NiJ9.!!!invalid!!!.sig")).toBeNull();
		});

		it("should return null for non-string input", () => {
			expect(decodeJWT(undefined as unknown as string)).toBeNull();
		});
	});

	describe("refreshJWT", () => {
		it("should issue a new token with fresh timestamps", () => {
			const token = signJWT(input, config);
			const original = decodeJWT(token)!;

			// Small delay to ensure different iat
			const newToken = refreshJWT(token, config);
			expect(newToken).not.toBeNull();

			const refreshed = decodeJWT(newToken!)!;
			expect(refreshed.sub).toBe(original.sub);
			expect(refreshed.roles).toEqual(original.roles);
			expect(refreshed.tenantId).toBe(original.tenantId);
			expect(refreshed.jti).not.toBe(original.jti); // new jti
			expect(refreshed.iat).toBeGreaterThanOrEqual(original.iat);
		});

		it("should return null for invalid token", () => {
			expect(refreshJWT("invalid.token.here", config)).toBeNull();
		});

		it("should return null for expired token", () => {
			const shortConfig: JWTConfig = { ...config, expiresIn: -1 };
			const token = signJWT(input, shortConfig);
			expect(refreshJWT(token, config)).toBeNull();
		});

		it("should produce a verifiable token", () => {
			const token = signJWT(input, config);
			const newToken = refreshJWT(token, config)!;
			const payload = verifyJWT(newToken, config);
			expect(payload).not.toBeNull();
		});
	});
});
