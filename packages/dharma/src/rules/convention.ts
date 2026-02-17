/**
 * @chitragupta/dharma — Coding convention rules.
 * Enforce consistent code quality and project standards.
 */

import path from "path";
import type { PolicyRule, PolicyAction, PolicyContext, PolicyVerdict } from "../types.js";

// ─── Naming Convention Patterns ─────────────────────────────────────────────

const NAMING_PATTERNS: Record<string, RegExp> = {
	"kebab-case": /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
	"camelCase": /^[a-z][a-zA-Z0-9]*$/,
	"PascalCase": /^[A-Z][a-zA-Z0-9]*$/,
};

// ─── Rule Implementations ───────────────────────────────────────────────────

/**
 * Enforces file naming conventions for newly created files.
 * Default: kebab-case for .ts/.js files, PascalCase for React components.
 */
export const fileNamingConvention: PolicyRule = {
	id: "convention.file-naming",
	name: "File Naming Convention",
	description: "Enforces kebab-case naming for TypeScript/JavaScript files",
	severity: "warning",
	category: "convention",
	evaluate(action: PolicyAction, _context: PolicyContext): PolicyVerdict {
		if (action.type !== "file_write" || !action.filePath) {
			return { status: "allow", ruleId: this.id, reason: "Not a file write operation" };
		}

		const ext = path.extname(action.filePath);
		const codeExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"]);

		if (!codeExtensions.has(ext)) {
			return { status: "allow", ruleId: this.id, reason: "Not a code file" };
		}

		const basename = path.basename(action.filePath, ext);

		// Allow index files
		if (basename === "index") {
			return { status: "allow", ruleId: this.id, reason: "Index file is always allowed" };
		}

		// React components (.tsx, .jsx) can use PascalCase
		const isComponent = ext === ".tsx" || ext === ".jsx";
		if (isComponent && NAMING_PATTERNS["PascalCase"].test(basename)) {
			return { status: "allow", ruleId: this.id, reason: "PascalCase is acceptable for React components" };
		}

		// All other code files should be kebab-case
		if (!NAMING_PATTERNS["kebab-case"].test(basename)) {
			return {
				status: "warn",
				ruleId: this.id,
				reason: `File name "${basename}${ext}" does not follow kebab-case convention`,
				suggestion: `Rename to "${toKebabCase(basename)}${ext}"`,
			};
		}

		return { status: "allow", ruleId: this.id, reason: "File name follows convention" };
	},
};

/** Warns when writing files longer than 500 lines. */
export const noLargeFiles: PolicyRule = {
	id: "convention.no-large-files",
	name: "No Large Files",
	description: "Warns when writing files with more than 500 lines",
	severity: "warning",
	category: "convention",
	evaluate(action: PolicyAction, _context: PolicyContext): PolicyVerdict {
		if (action.type !== "file_write" || !action.content) {
			return { status: "allow", ruleId: this.id, reason: "Not a file write with content" };
		}

		const lineCount = action.content.split("\n").length;

		if (lineCount > 500) {
			return {
				status: "warn",
				ruleId: this.id,
				reason: `File has ${lineCount} lines (limit: 500). Consider splitting into smaller modules`,
				suggestion: "Break the file into smaller, focused modules",
			};
		}

		return { status: "allow", ruleId: this.id, reason: "File size is within limits" };
	},
};

/**
 * Warns when creating source files without corresponding test files.
 * Only applies to files in src/ directories.
 */
