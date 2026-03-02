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

import fs from "node:fs";
import path from "node:path";
import { getChitraguptaHome } from "@chitragupta/core";
import type { RpcRouter } from "./rpc-router.js";

/**
 * Scan heartbeat files from a directory, filtering out stale entries.
 *
 * @param dir - Directory containing heartbeat JSON files.
 * @param staleMs - Maximum age in ms for a heartbeat to be considered alive.
 * @returns Array of parsed heartbeat records.
 */
function scanHeartbeatDir(dir: string, staleMs: number): Record<string, unknown>[] {
	if (!fs.existsSync(dir)) return [];
	const now = Date.now();
	const results: Record<string, unknown>[] = [];
	try {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.startsWith(".tmp-")) continue;
			try {
				const fp = path.join(dir, entry.name);
				const stat = fs.statSync(fp);
				if (now - stat.mtimeMs > staleMs) continue;
				results.push(JSON.parse(fs.readFileSync(fp, "utf-8")) as Record<string, unknown>);
			} catch { /* skip corrupt files */ }
		}
	} catch { /* dir unreadable */ }
	return results;
}

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
		const dir = path.join(getChitraguptaHome(), "telemetry", "instances");
		const instances = scanHeartbeatDir(dir, staleMs);
		return { instances, count: instances.length, timestamp: Date.now() };
	}, "Scan live MCP instances from heartbeat files");
}
