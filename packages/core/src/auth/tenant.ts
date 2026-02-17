/**
 * Kshetra-Tenant — Multi-tenant isolation layer.
 * Sanskrit: Kshetra (क्षेत्र) = field, domain, territory.
 *
 * Provides tenant configuration, context tracking, and an
 * in-memory store for development/testing. A persistent store
 * (e.g. SQLite, PostgreSQL) can implement TenantStore for production.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TenantConfig {
	/** Unique tenant identifier. */
	tenantId: string;
	/** Human-readable tenant name. */
	name: string;
	/** Feature flags enabled for this tenant. */
	features: Set<string>;
	/** Requests per minute limit for this tenant. Default: 60. */
	rateLimit: number;
	/** Maximum token budget (across all users). Default: Infinity. */
	tokenBudget: number;
	/** Maximum number of active agents. Default: 10. */
	maxAgents: number;
}

export interface TenantContext extends TenantConfig {
	/** Total tokens consumed by this tenant. */
	tokensUsed: number;
	/** Total API requests made by this tenant. */
	requestCount: number;
	/** Timestamp of tenant creation (ISO string). */
	createdAt: string;
	/** Timestamp of last activity (ISO string). */
	lastActiveAt: string;
}

/** Storage interface for tenant data. */
export interface TenantStore {
	getTenant(id: string): Promise<TenantContext | null>;
	listTenants(): Promise<TenantContext[]>;
	createTenant(config: TenantConfig): Promise<TenantContext>;
	updateTenant(id: string, update: Partial<TenantConfig>): Promise<TenantContext | null>;
	deleteTenant(id: string): Promise<boolean>;
}

// ─── Default Tenant ──────────────────────────────────────────────────────────

/** Default tenant for single-user / backward-compatible mode. */
export const DEFAULT_TENANT: TenantConfig = {
	tenantId: "default",
	name: "Default",
	features: new Set(["*"]), // all features
	rateLimit: 60,
	tokenBudget: Infinity,
	maxAgents: 10,
};

// ─── In-Memory Tenant Store ──────────────────────────────────────────────────

/**
 * In-memory tenant store for development and testing.
 *
 * Data is lost on process restart. For production, implement
 * TenantStore backed by a persistent database.
 */
export class InMemoryTenantStore implements TenantStore {
	private tenants: Map<string, TenantContext> = new Map();

	constructor() {
		// Seed with the default tenant
		const now = new Date().toISOString();
		this.tenants.set(DEFAULT_TENANT.tenantId, {
			...DEFAULT_TENANT,
			features: new Set(DEFAULT_TENANT.features),
			tokensUsed: 0,
			requestCount: 0,
			createdAt: now,
			lastActiveAt: now,
		});
	}

	async getTenant(id: string): Promise<TenantContext | null> {
		return this.tenants.get(id) ?? null;
	}

	async listTenants(): Promise<TenantContext[]> {
		return Array.from(this.tenants.values());
	}

	async createTenant(config: TenantConfig): Promise<TenantContext> {
		if (this.tenants.has(config.tenantId)) {
			throw new Error(`Tenant already exists: ${config.tenantId}`);
		}

		const now = new Date().toISOString();
		const context: TenantContext = {
			...config,
			features: new Set(config.features),
			tokensUsed: 0,
			requestCount: 0,
			createdAt: now,
			lastActiveAt: now,
		};

		this.tenants.set(config.tenantId, context);
		return context;
	}

	async updateTenant(id: string, update: Partial<TenantConfig>): Promise<TenantContext | null> {
		const existing = this.tenants.get(id);
		if (!existing) return null;

		if (update.name !== undefined) existing.name = update.name;
		if (update.features !== undefined) existing.features = new Set(update.features);
		if (update.rateLimit !== undefined) existing.rateLimit = update.rateLimit;
		if (update.tokenBudget !== undefined) existing.tokenBudget = update.tokenBudget;
		if (update.maxAgents !== undefined) existing.maxAgents = update.maxAgents;

		existing.lastActiveAt = new Date().toISOString();
		return existing;
	}

	async deleteTenant(id: string): Promise<boolean> {
		// Prevent deleting the default tenant
		if (id === "default") return false;
		return this.tenants.delete(id);
	}

	/** Record a request for usage tracking. */
	recordRequest(tenantId: string, tokensUsed: number = 0): void {
		const tenant = this.tenants.get(tenantId);
		if (!tenant) return;
		tenant.requestCount++;
		tenant.tokensUsed += tokensUsed;
		tenant.lastActiveAt = new Date().toISOString();
	}

	/** Check whether a tenant has exceeded its token budget. */
	isOverBudget(tenantId: string): boolean {
		const tenant = this.tenants.get(tenantId);
		if (!tenant) return true;
		return tenant.tokensUsed >= tenant.tokenBudget;
	}
}
