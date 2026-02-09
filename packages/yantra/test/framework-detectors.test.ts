import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	SKIP_DIRS,
	BINARY_EXTENSIONS,
	detectLanguages,
	detectFrameworks,
	findEntryPoints,
	analyzeDependencies,
	countLines,
	analyzeFileTypes,
} from "@chitragupta/yantra";
import type { FileTypeCount } from "@chitragupta/yantra";

// ─── Mock node:fs ───────────────────────────────────────────────────────────

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		existsSync: vi.fn(() => false),
		promises: {
			...actual.promises,
			readFile: vi.fn(),
			access: vi.fn(),
		},
	};
});

const mockReadFile = vi.mocked(fs.promises.readFile);
const mockAccess = vi.mocked(fs.promises.access);
const mockExistsSync = vi.mocked(fs.existsSync);

beforeEach(() => {
	vi.clearAllMocks();
	mockReadFile.mockRejectedValue(new Error("ENOENT"));
	mockAccess.mockRejectedValue(new Error("ENOENT"));
	mockExistsSync.mockReturnValue(false);
});

// ─── SKIP_DIRS ──────────────────────────────────────────────────────────────

describe("SKIP_DIRS", () => {
	it("contains node_modules", () => {
		expect(SKIP_DIRS.has("node_modules")).toBe(true);
	});

	it("contains .git", () => {
		expect(SKIP_DIRS.has(".git")).toBe(true);
	});

	it("contains dist", () => {
		expect(SKIP_DIRS.has("dist")).toBe(true);
	});

	it("contains build", () => {
		expect(SKIP_DIRS.has("build")).toBe(true);
	});

	it("contains __pycache__", () => {
		expect(SKIP_DIRS.has("__pycache__")).toBe(true);
	});

	it("contains .next", () => {
		expect(SKIP_DIRS.has(".next")).toBe(true);
	});

	it("contains target", () => {
		expect(SKIP_DIRS.has("target")).toBe(true);
	});

	it("contains vendor", () => {
		expect(SKIP_DIRS.has("vendor")).toBe(true);
	});

	it("contains coverage", () => {
		expect(SKIP_DIRS.has("coverage")).toBe(true);
	});

	it("contains .cache", () => {
		expect(SKIP_DIRS.has(".cache")).toBe(true);
	});

	it("does not contain src (should not skip source dirs)", () => {
		expect(SKIP_DIRS.has("src")).toBe(false);
	});
});

// ─── BINARY_EXTENSIONS ─────────────────────────────────────────────────────

describe("BINARY_EXTENSIONS", () => {
	it("contains image extensions", () => {
		expect(BINARY_EXTENSIONS.has(".png")).toBe(true);
		expect(BINARY_EXTENSIONS.has(".jpg")).toBe(true);
		expect(BINARY_EXTENSIONS.has(".gif")).toBe(true);
		expect(BINARY_EXTENSIONS.has(".jpeg")).toBe(true);
	});

	it("contains archive extensions", () => {
		expect(BINARY_EXTENSIONS.has(".zip")).toBe(true);
		expect(BINARY_EXTENSIONS.has(".tar")).toBe(true);
		expect(BINARY_EXTENSIONS.has(".gz")).toBe(true);
	});

	it("contains document extensions", () => {
		expect(BINARY_EXTENSIONS.has(".pdf")).toBe(true);
		expect(BINARY_EXTENSIONS.has(".doc")).toBe(true);
		expect(BINARY_EXTENSIONS.has(".docx")).toBe(true);
	});

	it("contains executable extensions", () => {
		expect(BINARY_EXTENSIONS.has(".exe")).toBe(true);
		expect(BINARY_EXTENSIONS.has(".dll")).toBe(true);
		expect(BINARY_EXTENSIONS.has(".so")).toBe(true);
		expect(BINARY_EXTENSIONS.has(".dylib")).toBe(true);
	});

	it("contains compiled extensions", () => {
		expect(BINARY_EXTENSIONS.has(".pyc")).toBe(true);
		expect(BINARY_EXTENSIONS.has(".class")).toBe(true);
		expect(BINARY_EXTENSIONS.has(".wasm")).toBe(true);
	});

	it("contains font extensions", () => {
		expect(BINARY_EXTENSIONS.has(".woff")).toBe(true);
		expect(BINARY_EXTENSIONS.has(".woff2")).toBe(true);
		expect(BINARY_EXTENSIONS.has(".ttf")).toBe(true);
	});

	it("contains media extensions", () => {
		expect(BINARY_EXTENSIONS.has(".mp3")).toBe(true);
		expect(BINARY_EXTENSIONS.has(".mp4")).toBe(true);
		expect(BINARY_EXTENSIONS.has(".wav")).toBe(true);
	});

	it("does not contain source code extensions", () => {
		expect(BINARY_EXTENSIONS.has(".ts")).toBe(false);
		expect(BINARY_EXTENSIONS.has(".js")).toBe(false);
		expect(BINARY_EXTENSIONS.has(".py")).toBe(false);
	});
});

