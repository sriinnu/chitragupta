import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	verifyGoogleToken,
	verifyAppleToken,
	verifyGitHubToken,
	verifyOAuthToken,
	clearJWKSCache,
} from "@chitragupta/core";
import type { OAuthProviderConfig } from "@chitragupta/core";

/**
 * OAuth tests use mocked fetch to avoid real network calls.
 * We test the verification logic, error handling, and caching behavior.
 */

describe("OAuth (Pratyaya)", () => {
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		clearJWKSCache();
		fetchSpy = vi.spyOn(globalThis, "fetch");
	});

	afterEach(() => {
		fetchSpy.mockRestore();
	});

	describe("verifyGoogleToken", () => {
		it("should return null when JWKS fetch fails", async () => {
			fetchSpy.mockRejectedValue(new Error("Network error"));
			const result = await verifyGoogleToken("fake-token", "client-id");
			expect(result).toBeNull();
		});

		it("should return null when JWKS returns non-200", async () => {
			fetchSpy.mockResolvedValue({
				ok: false,
				status: 500,
				json: () => Promise.resolve({}),
			} as Response);
			const result = await verifyGoogleToken("fake-token", "client-id");
			expect(result).toBeNull();
		});

		it("should return null when JWKS has no keys", async () => {
			fetchSpy.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ keys: [] }),
			} as unknown as Response);
			// Token with no matching key should fail
			const result = await verifyGoogleToken("a.b.c", "client-id");
			expect(result).toBeNull();
		});

		it("should return null for a malformed token", async () => {
			fetchSpy.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({
					keys: [{ kty: "RSA", kid: "test", n: "abc", e: "AQAB" }],
				}),
			} as unknown as Response);
			const result = await verifyGoogleToken("not-a-jwt", "client-id");
			expect(result).toBeNull();
		});
	});

	describe("verifyAppleToken", () => {
		it("should return null when JWKS fetch fails", async () => {
			fetchSpy.mockRejectedValue(new Error("Network error"));
			const result = await verifyAppleToken("fake-token", "client-id");
			expect(result).toBeNull();
		});

		it("should return null for invalid token format", async () => {
			fetchSpy.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({
					keys: [{ kty: "RSA", kid: "test", n: "abc", e: "AQAB" }],
				}),
			} as unknown as Response);
			const result = await verifyAppleToken("invalid", "client-id");
			expect(result).toBeNull();
		});
	});

	describe("verifyGitHubToken", () => {
		it("should return claims for valid GitHub API response", async () => {
			fetchSpy.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({
					id: 12345,
					login: "octocat",
					name: "The Octocat",
					email: "octocat@github.com",
					avatar_url: "https://avatars.githubusercontent.com/u/12345",
				}),
			} as unknown as Response);

			const result = await verifyGitHubToken("ghp_test_token");
			expect(result).not.toBeNull();
			expect(result!.sub).toBe("12345");
			expect(result!.name).toBe("The Octocat");
			expect(result!.email).toBe("octocat@github.com");
			expect(result!.provider).toBe("github");
		});

		it("should return null when GitHub API returns 401", async () => {
			fetchSpy.mockResolvedValue({
				ok: false,
				status: 401,
				json: () => Promise.resolve({ message: "Bad credentials" }),
			} as unknown as Response);

			const result = await verifyGitHubToken("invalid-token");
			expect(result).toBeNull();
		});

		it("should return null when fetch throws", async () => {
			fetchSpy.mockRejectedValue(new Error("Network error"));
			const result = await verifyGitHubToken("any-token");
			expect(result).toBeNull();
		});

		it("should use login as name when name is null", async () => {
			fetchSpy.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({
					id: 999,
					login: "testuser",
					name: null,
					email: null,
					avatar_url: null,
				}),
			} as unknown as Response);

			const result = await verifyGitHubToken("ghp_test");
			expect(result).not.toBeNull();
			expect(result!.name).toBe("testuser");
		});
	});

	describe("verifyOAuthToken (dispatcher)", () => {
		it("should route to GitHub verifier", async () => {
			fetchSpy.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({
					id: 1,
					login: "test",
					name: "Test",
					email: "test@test.com",
					avatar_url: "https://example.com/pic.jpg",
				}),
			} as unknown as Response);

			const config: OAuthProviderConfig = {
				providerId: "github",
				clientId: "gh-client",
			};

			const result = await verifyOAuthToken("github", "token", config);
			expect(result).not.toBeNull();
			expect(result!.provider).toBe("github");
		});

		it("should return null for unsupported provider", async () => {
			const config: OAuthProviderConfig = {
				providerId: "unknown",
				clientId: "client",
			};
			const result = await verifyOAuthToken("unknown", "token", config);
			expect(result).toBeNull();
		});
	});

	describe("JWKS cache", () => {
		it("should cache JWKS keys on subsequent calls", async () => {
			const jwksResponse = {
				ok: true,
				json: () => Promise.resolve({
					keys: [{ kty: "RSA", kid: "k1", n: "test", e: "AQAB" }],
				}),
			} as unknown as Response;

			fetchSpy.mockResolvedValue(jwksResponse);

			// First call — fetches
			await verifyGoogleToken("a.b.c", "client-id");
			// Second call — should use cache
			await verifyGoogleToken("x.y.z", "client-id");

			// fetch should only have been called once (for JWKS)
			expect(fetchSpy).toHaveBeenCalledTimes(1);
		});

		it("clearJWKSCache should force re-fetch", async () => {
			const jwksResponse = {
				ok: true,
				json: () => Promise.resolve({
					keys: [{ kty: "RSA", kid: "k1", n: "test", e: "AQAB" }],
				}),
			} as unknown as Response;

			fetchSpy.mockResolvedValue(jwksResponse);

			await verifyGoogleToken("a.b.c", "client-id");
			clearJWKSCache();
			await verifyGoogleToken("x.y.z", "client-id");

			// Two fetches: one before clear, one after
			expect(fetchSpy).toHaveBeenCalledTimes(2);
		});
	});
});
