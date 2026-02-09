/**
 * Kshetra — Sandboxed execution environment using git worktrees.
 * Sanskrit: Kshetra (क्षेत्र) = field, domain, sacred ground.
 *
 * Provides isolated filesystem environments for agents to safely
 * execute destructive operations (file writes, builds, tests) without
 * affecting the main working directory.
 *
 * Each sandbox is a full git worktree checked out to an ephemeral branch,
 * giving the agent a complete, writable copy of the repository at near-zero
 * cost (git shares objects under the hood). Changes can be committed inside
 * the sandbox and optionally merged back into the source branch.
 */

import { exec as execCb, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SandboxConfig {
	/** Base directory for worktrees. Default: .chitragupta/sandboxes */
	baseDir?: string;
	/** Auto-cleanup on destroy. Default: true */
	autoCleanup?: boolean;
	/** Maximum concurrent sandboxes. Default: 5 */
	maxSandboxes?: number;
	/** Default command timeout in ms. Default: 60000 */
	defaultTimeout?: number;
}

export interface SandboxInfo {
	id: string;
	path: string;
	branch: string;
	createdAt: number;
	active: boolean;
}

// ─── Security: Command Validation ───────────────────────────────────────────

/**
 * Allowlist of safe command prefixes that may be executed with shell mode.
 * Only these commands are permitted — anything else is rejected.
 */
const SAFE_COMMAND_PREFIXES = new Set([
	"npm", "node", "npx", "git", "tsc", "eslint", "prettier",
	"vitest", "jest", "make", "cargo", "python", "pip", "go", "rustc",
	"ls", "cat", "echo", "which", "env", "pwd", "dirname", "basename",
	"head", "tail", "wc", "sort", "uniq", "diff", "find", "grep",
	"mkdir", "rm", "cp", "mv", "touch", "chmod",
]);

/**
 * Characters that indicate shell meta-operations (injection vectors).
 * Any command containing these is rejected outright.
 */
const DANGEROUS_CHARS = /[;|&$`><]/;

/**
 * Parse a command string into [command, ...args], respecting quoted segments.
 * Handles both single and double quotes.
 *
 * @example
 * parseCommand('git commit -m "hello world"')
 * // => ["git", "commit", "-m", "hello world"]
 */
function parseCommand(command: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let inQuote: string | null = null;

	for (let i = 0; i < command.length; i++) {
		const ch = command[i];

		if (inQuote) {
			if (ch === inQuote) {
				inQuote = null;
			} else {
				current += ch;
			}
		} else if (ch === '"' || ch === "'") {
			inQuote = ch;
		} else if (ch === " " || ch === "\t") {
			if (current.length > 0) {
				tokens.push(current);
				current = "";
			}
		} else {
			current += ch;
		}
	}
	if (current.length > 0) {
		tokens.push(current);
	}

	return tokens;
}

/**
 * Validate a command string for safe execution in a sandbox.
 *
 * @throws {Error} if the command is empty, contains dangerous characters,
 *                 or uses a command not in the allowlist.
 */
function validateCommand(command: string): void {
	const trimmed = command.trim();
	if (!trimmed) {
		throw new Error("Sandbox: empty command rejected");
	}

	// Reject any shell meta-characters
	if (DANGEROUS_CHARS.test(trimmed)) {
		throw new Error(
			`Sandbox: command contains dangerous shell characters: ${trimmed}`,
		);
	}

	// Extract the base command (first token) and check the allowlist
	const tokens = parseCommand(trimmed);
	if (tokens.length === 0) {
		throw new Error("Sandbox: empty command rejected");
	}

	const baseCommand = path.basename(tokens[0]);
	if (!SAFE_COMMAND_PREFIXES.has(baseCommand)) {
		throw new Error(
			`Sandbox: command "${baseCommand}" is not in the allowlist. ` +
			`Allowed: ${[...SAFE_COMMAND_PREFIXES].join(", ")}`,
		);
	}
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function execAsync(
	command: string,
	options: { cwd?: string; timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		execCb(command, { ...options, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
			if (err) {
				const enriched = Object.assign(err, { stdout: stdout ?? "", stderr: stderr ?? "" });
				reject(enriched);
				return;
			}
			resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
		});
	});
}

function isGitRepo(dir: string): boolean {
	try {
		const { status } = spawnSync(
			"git", ["rev-parse", "--is-inside-work-tree"],
			{ cwd: dir, stdio: "pipe" },
		);
		return status === 0;
	} catch {
		return false;
	}
}

// ─── Sandbox ────────────────────────────────────────────────────────────────

/**
 * Manages git-worktree-based sandboxes for safe, isolated execution.
 *
 * @example
 * ```ts
 * const sandbox = new Sandbox("/path/to/repo");
 * const info = await sandbox.create();
 * const output = await sandbox.exec(info.id, "npm test");
 * await sandbox.destroy(info.id);
 * ```
 */
export class Sandbox {
	private sandboxes = new Map<string, SandboxInfo>();
	private readonly baseDir: string;
	private readonly autoCleanup: boolean;
	private readonly maxSandboxes: number;
	private readonly defaultTimeout: number;
	private readonly projectRoot: string;

	constructor(projectRoot: string, config?: SandboxConfig) {
		this.projectRoot = projectRoot;
		this.baseDir = config?.baseDir ?? path.join(projectRoot, ".chitragupta", "sandboxes");
		this.autoCleanup = config?.autoCleanup ?? true;
		this.maxSandboxes = config?.maxSandboxes ?? 5;
		this.defaultTimeout = config?.defaultTimeout ?? 60_000;
	}

	/**
	 * Create a new sandbox (git worktree).
	 * The worktree is checked out to an ephemeral branch named `sandbox/<uuid>`.
	 */
	async create(branchName?: string): Promise<SandboxInfo> {
		if (!isGitRepo(this.projectRoot)) {
			throw new Error(`Not a git repository: ${this.projectRoot}`);
		}

		if (this.sandboxes.size >= this.maxSandboxes) {
			throw new Error(
				`Maximum sandbox limit reached (${this.maxSandboxes}). ` +
				`Destroy an existing sandbox before creating a new one.`,
			);
		}

		const id = randomUUID().slice(0, 8);
		const branch = branchName ?? `sandbox/${id}`;
		const worktreePath = path.join(this.baseDir, id);

		// Ensure base directory exists
		fs.mkdirSync(this.baseDir, { recursive: true });

		// Create the worktree with a new branch
		await execAsync(
			`git worktree add -b "${branch}" "${worktreePath}"`,
			{ cwd: this.projectRoot, timeout: this.defaultTimeout },
		);

		const info: SandboxInfo = {
			id,
			path: worktreePath,
			branch,
			createdAt: Date.now(),
			active: true,
		};

		this.sandboxes.set(id, info);
		return info;
	}

	/**
	 * Execute a command inside a sandbox.
	 *
	 * The command is validated against a strict allowlist of safe prefixes
	 * (npm, node, npx, git, tsc, eslint, prettier, vitest, jest, make,
	 * cargo, python, pip, go, rustc) and rejected if it contains dangerous
	 * shell meta-characters (; | & $ ` > <).
	 *
	 * @returns stdout from the command.
	 * @throws {Error} if the command fails validation.
	 */
	async exec(sandboxId: string, command: string, timeout?: number): Promise<string> {
		const info = this.getSandbox(sandboxId);

		// ── Security gate: validate before execution ──
		validateCommand(command);

		const { stdout } = await execAsync(command, {
			cwd: info.path,
			timeout: timeout ?? this.defaultTimeout,
		});
		return stdout;
	}

	/**
	 * Stage all changes and commit inside a sandbox.
	 *
	 * @returns The commit hash.
	 */
	async commit(sandboxId: string, message: string): Promise<string> {
		const info = this.getSandbox(sandboxId);
		await execAsync("git add -A", { cwd: info.path, timeout: this.defaultTimeout });
		await execAsync(
			`git commit -m ${JSON.stringify(message)}`,
			{ cwd: info.path, timeout: this.defaultTimeout },
		);
		const { stdout } = await execAsync(
			"git rev-parse HEAD",
			{ cwd: info.path, timeout: this.defaultTimeout },
		);
		return stdout.trim();
	}

	/**
	 * Merge sandbox changes back to the branch that was current when
	 * the sandbox was created.
	 *
	 * @returns success flag and any conflict file paths.
	 */
	async merge(sandboxId: string): Promise<{ success: boolean; conflicts: string[] }> {
		const info = this.getSandbox(sandboxId);

		try {
			await execAsync(
				`git merge "${info.branch}"`,
				{ cwd: this.projectRoot, timeout: this.defaultTimeout },
			);
			return { success: true, conflicts: [] };
		} catch (err: unknown) {
			// Attempt to extract conflict file list
			const stderr = (err as { stderr?: string }).stderr ?? "";
			const stdout = (err as { stdout?: string }).stdout ?? "";
			const combined = stderr + "\n" + stdout;
			const conflicts: string[] = [];

			for (const line of combined.split("\n")) {
				const match = line.match(/CONFLICT \(.*?\): (?:Merge conflict in )?(.+)/);
				if (match?.[1]) {
					conflicts.push(match[1].trim());
				}
			}

			// Abort the failed merge to leave the repo in a clean state
			try {
				await execAsync("git merge --abort", {
					cwd: this.projectRoot,
					timeout: this.defaultTimeout,
				});
			} catch {
				// Best-effort abort; ignore errors
			}

			return { success: false, conflicts };
		}
	}

	/**
	 * Destroy a sandbox — removes the worktree and deletes the ephemeral branch.
	 */
	async destroy(sandboxId: string): Promise<void> {
		const info = this.sandboxes.get(sandboxId);
		if (!info) {
			throw new Error(`Sandbox not found: ${sandboxId}`);
		}

		info.active = false;

		// Remove the worktree
		try {
			await execAsync(
				`git worktree remove --force "${info.path}"`,
				{ cwd: this.projectRoot, timeout: this.defaultTimeout },
			);
		} catch {
			// If worktree removal failed (e.g. already gone), clean up the directory manually
			if (this.autoCleanup && fs.existsSync(info.path)) {
				fs.rmSync(info.path, { recursive: true, force: true });
			}
		}

		// Delete the ephemeral branch (non-fatal if it fails)
		try {
			await execAsync(
				`git branch -D "${info.branch}"`,
				{ cwd: this.projectRoot, timeout: this.defaultTimeout },
			);
		} catch {
			// Branch may already be deleted or never fully created
		}

		// Prune worktree metadata
		try {
			await execAsync("git worktree prune", {
				cwd: this.projectRoot,
				timeout: this.defaultTimeout,
			});
		} catch {
			// Non-fatal
		}

		this.sandboxes.delete(sandboxId);
	}

	/**
	 * List all tracked sandboxes.
	 */
	list(): SandboxInfo[] {
		return [...this.sandboxes.values()];
	}

	/**
	 * Destroy every sandbox managed by this instance.
	 */
	async destroyAll(): Promise<void> {
		const ids = [...this.sandboxes.keys()];
		for (const id of ids) {
			await this.destroy(id);
		}
	}

	// ─── Private ──────────────────────────────────────────────────────────────

	private getSandbox(sandboxId: string): SandboxInfo {
		const info = this.sandboxes.get(sandboxId);
		if (!info) {
			throw new Error(`Sandbox not found: ${sandboxId}`);
		}
		if (!info.active) {
			throw new Error(`Sandbox is no longer active: ${sandboxId}`);
		}
		return info;
	}
}