// ─── detectLanguages ────────────────────────────────────────────────────────

describe("detectLanguages", () => {
	it("detects a single language from .ts files", () => {
		const byType: FileTypeCount[] = [
			{ extension: ".ts", count: 10, totalLines: 500 },
		];
		const langs = detectLanguages(byType);

		expect(langs).toContain("TypeScript");
		expect(langs).toHaveLength(1);
	});

	it("detects multiple languages", () => {
		const byType: FileTypeCount[] = [
			{ extension: ".ts", count: 5, totalLines: 200 },
			{ extension: ".py", count: 3, totalLines: 100 },
			{ extension: ".rs", count: 2, totalLines: 80 },
			{ extension: ".go", count: 1, totalLines: 40 },
		];
		const langs = detectLanguages(byType);

		expect(langs).toContain("TypeScript");
		expect(langs).toContain("Python");
		expect(langs).toContain("Rust");
		expect(langs).toContain("Go");
	});

	it("ignores unknown extensions", () => {
		const byType: FileTypeCount[] = [
			{ extension: ".xyz", count: 5, totalLines: 100 },
			{ extension: ".unknown", count: 3, totalLines: 50 },
		];
		const langs = detectLanguages(byType);

		expect(langs).toHaveLength(0);
	});

	it("returns empty array for empty input", () => {
		const langs = detectLanguages([]);
		expect(langs).toHaveLength(0);
	});

	it("ignores entries with zero count", () => {
		const byType: FileTypeCount[] = [
			{ extension: ".ts", count: 0, totalLines: 0 },
		];
		const langs = detectLanguages(byType);

		expect(langs).toHaveLength(0);
	});

	it("deduplicates languages from related extensions (.ts and .tsx both map to TypeScript)", () => {
		const byType: FileTypeCount[] = [
			{ extension: ".ts", count: 5, totalLines: 200 },
			{ extension: ".tsx", count: 3, totalLines: 100 },
		];
		const langs = detectLanguages(byType);

		expect(langs).toContain("TypeScript");
		expect(langs).toHaveLength(1);
	});

	it("detects JavaScript from .js, .jsx, .mjs, .cjs", () => {
		const byType: FileTypeCount[] = [
			{ extension: ".js", count: 2, totalLines: 50 },
			{ extension: ".jsx", count: 1, totalLines: 20 },
			{ extension: ".mjs", count: 1, totalLines: 10 },
			{ extension: ".cjs", count: 1, totalLines: 10 },
		];
		const langs = detectLanguages(byType);

		expect(langs).toContain("JavaScript");
		expect(langs).toHaveLength(1);
	});

	it("detects Ruby, Java, Kotlin, Swift", () => {
		const byType: FileTypeCount[] = [
			{ extension: ".rb", count: 2, totalLines: 60 },
			{ extension: ".java", count: 3, totalLines: 100 },
			{ extension: ".kt", count: 1, totalLines: 30 },
			{ extension: ".swift", count: 1, totalLines: 40 },
		];
		const langs = detectLanguages(byType);

		expect(langs).toContain("Ruby");
		expect(langs).toContain("Java");
		expect(langs).toContain("Kotlin");
		expect(langs).toContain("Swift");
	});
});

// ─── detectFrameworks ───────────────────────────────────────────────────────

