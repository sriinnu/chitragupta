#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const packagesDir = path.join(rootDir, "packages");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const auditOnly = args.has("--check");

const packageDirs = fs.readdirSync(packagesDir, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.sort((a, b) => a.localeCompare(b));

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readOptionalJson(filePath) {
	if (!fs.existsSync(filePath)) return null;
	return readJson(filePath);
}

function collectSourceFiles(startDir) {
	const files = [];
	if (!fs.existsSync(startDir)) return files;

	const walk = (dir) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const next = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(next);
				continue;
			}
			if (/\.(ts|tsx|mts|cts|js|mjs)$/.test(entry.name)) {
				files.push(next);
			}
		}
	};

	walk(startDir);
	return files;
}

function getWorkspaceImports(filePath) {
	const source = fs.readFileSync(filePath, "utf8");
	const scriptKind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
	const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind);
	const imports = new Set();

	const addImport = (specifier) => {
		if (!specifier?.startsWith("@chitragupta/")) return;
		imports.add(specifier.split("/").slice(0, 2).join("/"));
	};

	sourceFile.forEachChild((node) => {
		if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
			addImport(node.moduleSpecifier.text);
			return;
		}
		if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) {
			addImport(node.moduleReference.expression.text);
		}
	});

	return imports;
}

const workspacePackages = new Map();
const workspacePackageDirs = new Map();
for (const dir of packageDirs) {
	const manifestPath = path.join(packagesDir, dir, "package.json");
	if (!fs.existsSync(manifestPath)) continue;

	const manifest = readJson(manifestPath);
	const tsconfigPath = path.join(packagesDir, dir, "tsconfig.json");
	workspacePackages.set(manifest.name, {
		dir,
		manifest,
		manifestPath,
		tsconfigPath,
		tsconfig: readOptionalJson(tsconfigPath),
	});
	workspacePackageDirs.set(path.resolve(packagesDir, dir), manifest.name);
}

const buildPackages = [...workspacePackages.entries()]
	.filter(([, data]) => typeof data.manifest.scripts?.build === "string")
	.sort((a, b) => a[1].dir.localeCompare(b[1].dir));

function resolveWorkspaceReference(ownerDir, referencePath) {
	const resolvedPath = path.resolve(packagesDir, ownerDir, referencePath);
	const candidateDir = resolvedPath.endsWith("tsconfig.json") ? path.dirname(resolvedPath) : resolvedPath;
	return workspacePackageDirs.get(candidateDir);
}

const compositeWorkspacePackages = new Set(
	[...workspacePackages.entries()]
		.filter(([, data]) => data.tsconfig?.compilerOptions?.composite === true)
		.map(([packageName]) => packageName),
);

const missingDependencyFindings = [];
const tsReferenceFindings = [];
const tsReferencesByPackage = new Map();
for (const [packageName, data] of buildPackages) {
	const declared = new Set([
		...Object.keys(data.manifest.dependencies ?? {}),
		...Object.keys(data.manifest.devDependencies ?? {}),
		...Object.keys(data.manifest.optionalDependencies ?? {}),
		...Object.keys(data.manifest.peerDependencies ?? {}),
	]);

	const sourceFiles = collectSourceFiles(path.join(packagesDir, data.dir, "src"));
	const requiredWorkspaceDeps = new Set();
	for (const sourceFile of sourceFiles) {
		for (const dependency of getWorkspaceImports(sourceFile)) {
			if (dependency === packageName || !workspacePackages.has(dependency)) continue;
			requiredWorkspaceDeps.add(dependency);
		}
	}
	for (const dependency of [...requiredWorkspaceDeps].sort()) {
		if (!declared.has(dependency)) {
			missingDependencyFindings.push({
				packageName,
				dir: data.dir,
				dependency,
			});
		}
	}

	const tsconfigReferences = new Set();
	for (const reference of data.tsconfig?.references ?? []) {
		if (!reference || typeof reference.path !== "string") continue;
		const referencePackage = resolveWorkspaceReference(data.dir, reference.path);
		if (!referencePackage) {
			tsReferenceFindings.push({
				packageName,
				dir: data.dir,
				type: "invalid",
				referencePath: reference.path,
			});
			continue;
		}
		tsconfigReferences.add(referencePackage);
		if (!declared.has(referencePackage)) {
			tsReferenceFindings.push({
				packageName,
				dir: data.dir,
				type: "undeclared",
				referencePath: reference.path,
				referencePackage,
			});
		}
	}
	tsReferencesByPackage.set(packageName, tsconfigReferences);

	if (data.tsconfig?.compilerOptions?.composite === true) {
		for (const dependency of [...requiredWorkspaceDeps].sort()) {
			if (!compositeWorkspacePackages.has(dependency)) continue;
			if (!tsconfigReferences.has(dependency)) {
				tsReferenceFindings.push({
					packageName,
					dir: data.dir,
					type: "missing",
					referencePackage: dependency,
				});
			}
		}
	}
}

