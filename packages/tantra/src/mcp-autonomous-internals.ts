/**
 * @chitragupta/tantra — Autonomous MCP Manager internal operations.
 *
 * Event handling, server integration, health scoring, crash tracking,
 * and quarantine management. Extracted from mcp-autonomous.ts.
 */

import type { McpServerRegistry } from "./server-registry.js";
import type {
	McpRemoteServerConfig,
	ManagedServerInfo,
	RegistryEvent,
} from "./registry-types.js";
import type {
	AutonomousMcpConfig,
	SkillGeneratorCallback,
	QuarantineInfo,
} from "./mcp-autonomous-types.js";
import type { CircuitBreaker } from "./mcp-circuit-breaker.js";

/** Shared state for internal manager operations. */
export interface ManagerInternals {
	registry: McpServerRegistry;
	circuitBreaker: CircuitBreaker;
	healthScores: Map<string, number>;
	quarantine: Map<string, QuarantineInfo>;
	crashTimestamps: Map<string, number[]>;
	knownServerIds: Set<string>;
	skillCallback?: SkillGeneratorCallback;
	config: Required<AutonomousMcpConfig>;
	running: boolean;
}

function quarantineRetryDelayMs(config: Required<AutonomousMcpConfig>): number {
	return Math.max(1_000, Math.min(config.discoveryIntervalMs, 5_000));
}

function releaseRecoveredServer(serverId: string, state: ManagerInternals): void {
	state.quarantine.delete(serverId);
	state.crashTimestamps.delete(serverId);
	state.circuitBreaker.remove(serverId);
	refreshHealthScore(serverId, state);
}

function scheduleQuarantineRetry(
	serverId: string,
	state: ManagerInternals,
): void {
	const info = state.quarantine.get(serverId);
	if (!info) return;

	info.restartPending = false;
	info.releaseAt = Date.now() + quarantineRetryDelayMs(state.config);
}

function recoverQuarantinedServer(
	serverId: string,
	state: ManagerInternals,
): void {
	const quarantineInfo = state.quarantine.get(serverId);
	if (!quarantineInfo || quarantineInfo.restartPending) return;

	const server = state.registry.getServer(serverId);
	if (!server) {
		state.quarantine.delete(serverId);
		state.crashTimestamps.delete(serverId);
		state.circuitBreaker.remove(serverId);
		state.knownServerIds.delete(serverId);
		return;
	}

	if (
		server.state === "ready" ||
		server.state === "starting" ||
		server.state === "restarting"
	) {
		releaseRecoveredServer(serverId, state);
		return;
	}

	if (server.state === "stopping") {
		scheduleQuarantineRetry(serverId, state);
		return;
	}

	quarantineInfo.restartPending = true;
	quarantineInfo.restartAttempts = (quarantineInfo.restartAttempts ?? 0) + 1;
	quarantineInfo.lastRestartAttemptAt = Date.now();

	const recovery = server.state === "error"
		? state.registry.restartServer(serverId)
		: state.registry.startServer(serverId).then(() => undefined);

	recovery
		.then(() => {
			releaseRecoveredServer(serverId, state);
		})
		.catch(() => {
			scheduleQuarantineRetry(serverId, state);
		});
}

/** Handle a registry event for health tracking and crash detection. */
export function handleRegistryEvent(
	event: RegistryEvent,
	state: ManagerInternals,
): void {
	switch (event.type) {
		case "server:state-changed": {
			const server = state.registry.getServer(event.serverId);
			if (server) updateHealthScore(server, state);
			if (event.to === "error") {
				recordCrash(event.serverId, state);
			}
			if (event.to === "ready") {
				if (state.quarantine.has(event.serverId)) {
					releaseRecoveredServer(event.serverId, state);
				}
				if (server && state.skillCallback) {
					generateSkills(server, state);
				}
			}
			break;
		}
		case "server:error": {
			state.circuitBreaker.recordFailure(event.serverId);
			refreshHealthScore(event.serverId, state);
			break;
		}
		case "server:health-ok": {
			state.circuitBreaker.recordSuccess(event.serverId);
			refreshHealthScore(event.serverId, state);
			break;
		}
		case "server:health-fail": {
			state.circuitBreaker.recordFailure(event.serverId);
			refreshHealthScore(event.serverId, state);
			break;
		}
		case "server:added": {
			state.knownServerIds.add(event.serverId);
			break;
		}
		case "server:removed": {
			state.knownServerIds.delete(event.serverId);
			state.healthScores.delete(event.serverId);
			state.quarantine.delete(event.serverId);
			state.circuitBreaker.remove(event.serverId);
			state.crashTimestamps.delete(event.serverId);
			break;
		}
	}
}