describe("detectFrameworks", () => {
	it("detects React from package.json dependency", async () => {
		mockReadFile.mockImplementation(async (p: any) => {
			if (String(p).endsWith("package.json")) {
				return JSON.stringify({
					dependencies: { react: "^18.0.0" },
				});
			}
			throw new Error("ENOENT");
		});

		const frameworks = await detectFrameworks("/project");
		expect(frameworks).toContain("React");
	});

	it("detects Express from package.json dependency", async () => {
		mockReadFile.mockImplementation(async (p: any) => {
			if (String(p).endsWith("package.json")) {
				return JSON.stringify({
					dependencies: { express: "^4.18.0" },
				});
			}
			throw new Error("ENOENT");
		});

		const frameworks = await detectFrameworks("/project");
		expect(frameworks).toContain("Express");
	});

	it("detects Next.js from next.config.js file presence", async () => {
		mockAccess.mockImplementation(async (p: any) => {
			if (String(p).endsWith("next.config.js")) return;
			throw new Error("ENOENT");
		});

		const frameworks = await detectFrameworks("/project");
		expect(frameworks).toContain("Next.js");
	});

	it("detects Next.js from next.config.mjs file presence", async () => {
		mockAccess.mockImplementation(async (p: any) => {
			if (String(p).endsWith("next.config.mjs")) return;
			throw new Error("ENOENT");
		});

		const frameworks = await detectFrameworks("/project");
		expect(frameworks).toContain("Next.js");
	});

	it("detects Angular from angular.json file presence", async () => {
		mockAccess.mockImplementation(async (p: any) => {
			if (String(p).endsWith("angular.json")) return;
			throw new Error("ENOENT");
		});

		const frameworks = await detectFrameworks("/project");
		expect(frameworks).toContain("Angular");
	});

	it("detects Svelte from svelte.config.js file presence", async () => {
		mockAccess.mockImplementation(async (p: any) => {
			if (String(p).endsWith("svelte.config.js")) return;
			throw new Error("ENOENT");
		});

		const frameworks = await detectFrameworks("/project");
		expect(frameworks).toContain("Svelte");
	});

	it("detects Django from manage.py file presence", async () => {
		mockAccess.mockImplementation(async (p: any) => {
			if (String(p).endsWith("manage.py")) return;
			throw new Error("ENOENT");
		});

		const frameworks = await detectFrameworks("/project");
		expect(frameworks).toContain("Django");
	});

	it("detects Flask from requirements.txt with flask dep", async () => {
		mockReadFile.mockImplementation(async (p: any) => {
			if (String(p).endsWith("requirements.txt")) {
				return "flask>=2.0\nrequests==2.28.0\n";
			}
			throw new Error("ENOENT");
		});

		const frameworks = await detectFrameworks("/project");
		expect(frameworks).toContain("Flask");
	});

	it("detects FastAPI from requirements.txt with fastapi dep", async () => {
		mockReadFile.mockImplementation(async (p: any) => {
			if (String(p).endsWith("requirements.txt")) {
				return "fastapi\nuvicorn\n";
			}
			throw new Error("ENOENT");
		});

		const frameworks = await detectFrameworks("/project");
		expect(frameworks).toContain("FastAPI");
	});

	it("detects Rails from Gemfile with rails dep", async () => {
		mockReadFile.mockImplementation(async (p: any) => {
			const pathStr = String(p);
			if (pathStr.endsWith("Gemfile")) {
				return "source 'https://rubygems.org'\ngem 'rails', '~> 7.0'\n";
			}
			throw new Error("ENOENT");
		});

		const frameworks = await detectFrameworks("/project");
		expect(frameworks).toContain("Rails");
	});

	it("detects Cargo (Rust) from Cargo.toml file presence", async () => {
		mockAccess.mockImplementation(async (p: any) => {
			if (String(p).endsWith("Cargo.toml")) return;
			throw new Error("ENOENT");
		});

		const frameworks = await detectFrameworks("/project");
		expect(frameworks).toContain("Cargo (Rust)");
	});

	it("detects Go module from go.mod file presence", async () => {
		mockAccess.mockImplementation(async (p: any) => {
			if (String(p).endsWith("go.mod")) return;
			throw new Error("ENOENT");
		});

		const frameworks = await detectFrameworks("/project");
		expect(frameworks).toContain("Go module");
	});

	it("detects Docker from Dockerfile presence", async () => {
		mockAccess.mockImplementation(async (p: any) => {
			if (String(p).endsWith("Dockerfile")) return;
			throw new Error("ENOENT");
		});

		const frameworks = await detectFrameworks("/project");
		expect(frameworks).toContain("Docker");
	});

	it("returns empty array when no frameworks match", async () => {
		const frameworks = await detectFrameworks("/empty-project");
		expect(frameworks).toEqual([]);
	});

	it("detects multiple frameworks simultaneously", async () => {
		mockReadFile.mockImplementation(async (p: any) => {
			const pathStr = String(p);
			if (pathStr.endsWith("package.json")) {
				return JSON.stringify({
					dependencies: { react: "^18.0.0", express: "^4.18.0" },
					devDependencies: {},
				});
			}
			throw new Error("ENOENT");
		});

		const frameworks = await detectFrameworks("/project");
		expect(frameworks).toContain("React");
		expect(frameworks).toContain("Express");
	});

	it("detects framework from devDependencies too", async () => {
		mockReadFile.mockImplementation(async (p: any) => {
			if (String(p).endsWith("package.json")) {
				return JSON.stringify({
					dependencies: {},
					devDependencies: { vue: "^3.0.0" },
				});
			}
			throw new Error("ENOENT");
		});

		const frameworks = await detectFrameworks("/project");
		expect(frameworks).toContain("Vue");
	});

	it("detects Fastify from package.json", async () => {
		mockReadFile.mockImplementation(async (p: any) => {
			if (String(p).endsWith("package.json")) {
				return JSON.stringify({
					dependencies: { fastify: "^4.0.0" },
				});
			}
			throw new Error("ENOENT");
		});

		const frameworks = await detectFrameworks("/project");
		expect(frameworks).toContain("Fastify");
	});
});

