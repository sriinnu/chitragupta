/**
 * CLI command handler for `chitragupta extension`.
 *
 * Supports installing extensions from npm, git, or local paths,
 * listing installed extensions, and removing them.
 *
 * Directory layout:
 *   ~/.chitragupta/extensions/npm/<pkg>/     — npm-installed packages
 *   ~/.chitragupta/extensions/git/<repo>/    — git-cloned repositories
 *   ~/.chitragupta/extensions/local/<name>/  — symlinks to local paths
 *   .chitragupta/extensions/                 — project-local extensions
 *
 * @module commands/extension
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

/** Base directory for globally-installed extensions. */
function getExtensionsBase(): string {
	const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
	return path.join(home, ".chitragupta", "extensions");
}

/** Parsed source specifier from CLI arguments. */
interface ExtensionSource {
	type: "npm" | "git" | "local";
	/** Raw package spec (e.g. "@foo/bar@1.0.0") or git URL or local path. */
	spec: string;
	/** Resolved directory name for installation target. */
	dirName: string;
	/** Optional version/ref suffix. */
	ref?: string;
}

/**
 * Parse an install argument into a typed source descriptor.
 *
 * Formats:
 *   npm:@scope/pkg[@version]
 *   git:github.com/user/repo[@ref]
 *   ./local/path  or  /absolute/path
 */
