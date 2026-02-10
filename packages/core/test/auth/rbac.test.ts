import { describe, it, expect, beforeAll } from "vitest";
import {
	RBACEngine,
	BUILT_IN_ROLES,
	PERMISSIONS,
	ROUTE_PERMISSIONS,
} from "@chitragupta/core";
import type { RoleDefinition, Permission } from "@chitragupta/core";

describe("RBAC (Niyama)", () => {
	describe("Built-in Roles", () => {
		it("should have four built-in roles", () => {
			expect(BUILT_IN_ROLES).toHaveLength(4);
			const names = BUILT_IN_ROLES.map((r) => r.name);
			expect(names).toContain("admin");
			expect(names).toContain("operator");
			expect(names).toContain("viewer");
			expect(names).toContain("agent");
		});

		it("admin should have wildcard permission", () => {
			const admin = BUILT_IN_ROLES.find((r) => r.name === "admin")!;
			expect(admin.permissions.has("*")).toBe(true);
		});

		it("viewer should only have read permissions", () => {
			const viewer = BUILT_IN_ROLES.find((r) => r.name === "viewer")!;
			for (const perm of viewer.permissions) {
				expect(perm).toMatch(/^read:/);
			}
		});

		it("operator should have read and write but not admin", () => {
			const operator = BUILT_IN_ROLES.find((r) => r.name === "operator")!;
			expect(operator.permissions.has(PERMISSIONS.READ_SESSION)).toBe(true);
			expect(operator.permissions.has(PERMISSIONS.WRITE_CHAT)).toBe(true);
			expect(operator.permissions.has(PERMISSIONS.ADMIN_AGENTS)).toBe(false);
			expect(operator.permissions.has(PERMISSIONS.ADMIN_SYSTEM)).toBe(false);
		});

		it("agent should have limited permissions", () => {
			const agent = BUILT_IN_ROLES.find((r) => r.name === "agent")!;
			expect(agent.permissions.has(PERMISSIONS.WRITE_CHAT)).toBe(true);
			expect(agent.permissions.has(PERMISSIONS.READ_MEMORY)).toBe(true);
			expect(agent.permissions.has(PERMISSIONS.DELETE_MEMORY)).toBe(false);
			expect(agent.permissions.has(PERMISSIONS.ADMIN_AGENTS)).toBe(false);
		});
	});

	describe("RBACEngine", () => {
		let engine: RBACEngine;

		beforeAll(() => {
			engine = new RBACEngine();
		});

		it("should list all built-in roles", () => {
			const roles = engine.listRoles();
			expect(roles).toHaveLength(4);
		});

		it("admin should be authorized for any permission", () => {
			expect(engine.authorize(["admin"], PERMISSIONS.READ_SESSION)).toBe(true);
			expect(engine.authorize(["admin"], PERMISSIONS.WRITE_CHAT)).toBe(true);
			expect(engine.authorize(["admin"], PERMISSIONS.ADMIN_AGENTS)).toBe(true);
			expect(engine.authorize(["admin"], PERMISSIONS.ADMIN_SYSTEM)).toBe(true);
			expect(engine.authorize(["admin"], "custom:anything")).toBe(true);
		});

		it("viewer should only be authorized for read permissions", () => {
			expect(engine.authorize(["viewer"], PERMISSIONS.READ_SESSION)).toBe(true);
			expect(engine.authorize(["viewer"], PERMISSIONS.WRITE_CHAT)).toBe(false);
			expect(engine.authorize(["viewer"], PERMISSIONS.DELETE_MEMORY)).toBe(false);
		});

		it("operator should be authorized for read and write", () => {
			expect(engine.authorize(["operator"], PERMISSIONS.READ_SESSION)).toBe(true);
			expect(engine.authorize(["operator"], PERMISSIONS.WRITE_CHAT)).toBe(true);
			expect(engine.authorize(["operator"], PERMISSIONS.DELETE_MEMORY)).toBe(true);
			expect(engine.authorize(["operator"], PERMISSIONS.ADMIN_AGENTS)).toBe(false);
		});

		it("should combine permissions from multiple roles", () => {
			// viewer + agent: agent has WRITE_CHAT, viewer does not
			expect(engine.authorize(["viewer", "agent"], PERMISSIONS.WRITE_CHAT)).toBe(true);
			expect(engine.authorize(["viewer", "agent"], PERMISSIONS.READ_SESSION)).toBe(true);
		});

		it("should return false for unknown role", () => {
			expect(engine.authorize(["nonexistent"], PERMISSIONS.READ_SESSION)).toBe(false);
		});

		it("should return false for empty roles array", () => {
			expect(engine.authorize([], PERMISSIONS.READ_SESSION)).toBe(false);
		});

		it("hasRole should check role membership", () => {
			expect(engine.hasRole(["admin", "viewer"], "admin")).toBe(true);
			expect(engine.hasRole(["viewer"], "admin")).toBe(false);
		});

		it("getPermissions should return the permission set", () => {
			const perms = engine.getPermissions("viewer");
			expect(perms.has(PERMISSIONS.READ_SESSION)).toBe(true);
			expect(perms.has(PERMISSIONS.WRITE_CHAT)).toBe(false);
		});

		it("getPermissions should return empty set for unknown role", () => {
			const perms = engine.getPermissions("nonexistent");
			expect(perms.size).toBe(0);
		});

		it("addRole should register a custom role", () => {
			const customRole: RoleDefinition = {
				name: "custom",
				description: "Custom test role",
				permissions: new Set(["custom:perm1", "custom:perm2"]),
			};
			engine.addRole(customRole);
			expect(engine.authorize(["custom"], "custom:perm1")).toBe(true);
			expect(engine.authorize(["custom"], "custom:perm2")).toBe(true);
			expect(engine.authorize(["custom"], PERMISSIONS.READ_SESSION)).toBe(false);
		});
	});

	describe("Route Permissions", () => {
		it("GET /api/health should be public (null)", () => {
			expect(ROUTE_PERMISSIONS.get("GET /api/health")).toBeNull();
		});

		it("GET /api/sessions should require read:session", () => {
			expect(ROUTE_PERMISSIONS.get("GET /api/sessions")).toBe(PERMISSIONS.READ_SESSION);
		});

		it("POST /api/chat should require write:chat", () => {
			expect(ROUTE_PERMISSIONS.get("POST /api/chat")).toBe(PERMISSIONS.WRITE_CHAT);
		});

		it("DELETE /api/memory/:scope should require delete:memory", () => {
			expect(ROUTE_PERMISSIONS.get("DELETE /api/memory/:scope")).toBe(PERMISSIONS.DELETE_MEMORY);
		});

		it("POST /api/agent/reset should require admin:agents", () => {
			expect(ROUTE_PERMISSIONS.get("POST /api/agent/reset")).toBe(PERMISSIONS.ADMIN_AGENTS);
		});
	});

	describe("resolveRoutePermission", () => {
		let engine: RBACEngine;

		beforeAll(() => {
			engine = new RBACEngine();
		});

		it("should resolve exact route", () => {
			expect(engine.resolveRoutePermission("GET", "/api/sessions")).toBe(PERMISSIONS.READ_SESSION);
		});

		it("should resolve parameterized route", () => {
			expect(engine.resolveRoutePermission("GET", "/api/agents/abc-123")).toBe(PERMISSIONS.READ_AGENTS);
		});

		it("should resolve nested parameterized route", () => {
			expect(engine.resolveRoutePermission("GET", "/api/agents/abc-123/tree")).toBe(PERMISSIONS.READ_AGENTS);
		});

		it("should return null for public routes", () => {
			expect(engine.resolveRoutePermission("GET", "/api/health")).toBeNull();
		});

		it("should return undefined for unknown routes", () => {
			expect(engine.resolveRoutePermission("GET", "/api/unknown")).toBeUndefined();
		});
	});
});
