/**
 * @chitragupta/daemon — Telemetry RPC service methods.
 *
 * Registers telemetry.scan RPC method on the router.
 * Scans heartbeat files from ~/.chitragupta/telemetry/instances/
 * to discover live MCP instances.
 *
 * Extracted from services.ts to respect the 450 LOC limit.
 *
 * @module
 */

import type { RpcRouter } from "./rpc-router.js";
import { scanTelemetryInstances } from "./telemetry-files.js";

/**
 * Parse a non-negative integer from an unknown value.
 *
 * @param value - Value to parse.
 * @param field - Field name for error messages.
 * @param fallback - Default value if null/undefined.
 * @returns Parsed non-negative integer.
 */
function parseNonNegativeInt(value: unknown, field: string, fallback = 0): number {
	const parsed = value == null ? fallback : Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error(`Invalid ${field}`);
	}
	return Math.trunc(parsed);
}

/**
 * Register telemetry RPC methods on the router.
 *
 * Methods:
 * - `telemetry.scan` — Scan live MCP instances from heartbeat files.
 *
 * @param router - RPC router to register methods on.
 */
export function registerTelemetryMethods(router: RpcRouter): void {
	router.register("telemetry.scan", async (params) => {
		const staleMs = parseNonNegativeInt(params.staleMs, "staleMs", 10_000);
		const cleanup = params.cleanup !== false;
		const result = scanTelemetryInstances({
			staleMs,
			cleanupStale: cleanup,
			cleanupCorrupt: cleanup,
			cleanupOrphan: cleanup,
		});
		return {
			instances: result.instances,
			count: result.instances.length,
			cleanup: {
				removedStale: result.removedStale,
				removedCorrupt: result.removedCorrupt,
				removedOrphan: result.removedOrphan,
			},
			timestamp: Date.now(),
		};
	}, "Scan live MCP instances from heartbeat files");
}