/** Handle discovery events (file watch changes). */
export async function handleDiscoveryEvent(
	event: { type: string; config?: McpRemoteServerConfig },
	state: ManagerInternals,
): Promise<void> {
	if (!event.config) return;
	if (event.type === "removed") {
		if (state.knownServerIds.has(event.config.id)) {
			await state.registry.removeServer(event.config.id);
		}
	} else {
		if (!state.knownServerIds.has(event.config.id)) {
			await integrateServer(event.config, state);
		}
	}
}

/** Integrate a newly discovered server: add to registry, start it, generate skills. */
export async function integrateServer(
	config: McpRemoteServerConfig,
	state: ManagerInternals,
): Promise<void> {
	try {
		const info = await state.registry.addServer(config, true);
		state.knownServerIds.add(config.id);
		updateHealthScore(info, state);
		if (state.skillCallback && info.tools.length > 0) {
			generateSkills(info, state);
		}
	} catch {
		// Server failed to start; normal lifecycle handling will manage retries
	}
}

/** Generate skills from a server tools via the callback. */
export function generateSkills(
	server: ManagedServerInfo,
	state: ManagerInternals,
): void {
	if (!state.skillCallback || server.tools.length === 0) return;
	const toolDefs = server.tools.map((t) => ({
		name: t.name,
		description: t.description,
		inputSchema: t.inputSchema,
	}));
	try {
		state.skillCallback.generateAndRegister(toolDefs);
	} catch {
		// Skill generation failures should not break server management
	}
}

/**
 * Compute and store health score for a server.
 *
 * health = uptimeScore * 0.4 + successRate * 0.3 + latencyScore * 0.3
 */
export function updateHealthScore(
	server: ManagedServerInfo,
	state: ManagerInternals,
): void {
	const stats = server.stats;
	const uptimeHours = stats.uptime / (1000 * 60 * 60);
	const uptimeScore = Math.min(1, uptimeHours / 24);
	const successRate = stats.totalCalls > 0
		? 1 - (stats.totalErrors / stats.totalCalls)
		: 1.0;
	const latencyScore = stats.averageLatency > 0
		? 1 / (1 + stats.averageLatency / 1000)
		: 1.0;
	const health = uptimeScore * 0.4 + successRate * 0.3 + latencyScore * 0.3;
	state.healthScores.set(server.config.id, Math.max(0, Math.min(1, health)));
}

/** Refresh health score from registry data. */
export function refreshHealthScore(
	serverId: string,
	state: ManagerInternals,
): void {
	const server = state.registry.getServer(serverId);
	if (server) updateHealthScore(server, state);
}

/** Record a server crash. Quarantine if too many crashes in window. */
export function recordCrash(
	serverId: string,
	state: ManagerInternals,
): void {
	if (state.quarantine.has(serverId)) return;

	const now = Date.now();
	const timestamps = state.crashTimestamps.get(serverId) ?? [];
	timestamps.push(now);
	const cutoff = now - state.config.quarantineCrashWindowMs;
	const recent = timestamps.filter((t) => t >= cutoff);
	state.crashTimestamps.set(serverId, recent);
	if (recent.length >= state.config.quarantineMaxCrashes) {
		quarantineServer(
			serverId,
			`${recent.length} crashes in ${state.config.quarantineCrashWindowMs / 1000}s window`,
			recent,
			state,
		);
	}
}

/** Place a server in quarantine. */
export function quarantineServer(
	serverId: string,
	reason: string,
	crashTimestamps: number[],
	state: ManagerInternals,
): void {
	const now = Date.now();
	state.quarantine.set(serverId, {
		serverId,
		reason,
		quarantinedAt: now,
		releaseAt: now + state.config.quarantineDurationMs,
		crashTimestamps,
		restartPending: false,
		restartAttempts: 0,
	});
	state.registry.stopServer(serverId).catch(() => {});
}

/** Remove quarantines that have expired. */
export function pruneExpiredQuarantines(
	state: ManagerInternals,
): void {
	const now = Date.now();
	for (const [serverId, info] of state.quarantine) {
		if (info.releaseAt > now) continue;
		recoverQuarantinedServer(serverId, state);
	}
}
