import type { McpServerAuthConfig } from "@chitragupta/tantra";
import { createDaemonServerAuth } from "@chitragupta/daemon";
import type { AuthScope } from "@chitragupta/dharma";

function hasScope(scopes: readonly string[], scope: AuthScope): boolean {
	return scopes.includes("admin") || scopes.includes(scope);
}

function authorizeMcpMethod(method: string, scopes: readonly string[]): {
	allowed: boolean;
	requiredScope?: AuthScope;
	error?: string;
} {
	if (method === "tools/call") {
		return hasScope(scopes, "tools") || hasScope(scopes, "write")
			? { allowed: true }
			: { allowed: false, requiredScope: "tools" };
	}

	if (
		method === "initialize"
		|| method === "notifications/initialized"
		|| method === "ping"
		|| method === "tools/list"
		|| method === "resources/list"
		|| method === "resources/read"
		|| method === "prompts/list"
		|| method === "prompts/get"
	) {
		return hasScope(scopes, "read")
			? { allowed: true }
			: { allowed: false, requiredScope: "read" };
	}

	return hasScope(scopes, "read")
		? { allowed: true }
		: { allowed: false, requiredScope: "read" };
}

export function createMcpSseAuthConfig(): McpServerAuthConfig {
	const daemonAuth = createDaemonServerAuth();
	return {
		required: daemonAuth.required,
		validateToken: (token) => {
			const result = daemonAuth.validateToken(token);
			return {
				authenticated: result.authenticated,
				keyId: result.keyId,
				tenantId: result.tenantId,
				scopes: result.scopes,
				error: result.error,
			};
		},
		authorizeMethod: (method, context) => authorizeMcpMethod(method, context.scopes),
		rateLimit: daemonAuth.requestRateLimit
			? {
				maxRequests: daemonAuth.requestRateLimit.maxRequests,
				windowMs: daemonAuth.requestRateLimit.windowMs,
				exemptMethods: [...daemonAuth.requestRateLimit.exemptMethods],
			}
			: undefined,
	};
}

export function createMcpStreamableHttpAuthConfig(): McpServerAuthConfig {
	return {
		...createMcpSseAuthConfig(),
		allowQueryToken: false,
	};
}
