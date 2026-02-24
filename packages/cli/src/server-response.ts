/**
 * Standard API response envelope for the Dvaara HTTP server.
 *
 * All API endpoints should use {@link okResponse} and {@link errorResponse}
 * to construct their response bodies, ensuring a consistent contract for
 * consumers (Hub dashboard, Vaayu gateway, external integrations).
 *
 * @module server-response
 */

/** Standard API response envelope. */
export interface ApiResponse<T = unknown> {
	ok: boolean;
	data?: T;
	error?: string;
	meta?: { count?: number; page?: number; total?: number };
}

/**
 * Construct a successful response envelope.
 *
 * @param data - The response payload.
 * @param meta - Optional pagination/count metadata.
 */
export function okResponse<T>(data: T, meta?: ApiResponse["meta"]): ApiResponse<T> {
	return { ok: true, data, ...(meta ? { meta } : {}) };
}

/**
 * Construct an error response envelope.
 *
 * @param message - Human-readable error description.
 */
export function errorResponse(message: string): ApiResponse<never> {
	return { ok: false, error: message };
}
