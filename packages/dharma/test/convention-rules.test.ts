import { describe, it, expect } from "vitest";
import type { PolicyAction, PolicyContext } from "@chitragupta/dharma";
import {
	fileNamingConvention,
	noLargeFiles,
	requireTestsForNewFiles,
	noDirectConsoleLog,
	importOrderConvention,
	CONVENTION_RULES,
} from "@chitragupta/dharma";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeAction(overrides: Partial<PolicyAction> = {}): PolicyAction {
	return {
		type: "file_write",
		filePath: "/project/src/hello-world.ts",
		content: "export const x = 1;\n",
		...overrides,
	};
}

function makeContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
	return {
		sessionId: "sess-001",
		agentId: "agent-001",
		agentDepth: 0,
		projectPath: "/project",
		totalCostSoFar: 0,
		costBudget: 10,
		filesModified: [],
		commandsRun: [],
		timestamp: Date.now(),
		...overrides,
	};
}

// ─── fileNamingConvention ───────────────────────────────────────────────────

describe("fileNamingConvention", () => {
	it("allows non-file_write actions", async () => {
		const verdict = await fileNamingConvention.evaluate(
			makeAction({ type: "file_read", filePath: "/project/camelCase.ts" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows non-code file extensions", async () => {
		const verdict = await fileNamingConvention.evaluate(
			makeAction({ filePath: "/project/README.md" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows index.ts", async () => {
		const verdict = await fileNamingConvention.evaluate(
			makeAction({ filePath: "/project/src/index.ts" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows PascalCase for .tsx files", async () => {
		const verdict = await fileNamingConvention.evaluate(
			makeAction({ filePath: "/project/src/MyComponent.tsx" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows PascalCase for .jsx files", async () => {
		const verdict = await fileNamingConvention.evaluate(
			makeAction({ filePath: "/project/src/Button.jsx" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("warns on non-kebab-case .ts files (camelCase)", async () => {
		const verdict = await fileNamingConvention.evaluate(
			makeAction({ filePath: "/project/src/myModule.ts" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "warn" });
		expect(verdict.reason).toContain("myModule.ts");
		expect(verdict.suggestion).toContain("my-module.ts");
	});

	it("warns on PascalCase .ts files (not .tsx)", async () => {
		const verdict = await fileNamingConvention.evaluate(
			makeAction({ filePath: "/project/src/MyModule.ts" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "warn" });
	});

	it("warns on snake_case .ts files", async () => {
		const verdict = await fileNamingConvention.evaluate(
			makeAction({ filePath: "/project/src/my_module.ts" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "warn" });
	});

	it("allows kebab-case .ts files", async () => {
		const verdict = await fileNamingConvention.evaluate(
			makeAction({ filePath: "/project/src/my-module.ts" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows kebab-case .mts files", async () => {
		const verdict = await fileNamingConvention.evaluate(
			makeAction({ filePath: "/project/src/my-utils.mts" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows kebab-case .mjs files", async () => {
		const verdict = await fileNamingConvention.evaluate(
			makeAction({ filePath: "/project/src/some-helper.mjs" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows single-word lowercase name", async () => {
		const verdict = await fileNamingConvention.evaluate(
			makeAction({ filePath: "/project/src/utils.ts" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("has correct metadata", () => {
		expect(fileNamingConvention.id).toBe("convention.file-naming");
		expect(fileNamingConvention.category).toBe("convention");
		expect(fileNamingConvention.severity).toBe("warning");
	});
});

// ─── noLargeFiles ───────────────────────────────────────────────────────────

describe("noLargeFiles", () => {
	it("warns when file exceeds 500 lines", async () => {
		const content = Array.from({ length: 501 }, (_, i) => `const line${i} = ${i};`).join("\n");
		const verdict = await noLargeFiles.evaluate(makeAction({ content }), makeContext());
		expect(verdict).toMatchObject({ status: "warn" });
		expect(verdict.reason).toContain("501");
	});

	it("allows files with exactly 500 lines", async () => {
		const content = Array.from({ length: 500 }, (_, i) => `const line${i} = ${i};`).join("\n");
		const verdict = await noLargeFiles.evaluate(makeAction({ content }), makeContext());
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows files under 500 lines", async () => {
		const content = "const x = 1;\nconst y = 2;\n";
		const verdict = await noLargeFiles.evaluate(makeAction({ content }), makeContext());
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows file_write with no content", async () => {
		const verdict = await noLargeFiles.evaluate(
			makeAction({ content: undefined }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows non-file_write actions", async () => {
		const verdict = await noLargeFiles.evaluate(
			makeAction({ type: "file_read" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("has correct metadata", () => {
		expect(noLargeFiles.id).toBe("convention.no-large-files");
	});
});

// ─── requireTestsForNewFiles ────────────────────────────────────────────────

describe("requireTestsForNewFiles", () => {
	it("warns when writing src/ file without matching test", async () => {
		const verdict = await requireTestsForNewFiles.evaluate(
			makeAction({ filePath: "/project/src/utils.ts" }),
			makeContext({ filesModified: [] }),
		);
		expect(verdict).toMatchObject({ status: "warn" });
		expect(verdict.reason).toContain("utils.ts");
	});

	it("allows when matching test file exists in filesModified", async () => {
		const verdict = await requireTestsForNewFiles.evaluate(
			makeAction({ filePath: "/project/src/utils.ts" }),
			makeContext({ filesModified: ["/project/test/utils.test.ts"] }),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows when .spec test file exists in filesModified", async () => {
		const verdict = await requireTestsForNewFiles.evaluate(
			makeAction({ filePath: "/project/src/utils.ts" }),
			makeContext({ filesModified: ["/project/src/utils.spec.ts"] }),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows files not in src/", async () => {
		const verdict = await requireTestsForNewFiles.evaluate(
			makeAction({ filePath: "/project/test/my-test.ts" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows index.ts files", async () => {
		const verdict = await requireTestsForNewFiles.evaluate(
			makeAction({ filePath: "/project/src/index.ts" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows types.ts files", async () => {
		const verdict = await requireTestsForNewFiles.evaluate(
			makeAction({ filePath: "/project/src/types.ts" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows .d.ts files", async () => {
		const verdict = await requireTestsForNewFiles.evaluate(
			makeAction({ filePath: "/project/src/globals.d.ts" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows non-file_write actions", async () => {
		const verdict = await requireTestsForNewFiles.evaluate(
			makeAction({ type: "shell_exec", command: "npm test" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows non-code extensions", async () => {
		const verdict = await requireTestsForNewFiles.evaluate(
			makeAction({ filePath: "/project/src/README.md" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("has correct metadata", () => {
		expect(requireTestsForNewFiles.id).toBe("convention.require-tests");
		expect(requireTestsForNewFiles.severity).toBe("info");
	});
});

// ─── noDirectConsoleLog ─────────────────────────────────────────────────────

describe("noDirectConsoleLog", () => {
	it("warns when src/ file contains console.log(", async () => {
		const content = "const x = 1;\nconsole.log(\"debug\");\n";
		const verdict = await noDirectConsoleLog.evaluate(
			makeAction({ filePath: "/project/src/utils.ts", content }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "warn" });
		expect(verdict.reason).toContain("console.log");
	});

	it("allows test files with console.log", async () => {
		const content = "console.log(\"test output\");";
		const verdict = await noDirectConsoleLog.evaluate(
			makeAction({ filePath: "/project/src/utils.test.ts", content }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows spec files with console.log", async () => {
		const content = "console.log(\"spec output\");";
		const verdict = await noDirectConsoleLog.evaluate(
			makeAction({ filePath: "/project/src/utils.spec.ts", content }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows config files with console.log", async () => {
		const content = "console.log(\"config info\");";
		const verdict = await noDirectConsoleLog.evaluate(
			makeAction({ filePath: "/project/src/vitest.config.ts", content }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows files not in src/", async () => {
		const content = "console.log(\"outside src\");";
		const verdict = await noDirectConsoleLog.evaluate(
			makeAction({ filePath: "/project/scripts/build.ts", content }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows src/ files without console.log", async () => {
		const content = "const x = 1;\nlogger.info(\"structured\");\n";
		const verdict = await noDirectConsoleLog.evaluate(
			makeAction({ filePath: "/project/src/utils.ts", content }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows when no content", async () => {
		const verdict = await noDirectConsoleLog.evaluate(
			makeAction({ filePath: "/project/src/utils.ts", content: undefined }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows non-file_write actions", async () => {
		const verdict = await noDirectConsoleLog.evaluate(
			makeAction({ type: "llm_call" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("has correct metadata", () => {
		expect(noDirectConsoleLog.id).toBe("convention.no-console-log");
	});
});

// ─── importOrderConvention ──────────────────────────────────────────────────

describe("importOrderConvention", () => {
	it("warns when relative imports come before external", async () => {
		const content = [
			"import { foo } from \"./local.js\";",
			"import path from \"path\";",
		].join("\n");
		const verdict = await importOrderConvention.evaluate(
			makeAction({ filePath: "/project/src/mod.ts", content }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "warn" });
		expect(verdict.reason).toContain("incorrect");
	});

	it("warns when relative imports come before @chitragupta/*", async () => {
		const content = [
			"import { foo } from \"./local.js\";",
			"import { bar } from \"@chitragupta/core\";",
		].join("\n");
		const verdict = await importOrderConvention.evaluate(
			makeAction({ filePath: "/project/src/mod.ts", content }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "warn" });
	});

	it("warns when @chitragupta/* comes before external", async () => {
		const content = [
			"import { bar } from \"@chitragupta/core\";",
			"import path from \"path\";",
		].join("\n");
		const verdict = await importOrderConvention.evaluate(
			makeAction({ filePath: "/project/src/mod.ts", content }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "warn" });
	});

	it("allows correct order: external -> @chitragupta/* -> relative", async () => {
		const content = [
			"import path from \"path\";",
			"import { bar } from \"@chitragupta/core\";",
			"import { foo } from \"./local.js\";",
		].join("\n");
		const verdict = await importOrderConvention.evaluate(
			makeAction({ filePath: "/project/src/mod.ts", content }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows only external imports in correct order", async () => {
		const content = [
			"import path from \"path\";",
			"import fs from \"fs\";",
		].join("\n");
		const verdict = await importOrderConvention.evaluate(
			makeAction({ filePath: "/project/src/mod.ts", content }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows fewer than 2 imports", async () => {
		const content = "import path from \"path\";\nconst x = 1;\n";
		const verdict = await importOrderConvention.evaluate(
			makeAction({ filePath: "/project/src/mod.ts", content }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows non-code file extensions", async () => {
		const content = "import wrong from \"./a\";\nimport right from \"path\";\n";
		const verdict = await importOrderConvention.evaluate(
			makeAction({ filePath: "/project/src/data.json", content }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows non-file_write actions", async () => {
		const verdict = await importOrderConvention.evaluate(
			makeAction({ type: "file_read" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows when no content", async () => {
		const verdict = await importOrderConvention.evaluate(
			makeAction({ content: undefined }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("has correct metadata", () => {
		expect(importOrderConvention.id).toBe("convention.import-order");
		expect(importOrderConvention.severity).toBe("info");
	});
});

// ─── CONVENTION_RULES ───────────────────────────────────────────────────────

describe("CONVENTION_RULES", () => {
	it("is an array of exactly 5 rules", () => {
		expect(CONVENTION_RULES).toHaveLength(5);
	});

	it("contains all convention rules", () => {
		const ids = CONVENTION_RULES.map((r) => r.id);
		expect(ids).toContain("convention.file-naming");
		expect(ids).toContain("convention.no-large-files");
		expect(ids).toContain("convention.require-tests");
		expect(ids).toContain("convention.no-console-log");
		expect(ids).toContain("convention.import-order");
	});

	it("all rules have category convention", () => {
		for (const rule of CONVENTION_RULES) {
			expect(rule.category).toBe("convention");
		}
	});

	it("all rules have an evaluate function", () => {
		for (const rule of CONVENTION_RULES) {
			expect(typeof rule.evaluate).toBe("function");
		}
	});
});
