/**
 * Niyama-RBAC — Role-Based Access Control engine.
 * Sanskrit: Niyama (नियम) = rule, discipline.
 *
 * Defines permissions, roles, and route-permission mappings for
 * the Chitragupta API. Designed to be composable and extensible:
 * built-in roles ship by default, custom roles can be added.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * A permission string in the format `"action:resource"`.
 * Examples: `"read:session"`, `"write:memory"`, `"admin:agents"`.
 */
export type Permission = string;

/** Definition of a role with a name, description, and permission set. */
export interface RoleDefinition {
	/** Unique role name (e.g. "admin", "viewer"). */
	name: string;
	/** Human-readable description. */
	description: string;
	/** Set of permissions granted to this role. */
	permissions: Set<Permission>;
}

// ─── Built-in Permissions ────────────────────────────────────────────────────

/** All known permissions in the system. */
export const PERMISSIONS = {
	// Session
	READ_SESSION: "read:session" as Permission,
	WRITE_SESSION: "write:session" as Permission,

	// Chat
	READ_CHAT: "read:chat" as Permission,
	WRITE_CHAT: "write:chat" as Permission,

	// Jobs
	READ_JOBS: "read:jobs" as Permission,
	WRITE_JOBS: "write:jobs" as Permission,

	// Agents
	READ_AGENTS: "read:agents" as Permission,
	WRITE_AGENTS: "write:agents" as Permission,
	ADMIN_AGENTS: "admin:agents" as Permission,

	// Memory
	READ_MEMORY: "read:memory" as Permission,
	WRITE_MEMORY: "write:memory" as Permission,
	DELETE_MEMORY: "delete:memory" as Permission,

	// Metrics
	READ_METRICS: "read:metrics" as Permission,

	// Providers & Tools
	READ_PROVIDERS: "read:providers" as Permission,
	READ_TOOLS: "read:tools" as Permission,

	// Admin
	ADMIN_SYSTEM: "admin:system" as Permission,
} as const;

/** Wildcard permission that grants everything. */
const WILDCARD_PERMISSION: Permission = "*";

// ─── Built-in Roles ─────────────────────────────────────────────────────────

/** All permissions as a flat array (for constructing the admin set). */
const ALL_PERMISSIONS = new Set<Permission>(Object.values(PERMISSIONS));
ALL_PERMISSIONS.add(WILDCARD_PERMISSION);

/** Admin: unrestricted access. */
const ADMIN_ROLE: RoleDefinition = {
	name: "admin",
	description: "Full system access. All permissions granted.",
	permissions: new Set([WILDCARD_PERMISSION]),
};

/** Operator: read + write, no admin actions. */
const OPERATOR_ROLE: RoleDefinition = {
	name: "operator",
	description: "Read and write access to sessions, chat, jobs, agents, and memory.",
	permissions: new Set<Permission>([
		PERMISSIONS.READ_SESSION,
		PERMISSIONS.WRITE_SESSION,
		PERMISSIONS.READ_CHAT,
		PERMISSIONS.WRITE_CHAT,
		PERMISSIONS.READ_JOBS,
		PERMISSIONS.WRITE_JOBS,
		PERMISSIONS.READ_AGENTS,
		PERMISSIONS.WRITE_AGENTS,
		PERMISSIONS.READ_MEMORY,
		PERMISSIONS.WRITE_MEMORY,
		PERMISSIONS.DELETE_MEMORY,
		PERMISSIONS.READ_METRICS,
		PERMISSIONS.READ_PROVIDERS,
		PERMISSIONS.READ_TOOLS,
	]),
};

/** Viewer: read-only access. */
const VIEWER_ROLE: RoleDefinition = {
	name: "viewer",
	description: "Read-only access to sessions, agents, memory, and metrics.",
	permissions: new Set<Permission>([
		PERMISSIONS.READ_SESSION,
		PERMISSIONS.READ_CHAT,
		PERMISSIONS.READ_JOBS,
		PERMISSIONS.READ_AGENTS,
		PERMISSIONS.READ_MEMORY,
		PERMISSIONS.READ_METRICS,
		PERMISSIONS.READ_PROVIDERS,
		PERMISSIONS.READ_TOOLS,
	]),
};

/** Agent: limited API access for programmatic use by sub-agents. */
const AGENT_ROLE: RoleDefinition = {
	name: "agent",
	description: "Limited API access for programmatic sub-agent use.",
	permissions: new Set<Permission>([
		PERMISSIONS.READ_SESSION,
		PERMISSIONS.WRITE_CHAT,
		PERMISSIONS.READ_AGENTS,
		PERMISSIONS.READ_MEMORY,
		PERMISSIONS.WRITE_MEMORY,
		PERMISSIONS.READ_TOOLS,
	]),
};

/** The four built-in roles, exported for reference. */
export const BUILT_IN_ROLES: readonly RoleDefinition[] = [
	ADMIN_ROLE,
	OPERATOR_ROLE,
	VIEWER_ROLE,
	AGENT_ROLE,
];

// ─── Route → Permission Mapping ──────────────────────────────────────────────

/**
 * Maps `"METHOD /path/pattern"` to the required permission.
 *
 * Routes not listed here (or mapped to `null`) are public
 * (no authorization check required — only authentication).
 */
