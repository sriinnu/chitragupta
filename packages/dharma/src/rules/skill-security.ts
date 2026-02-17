/**
 * @chitragupta/dharma — Skill-specific security policy rules.
 *
 * Three rules that enforce the Suraksha pipeline's security guarantees
 * at the policy level:
 *
 * 1. **skill-requires-review**: External skills must pass quarantine
 * 2. **skill-network-isolation**: Quarantined skills cannot make network calls
 * 3. **skill-file-sandbox**: Quarantined skills restricted to staging directory
 */

import path from "path";
import { getChitraguptaHome } from "@chitragupta/core";
import type { PolicyRule, PolicyAction, PolicyContext, PolicyVerdict } from "../types.js";

// ─── Rule 1: Skill Requires Review ─────────────────────────────────────────

/**
 * External skills must pass through the Suraksha quarantine pipeline
 * before being registered in the live skill registry.
 *
 * Blocks `skill_register` actions when the source is external and
 * the skill has not been approved through quarantine.
 */
export const skillRequiresReview: PolicyRule = {
	id: "skill-security.requires-review",
	name: "Skill Requires Review",
	description: "External skills must pass quarantine review before registration",
	severity: "error",
	category: "security",
	evaluate(action: PolicyAction, _context: PolicyContext): PolicyVerdict {
		// Skill registration is modeled as a tool_call with intent "skill_register"
		const isSkillRegister =
			action.type === "tool_call" &&
			(action.tool === "skill_register" || action.args?.intent === "skill_register");

		if (!isSkillRegister) {
			return { status: "allow", ruleId: this.id, reason: "Not a skill registration action" };
		}

		const source = action.args?.source as string | undefined;
		const approved = action.args?.approved as boolean | undefined;

		// Built-in and trusted sources are allowed without review
		const trustedSources = new Set(["tool", "mcp-server", "plugin"]);
		if (source && trustedSources.has(source)) {
			return { status: "allow", ruleId: this.id, reason: `Trusted source: ${source}` };
		}

		// External sources require explicit approval
		if (!approved) {
			return {
				status: "deny",
				ruleId: this.id,
				reason: "External skill has not been approved through quarantine review",
				suggestion: "Use /skills approve <id> to approve the skill after reviewing the scan report",
			};
		}

		return { status: "allow", ruleId: this.id, reason: "Skill has been approved" };
	},
};

// ─── Rule 2: Skill Network Isolation ────────────────────────────────────────

/** Network-related tool names that quarantined skills should not access. */
const NETWORK_TOOLS = new Set([
	"fetch", "http_request", "https_request", "websocket",
	"net_connect", "dgram", "curl", "wget",
]);

/**
 * Quarantined skills cannot make network calls.
 *
 * When the agent is executing within a quarantine context (flagged via
 * `context.agentId` starting with "quarantine:" or action args containing
 * `quarantine: true`), network-related tool invocations are blocked.
 */
export const skillNetworkIsolation: PolicyRule = {
	id: "skill-security.network-isolation",
	name: "Skill Network Isolation",
	description: "Quarantined skills cannot make network calls",
	severity: "error",
	category: "network",
	evaluate(action: PolicyAction, context: PolicyContext): PolicyVerdict {
		// Check if we're in a quarantine context
		const isQuarantine =
			context.agentId.startsWith("quarantine:") ||
			action.args?.quarantine === true;

		if (!isQuarantine) {
			return { status: "allow", ruleId: this.id, reason: "Not in quarantine context" };
		}

		// Block network tools in quarantine
		if (action.type === "network_request" || NETWORK_TOOLS.has(action.tool ?? "")) {
			return {
				status: "deny",
				ruleId: this.id,
				reason: "Network access is blocked for quarantined skills",
				suggestion: "Remove network calls from the skill or promote it through review first",
			};
		}

		return { status: "allow", ruleId: this.id, reason: "Non-network action allowed in quarantine" };
	},
};

// ─── Rule 3: Skill File Sandbox ─────────────────────────────────────────────

/**
 * Quarantined skills are restricted to their staging directory.
 *
 * When executing in a quarantine context, file operations are confined
 * to the skill's staging subdirectory under ~/.chitragupta/skills/staging/.
 */
export const skillFileSandbox: PolicyRule = {
	id: "skill-security.file-sandbox",
	name: "Skill File Sandbox",
	description: "Quarantined skills restricted to staging directory",
	severity: "error",
	category: "filesystem",
	evaluate(action: PolicyAction, context: PolicyContext): PolicyVerdict {
		// Check if we're in a quarantine context
		const isQuarantine =
			context.agentId.startsWith("quarantine:") ||
			action.args?.quarantine === true;

		if (!isQuarantine) {
			return { status: "allow", ruleId: this.id, reason: "Not in quarantine context" };
		}

		const fileActionTypes = new Set(["file_read", "file_write", "file_delete"]);
		if (!fileActionTypes.has(action.type) || !action.filePath) {
			return { status: "allow", ruleId: this.id, reason: "Not a file operation" };
		}

		const resolvedPath = path.resolve(action.filePath);
		const stagingDir = path.resolve(path.join(getChitraguptaHome(), "skills", "staging"));

		// Allow access within the staging directory only
		if (resolvedPath.startsWith(stagingDir + path.sep) || resolvedPath === stagingDir) {
			return { status: "allow", ruleId: this.id, reason: "File is within skill staging directory" };
		}

		return {
			status: "deny",
			ruleId: this.id,
			reason: `Quarantined skill cannot access "${resolvedPath}" — restricted to "${stagingDir}"`,
			suggestion: "Quarantined skills can only read/write within their staging directory",
		};
	},
};

// ─── Exports ────────────────────────────────────────────────────────────────

/** All skill security rules. */
export const SKILL_SECURITY_RULES: PolicyRule[] = [
	skillRequiresReview,
	skillNetworkIsolation,
	skillFileSandbox,
];