// ─── findEntryPoints ────────────────────────────────────────────────────────

describe("findEntryPoints", () => {
	it("finds index.ts and main.ts", () => {
		const files = [
			{ path: "/project/index.ts", ext: ".ts", size: 100 },
			{ path: "/project/main.ts", ext: ".ts", size: 200 },
			{ path: "/project/utils.ts", ext: ".ts", size: 50 },
		];

		const entries = findEntryPoints(files, "/project");
		expect(entries).toContain("index.ts");
		expect(entries).toContain("main.ts");
		expect(entries).not.toContain("utils.ts");
	});

	it("finds app.ts and server.ts", () => {
		const files = [
			{ path: "/project/app.ts", ext: ".ts", size: 100 },
			{ path: "/project/server.ts", ext: ".ts", size: 200 },
		];

		const entries = findEntryPoints(files, "/project");
		expect(entries).toContain("app.ts");
		expect(entries).toContain("server.ts");
	});

	it("finds JavaScript entry points", () => {
		const files = [
			{ path: "/project/index.js", ext: ".js", size: 100 },
			{ path: "/project/app.js", ext: ".js", size: 200 },
		];

		const entries = findEntryPoints(files, "/project");
		expect(entries).toContain("index.js");
		expect(entries).toContain("app.js");
	});

	it("finds Python entry points", () => {
		const files = [
			{ path: "/project/main.py", ext: ".py", size: 100 },
			{ path: "/project/app.py", ext: ".py", size: 200 },
			{ path: "/project/__main__.py", ext: ".py", size: 50 },
		];

		const entries = findEntryPoints(files, "/project");
		expect(entries).toContain("__main__.py");
		expect(entries).toContain("app.py");
		expect(entries).toContain("main.py");
	});

	it("finds Go and Rust entry points", () => {
		const files = [
			{ path: "/project/main.go", ext: ".go", size: 100 },
			{ path: "/project/main.rs", ext: ".rs", size: 200 },
			{ path: "/project/lib.rs", ext: ".rs", size: 150 },
		];

		const entries = findEntryPoints(files, "/project");
		expect(entries).toContain("lib.rs");
		expect(entries).toContain("main.go");
		expect(entries).toContain("main.rs");
	});

	it("ignores non-entry files", () => {
		const files = [
			{ path: "/project/utils.ts", ext: ".ts", size: 100 },
			{ path: "/project/helpers.js", ext: ".js", size: 200 },
			{ path: "/project/config.json", ext: ".json", size: 50 },
		];

		const entries = findEntryPoints(files, "/project");
		expect(entries).toHaveLength(0);
	});

	it("handles nested paths with basename matching", () => {
		const files = [
			{ path: "/project/src/index.ts", ext: ".ts", size: 100 },
			{ path: "/project/cmd/main.go", ext: ".go", size: 200 },
		];

		const entries = findEntryPoints(files, "/project");
		expect(entries).toContain("src/index.ts");
		expect(entries).toContain("cmd/main.go");
	});

	it("returns sorted results", () => {
		const files = [
			{ path: "/project/server.ts", ext: ".ts", size: 100 },
			{ path: "/project/app.ts", ext: ".ts", size: 200 },
			{ path: "/project/index.ts", ext: ".ts", size: 50 },
		];

		const entries = findEntryPoints(files, "/project");
		expect(entries).toEqual(["app.ts", "index.ts", "server.ts"]);
	});

	it("returns empty array for empty file list", () => {
		const entries = findEntryPoints([], "/project");
		expect(entries).toHaveLength(0);
	});

	it("finds TSX/JSX entry points", () => {
		const files = [
			{ path: "/project/index.tsx", ext: ".tsx", size: 100 },
			{ path: "/project/main.jsx", ext: ".jsx", size: 200 },
		];

		const entries = findEntryPoints(files, "/project");
		expect(entries).toContain("index.tsx");
		expect(entries).toContain("main.jsx");
	});
});