function parseSource(arg: string): ExtensionSource {
	if (arg.startsWith("npm:")) {
		const raw = arg.slice(4);
		// Split name from version: "@scope/pkg@1.2" -> name="@scope/pkg", ref="1.2"
		const atIdx = raw.lastIndexOf("@");
		const hasVersion = atIdx > 0 && !raw.startsWith("@", atIdx - 1);
		const pkgName = hasVersion ? raw.slice(0, atIdx) : raw;
		const ref = hasVersion ? raw.slice(atIdx + 1) : undefined;
		// Directory-safe name: @scope/pkg -> scope-pkg
		const dirName = pkgName.replace(/^@/, "").replace(/\//g, "-");
		return { type: "npm", spec: pkgName, dirName, ref };
	}

	if (arg.startsWith("git:")) {
		const raw = arg.slice(4);
		const atIdx = raw.lastIndexOf("@");
		const hasRef = atIdx > 0;
		const url = hasRef ? raw.slice(0, atIdx) : raw;
		const ref = hasRef ? raw.slice(atIdx + 1) : undefined;
		// Extract repo name from URL: "github.com/user/repo" -> "repo"
		const segments = url.replace(/\.git$/, "").split("/");
		const dirName = segments[segments.length - 1] ?? "unknown";
		return { type: "git", spec: url, dirName, ref };
	}

	// Local path (relative or absolute)
	const absPath = path.resolve(arg);
	const dirName = path.basename(absPath);
	return { type: "local", spec: absPath, dirName };
}

/**
 * Handle `chitragupta extension <subcommand> [args...]`.
 *
 * @param subcommand - One of: install, list, remove
 * @param rest - Remaining positional arguments
 */
export async function handleExtensionCommand(
	subcommand: string | undefined,
	rest: string[],
): Promise<void> {
	switch (subcommand) {
		case "install":
			await installExtension(rest);
			break;
		case "list":
			await listExtensions();
			break;
		case "remove":
			await removeExtension(rest);
			break;
		default:
			process.stderr.write(
				"\nUsage: chitragupta extension <install|list|remove>\n\n" +
				"  install npm:@scope/pkg[@ver]  Install from npm\n" +
				"  install git:host/user/repo    Clone from git\n" +
				"  install ./local/path          Symlink local extension\n" +
				"  list                          List installed extensions\n" +
				"  remove <name>                 Remove an extension\n\n",
			);
			process.exit(1);
	}
}

// ── Install ────────────────────────────────────────────────────────────────

/** Install an extension from npm, git, or local path. */
async function installExtension(args: string[]): Promise<void> {
	const arg = args[0];
	if (!arg) {
		process.stderr.write(
			"\nError: Extension source required.\n" +
			"Usage: chitragupta extension install <npm:pkg | git:url | ./path>\n\n",
		);
		process.exit(1);
	}

	const source = parseSource(arg);
	switch (source.type) {
		case "npm":
			await installFromNpm(source);
			break;
		case "git":
			await installFromGit(source);
			break;
		case "local":
			await installFromLocal(source);
			break;
	}
}

/** Install an extension package from npm. */
async function installFromNpm(source: ExtensionSource): Promise<void> {
	const targetDir = path.join(getExtensionsBase(), "npm", source.dirName);
	await fs.mkdir(targetDir, { recursive: true });

	const pkgSpec = source.ref ? `${source.spec}@${source.ref}` : source.spec;
	process.stdout.write(`\n  Installing ${pkgSpec} from npm...\n`);

	try {
		await execFileAsync("npm", ["install", "--prefix", targetDir, pkgSpec], {
			timeout: 120_000,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		process.stderr.write(`\n  Error: npm install failed: ${msg}\n\n`);
		process.exit(1);
	}

	// Read installed package.json for chitragupta manifest
	const info = await readPackageManifest(targetDir);
	process.stdout.write(
		`  Installed: ${source.spec}` +
		(info.version ? ` v${info.version}` : "") +
		(info.entryPoints.length > 0 ? ` (${info.entryPoints.length} extension entry point(s))` : "") +
		`\n  Location: ${targetDir}\n\n`,
	);
}

/** Clone an extension from a git repository. */
async function installFromGit(source: ExtensionSource): Promise<void> {
	const targetDir = path.join(getExtensionsBase(), "git", source.dirName);

	// Ensure parent exists
	await fs.mkdir(path.dirname(targetDir), { recursive: true });

	// Remove existing if present
	try {
		await fs.rm(targetDir, { recursive: true, force: true });
	} catch { /* ignore */ }

	// Construct full git URL if it looks like a shorthand
	const gitUrl = source.spec.includes("://")
		? source.spec
		: `https://${source.spec}.git`;

	process.stdout.write(`\n  Cloning ${gitUrl}...\n`);

	try {
		await execFileAsync("git", ["clone", "--depth", "1", gitUrl, targetDir], {
			timeout: 120_000,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		process.stderr.write(`\n  Error: git clone failed: ${msg}\n\n`);
		process.exit(1);
	}

	// Checkout specific ref if provided
	if (source.ref) {
		try {
			await execFileAsync("git", ["-C", targetDir, "fetch", "--depth", "1", "origin", source.ref]);
			await execFileAsync("git", ["-C", targetDir, "checkout", source.ref]);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			process.stderr.write(`  Warning: Could not checkout ref '${source.ref}': ${msg}\n`);
		}
	}

	// Run npm install if package.json exists
	const pkgJsonPath = path.join(targetDir, "package.json");
	if (await fileExists(pkgJsonPath)) {
		process.stdout.write("  Installing dependencies...\n");
		try {
			await execFileAsync("npm", ["install", "--prefix", targetDir], {
				timeout: 120_000,
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			process.stderr.write(`  Warning: npm install failed: ${msg}\n`);
		}
	}

	const info = await readPackageManifest(targetDir);
	process.stdout.write(
		`  Installed: ${source.dirName}` +
		(info.version ? ` v${info.version}` : "") +
		`\n  Location: ${targetDir}\n\n`,
	);
}

/** Symlink a local extension directory. */
async function installFromLocal(source: ExtensionSource): Promise<void> {
	// Verify source exists
	if (!(await fileExists(source.spec))) {
		process.stderr.write(`\n  Error: Path does not exist: ${source.spec}\n\n`);
		process.exit(1);
	}

	const targetDir = path.join(getExtensionsBase(), "local");
	await fs.mkdir(targetDir, { recursive: true });
	const linkPath = path.join(targetDir, source.dirName);

	// Remove existing symlink
	try { await fs.unlink(linkPath); } catch { /* ignore */ }

	await fs.symlink(source.spec, linkPath, "dir");
	process.stdout.write(
		`\n  Linked: ${source.dirName} -> ${source.spec}\n` +
		`  Location: ${linkPath}\n\n`,
	);
}

// ── List ───────────────────────────────────────────────────────────────────

/** Extension entry as displayed in the list table. */
interface ExtensionEntry {
	name: string;
	source: string;
	version: string;
	location: string;
}

/** List all installed extensions from npm, git, local, and project dirs. */
async function listExtensions(): Promise<void> {
	const base = getExtensionsBase();
	const entries: ExtensionEntry[] = [];

	// Scan npm/, git/, local/ under global extensions dir
	for (const sourceType of ["npm", "git", "local"] as const) {
		const dir = path.join(base, sourceType);
		const subdirs = await safeReadDir(dir);
		for (const name of subdirs) {
			const extDir = path.join(dir, name);
			const info = await readPackageManifest(extDir);
			entries.push({ name, source: sourceType, version: info.version || "-", location: extDir });
		}
	}

	// Scan project-local extensions
	const projectDir = path.join(process.cwd(), ".chitragupta", "extensions");
	const projectFiles = await safeReadDir(projectDir);
	for (const name of projectFiles) {
		entries.push({ name, source: "project", version: "-", location: path.join(projectDir, name) });
	}

	if (entries.length === 0) {
		process.stdout.write(
			"\n  No extensions installed.\n" +
			`  Extension directory: ${base}\n\n`,
		);
		return;
	}

	// Print table
	process.stdout.write("\n  Installed extensions:\n\n");
	const nameW = Math.max(6, ...entries.map(e => e.name.length));
	const srcW = Math.max(6, ...entries.map(e => e.source.length));
	const verW = Math.max(7, ...entries.map(e => e.version.length));
	const header = `  ${"NAME".padEnd(nameW)}  ${"SOURCE".padEnd(srcW)}  ${"VERSION".padEnd(verW)}  LOCATION`;
	process.stdout.write(`${header}\n`);
	process.stdout.write(`  ${"-".repeat(nameW)}  ${"-".repeat(srcW)}  ${"-".repeat(verW)}  --------\n`);
	for (const e of entries) {
		process.stdout.write(`  ${e.name.padEnd(nameW)}  ${e.source.padEnd(srcW)}  ${e.version.padEnd(verW)}  ${e.location}\n`);
	}
	process.stdout.write("\n");
}

// ── Remove ─────────────────────────────────────────────────────────────────

/** Remove an installed extension by name. */
async function removeExtension(args: string[]): Promise<void> {
	const name = args[0];
	if (!name) {
		process.stderr.write("\nError: Extension name required.\nUsage: chitragupta extension remove <name>\n\n");
		process.exit(1);
	}

	const base = getExtensionsBase();

	for (const sourceType of ["npm", "git", "local"] as const) {
		const extPath = path.join(base, sourceType, name);
		if (await fileExists(extPath)) {
			const stat = await fs.lstat(extPath);
			if (stat.isSymbolicLink()) {
				await fs.unlink(extPath);
			} else {
				await fs.rm(extPath, { recursive: true, force: true });
			}
			process.stdout.write(`\n  Removed extension '${name}' (${sourceType})\n\n`);
			return;
		}
	}

	process.stderr.write(`\n  Error: Extension '${name}' not found.\n\n`);
	process.exit(1);
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Package manifest info extracted from package.json. */
interface PackageManifestInfo {
	version: string;
	entryPoints: string[];
}

/** Read package.json and extract chitragupta manifest info. */
async function readPackageManifest(dir: string): Promise<PackageManifestInfo> {
	try {
		// For npm installs, package.json may be in node_modules/<pkg>/
		const candidates = [
			path.join(dir, "package.json"),
			...await findNestedPackageJson(dir),
		];

		for (const pkgPath of candidates) {
			const raw = await fs.readFile(pkgPath, "utf-8");
			const pkg = JSON.parse(raw) as Record<string, unknown>;
			const version = typeof pkg.version === "string" ? pkg.version : "";
			const chitragupta = pkg.chitragupta as Record<string, unknown> | undefined;
			const entryPoints = Array.isArray(chitragupta?.extensions)
				? chitragupta.extensions as string[]
				: [];
			if (version || entryPoints.length > 0) {
				return { version, entryPoints };
			}
		}
	} catch { /* ignore read errors */ }
	return { version: "", entryPoints: [] };
}

/** Find package.json files one level deep in node_modules. */
async function findNestedPackageJson(dir: string): Promise<string[]> {
	const results: string[] = [];
	const nmDir = path.join(dir, "node_modules");
	try {
		const entries = await fs.readdir(nmDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
			if (entry.name.startsWith("@")) {
				// Scoped package: @scope/pkg
				const scopeEntries = await fs.readdir(path.join(nmDir, entry.name), { withFileTypes: true });
				for (const se of scopeEntries) {
					if (se.isDirectory()) {
						results.push(path.join(nmDir, entry.name, se.name, "package.json"));
					}
				}
			} else {
				results.push(path.join(nmDir, entry.name, "package.json"));
			}
		}
	} catch { /* ignore */ }
	return results;
}

/** Check if a path exists. */
async function fileExists(p: string): Promise<boolean> {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}

/** Safely read a directory, returning [] on error. */
async function safeReadDir(dir: string): Promise<string[]> {
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		return entries
			.filter(e => e.isDirectory() || e.isSymbolicLink())
			.map(e => e.name)
			.filter(n => !n.startsWith("."));
	} catch {
		return [];
	}
}
