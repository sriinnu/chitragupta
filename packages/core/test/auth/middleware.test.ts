import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	authenticateRequest,
	authorizeRoute,
	signJWT,
	RBACEngine,
	InMemoryTenantStore,
} from "@chitragupta/core";
import type { AuthMiddlewareConfig, JWTConfig, AuthContext } from "@chitragupta/core";

describe("Auth Middleware (Dvarpalaka)", () => {
	const jwtConfig: JWTConfig = {
		secret: "dvarpalaka-test-secret-2026",
		expiresIn: 3600,
		issuer: "chitragupta",
		audience: "chitragupta-api",
	};

	const rbac = new RBACEngine();
	const tenantStore = new InMemoryTenantStore();

	const fullConfig: AuthMiddlewareConfig = {
		jwt: jwtConfig,
		rbac,
		tenantStore,
	};

	/** Helper to create a valid JWT. */
	function makeToken(overrides?: {
		sub?: string;
		roles?: string[];
		tenantId?: string;
		scope?: string[];
	}): string {
		return signJWT(
			{
				sub: overrides?.sub ?? "user-1",
				roles: overrides?.roles ?? ["operator"],
				tenantId: overrides?.tenantId ?? "default",
				scope: overrides?.scope ?? ["read:session"],
			},
			jwtConfig,
		);
	}

	describe("authenticateRequest", () => {
		it("should authenticate a valid JWT bearer token", async () => {
			const token = makeToken();
			const result = await authenticateRequest(
				{
					method: "GET",
					path: "/api/sessions",
					headers: { authorization: `Bearer ${token}` },
				},
				fullConfig,
			);

			expect(result).not.toBeNull();
			expect(result!.userId).toBe("user-1");
			expect(result!.tenantId).toBe("default");
			expect(result!.roles).toEqual(["operator"]);
			expect(result!.isLegacy).toBe(false);
		});

		it("should reject an invalid JWT", async () => {
			const result = await authenticateRequest(
				{
					method: "GET",
					path: "/api/sessions",
					headers: { authorization: "Bearer invalid-token" },
				},
				fullConfig,
			);
			expect(result).toBeNull();
		});

		it("should reject when no auth header is provided", async () => {
			const result = await authenticateRequest(
				{
					method: "GET",
					path: "/api/sessions",
					headers: {},
				},
				fullConfig,
			);
			expect(result).toBeNull();
		});

		it("should allow public routes without auth", async () => {
			const result = await authenticateRequest(
				{
					method: "GET",
					path: "/api/health",
					headers: {},
				},
				fullConfig,
			);
			expect(result).not.toBeNull();
		});

		it("should resolve tenant from the store", async () => {
			const token = makeToken({ tenantId: "default" });
			const result = await authenticateRequest(
				{
					method: "GET",
					path: "/api/sessions",
					headers: { authorization: `Bearer ${token}` },
				},
				fullConfig,
			);

			expect(result).not.toBeNull();
			expect(result!.tenant).not.toBeNull();
			expect(result!.tenant!.tenantId).toBe("default");
		});

		it("should allow custom public routes", async () => {
			const configWithPublic: AuthMiddlewareConfig = {
				...fullConfig,
				publicRoutes: new Set(["GET /api/custom/public"]),
			};

			const result = await authenticateRequest(
				{
					method: "GET",
					path: "/api/custom/public",
					headers: {},
				},
				configWithPublic,
			);
			expect(result).not.toBeNull();
		});

		it("should allow OPTIONS for any path (default public)", async () => {
			const result = await authenticateRequest(
				{
					method: "OPTIONS",
					path: "/api/anything",
					headers: {},
				},
				fullConfig,
			);
			expect(result).not.toBeNull();
		});
	});

	describe("Legacy auth fallback", () => {
		it("should authenticate with legacy bearer token", async () => {
			const legacyConfig: AuthMiddlewareConfig = {
				legacyAuthToken: "my-secret-token",
			};

			const result = await authenticateRequest(
				{
					method: "GET",
					path: "/api/sessions",
					headers: { authorization: "Bearer my-secret-token" },
				},
				legacyConfig,
			);

			expect(result).not.toBeNull();
			expect(result!.isLegacy).toBe(true);
			expect(result!.userId).toBe("legacy");
		});

		it("should authenticate with legacy API key", async () => {
			const legacyConfig: AuthMiddlewareConfig = {
				legacyApiKeys: ["key-1", "key-2"],
			};

			const result = await authenticateRequest(
				{
					method: "GET",
					path: "/api/sessions",
					headers: { "x-api-key": "key-1" },
				},
				legacyConfig,
			);

			expect(result).not.toBeNull();
			expect(result!.isLegacy).toBe(true);
		});

		it("should reject wrong legacy token", async () => {
			const legacyConfig: AuthMiddlewareConfig = {
				legacyAuthToken: "correct-token",
			};

			const result = await authenticateRequest(
				{
					method: "GET",
					path: "/api/sessions",
					headers: { authorization: "Bearer wrong-token" },
				},
				legacyConfig,
			);
			expect(result).toBeNull();
		});

		it("should allow all when no auth is configured", async () => {
			const result = await authenticateRequest(
				{
					method: "GET",
					path: "/api/sessions",
					headers: {},
				},
				{}, // empty config
			);
			expect(result).not.toBeNull();
			expect(result!.isLegacy).toBe(true);
		});

		it("should fall back to legacy when JWT config + legacy config both present", async () => {
			const mixedConfig: AuthMiddlewareConfig = {
				jwt: jwtConfig,
				legacyAuthToken: "legacy-tok",
			};

			// Invalid JWT but valid legacy token
			const result = await authenticateRequest(
				{
					method: "GET",
					path: "/api/sessions",
					headers: { authorization: "Bearer legacy-tok" },
				},
				mixedConfig,
			);

			expect(result).not.toBeNull();
			expect(result!.isLegacy).toBe(true);
		});
	});

	describe("authorizeRoute", () => {
		it("should allow admin for any route", () => {
			const token = makeToken({ roles: ["admin"] });
			const context: AuthContext = {
				userId: "admin-1",
				tenantId: "default",
				roles: ["admin"],
				permissions: new Set(["*"]),
				jwtPayload: null,
				tenant: null,
				isLegacy: false,
			};

			expect(authorizeRoute(context, "DELETE", "/api/memory/global", fullConfig)).toBe(true);
		});

		it("should deny viewer for write routes", () => {
			const context: AuthContext = {
				userId: "viewer-1",
				tenantId: "default",
				roles: ["viewer"],
				permissions: rbac.getPermissions("viewer"),
				jwtPayload: null,
				tenant: null,
				isLegacy: false,
			};

			expect(authorizeRoute(context, "POST", "/api/chat", fullConfig)).toBe(false);
		});

		it("should allow viewer for read routes", () => {
			const context: AuthContext = {
				userId: "viewer-1",
				tenantId: "default",
				roles: ["viewer"],
				permissions: rbac.getPermissions("viewer"),
				jwtPayload: null,
				tenant: null,
				isLegacy: false,
			};

			expect(authorizeRoute(context, "GET", "/api/sessions", fullConfig)).toBe(true);
		});

		it("should allow legacy contexts for any route", () => {
			const context: AuthContext = {
				userId: "legacy",
				tenantId: "default",
				roles: ["admin"],
				permissions: new Set(["*"]),
				jwtPayload: null,
				tenant: null,
				isLegacy: true,
			};

			expect(authorizeRoute(context, "DELETE", "/api/memory/global", fullConfig)).toBe(true);
		});

		it("should allow when no RBAC is configured", () => {
			const noRbacConfig: AuthMiddlewareConfig = { jwt: jwtConfig };
			const context: AuthContext = {
				userId: "any",
				tenantId: "default",
				roles: [],
				permissions: new Set(),
				jwtPayload: null,
				tenant: null,
				isLegacy: false,
			};

			expect(authorizeRoute(context, "POST", "/api/chat", noRbacConfig)).toBe(true);
		});
	});

	describe("Tenant resolution", () => {
		it("should resolve the default tenant", async () => {
			const token = makeToken({ tenantId: "default" });
			const result = await authenticateRequest(
				{
					method: "GET",
					path: "/api/sessions",
					headers: { authorization: `Bearer ${token}` },
				},
				fullConfig,
			);

			expect(result).not.toBeNull();
			expect(result!.tenant).not.toBeNull();
			expect(result!.tenant!.name).toBe("Default");
		});

		it("should return null tenant for unknown tenantId", async () => {
			const token = makeToken({ tenantId: "nonexistent" });
			const result = await authenticateRequest(
				{
					method: "GET",
					path: "/api/sessions",
					headers: { authorization: `Bearer ${token}` },
				},
				fullConfig,
			);

			expect(result).not.toBeNull();
			expect(result!.tenant).toBeNull();
		});
	});
});