export const ROUTE_PERMISSIONS: ReadonlyMap<string, Permission | null> = new Map<string, Permission | null>([
	// Public
	["GET /api/health", null],

	// Sessions
	["GET /api/sessions", PERMISSIONS.READ_SESSION],
	["GET /api/sessions/:id", PERMISSIONS.READ_SESSION],
	["POST /api/sessions", PERMISSIONS.WRITE_SESSION],

	// Chat
	["POST /api/chat", PERMISSIONS.WRITE_CHAT],

	// Jobs
	["GET /api/jobs", PERMISSIONS.READ_JOBS],
	["GET /api/jobs/stats", PERMISSIONS.READ_JOBS],
	["GET /api/jobs/:id", PERMISSIONS.READ_JOBS],
	["POST /api/jobs", PERMISSIONS.WRITE_JOBS],
	["POST /api/jobs/:id/cancel", PERMISSIONS.WRITE_JOBS],

	// Agents
	["GET /api/agents", PERMISSIONS.READ_AGENTS],
	["GET /api/agents/tree", PERMISSIONS.READ_AGENTS],
	["GET /api/agents/stats", PERMISSIONS.READ_AGENTS],
	["GET /api/agents/:id", PERMISSIONS.READ_AGENTS],
	["GET /api/agents/:id/tree", PERMISSIONS.READ_AGENTS],
	["POST /api/agents/:id/spawn", PERMISSIONS.WRITE_AGENTS],
	["POST /api/agents/:id/abort", PERMISSIONS.ADMIN_AGENTS],
	["POST /api/agents/:id/prompt", PERMISSIONS.WRITE_AGENTS],
	["GET /api/agent/status", PERMISSIONS.READ_AGENTS],
	["POST /api/agent/reset", PERMISSIONS.ADMIN_AGENTS],

	// Memory
	["GET /api/memory/scopes", PERMISSIONS.READ_MEMORY],
	["GET /api/memory/:scope", PERMISSIONS.READ_MEMORY],
	["PUT /api/memory/:scope", PERMISSIONS.WRITE_MEMORY],
	["POST /api/memory/:scope", PERMISSIONS.WRITE_MEMORY],
	["POST /api/memory/search", PERMISSIONS.READ_MEMORY],
	["DELETE /api/memory/:scope", PERMISSIONS.DELETE_MEMORY],

	// Providers & Tools
	["GET /api/providers", PERMISSIONS.READ_PROVIDERS],
	["GET /api/tools", PERMISSIONS.READ_TOOLS],

	// Auth (public — these handle their own auth)
	["POST /api/auth/token", null],
	["POST /api/auth/refresh", null],
	["GET /api/auth/me", null],
]);

// ─── RBAC Engine ─────────────────────────────────────────────────────────────

export class RBACEngine {
	private roles: Map<string, RoleDefinition> = new Map();

	constructor(roles?: RoleDefinition[]) {
		const initial = roles ?? [...BUILT_IN_ROLES];
		for (const role of initial) {
			this.roles.set(role.name, role);
		}
	}

	/**
	 * Check whether any of the user's roles grants the given permission.
	 */
	authorize(userRoles: string[], permission: Permission): boolean {
		for (const roleName of userRoles) {
			const role = this.roles.get(roleName);
			if (!role) continue;

			// Wildcard grants everything
			if (role.permissions.has(WILDCARD_PERMISSION)) return true;
			if (role.permissions.has(permission)) return true;
		}
		return false;
	}

	/**
	 * Check whether the user has a specific role.
	 */
	hasRole(userRoles: string[], roleName: string): boolean {
		return userRoles.includes(roleName);
	}

	/**
	 * Get the permission set for a named role.
	 * Returns an empty set if the role is not found.
	 */
	getPermissions(roleName: string): Set<Permission> {
		return this.roles.get(roleName)?.permissions ?? new Set();
	}

	/**
	 * Add or replace a role definition.
	 */
	addRole(role: RoleDefinition): void {
		this.roles.set(role.name, role);
	}

	/**
	 * List all registered roles.
	 */
	listRoles(): RoleDefinition[] {
		return Array.from(this.roles.values());
	}

	/**
	 * Look up the required permission for a route.
	 *
	 * Tries exact match first, then pattern match (replacing path
	 * segments with `:param` placeholders).
	 *
	 * Returns `null` for public routes, the permission string
	 * for protected routes, or `undefined` if no mapping exists
	 * (defaults to requiring auth but no specific permission).
	 */
	resolveRoutePermission(method: string, path: string): Permission | null | undefined {
		// Exact match
		const exact = `${method} ${path}`;
		if (ROUTE_PERMISSIONS.has(exact)) {
			return ROUTE_PERMISSIONS.get(exact)!;
		}

		// Pattern match: try replacing trailing path segments with :param
		const segments = path.split("/").filter(Boolean);
		for (const [routeKey, permission] of ROUTE_PERMISSIONS) {
			const [routeMethod, routePattern] = routeKey.split(" ");
			if (routeMethod !== method) continue;

			const routeSegments = routePattern.split("/").filter(Boolean);
			if (routeSegments.length !== segments.length) continue;

			let matched = true;
			for (let i = 0; i < routeSegments.length; i++) {
				if (routeSegments[i].startsWith(":")) continue; // wildcard segment
				if (routeSegments[i] !== segments[i]) {
					matched = false;
					break;
				}
			}

			if (matched) return permission;
		}

		return undefined;
	}
}
