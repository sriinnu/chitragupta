// @chitragupta/core — Foundation
export * from "./types.js";
export * from "./errors.js";
export { createEventBus } from "./events.js";
export { createPluginRegistry } from "./plugin.js";
export {
	createConfig,
	cascadeConfigs,
	getChitraguptaHome,
	loadGlobalSettings,
	saveGlobalSettings,
	loadProjectConfig,
	deepSet,
} from "./config.js";
export { CHITRAGUPTA_PROFILE, MINIMAL_PROFILE, FRIENDLY_PROFILE, KARTRU_PROFILE, PARIKSHAKA_PROFILE, ANVESHI_PROFILE, SHODHAKA_PROFILE, PARIKARTRU_PROFILE, LEKHAKA_PROFILE, BUILT_IN_PROFILES, resolveProfile } from "./agent-profile.js";

// Validation (Niyama)
export { v, validate, assertValid } from "./validation.js";
export type { ValidatorFn, ValidationError, ValidationResult } from "./validation.js";

// Authentication & Authorization (Kavacham)
export * from "./auth/index.js";

// Observability (Drishti)
export * from "./observability/index.js";
