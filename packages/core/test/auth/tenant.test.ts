import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryTenantStore, DEFAULT_TENANT } from "@chitragupta/core";
import type { TenantConfig } from "@chitragupta/core";

describe("Tenant (Kshetra)", () => {
	describe("DEFAULT_TENANT", () => {
		it("should have tenantId 'default'", () => {
			expect(DEFAULT_TENANT.tenantId).toBe("default");
		});

		it("should have wildcard features", () => {
			expect(DEFAULT_TENANT.features.has("*")).toBe(true);
		});

		it("should have reasonable defaults", () => {
			expect(DEFAULT_TENANT.rateLimit).toBe(60);
			expect(DEFAULT_TENANT.tokenBudget).toBe(Infinity);
			expect(DEFAULT_TENANT.maxAgents).toBe(10);
		});
	});

	describe("InMemoryTenantStore", () => {
		let store: InMemoryTenantStore;

		beforeEach(() => {
			store = new InMemoryTenantStore();
		});

		it("should be seeded with the default tenant", async () => {
			const tenant = await store.getTenant("default");
			expect(tenant).not.toBeNull();
			expect(tenant!.tenantId).toBe("default");
			expect(tenant!.tokensUsed).toBe(0);
			expect(tenant!.requestCount).toBe(0);
		});

		it("should create a new tenant", async () => {
			const config: TenantConfig = {
				tenantId: "acme",
				name: "Acme Corp",
				features: new Set(["chat", "memory"]),
				rateLimit: 100,
				tokenBudget: 1_000_000,
				maxAgents: 5,
			};

			const created = await store.createTenant(config);
			expect(created.tenantId).toBe("acme");
			expect(created.name).toBe("Acme Corp");
			expect(created.features.has("chat")).toBe(true);
			expect(created.tokensUsed).toBe(0);
			expect(created.createdAt).toBeTruthy();
		});

		it("should reject duplicate tenant creation", async () => {
			const config: TenantConfig = {
				tenantId: "default",
				name: "Duplicate",
				features: new Set(),
				rateLimit: 10,
				tokenBudget: 100,
				maxAgents: 1,
			};

			await expect(store.createTenant(config)).rejects.toThrow("Tenant already exists");
		});

		it("should list all tenants", async () => {
			await store.createTenant({
				tenantId: "t1",
				name: "T1",
				features: new Set(),
				rateLimit: 10,
				tokenBudget: 100,
				maxAgents: 1,
			});

			const tenants = await store.listTenants();
			expect(tenants.length).toBeGreaterThanOrEqual(2); // default + t1
		});

		it("should update a tenant", async () => {
			const updated = await store.updateTenant("default", { name: "Updated Default" });
			expect(updated).not.toBeNull();
			expect(updated!.name).toBe("Updated Default");
		});

		it("should return null when updating nonexistent tenant", async () => {
			const result = await store.updateTenant("nonexistent", { name: "X" });
			expect(result).toBeNull();
		});

		it("should delete a tenant", async () => {
			await store.createTenant({
				tenantId: "to-delete",
				name: "Delete Me",
				features: new Set(),
				rateLimit: 10,
				tokenBudget: 100,
				maxAgents: 1,
			});

			const deleted = await store.deleteTenant("to-delete");
			expect(deleted).toBe(true);

			const result = await store.getTenant("to-delete");
			expect(result).toBeNull();
		});

		it("should not delete the default tenant", async () => {
			const deleted = await store.deleteTenant("default");
			expect(deleted).toBe(false);

			const tenant = await store.getTenant("default");
			expect(tenant).not.toBeNull();
		});

		it("should track request usage", () => {
			store.recordRequest("default", 100);
			store.recordRequest("default", 50);

			// Verify by getting tenant
			store.getTenant("default").then((tenant) => {
				expect(tenant!.requestCount).toBe(2);
				expect(tenant!.tokensUsed).toBe(150);
			});
		});

		it("should detect over-budget tenants", async () => {
			await store.createTenant({
				tenantId: "budget-test",
				name: "Budget Test",
				features: new Set(),
				rateLimit: 10,
				tokenBudget: 100,
				maxAgents: 1,
			});

			expect(store.isOverBudget("budget-test")).toBe(false);

			store.recordRequest("budget-test", 100);
			expect(store.isOverBudget("budget-test")).toBe(true);
		});

		it("should return over-budget for nonexistent tenant", () => {
			expect(store.isOverBudget("nonexistent")).toBe(true);
		});
	});
});
