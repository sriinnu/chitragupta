/**
 * SSH Delegation Extension — Reference Implementation.
 *
 * Demonstrates the `onBashSpawn` hook by routing matching shell commands
 * to a remote host via SSH ControlMaster. This keeps a persistent SSH
 * connection open and rewrites commands to execute remotely.
 *
 * ## Configuration (environment variables)
 *
 * - `CHITRAGUPTA_SSH_HOST` — Remote hostname (required to activate)
 * - `CHITRAGUPTA_SSH_USER` — SSH user (default: current user)
 * - `CHITRAGUPTA_SSH_WORKSPACE` — Remote working directory (default: ~)
 * - `CHITRAGUPTA_SSH_PATTERNS` — Comma-separated command prefixes to
 *   delegate (default: "npm,npx,node,python,pip,cargo,go,make,docker")
 *
 * ## Usage
 *
 * Place this file in `~/.chitragupta/extensions/` or
 * `.chitragupta/extensions/` in your project root.
 *
 * @module
 */

import type {
	ExtensionManifest,
	ExtensionAPI,
	BashSpawnContext,
} from "@chitragupta/tantra";

// ─── Configuration ─────────────────────────────────────────────────────────

/** Default command prefixes that trigger SSH delegation. */
const DEFAULT_PATTERNS = [
	"npm", "npx", "node", "python", "pip",
	"cargo", "go", "make", "docker",
];

/** Read SSH config from environment. Returns null if not configured. */
function loadSshConfig(): SshConfig | null {
	const host = process.env.CHITRAGUPTA_SSH_HOST;
	if (!host) return null;

	const user = process.env.CHITRAGUPTA_SSH_USER ?? process.env.USER ?? "root";
	const workspace = process.env.CHITRAGUPTA_SSH_WORKSPACE ?? "~";
	const patternsRaw = process.env.CHITRAGUPTA_SSH_PATTERNS;
	const patterns = patternsRaw
		? patternsRaw.split(",").map((p) => p.trim()).filter(Boolean)
		: DEFAULT_PATTERNS;

	return { host, user, workspace, patterns };
}

/** SSH delegation configuration. */
interface SshConfig {
	host: string;
	user: string;
	workspace: string;
	patterns: string[];
}

// ─── SSH ControlMaster ─────────────────────────────────────────────────────

/** Build the ControlPath for SSH ControlMaster. */
function controlPath(config: SshConfig): string {
	return `~/.ssh/chitragupta_${config.host}_${config.user}`;
}

/** Build the SSH ControlMaster options string. */
function controlOpts(config: SshConfig): string {
	return `-o ControlPath=${controlPath(config)}`;
}

/**
 * Start an SSH ControlMaster connection in the background.
 * Uses `-fNM` to fork into background with no remote command.
 */
function buildMasterStartCommand(config: SshConfig): string {
	const target = `${config.user}@${config.host}`;
	return `ssh -fNM ${controlOpts(config)} -o ControlMaster=auto -o ServerAliveInterval=30 ${target}`;
}

/**
 * Build the command to gracefully close the ControlMaster.
 */
function buildMasterStopCommand(config: SshConfig): string {
	const target = `${config.user}@${config.host}`;
	return `ssh -O exit ${controlOpts(config)} ${target} 2>/dev/null || true`;
}

/**
 * Rewrite a local command to execute on the remote host via SSH.
 * Uses the existing ControlMaster socket for zero-overhead connection reuse.
 */
function buildRemoteCommand(config: SshConfig, command: string, cwd: string): string {
	const remoteCwd = config.workspace === "~" ? config.workspace : config.workspace;
	const target = `${config.user}@${config.host}`;
	// Escape single quotes in the command for safe shell wrapping
	const escaped = command.replace(/'/g, "'\\''");
	return `ssh ${controlOpts(config)} ${target} 'cd ${remoteCwd} && ${escaped}'`;
}

// ─── Hook Logic ────────────────────────────────────────────────────────────

/**
 * Check if a command should be delegated to the remote host.
 * Matches against the first word (command name) of the shell command.
 */
function shouldDelegate(command: string, patterns: string[]): boolean {
	const trimmed = command.trimStart();
	// Handle common prefixes: env vars, sudo, etc.
	const firstWord = trimmed.split(/[\s;|&]/)[0];
	return patterns.some((pat) => firstWord === pat);
}

// ─── Extension State ───────────────────────────────────────────────────────

let sshConfig: SshConfig | null = null;
let masterStarted = false;

// ─── Extension Manifest ────────────────────────────────────────────────────

/**
 * SSH Delegation Extension.
 *
 * Routes matching bash commands to a remote host via SSH ControlMaster.
 * The persistent multiplexed connection eliminates per-command SSH overhead.
 */
const manifest: ExtensionManifest = {
	name: "ssh-delegate",
	version: "0.1.0",
	description: "Route bash commands to remote host via SSH ControlMaster",

	hooks: {
		/**
		 * onBashSpawn — intercept shell commands before execution.
		 * If the command matches a delegation pattern and SSH is configured,
		 * rewrites the command to execute remotely.
		 */
		onBashSpawn: async (ctx: BashSpawnContext) => {
			if (!sshConfig) return;

			const command = ctx.modifiedCommand ?? ctx.command;
			if (!shouldDelegate(command, sshConfig.patterns)) return;

			const cwd = ctx.modifiedCwd ?? ctx.cwd;
			ctx.modifiedCommand = buildRemoteCommand(sshConfig, command, cwd);

			process.stderr.write(
				`[ssh-delegate] Routing to ${sshConfig.user}@${sshConfig.host}: ${command}\n`,
			);
		},
	},

	/**
	 * activate — called when the extension loads.
	 * Reads SSH config from environment and starts ControlMaster.
	 */
	activate: async (_api: ExtensionAPI) => {
		sshConfig = loadSshConfig();
		if (!sshConfig) {
			process.stderr.write(
				"[ssh-delegate] Not configured (set CHITRAGUPTA_SSH_HOST to enable)\n",
			);
			return;
		}

		// Start ControlMaster in the background
		try {
			const { execSync } = await import("node:child_process");
			const cmd = buildMasterStartCommand(sshConfig);
			execSync(cmd, { timeout: 10_000, stdio: "ignore" });
			masterStarted = true;
			process.stderr.write(
				`[ssh-delegate] ControlMaster started: ${sshConfig.user}@${sshConfig.host}\n`,
			);
		} catch (err) {
			process.stderr.write(
				`[ssh-delegate] ControlMaster failed: ${err instanceof Error ? err.message : String(err)}\n`,
			);
		}
	},

	/**
	 * deactivate — called when the extension unloads.
	 * Closes the SSH ControlMaster connection.
	 */
	deactivate: async () => {
		if (!sshConfig || !masterStarted) return;

		try {
			const { execSync } = await import("node:child_process");
			execSync(buildMasterStopCommand(sshConfig), { timeout: 5_000, stdio: "ignore" });
			process.stderr.write(
				`[ssh-delegate] ControlMaster closed: ${sshConfig.user}@${sshConfig.host}\n`,
			);
		} catch {
			// Best-effort cleanup — socket may already be gone
		}

		sshConfig = null;
		masterStarted = false;
	},
};

export default manifest;