if (missingDependencyFindings.length > 0) {
	console.error("Workspace dependency audit failed:");
	for (const finding of missingDependencyFindings) {
		console.error(`- ${finding.packageName} (${finding.dir}) imports ${finding.dependency} but does not declare it in package.json`);
	}
	process.exit(1);
}

if (tsReferenceFindings.length > 0) {
	console.error("TypeScript project-reference audit failed:");
	for (const finding of tsReferenceFindings) {
		if (finding.type === "invalid") {
			console.error(`- ${finding.packageName} (${finding.dir}) references ${finding.referencePath}, which does not resolve to a workspace package`);
			continue;
		}
		if (finding.type === "undeclared") {
			console.error(`- ${finding.packageName} (${finding.dir}) references ${finding.referencePackage} in tsconfig but does not declare it in package.json`);
			continue;
		}
		console.error(`- ${finding.packageName} (${finding.dir}) imports composite workspace dependency ${finding.referencePackage} but is missing a tsconfig reference`);
	}
	process.exit(1);
}

const dependencyGraph = new Map();
const reverseGraph = new Map();

for (const [packageName, data] of buildPackages) {
	const dependencies = new Set();
	for (const bucket of [
		data.manifest.dependencies ?? {},
		data.manifest.optionalDependencies ?? {},
		data.manifest.peerDependencies ?? {},
		data.manifest.devDependencies ?? {},
	]) {
		for (const dependencyName of Object.keys(bucket)) {
			if (workspacePackages.has(dependencyName)) {
				dependencies.add(dependencyName);
			}
		}
	}
	for (const dependencyName of tsReferencesByPackage.get(packageName) ?? []) {
		dependencies.add(dependencyName);
	}
	dependencyGraph.set(packageName, dependencies);
	reverseGraph.set(packageName, new Set());
}

for (const [packageName, dependencies] of dependencyGraph) {
	for (const dependency of dependencies) {
		if (!reverseGraph.has(dependency)) reverseGraph.set(dependency, new Set());
		reverseGraph.get(dependency).add(packageName);
	}
}

const indegree = new Map();
for (const [packageName, dependencies] of dependencyGraph) {
	indegree.set(packageName, dependencies.size);
}

const ready = [...indegree.entries()]
	.filter(([, count]) => count === 0)
	.map(([packageName]) => packageName)
	.sort((a, b) => workspacePackages.get(a).dir.localeCompare(workspacePackages.get(b).dir));

const buildOrder = [];
while (ready.length > 0) {
	const packageName = ready.shift();
	buildOrder.push(packageName);

	for (const dependent of reverseGraph.get(packageName) ?? []) {
		const nextDegree = (indegree.get(dependent) ?? 0) - 1;
		indegree.set(dependent, nextDegree);
		if (nextDegree === 0) {
			ready.push(dependent);
			ready.sort((a, b) => workspacePackages.get(a).dir.localeCompare(workspacePackages.get(b).dir));
		}
	}
}

if (buildOrder.length !== buildPackages.length) {
	const unresolved = buildPackages
		.map(([packageName]) => packageName)
		.filter((packageName) => !buildOrder.includes(packageName));
	console.error("Workspace build graph contains a cycle or unresolved dependency set:");
	for (const packageName of unresolved) {
		const deps = [...(dependencyGraph.get(packageName) ?? [])].join(", ");
		console.error(`- ${packageName}: ${deps}`);
	}
	process.exit(1);
}

console.log("Workspace build order:");
for (const packageName of buildOrder) {
	console.log(`- ${packageName}`);
}

if (dryRun || auditOnly) {
	process.exit(0);
}

function runPackageBuild(packageName) {
	return new Promise((resolve, reject) => {
		const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
		const child = spawn(command, ["--filter", packageName, "run", "build"], {
			cwd: rootDir,
			stdio: "inherit",
			env: process.env,
		});

		child.on("exit", (code, signal) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`${packageName} build failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`));
		});
		child.on("error", reject);
	});
}

for (const packageName of buildOrder) {
	console.log(`\n==> Building ${packageName}`);
	await runPackageBuild(packageName);
}

console.log("\nWorkspace build completed.");
