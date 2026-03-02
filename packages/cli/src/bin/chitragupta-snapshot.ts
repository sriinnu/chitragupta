#!/usr/bin/env node
/**
 * chitragupta-snapshot — Aggregate all live MCP instances into a single JSON snapshot.
 *
 * Usage:
 *   chitragupta-snapshot              # Pretty-print all live instances
 *   chitragupta-snapshot --json       # Machine-readable JSON output
 *   chitragupta-snapshot --stale 15   # Custom stale threshold (seconds)
 *
 * Reads heartbeat files from ~/.chitragupta/telemetry/instances/ and
 * filters out stale entries (default: 10s without update).
 *
 * @module
 */

import { scanHeartbeats, computeFingerprint, getTelemetryDir } from "../modes/mcp-telemetry.js";
import type { HeartbeatData } from "../modes/mcp-telemetry.js";

/** Aggregated snapshot of all live instances. */
interface SnapshotResult {
	timestamp: string;
	fingerprint: string;
	telemetryDir: string;
	instanceCount: number;
	instances: HeartbeatData[];
}

/**
 * Parse CLI arguments.
 *
 * @param argv - process.argv array.
 * @returns Parsed flags.
 */
function parseArgs(argv: string[]): { json: boolean; staleSeconds: number } {
	let json = false;
	let staleSeconds = 10;
	for (let i = 2; i < argv.length; i++) {
		if (argv[i] === "--json") json = true;
		else if (argv[i] === "--stale" && i + 1 < argv.length) {
			staleSeconds = Math.max(1, parseInt(argv[++i], 10) || 10);
		}
	}
	return { json, staleSeconds };
}

/**
 * Format uptime seconds into a human-readable short string.
 *
 * @param seconds - Uptime in seconds.
 * @returns Formatted string (e.g. "42s", "5m", "1.2h").
 */
function formatUptime(seconds: number): string {
	if (seconds < 60) return `${Math.round(seconds)}s`;
	if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
	return `${(seconds / 3600).toFixed(1)}h`;
}

/** Main entry point. */
function main(): void {
	const { json, staleSeconds } = parseArgs(process.argv);
	const staleMs = staleSeconds * 1000;
	const instances = scanHeartbeats(staleMs);
	const fingerprint = computeFingerprint(instances);

	const snapshot: SnapshotResult = {
		timestamp: new Date().toISOString(),
		fingerprint,
		telemetryDir: getTelemetryDir(),
		instanceCount: instances.length,
		instances,
	};

	if (json) {
		process.stdout.write(JSON.stringify(snapshot, null, 2) + "\n");
		return;
	}

	// Human-readable output
	console.log(`Chitragupta Instances (${instances.length} live)\n`);
	console.log(`  Telemetry: ${snapshot.telemetryDir}`);
	console.log(`  Fingerprint: ${fingerprint}`);
	console.log(`  Stale threshold: ${staleSeconds}s\n`);

	if (instances.length === 0) {
		console.log("  No live instances found.");
		return;
	}

	for (const inst of instances) {
		const age = formatUptime(inst.uptime);
		const state = inst.state.toUpperCase();
		const session = inst.sessionId ? inst.sessionId.slice(0, 8) : "none";
		console.log(`  PID ${inst.pid}  ${state}  up ${age}  session=${session}  tools=${inst.toolCallCount}  turns=${inst.turnCount}`);
		console.log(`    workspace: ${inst.workspace}`);
		if (inst.model) console.log(`    model: ${inst.model}`);
		console.log();
	}
}

main();
