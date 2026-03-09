import { CircuitBreaker } from "./mcp-circuit-breaker.js";
import type { AutonomousMcpConfig } from "./mcp-autonomous-types.js";
import {
	DEFAULT_DISCOVERY_INTERVAL_MS,
	DEFAULT_HEALTH_THRESHOLD,
	DEFAULT_QUARANTINE_MAX_CRASHES,
	DEFAULT_QUARANTINE_CRASH_WINDOW_MS,
	DEFAULT_QUARANTINE_DURATION_MS,
	DEFAULT_CB_FAILURE_THRESHOLD,
	DEFAULT_CB_WINDOW_MS,
	DEFAULT_CB_COOLDOWN_MS,
} from "./mcp-autonomous-types.js";

export function buildAutonomousConfig(
	config?: AutonomousMcpConfig,
): Required<AutonomousMcpConfig> {
	return {
		discoveryIntervalMs: config?.discoveryIntervalMs ?? DEFAULT_DISCOVERY_INTERVAL_MS,
		discoveryDirectories: config?.discoveryDirectories ?? [],
		healthThreshold: config?.healthThreshold ?? DEFAULT_HEALTH_THRESHOLD,
		quarantineMaxCrashes: config?.quarantineMaxCrashes ?? DEFAULT_QUARANTINE_MAX_CRASHES,
		quarantineCrashWindowMs: config?.quarantineCrashWindowMs ?? DEFAULT_QUARANTINE_CRASH_WINDOW_MS,
		quarantineDurationMs: config?.quarantineDurationMs ?? DEFAULT_QUARANTINE_DURATION_MS,
		circuitBreakerFailureThreshold: config?.circuitBreakerFailureThreshold ?? DEFAULT_CB_FAILURE_THRESHOLD,
		circuitBreakerWindowMs: config?.circuitBreakerWindowMs ?? DEFAULT_CB_WINDOW_MS,
		circuitBreakerCooldownMs: config?.circuitBreakerCooldownMs ?? DEFAULT_CB_COOLDOWN_MS,
	};
}

export function createAutonomousCircuitBreaker(
	config: Required<AutonomousMcpConfig>,
): CircuitBreaker {
	return new CircuitBreaker(
		config.circuitBreakerFailureThreshold,
		config.circuitBreakerWindowMs,
		config.circuitBreakerCooldownMs,
	);
}