// ─── analyzeDependencies ────────────────────────────────────────────────────

describe("analyzeDependencies", () => {
	it("reads Node.js dependencies from package.json", async () => {
		mockReadFile.mockImplementation(async (p: any) => {
			if (String(p).endsWith("package.json")) {
				return JSON.stringify({
					dependencies: { express: "^4.18.0", lodash: "^4.17.21" },
					devDependencies: { vitest: "^1.0.0" },
				});
			}
			throw new Error("ENOENT");
		});

		const result = await analyzeDependencies("/project");
		const directDeps = result.deps.filter((d) => d.type === "direct");
		const devDeps = result.deps.filter((d) => d.type === "dev");

		expect(directDeps).toHaveLength(2);
		expect(devDeps).toHaveLength(1);
		expect(directDeps.find((d) => d.name === "express")).toBeDefined();
		expect(directDeps.find((d) => d.name === "lodash")).toBeDefined();
		expect(devDeps[0].name).toBe("vitest");
	});

	it("detects pnpm package manager", async () => {
		mockReadFile.mockImplementation(async (p: any) => {
			if (String(p).endsWith("package.json")) {
				return JSON.stringify({ dependencies: {} });
			}
			throw new Error("ENOENT");
		});
		mockExistsSync.mockImplementation((p: any) => {
			return String(p).endsWith("pnpm-lock.yaml");
		});

		const result = await analyzeDependencies("/project");
		expect(result.packageManager).toBe("pnpm");
	});

	it("detects yarn package manager", async () => {
		mockReadFile.mockImplementation(async (p: any) => {
			if (String(p).endsWith("package.json")) {
				return JSON.stringify({ dependencies: {} });
			}
			throw new Error("ENOENT");
		});
		mockExistsSync.mockImplementation((p: any) => {
			return String(p).endsWith("yarn.lock");
		});

		const result = await analyzeDependencies("/project");
		expect(result.packageManager).toBe("yarn");
	});

	it("detects npm package manager", async () => {
		mockReadFile.mockImplementation(async (p: any) => {
			if (String(p).endsWith("package.json")) {
				return JSON.stringify({ dependencies: {} });
			}
			throw new Error("ENOENT");
		});
		mockExistsSync.mockImplementation((p: any) => {
			return String(p).endsWith("package-lock.json");
		});

		const result = await analyzeDependencies("/project");
		expect(result.packageManager).toBe("npm");
	});

	it("detects bun package manager", async () => {
		mockReadFile.mockImplementation(async (p: any) => {
			if (String(p).endsWith("package.json")) {
				return JSON.stringify({ dependencies: {} });
			}
			throw new Error("ENOENT");
		});
		mockExistsSync.mockImplementation((p: any) => {
			return String(p).endsWith("bun.lockb");
		});

		const result = await analyzeDependencies("/project");
		expect(result.packageManager).toBe("bun");
	});

	it("reads Rust dependencies from Cargo.toml", async () => {
		mockReadFile.mockImplementation(async (p: any) => {
			const pathStr = String(p);
			if (pathStr.endsWith("Cargo.toml")) {
				return [
					"[package]",
					'name = "myapp"',
					"",
					"[dependencies]",
					'serde = "1.0"',
					'tokio = "1.0"',
					"",
					"[dev-dependencies]",
					'criterion = "0.5"',
				].join("\n");
			}
			throw new Error("ENOENT");
		});

		const result = await analyzeDependencies("/project");
		const directDeps = result.deps.filter((d) => d.type === "direct");
		const devDeps = result.deps.filter((d) => d.type === "dev");

		expect(directDeps).toHaveLength(2);
		expect(directDeps.find((d) => d.name === "serde")).toBeDefined();
		expect(directDeps.find((d) => d.name === "tokio")).toBeDefined();
		expect(devDeps).toHaveLength(1);
		expect(devDeps[0].name).toBe("criterion");
	});

	it("reads Go dependencies from go.mod", async () => {
		mockReadFile.mockImplementation(async (p: any) => {
			const pathStr = String(p);
			if (pathStr.endsWith("go.mod")) {
				return [
					"module example.com/myapp",
					"",
					"go 1.21",
					"",
					"require (",
					"\tgithub.com/gin-gonic/gin v1.9.1",
					"\tgithub.com/stretchr/testify v1.8.4",
					")",
				].join("\n");
			}
			throw new Error("ENOENT");
		});

		const result = await analyzeDependencies("/project");
		expect(result.deps).toHaveLength(2);
		expect(result.deps.find((d) => d.name === "github.com/gin-gonic/gin")).toBeDefined();
		expect(result.deps.find((d) => d.name === "github.com/stretchr/testify")).toBeDefined();
	});

	it("returns empty deps when no manifest files exist", async () => {
		const result = await analyzeDependencies("/empty");
		expect(result.deps).toHaveLength(0);
		expect(result.packageManager).toBeUndefined();
	});

	it("reads from multiple manifest files in one project", async () => {
		mockReadFile.mockImplementation(async (p: any) => {
			const pathStr = String(p);
			if (pathStr.endsWith("package.json")) {
				return JSON.stringify({ dependencies: { express: "^4.0.0" } });
			}
			if (pathStr.endsWith("Cargo.toml")) {
				return "[dependencies]\nserde = \"1.0\"\n";
			}
			if (pathStr.endsWith("go.mod")) {
				return "module app\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n)\n";
			}
			throw new Error("ENOENT");
		});

		const result = await analyzeDependencies("/polyglot");
		expect(result.deps.length).toBeGreaterThanOrEqual(3);
	});
});

