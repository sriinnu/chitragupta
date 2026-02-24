// @chitragupta/core — Foundation

/** Core shared types: ChitraguptaConfig, Plugin, EventBus, and common interfaces. */
export * from "./types.js";
/** Typed error hierarchy: ChitraguptaError, ConfigError, PluginError, etc. */
export * from "./errors.js";
/** Create a typed pub/sub event bus for decoupled inter-module communication. */
export { createEventBus } from "./events.js";
/** Create a plugin registry for loading, ordering, and lifecycle-managing plugins. */
export { createPluginRegistry } from "./plugin.js";
/** Configuration loading, cascading, and persistence for global and project settings. */
export {
	createConfig,
	cascadeConfigs,
	getChitraguptaHome,
	loadGlobalSettings,
	saveGlobalSettings,
	loadProjectConfig,
	deepSet,
} from "./config.js";
/** Built-in agent personality profiles (Kartru, Parikshaka, Anveshi, etc.) with resolution. */
export { CHITRAGUPTA_PROFILE, MINIMAL_PROFILE, FRIENDLY_PROFILE, KARTRU_PROFILE, PARIKSHAKA_PROFILE, ANVESHI_PROFILE, SHODHAKA_PROFILE, PARIKARTRU_PROFILE, LEKHAKA_PROFILE, BUILT_IN_PROFILES, resolveProfile } from "./agent-profile.js";

/** Schema validation with composable validators and assertion helpers. */
export { v, validate, assertValid } from "./validation.js";
export type { ValidatorFn, ValidationError, ValidationResult } from "./validation.js";

/** Authentication and authorization: JWT, RBAC, OAuth, tenant isolation, middleware. */
export * from "./auth/index.js";

/** Observability stack: structured logging, distributed tracing, metrics, and health checks. */
export * from "./observability/index.js";
