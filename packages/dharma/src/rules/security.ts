/**
 * @chitragupta/dharma — Built-in security rules.
 * Prevent dangerous operations, detect secrets, and sandbox file access.
 */

import path from "path";
import { getChitraguptaHome } from "@chitragupta/core";
import type { PolicyRule, PolicyAction, PolicyContext, PolicyVerdict } from "../types.js";

// ─── Secret Patterns ────────────────────────────────────────────────────────

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
	{ name: "OpenAI API key", pattern: /sk-[A-Za-z0-9]{20,}/ },
	{ name: "GitHub personal access token", pattern: /ghp_[A-Za-z0-9]{36,}/ },
	{ name: "GitHub OAuth token", pattern: /gho_[A-Za-z0-9]{36,}/ },
	{ name: "GitHub App token", pattern: /ghu_[A-Za-z0-9]{36,}/ },
	{ name: "GitHub App refresh token", pattern: /ghr_[A-Za-z0-9]{36,}/ },
	{ name: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/ },
	{ name: "AWS secret key", pattern: /aws[_\-]?secret[_\-]?access[_\-]?key[\s]*[=:]\s*[A-Za-z0-9/+=]{40}/i },
	{ name: "Bearer token", pattern: /[Bb]earer\s+[A-Za-z0-9\-._~+/]+=*/ },
	{ name: "Generic API key assignment", pattern: /(?:api[_\-]?key|apikey|api[_\-]?secret)[\s]*[=:]\s*["']?[A-Za-z0-9]{16,}["']?/i },
	{ name: "Password assignment", pattern: /(?:password|passwd|pwd)[\s]*[=:]\s*["'][^"']{6,}["']/i },
	{ name: "Private key header", pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/ },
	{ name: "Slack token", pattern: /xox[bpors]-[0-9]{10,}-[A-Za-z0-9]{10,}/ },
	{ name: "Stripe API key", pattern: /sk_(?:live|test)_[A-Za-z0-9]{24,}/ },
	{ name: "Anthropic API key", pattern: /sk-ant-[A-Za-z0-9\-]{20,}/ },
];

// ─── Destructive Commands ───────────────────────────────────────────────────

const DESTRUCTIVE_COMMAND_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
	{ name: "rm -rf /", pattern: /rm\s+(?:-\w*)*\s*-(?:\w*r\w*f|\w*f\w*r)\s+\// },
	{ name: "rm -rf root", pattern: /rm\s+(?:-\w*)*\s*-(?:\w*r\w*f|\w*f\w*r)\s+(?:\/\s*$|\/\s+)/ },
	{ name: "mkfs format", pattern: /mkfs(?:\.\w+)?\s/ },
	{ name: "dd overwrite", pattern: /dd\s+if=/ },
	{ name: "fork bomb", pattern: /:\(\)\s*\{\s*:\|:&\s*\}\s*;?\s*:/ },
	{ name: "chmod 777 recursive", pattern: /chmod\s+(?:-R\s+)?777\s/ },
	{ name: "format disk", pattern: /format\s+[A-Za-z]:/ },
	{ name: "delete system files", pattern: /rm\s+(?:-\w+\s+)*\/(?:etc|usr|bin|sbin|boot|var)(?:\/|$|\s)/ },
	{ name: "overwrite MBR", pattern: /dd\s+.*of=\/dev\/[sh]d[a-z]/ },
	{ name: "> /dev/sda", pattern: />\s*\/dev\/[sh]d[a-z]/ },
	{ name: "env variable exfiltration", pattern: /(?:^|\|)\s*(?:env|printenv|set)\b.*\|\s*(?:grep|curl|wget|nc|base64)/ },
];

// ─── Exfiltration Patterns ──────────────────────────────────────────────────

const EXFILTRATION_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
	{ name: "curl upload", pattern: /curl\s+.*(?:-d\s+@|-F\s+.*=@|--data-binary\s+@|--upload-file\s)/ },
	{ name: "curl with file pipe", pattern: /cat\s+.*\|\s*curl/ },
	{ name: "wget post with file", pattern: /wget\s+.*--post-file/ },
	{ name: "pipe to nc", pattern: /\|\s*nc\s/ },
	{ name: "pipe to netcat", pattern: /\|\s*netcat\s/ },
	{ name: "base64 encode and send", pattern: /base64\s+.*\|\s*(?:curl|wget|nc)/ },
];

// ─── Rule Implementations ───────────────────────────────────────────────────

/** Detects API keys, passwords, tokens in content sent to LLMs or written to files. */
export const noSecretsInPrompts: PolicyRule = {
	id: "security.no-secrets-in-prompts",
	name: "No Secrets in Prompts",
	description: "Detects API keys, passwords, tokens, and other secrets in content",
	severity: "error",
	category: "security",
	evaluate(action: PolicyAction, _context: PolicyContext): PolicyVerdict {
		const content = action.content ?? "";
		if (!content) {
			return { status: "allow", ruleId: this.id, reason: "No content to check" };
		}

		for (const { name, pattern } of SECRET_PATTERNS) {
			if (pattern.test(content)) {
				return {
					status: "deny",
					ruleId: this.id,
					reason: `Detected potential secret (${name}) in content`,
					suggestion: "Remove or redact the secret before sending",
				};
			}
		}

		return { status: "allow", ruleId: this.id, reason: "No secrets detected in content" };
	},
};

