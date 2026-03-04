import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { extractSymbols, SemanticGraph, buildSemanticGraph } from "../src/semantic-graph.js";
import { buildImportGraph } from "../src/import-graph.js";
import { computePageRank, normalizeScores } from "../src/page-rank.js";

// ─── extractSymbols (pure, no filesystem) ──────────────────────────────────

describe("extractSymbols", () => {
	it("extracts exported functions", () => {
		const content = `export function doSomething() {}\nexport async function fetchData() {}`;
		const symbols = extractSymbols(content, "test.ts");

		expect(symbols).toContainEqual(expect.objectContaining({
			name: "doSomething", kind: "function", exported: true,
		}));
		expect(symbols).toContainEqual(expect.objectContaining({
			name: "fetchData", kind: "function", exported: true,
		}));
	});

	it("extracts exported classes", () => {
		const content = `export class UserAuthentication {}\nexport abstract class BaseService {}`;
		const symbols = extractSymbols(content, "auth.ts");

		expect(symbols).toContainEqual(expect.objectContaining({
			name: "UserAuthentication", kind: "class", exported: true,
		}));
		expect(symbols).toContainEqual(expect.objectContaining({
			name: "BaseService", kind: "class", exported: true,
		}));
	});

	it("extracts exported interfaces and types", () => {
		const content = [
			`export interface Config {}`,
			`export type UserId = string;`,
		].join("\n");
		const symbols = extractSymbols(content, "types.ts");

		expect(symbols).toContainEqual(expect.objectContaining({
			name: "Config", kind: "interface", exported: true,
		}));
		expect(symbols).toContainEqual(expect.objectContaining({
			name: "UserId", kind: "type", exported: true,
		}));
	});

	it("extracts exported const and enum", () => {
		const content = [
			`export const MAX_RETRIES = 3;`,
			`export enum Status { Active, Inactive }`,
		].join("\n");
		const symbols = extractSymbols(content, "constants.ts");

		expect(symbols).toContainEqual(expect.objectContaining({
			name: "MAX_RETRIES", kind: "const", exported: true,
		}));
		expect(symbols).toContainEqual(expect.objectContaining({
			name: "Status", kind: "enum", exported: true,
		}));
	});

	it("extracts non-exported symbols", () => {
		const content = [
			`function helperFn() {}`,
			`class InternalService {}`,
			`const SECRET = "abc";`,
		].join("\n");
		const symbols = extractSymbols(content, "internal.ts");

		expect(symbols).toContainEqual(expect.objectContaining({
			name: "helperFn", kind: "function", exported: false,
		}));
		expect(symbols).toContainEqual(expect.objectContaining({
			name: "InternalService", kind: "class", exported: false,
		}));
		expect(symbols).toContainEqual(expect.objectContaining({
			name: "SECRET", kind: "variable", exported: false,
		}));
	});

	it("includes correct line numbers", () => {
		const content = [
			`// line 1 comment`,
			`export function foo() {}`,
			``,
			`export class Bar {}`,
		].join("\n");
		const symbols = extractSymbols(content, "line-test.ts");

		const foo = symbols.find((s) => s.name === "foo");
		const bar = symbols.find((s) => s.name === "Bar");
		expect(foo).toBeDefined();
		expect(foo!.line).toBe(2);
		expect(bar).toBeDefined();
		expect(bar!.line).toBe(4);
	});

	it("handles empty content", () => {
		const symbols = extractSymbols("", "empty.ts");
		expect(symbols).toEqual([]);
	});

	it("sets filePath correctly", () => {
		const content = `export function test() {}`;
		const symbols = extractSymbols(content, "src/utils/test.ts");
		expect(symbols[0].filePath).toBe("src/utils/test.ts");
	});
});

// ─── SemanticGraph (requires temp filesystem) ──────────────────────────────