// ─── countLines ─────────────────────────────────────────────────────────────

describe("countLines", () => {
	it("counts total lines in a simple string", () => {
		expect(countLines("line1\nline2\nline3")).toBe(3);
	});

	it("returns 1 for a single line (no newline)", () => {
		expect(countLines("hello")).toBe(1);
	});

	it("returns 0 for empty string", () => {
		expect(countLines("")).toBe(0);
	});

	it("counts trailing newline as an extra line", () => {
		expect(countLines("line1\nline2\n")).toBe(3);
	});

	it("counts lines with only newlines", () => {
		expect(countLines("\n\n\n")).toBe(4);
	});

	it("handles a single newline", () => {
		expect(countLines("\n")).toBe(2);
	});

	it("handles multi-line code content", () => {
		const code = [
			"function hello() {",
			"  console.log('hi');",
			"}",
			"",
			"hello();",
		].join("\n");
		expect(countLines(code)).toBe(5);
	});
});

// ─── analyzeFileTypes ───────────────────────────────────────────────────────

describe("analyzeFileTypes", () => {
	it("groups files by extension", async () => {
		mockReadFile.mockImplementation(async () => "line1\nline2\n");

		const files = [
			{ path: "/p/a.ts", ext: ".ts", size: 20 },
			{ path: "/p/b.ts", ext: ".ts", size: 30 },
			{ path: "/p/c.js", ext: ".js", size: 15 },
		];

		const result = await analyzeFileTypes(files);
		const tsType = result.byType.find((t) => t.extension === ".ts");
		const jsType = result.byType.find((t) => t.extension === ".js");

		expect(tsType).toBeDefined();
		expect(tsType!.count).toBe(2);
		expect(jsType).toBeDefined();
		expect(jsType!.count).toBe(1);
	});

	it("accumulates total lines", async () => {
		mockReadFile.mockImplementation(async () => "a\nb\nc");

		const files = [
			{ path: "/p/a.ts", ext: ".ts", size: 10 },
			{ path: "/p/b.ts", ext: ".ts", size: 10 },
		];

		const result = await analyzeFileTypes(files);
		// Each file has 3 lines, 2 files = 6
		expect(result.totalLines).toBe(6);
	});

	it("returns largest files sorted by line count", async () => {
		let callCount = 0;
		mockReadFile.mockImplementation(async () => {
			callCount++;
			return callCount === 1 ? "a\nb\nc\nd\ne" : "x\ny";
		});

		const files = [
			{ path: "/p/big.ts", ext: ".ts", size: 50 },
			{ path: "/p/small.ts", ext: ".ts", size: 10 },
		];

		const result = await analyzeFileTypes(files);
		expect(result.largest[0].path).toBe("/p/big.ts");
		expect(result.largest[0].lines).toBeGreaterThan(result.largest[1].lines);
	});

	it("handles empty file list", async () => {
		const result = await analyzeFileTypes([]);

		expect(result.byType).toHaveLength(0);
		expect(result.totalLines).toBe(0);
		expect(result.largest).toHaveLength(0);
	});

	it("uses (no ext) for files without extension", async () => {
		mockReadFile.mockImplementation(async () => "content");

		const files = [
			{ path: "/p/Makefile", ext: "", size: 50 },
		];

		const result = await analyzeFileTypes(files);
		const noExt = result.byType.find((t) => t.extension === "(no ext)");

		expect(noExt).toBeDefined();
		expect(noExt!.count).toBe(1);
	});

	it("skips files that cannot be read", async () => {
		let calls = 0;
		mockReadFile.mockImplementation(async () => {
			calls++;
			if (calls === 1) throw new Error("EACCES");
			return "ok";
		});

		const files = [
			{ path: "/p/unreadable.ts", ext: ".ts", size: 50 },
			{ path: "/p/readable.ts", ext: ".ts", size: 50 },
		];

		const result = await analyzeFileTypes(files);
		// Only the second file should be in the results
		expect(result.totalLines).toBe(1);
	});

	it("skips line counting for files >= 1MB", async () => {
		mockReadFile.mockImplementation(async () => "content\ncontent\n");

		const files = [
			{ path: "/p/huge.ts", ext: ".ts", size: 2_000_000 },
			{ path: "/p/small.ts", ext: ".ts", size: 100 },
		];

		const result = await analyzeFileTypes(files);
		// huge.ts should have 0 lines (skipped), small.ts should have lines
		const tsType = result.byType.find((t) => t.extension === ".ts");
		expect(tsType).toBeDefined();
		expect(tsType!.count).toBe(2);
		// Only 1 readFile call (for small.ts); huge.ts is skipped due to size
		expect(mockReadFile).toHaveBeenCalledTimes(1);
	});

	it("sorts byType by count descending", async () => {
		mockReadFile.mockImplementation(async () => "x");

		const files = [
			{ path: "/p/a.js", ext: ".js", size: 10 },
			{ path: "/p/b.ts", ext: ".ts", size: 10 },
			{ path: "/p/c.ts", ext: ".ts", size: 10 },
			{ path: "/p/d.ts", ext: ".ts", size: 10 },
		];

		const result = await analyzeFileTypes(files);
		expect(result.byType[0].extension).toBe(".ts");
		expect(result.byType[0].count).toBe(3);
		expect(result.byType[1].extension).toBe(".js");
		expect(result.byType[1].count).toBe(1);
	});
});
