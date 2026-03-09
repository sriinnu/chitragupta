import type { McpClientAuthConfig, McpServerAuthConfig } from "../types.js";

export interface NormalizedClientAuth {
	token: string;
	headerName: string;
	headerLookup: string;
	queryParam: string;
}

export interface NormalizedServerAuth {
	required: boolean;
	headerName: string;
	headerLookup: string;
	bearerPrefix: string;
	queryParam: string;
	allowQueryToken: boolean;
	validateToken: McpServerAuthConfig["validateToken"];
	authorizeMethod?: McpServerAuthConfig["authorizeMethod"];
	rateLimit?: McpServerAuthConfig["rateLimit"];
}

export function isLoopbackOrigin(origin: string): boolean {
	try {
		const url = new URL(origin);
		const hostname = url.hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
		return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
	} catch {
		return false;
	}
}

export function normalizeClientAuth(auth?: McpClientAuthConfig): NormalizedClientAuth | null {
	if (!auth) return null;
	const headerName = auth.headerName ?? "Authorization";
	return {
		token: auth.token,
		headerName,
		headerLookup: headerName.toLowerCase(),
		queryParam: auth.queryParam ?? "api_key",
	};
}

export function normalizeServerAuth(auth?: McpServerAuthConfig): NormalizedServerAuth | null {
	if (!auth) return null;
	const headerName = auth.headerName ?? "Authorization";
	return {
		required: auth.required ?? true,
		headerName,
		headerLookup: headerName.toLowerCase(),
		bearerPrefix: auth.bearerPrefix ?? "Bearer",
		queryParam: auth.queryParam ?? "api_key",
		allowQueryToken: auth.allowQueryToken ?? true,
		validateToken: auth.validateToken,
		authorizeMethod: auth.authorizeMethod,
		rateLimit: auth.rateLimit,
	};
}

export function applyAuthToUrl(url: URL, auth: NormalizedClientAuth | null): void {
	if (!auth) return;
	if (!url.searchParams.has(auth.queryParam)) {
		url.searchParams.set(auth.queryParam, auth.token);
	}
}

export function buildAuthHeaders(
	auth: NormalizedClientAuth | null,
	headers: Record<string, string | number>,
): Record<string, string | number> {
	if (!auth) return headers;
	return {
		...headers,
		[auth.headerName]: auth.headerLookup === "authorization" ? `Bearer ${auth.token}` : auth.token,
	};
}