describe("SemanticGraph", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "netra-semantic-graph-"));
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

	/** Build a SemanticGraph manually from files. */
	function buildGraph(files: string[]): SemanticGraph {
		const importGraph = buildImportGraph(files, { projectDir: tmpDir });
		const prResult = computePageRank(importGraph);
		const rankScores = normalizeScores(prResult.scores);
		const symbolMap = new Map<string, ReturnType<typeof extractSymbols>>();
		for (const file of files) {
			const absPath = path.join(tmpDir, file);
			try {
				const content = fs.readFileSync(absPath, "utf-8");
				symbolMap.set(file, extractSymbols(content, file));
			} catch {
				symbolMap.set(file, []);
			}
		}
		return new SemanticGraph(tmpDir, importGraph, symbolMap, rankScores);
	}

	describe("findSymbol", () => {
		it("finds symbols by exact name", () => {
			writeFile("auth.ts", `export class UserAuthentication {}`);
			writeFile("app.ts", `import { UserAuthentication } from "./auth.js";`);

			const graph = buildGraph(["auth.ts", "app.ts"]);
			const results = graph.findSymbol("UserAuthentication");

			expect(results.length).toBe(1);
			expect(results[0].name).toBe("UserAuthentication");
			expect(results[0].filePath).toBe("auth.ts");
		});

		it("finds symbols by substring (case-insensitive)", () => {
			writeFile("auth.ts", `export class UserAuthentication {}\nexport function authenticateUser() {}`);

			const graph = buildGraph(["auth.ts"]);
			const results = graph.findSymbol("auth");

			expect(results.length).toBe(2);
			expect(results.map((s) => s.name)).toContain("UserAuthentication");
			expect(results.map((s) => s.name)).toContain("authenticateUser");
		});

		it("returns empty for no matches", () => {
			writeFile("app.ts", `export function main() {}`);
			const graph = buildGraph(["app.ts"]);

			expect(graph.findSymbol("nonexistent")).toEqual([]);
		});
	});

	describe("getDependents (upstream)", () => {
		it("returns files that import the target, depth=1", () => {
			writeFile("core.ts", `export const CORE = 1;`);
			writeFile("a.ts", `import { CORE } from "./core.js";`);
			writeFile("b.ts", `import { CORE } from "./core.js";`);
			writeFile("c.ts", `const x = 42;`);

			const graph = buildGraph(["core.ts", "a.ts", "b.ts", "c.ts"]);
			const result = graph.getDependents("core.ts", 1);

			const filePaths = result.nodes.map((n) => n.filePath);
			expect(filePaths).toContain("core.ts");
			expect(filePaths).toContain("a.ts");
			expect(filePaths).toContain("b.ts");
			expect(filePaths).not.toContain("c.ts");
		});

		it("traverses multiple levels with depth=2", () => {
			writeFile("base.ts", `export const BASE = 1;`);
			writeFile("mid.ts", `import { BASE } from "./base.js";\nexport const MID = 2;`);
			writeFile("top.ts", `import { MID } from "./mid.js";`);

			const graph = buildGraph(["base.ts", "mid.ts", "top.ts"]);
			const depth1 = graph.getDependents("base.ts", 1);
			const depth2 = graph.getDependents("base.ts", 2);

			// depth=1: base + mid
			expect(depth1.nodes.map((n) => n.filePath)).toContain("mid.ts");
			expect(depth1.nodes.map((n) => n.filePath)).not.toContain("top.ts");

			// depth=2: base + mid + top
			expect(depth2.nodes.map((n) => n.filePath)).toContain("top.ts");
		});
	});

	describe("getDependencies (downstream)", () => {
		it("returns files that the target imports, depth=1", () => {
			writeFile("utils.ts", `export function helper() {}`);
			writeFile("config.ts", `export const CONFIG = {};`);
			writeFile("app.ts", `import { helper } from "./utils.js";\nimport { CONFIG } from "./config.js";`);

			const graph = buildGraph(["utils.ts", "config.ts", "app.ts"]);
			const result = graph.getDependencies("app.ts", 1);

			const filePaths = result.nodes.map((n) => n.filePath);
			expect(filePaths).toContain("app.ts");
			expect(filePaths).toContain("utils.ts");
			expect(filePaths).toContain("config.ts");
		});
	});

	describe("query", () => {
		it("queries by symbol name with direction=both", () => {
			writeFile("types.ts", `export interface Config {}`);
			writeFile("loader.ts", `import { Config } from "./types.js";\nexport function loadConfig(): void {}`);
			writeFile("app.ts", `import { loadConfig } from "./loader.js";`);

			const graph = buildGraph(["types.ts", "loader.ts", "app.ts"]);
			const result = graph.query("Config", 1, "both");

			expect(result.entity).toBe("Config");
			expect(result.matchedSymbols.length).toBeGreaterThanOrEqual(1);
			expect(result.matchedSymbols[0].name).toBe("Config");
			// types.ts is in the subgraph (contains Config)
			expect(result.subgraph.nodes.map((n) => n.filePath)).toContain("types.ts");
		});

		it("queries by file path directly", () => {
			writeFile("utils.ts", `export function doStuff() {}`);
			writeFile("consumer.ts", `import { doStuff } from "./utils.js";`);

			const graph = buildGraph(["utils.ts", "consumer.ts"]);
			const result = graph.query("utils.ts", 1, "upstream");

			expect(result.subgraph.nodes.map((n) => n.filePath)).toContain("consumer.ts");
		});

		it("returns empty subgraph for unknown entity", () => {
			writeFile("app.ts", `export function main() {}`);
			const graph = buildGraph(["app.ts"]);
			const result = graph.query("NonExistentThing", 1, "both");

			expect(result.matchedSymbols).toEqual([]);
			expect(result.subgraph.nodes).toEqual([]);
		});

		it("respects direction=upstream", () => {
			writeFile("base.ts", `export const BASE = 1;`);
			writeFile("mid.ts", `import { BASE } from "./base.js";\nexport const MID = 2;`);
			writeFile("dep.ts", `export const DEP = 0;`);

			// base.ts does not import anything, so upstream=who imports base
			const graph = buildGraph(["base.ts", "mid.ts", "dep.ts"]);
			const result = graph.query("BASE", 1, "upstream");

			const filePaths = result.subgraph.nodes.map((n) => n.filePath);
			expect(filePaths).toContain("mid.ts");
			// dep.ts is unrelated
			expect(filePaths).not.toContain("dep.ts");
		});

		it("respects direction=downstream", () => {
			writeFile("dep.ts", `export const DEP = 1;`);
			writeFile("app.ts", `import { DEP } from "./dep.js";\nexport function main() {}`);
			writeFile("consumer.ts", `import { main } from "./app.js";`);

			const graph = buildGraph(["dep.ts", "app.ts", "consumer.ts"]);
			const result = graph.query("main", 1, "downstream");

			const filePaths = result.subgraph.nodes.map((n) => n.filePath);
			// app.ts imports dep.ts (downstream)
			expect(filePaths).toContain("dep.ts");
			// consumer.ts imports app.ts (upstream direction, should NOT appear)
			expect(filePaths).not.toContain("consumer.ts");
		});
	});

	describe("getHotSpots", () => {
		it("returns files sorted by PageRank score", () => {
			writeFile("core.ts", `export const CORE = 1;`);
			writeFile("a.ts", `import { CORE } from "./core.js";`);
			writeFile("b.ts", `import { CORE } from "./core.js";`);
			writeFile("c.ts", `import { CORE } from "./core.js";`);
			writeFile("lonely.ts", `const x = 1;`);

			const graph = buildGraph(["core.ts", "a.ts", "b.ts", "c.ts", "lonely.ts"]);
			const hotSpots = graph.getHotSpots(3);

			expect(hotSpots.nodes.length).toBeLessThanOrEqual(3);
			// core.ts should be the highest ranked (imported by 3 files)
			expect(hotSpots.nodes[0].filePath).toBe("core.ts");
			expect(hotSpots.nodes[0].rankScore).toBeGreaterThan(0);
		});

		it("handles empty graph", () => {
			const graph = new SemanticGraph(tmpDir, new Map(), new Map(), new Map());
			const hotSpots = graph.getHotSpots(5);
			expect(hotSpots.nodes).toEqual([]);
		});
	});

	describe("graph edges", () => {
		it("includes edges in subgraph results", () => {
			writeFile("a.ts", `export const A = 1;`);
			writeFile("b.ts", `import { A } from "./a.js";\nexport const B = 2;`);

			const graph = buildGraph(["a.ts", "b.ts"]);
			const result = graph.getDependents("a.ts", 1);

			expect(result.edges.length).toBeGreaterThan(0);
			expect(result.edges).toContainEqual({ from: "b.ts", to: "a.ts" });
		});
	});

	describe("depth tracking", () => {
		it("assigns correct depth to nodes", () => {
			writeFile("root.ts", `export const ROOT = 1;`);
			writeFile("l1.ts", `import { ROOT } from "./root.js";\nexport const L1 = 2;`);
			writeFile("l2.ts", `import { L1 } from "./l1.js";`);

			const graph = buildGraph(["root.ts", "l1.ts", "l2.ts"]);
			const result = graph.getDependents("root.ts", 2);

			const rootNode = result.nodes.find((n) => n.filePath === "root.ts");
			const l1Node = result.nodes.find((n) => n.filePath === "l1.ts");
			const l2Node = result.nodes.find((n) => n.filePath === "l2.ts");

			expect(rootNode?.depth).toBe(0);
			expect(l1Node?.depth).toBe(1);
			expect(l2Node?.depth).toBe(2);
		});
	});
});

// ─── buildSemanticGraph (integration) ──────────────────────────────────────

describe("buildSemanticGraph", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "netra-build-semantic-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function writeFile(relPath: string, content: string): void {
		const abs = path.join(tmpDir, relPath);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, content, "utf-8");
	}

	it("builds a complete semantic graph from project directory", () => {
		writeFile("src/index.ts", `import { helper } from "./utils.js";\nexport function main() {}`);
		writeFile("src/utils.ts", `export function helper() {}`);

		const graph = buildSemanticGraph(tmpDir, { extensions: [".ts"] });

		expect(graph.fileCount).toBe(2);
		expect(graph.findSymbol("helper").length).toBeGreaterThanOrEqual(1);
		expect(graph.findSymbol("main").length).toBe(1);
	});

	it("handles project with no source files", () => {
		// Empty project
		const graph = buildSemanticGraph(tmpDir, { extensions: [".ts"] });
		expect(graph.fileCount).toBe(0);
		expect(graph.findSymbol("anything")).toEqual([]);
	});
});