export const requireTestsForNewFiles: PolicyRule = {
	id: "convention.require-tests",
	name: "Require Tests for New Files",
	description: "Warns when creating source files without corresponding test files",
	severity: "info",
	category: "convention",
	evaluate(action: PolicyAction, context: PolicyContext): PolicyVerdict {
		if (action.type !== "file_write" || !action.filePath) {
			return { status: "allow", ruleId: this.id, reason: "Not a file write operation" };
		}

		const filePath = action.filePath;
		const ext = path.extname(filePath);
		const codeExtensions = new Set([".ts", ".js", ".mts", ".mjs"]);

		if (!codeExtensions.has(ext)) {
			return { status: "allow", ruleId: this.id, reason: "Not a code file" };
		}

		// Only check files in src/ directories
		const relativePath = path.relative(context.projectPath, filePath);
		if (!relativePath.startsWith("src" + path.sep) && !relativePath.startsWith("src/")) {
			return { status: "allow", ruleId: this.id, reason: "Not in src/ directory" };
		}

		// Skip index files and type-only files
		const basename = path.basename(filePath, ext);
		if (basename === "index" || basename === "types" || basename.endsWith(".d")) {
			return { status: "allow", ruleId: this.id, reason: "Index/type files do not need tests" };
		}

		// Check if a test file has been modified in this session
		const testPatterns = [
			filePath.replace(/\/src\//, "/test/").replace(ext, `.test${ext}`),
			filePath.replace(/\/src\//, "/tests/").replace(ext, `.test${ext}`),
			filePath.replace(/\/src\//, "/__tests__/").replace(ext, `.test${ext}`),
			filePath.replace(ext, `.test${ext}`),
			filePath.replace(ext, `.spec${ext}`),
		];

		const hasTest = testPatterns.some((tp) =>
			context.filesModified.some((f) => f === tp || f.endsWith(path.basename(tp))),
		);

		if (!hasTest) {
			return {
				status: "warn",
				ruleId: this.id,
				reason: `New source file "${basename}${ext}" has no corresponding test file`,
				suggestion: `Create a test file, e.g., "${basename}.test${ext}"`,
			};
		}

		return { status: "allow", ruleId: this.id, reason: "Test file exists for this source file" };
	},
};

/** Warns on writing console.log statements in production source code. */
export const noDirectConsoleLog: PolicyRule = {
	id: "convention.no-console-log",
	name: "No Direct console.log",
	description: "Warns when writing console.log in production source code",
	severity: "info",
	category: "convention",
	evaluate(action: PolicyAction, _context: PolicyContext): PolicyVerdict {
		if (action.type !== "file_write" || !action.content || !action.filePath) {
			return { status: "allow", ruleId: this.id, reason: "Not a file write with content" };
		}

		// Skip test files and config files
		const filePath = action.filePath;
		if (/\.(test|spec|config|setup)\.[jt]sx?$/.test(filePath)) {
			return { status: "allow", ruleId: this.id, reason: "Test/config files may use console.log" };
		}

		// Only check code files in src/
		if (!filePath.includes("/src/")) {
			return { status: "allow", ruleId: this.id, reason: "Not in src/ directory" };
		}

		const consoleLogPattern = /\bconsole\.log\s*\(/;
		if (consoleLogPattern.test(action.content)) {
			return {
				status: "warn",
				ruleId: this.id,
				reason: "File contains console.log() — use a proper logger instead",
				suggestion: "Use a structured logger (e.g., from @chitragupta/core) instead of console.log",
			};
		}

		return { status: "allow", ruleId: this.id, reason: "No console.log found" };
	},
};

/**
 * Checks import ordering: external packages, then internal (@chitragupta/*),
 * then relative imports.
 */
export const importOrderConvention: PolicyRule = {
	id: "convention.import-order",
	name: "Import Order Convention",
	description: "Checks that imports are ordered: external -> internal (@chitragupta/*) -> relative",
	severity: "info",
	category: "convention",
	evaluate(action: PolicyAction, _context: PolicyContext): PolicyVerdict {
		if (action.type !== "file_write" || !action.content || !action.filePath) {
			return { status: "allow", ruleId: this.id, reason: "Not a file write with content" };
		}

		const ext = path.extname(action.filePath);
		const codeExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"]);
		if (!codeExtensions.has(ext)) {
			return { status: "allow", ruleId: this.id, reason: "Not a code file" };
		}

		const lines = action.content.split("\n");
		const importLines: Array<{ line: string; group: "external" | "internal" | "relative" }> = [];

		for (const line of lines) {
			const match = line.match(/^import\s.*from\s+["']([^"']+)["']/);
			if (!match) continue;

			const specifier = match[1];
			let group: "external" | "internal" | "relative";

			if (specifier.startsWith(".") || specifier.startsWith("/")) {
				group = "relative";
			} else if (specifier.startsWith("@chitragupta/")) {
				group = "internal";
			} else {
				group = "external";
			}

			importLines.push({ line, group });
		}

		if (importLines.length < 2) {
			return { status: "allow", ruleId: this.id, reason: "Too few imports to check ordering" };
		}

		// Check ordering: external -> internal -> relative
		const groupOrder: Record<string, number> = { external: 0, internal: 1, relative: 2 };
		let lastGroup = -1;

		for (const imp of importLines) {
			const currentGroup = groupOrder[imp.group];
			if (currentGroup < lastGroup) {
				return {
					status: "warn",
					ruleId: this.id,
					reason: "Import order is incorrect — expected: external packages, then @chitragupta/*, then relative imports",
					suggestion: "Reorder imports: external (node:*, npm) -> internal (@chitragupta/*) -> relative (./)",
				};
			}
			lastGroup = currentGroup;
		}

		return { status: "allow", ruleId: this.id, reason: "Import order is correct" };
	},
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function toKebabCase(str: string): string {
	return str
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
		.replace(/[_\s]+/g, "-")
		.toLowerCase();
}

/** All built-in convention rules. */
export const CONVENTION_RULES: PolicyRule[] = [
	fileNamingConvention,
	noLargeFiles,
	requireTestsForNewFiles,
	noDirectConsoleLog,
	importOrderConvention,
];
