import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { extractImports, buildImportGraph, reverseGraph } from "../src/import-graph.js";

// ─── extractImports (pure, no filesystem) ───────────────────────────────────

describe("extractImports", () => {
	it("extracts named imports", () => {
		const result = extractImports(`import { foo, bar } from "./utils";`);
		expect(result).toEqual(["./utils"]);
	});

	it("extracts default imports", () => {
		const result = extractImports(`import Config from "./config";`);
		expect(result).toEqual(["./config"]);
	});

	it("extracts namespace imports", () => {
		const result = extractImports(`import * as helpers from "./helpers";`);
		expect(result).toEqual(["./helpers"]);
	});

	it("extracts dynamic imports", () => {
		const result = extractImports(`const mod = import("./lazy-module");`);
		expect(result).toEqual(["./lazy-module"]);
	});

	it("extracts require calls", () => {
		const result = extractImports(`const x = require("./old-module");`);
		expect(result).toEqual(["./old-module"]);
	});

	it("extracts re-exports", () => {
		const result = extractImports(`export { thing } from "./thing";`);
		expect(result).toEqual(["./thing"]);
	});

	it("extracts star re-exports", () => {
		const result = extractImports(`export * from "./barrel";`);
		expect(result).toEqual(["./barrel"]);
	});

	it("skips npm package imports", () => {
		const result = extractImports(`import express from "express";`);
		expect(result).toEqual([]);
	});

	it("skips node builtins", () => {
		const result = extractImports(`import fs from "node:fs";`);
		expect(result).toEqual([]);
	});

	it("handles multiple imports in one file", () => {
		const content = [
			`import { a } from "./alpha";`,
			`import { b } from "./beta";`,
			`import x from "external";`,
			`const c = require("./gamma");`,
		].join("\n");
		const result = extractImports(content);
		expect(result).toContain("./alpha");
		expect(result).toContain("./beta");
		expect(result).toContain("./gamma");
		expect(result).not.toContain("external");
		expect(result.length).toBe(3);
	});

	it("deduplicates repeated imports", () => {
		const content = [
			`import { a } from "./shared";`,
			`import { b } from "./shared";`,
		].join("\n");
		const result = extractImports(content);
		expect(result).toEqual(["./shared"]);
	});

	it("handles .js extension in ESM imports", () => {
		const result = extractImports(`import { x } from "./foo.js";`);
		expect(result).toEqual(["./foo.js"]);
	});

	it("handles parent directory imports", () => {
		const result = extractImports(`import { x } from "../parent/mod";`);
		expect(result).toEqual(["../parent/mod"]);
	});
});

// ─── buildImportGraph (requires temp filesystem) ────────────────────────────

describe("buildImportGraph", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "netra-import-graph-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	/** Helper to write a file in the temp project. */
	function writeFile(relPath: string, content: string): void {
		const abs = path.join(tmpDir, relPath);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, content, "utf-8");
	}

	it("builds graph with resolved imports", () => {
		writeFile("src/index.ts", `import { foo } from "./utils.js";`);
		writeFile("src/utils.ts", `export function foo() {}`);

		const graph = buildImportGraph(
			["src/index.ts", "src/utils.ts"],
			{ projectDir: tmpDir },
		);

		expect(graph.get("src/index.ts")).toEqual(["src/utils.ts"]);
		expect(graph.get("src/utils.ts")).toEqual([]);
	});

	it("resolves .js to .ts (ESM convention)", () => {
		writeFile("a.ts", `import { x } from "./b.js";`);
		writeFile("b.ts", `export const x = 1;`);

		const graph = buildImportGraph(["a.ts", "b.ts"], { projectDir: tmpDir });
		expect(graph.get("a.ts")).toEqual(["b.ts"]);
	});

	it("resolves index imports", () => {
		writeFile("main.ts", `import { thing } from "./lib";`);
		writeFile("lib/index.ts", `export const thing = 42;`);

		const graph = buildImportGraph(
			["main.ts", "lib/index.ts"],
			{ projectDir: tmpDir },
		);
		expect(graph.get("main.ts")).toEqual(["lib/index.ts"]);
	});

	it("initializes all files even without imports", () => {
		writeFile("lonely.ts", `const x = 42;`);
		const graph = buildImportGraph(["lonely.ts"], { projectDir: tmpDir });
		expect(graph.has("lonely.ts")).toBe(true);
		expect(graph.get("lonely.ts")).toEqual([]);
	});

	it("only includes edges to known project files", () => {
		writeFile("app.ts", `import { foo } from "./exists.js";\nimport { bar } from "./missing.js";`);
		writeFile("exists.ts", `export const foo = 1;`);

		const graph = buildImportGraph(
			["app.ts", "exists.ts"],
			{ projectDir: tmpDir },
		);
		// "missing.ts" doesn't exist and isn't in the file list
		expect(graph.get("app.ts")).toEqual(["exists.ts"]);
	});

	it("handles circular imports", () => {
		writeFile("a.ts", `import { b } from "./b.js";`);
		writeFile("b.ts", `import { a } from "./a.js";`);

		const graph = buildImportGraph(["a.ts", "b.ts"], { projectDir: tmpDir });
		expect(graph.get("a.ts")).toEqual(["b.ts"]);
		expect(graph.get("b.ts")).toEqual(["a.ts"]);
	});
});

// ─── reverseGraph ───────────────────────────────────────────────────────────

describe("reverseGraph", () => {
	it("reverses edges correctly", () => {
		const graph = new Map<string, string[]>([
			["a.ts", ["b.ts", "c.ts"]],
			["b.ts", ["c.ts"]],
			["c.ts", []],
		]);
		const reversed = reverseGraph(graph);

		expect(reversed.get("a.ts")).toEqual([]);
		expect(reversed.get("b.ts")).toEqual(["a.ts"]);
		expect(reversed.get("c.ts")!.sort()).toEqual(["a.ts", "b.ts"]);
	});

	it("handles empty graph", () => {
		const reversed = reverseGraph(new Map());
		expect(reversed.size).toBe(0);
	});

	it("handles graph with no edges", () => {
		const graph = new Map<string, string[]>([
			["a.ts", []],
			["b.ts", []],
		]);
		const reversed = reverseGraph(graph);
		expect(reversed.get("a.ts")).toEqual([]);
		expect(reversed.get("b.ts")).toEqual([]);
	});
});
