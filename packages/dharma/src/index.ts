// @chitragupta/dharma — Guardrails & Policy Engine
export * from "./types.js";
export { PolicyEngine } from "./engine.js";
export { AuditLogger } from "./audit.js";
export type { AuditQueryFilters } from "./audit.js";

// Built-in rules
export {
	noSecretsInPrompts,
	noDestructiveCommands,
	noSudoWithoutApproval,
	noNetworkExfiltration,
	sandboxFileAccess,
	SECURITY_RULES,
} from "./rules/security.js";

export {
	budgetLimit,
	perCallCostWarning,
	modelCostGuard,
	rateLimitGuard,
	COST_RULES,
} from "./rules/cost.js";

export {
	fileNamingConvention,
	noLargeFiles,
	requireTestsForNewFiles,
	noDirectConsoleLog,
	importOrderConvention,
	CONVENTION_RULES,
} from "./rules/convention.js";

export {
	projectBoundary,
	noModifyLockFiles,
	noModifyGitHistory,
	maxModifiedFiles,
	readOnlyPaths,
	SCOPE_RULES,
} from "./rules/scope.js";

export {
	skillRequiresReview,
	skillNetworkIsolation,
	skillFileSandbox,
	SKILL_SECURITY_RULES,
} from "./rules/skill-security.js";

// Presets
export {
	STRICT_PRESET,
	STANDARD_PRESET,
	PERMISSIVE_PRESET,
	READONLY_PRESET,
	REVIEW_PRESET,
	PRESETS,
} from "./presets.js";
export type { PresetName } from "./presets.js";

// Approval Gate (Dvaara)
export { ApprovalGate } from "./approval-gate.js";
export type {
	ApprovalStatus,
	ApprovalRequest,
	ApprovalGateConfig,
} from "./approval-gate.js";

// Karma Tracker (Punya)
export { KarmaTracker } from "./karma-tracker.js";
export type {
	KarmaEventType,
	KarmaEvent,
	KarmaScore,
	TrustLevel,
} from "./karma-tracker.js";

// Rta Invariant Layer (ऋत — Cosmic Order)
export { RtaEngine } from "./rta.js";
export {
	noCredentialLeak,
	noDestructiveOverwrite,
	noUnboundedRecursion,
	noCostExplosion,
	noDataExfiltration,
	RTA_RULES,
} from "./rta.js";
export type {
	RtaRule,
	RtaContext,
	RtaVerdict,
	RtaAuditEntry,
} from "./rta.js";