/** Blocks dangerous/destructive shell commands. */
export const noDestructiveCommands: PolicyRule = {
	id: "security.no-destructive-commands",
	name: "No Destructive Commands",
	description: "Blocks rm -rf /, mkfs, dd if=, fork bombs, chmod 777, and other destructive commands",
	severity: "error",
	category: "execution",
	evaluate(action: PolicyAction, _context: PolicyContext): PolicyVerdict {
		if (action.type !== "shell_exec" || !action.command) {
			return { status: "allow", ruleId: this.id, reason: "Not a shell command" };
		}

		for (const { name, pattern } of DESTRUCTIVE_COMMAND_PATTERNS) {
			if (pattern.test(action.command)) {
				return {
					status: "deny",
					ruleId: this.id,
					reason: `Blocked destructive command pattern: ${name}`,
					suggestion: "Use a safer alternative or specify exact paths",
				};
			}
		}

		return { status: "allow", ruleId: this.id, reason: "Command is not destructive" };
	},
};

/** Warns on any sudo command. */
export const noSudoWithoutApproval: PolicyRule = {
	id: "security.no-sudo-without-approval",
	name: "No Sudo Without Approval",
	description: "Warns on any command using sudo",
	severity: "warning",
	category: "execution",
	evaluate(action: PolicyAction, _context: PolicyContext): PolicyVerdict {
		if (action.type !== "shell_exec" || !action.command) {
			return { status: "allow", ruleId: this.id, reason: "Not a shell command" };
		}

		if (/(?:^|\s|&&|\|\||;)sudo\s/.test(action.command)) {
			return {
				status: "warn",
				ruleId: this.id,
				reason: "Command uses sudo — requires elevated privileges",
				suggestion: "Consider whether sudo is truly needed, or run without elevated privileges",
			};
		}

		return { status: "allow", ruleId: this.id, reason: "Command does not use sudo" };
	},
};

/** Detects potential data exfiltration via curl/wget piping local file content to external URLs. */
export const noNetworkExfiltration: PolicyRule = {
	id: "security.no-network-exfiltration",
	name: "No Network Exfiltration",
	description: "Detects curl/wget piping to external URLs with local file content",
	severity: "error",
	category: "network",
	evaluate(action: PolicyAction, _context: PolicyContext): PolicyVerdict {
		if (action.type !== "shell_exec" || !action.command) {
			return { status: "allow", ruleId: this.id, reason: "Not a shell command" };
		}

		for (const { name, pattern } of EXFILTRATION_PATTERNS) {
			if (pattern.test(action.command)) {
				return {
					status: "deny",
					ruleId: this.id,
					reason: `Detected potential data exfiltration pattern: ${name}`,
					suggestion: "If this is intentional, use explicit file upload tools instead",
				};
			}
		}

		return { status: "allow", ruleId: this.id, reason: "No exfiltration patterns detected" };
	},
};

/** Restricts file operations to the project directory and home config. */
export const sandboxFileAccess: PolicyRule = {
	id: "security.sandbox-file-access",
	name: "Sandbox File Access",
	description: "Restricts file operations to the project directory and ~/.chitragupta config",
	severity: "error",
	category: "filesystem",
	evaluate(action: PolicyAction, context: PolicyContext): PolicyVerdict {
		const fileActionTypes = new Set(["file_read", "file_write", "file_delete"]);
		if (!fileActionTypes.has(action.type) || !action.filePath) {
			return { status: "allow", ruleId: this.id, reason: "Not a file operation" };
		}

		const resolvedPath = path.resolve(action.filePath);
		const projectPath = path.resolve(context.projectPath);
		const chitraguptaHome = path.resolve(getChitraguptaHome());

		// Allow access within the project directory
		if (resolvedPath.startsWith(projectPath + path.sep) || resolvedPath === projectPath) {
			return { status: "allow", ruleId: this.id, reason: "File is within project directory" };
		}

		// Allow access to ~/.chitragupta config
		if (resolvedPath.startsWith(chitraguptaHome + path.sep) || resolvedPath === chitraguptaHome) {
			return { status: "allow", ruleId: this.id, reason: "File is within Chitragupta config directory" };
		}

		return {
			status: "deny",
			ruleId: this.id,
			reason: `File access denied: "${resolvedPath}" is outside the project directory and Chitragupta config`,
			suggestion: `Only access files within "${projectPath}" or "${chitraguptaHome}"`,
		};
	},
};

/** All built-in security rules. */
export const SECURITY_RULES: PolicyRule[] = [
	noSecretsInPrompts,
	noDestructiveCommands,
	noSudoWithoutApproval,
	noNetworkExfiltration,
	sandboxFileAccess,
];
