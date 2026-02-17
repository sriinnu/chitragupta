import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as childProcess from "node:child_process";
import { projectAnalysisTool } from "../src/project-analysis.js";
import type { ToolContext } from "../src/types.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    promises: {
      ...actual.promises,
      stat: vi.fn(),
      readdir: vi.fn(),
      readFile: vi.fn(),
      access: vi.fn(),
    },
  };
});

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

const mockStat = vi.mocked(fs.promises.stat);
const mockReaddir = vi.mocked(fs.promises.readdir);
const mockReadFile = vi.mocked(fs.promises.readFile);
const mockAccess = vi.mocked(fs.promises.access);
const mockExistsSync = vi.mocked(fs.existsSync);
const mockExecSync = vi.mocked(childProcess.execSync);

const CTX: ToolContext = {
  sessionId: "s1",
  workingDirectory: "/project",
};

describe("projectAnalysisTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: project dir exists
    mockStat.mockImplementation(async (p: fs.PathLike) => {
      const pathStr = String(p);
      if (pathStr === "/project") {
        return { isFile: () => false, isDirectory: () => true } as any;
      }
      return { isFile: () => true, isDirectory: () => false, size: 100 } as any;
    });

    // Default: empty directory
    mockReaddir.mockResolvedValue([]);

    // Default: no files accessible (framework config files, etc.)
    mockAccess.mockRejectedValue(new Error("ENOENT"));

    // Default: no readable files (package.json, etc.)
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    // Default: no git
    mockExecSync.mockImplementation(() => {
      throw new Error("not a git repo");
    });
  });

  it("should have the correct definition", () => {
    expect(projectAnalysisTool.definition.name).toBe("project_analysis");
  });

  it("should return error for non-existent directory", async () => {
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockStat.mockRejectedValue(err);
    const result = await projectAnalysisTool.execute({ path: "/missing" }, CTX);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Directory not found");
  });

  it("should return error for non-directory paths", async () => {
    mockStat.mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
    } as any);
    const result = await projectAnalysisTool.execute({ path: "/project" }, CTX);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("not a directory");
  });

  it("should analyze an empty project directory", async () => {
    const result = await projectAnalysisTool.execute({}, CTX);
    expect(result.isError).toBeUndefined();
    const report = JSON.parse(result.content);
    expect(report.projectPath).toBe("/project");
    expect(report.totalFiles).toBe(0);
    expect(report.detectedLanguages).toEqual([]);
    expect(report.detectedFrameworks).toEqual([]);
  });

  it("should detect TypeScript files", async () => {
    // Return files from readdir
    mockReaddir.mockImplementation(async (dir: fs.PathLike) => {
      const pathStr = String(dir);
      if (pathStr === "/project") {
        return [
          { name: "index.ts", isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false },
          { name: "app.tsx", isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false },
        ] as any;
      }
      return [];
    });

    mockStat.mockImplementation(async (p: fs.PathLike) => {
      const pathStr = String(p);
      if (pathStr === "/project") {
        return { isFile: () => false, isDirectory: () => true } as any;
      }
      return { isFile: () => true, isDirectory: () => false, size: 50 } as any;
    });

    mockReadFile.mockResolvedValue("const x = 1;\n");

    const result = await projectAnalysisTool.execute({}, CTX);
    const report = JSON.parse(result.content);
    expect(report.totalFiles).toBe(2);
    expect(report.detectedLanguages).toContain("TypeScript");
  });

  it("should detect frameworks from package.json", async () => {
    mockReaddir.mockResolvedValue([]);
    // package.json with react dependency
    mockReadFile.mockImplementation(async (p: any) => {
      const pathStr = String(p);
      if (pathStr.endsWith("package.json")) {
        return JSON.stringify({
          dependencies: { react: "^18.0.0" },
          devDependencies: {},
        });
      }
      throw new Error("ENOENT");
    });

    mockAccess.mockRejectedValue(new Error("ENOENT"));

    const result = await projectAnalysisTool.execute({}, CTX);
    const report = JSON.parse(result.content);
    expect(report.detectedFrameworks).toContain("React");
  });

  it("should detect Next.js from config file", async () => {
    mockReaddir.mockResolvedValue([]);
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    mockAccess.mockImplementation(async (p: fs.PathLike) => {
      const pathStr = String(p);
      if (pathStr.endsWith("next.config.js") || pathStr.endsWith("next.config.mjs") || pathStr.endsWith("next.config.ts")) {
        return; // File exists
      }
      throw new Error("ENOENT");
    });

    const result = await projectAnalysisTool.execute({}, CTX);
    const report = JSON.parse(result.content);
    expect(report.detectedFrameworks).toContain("Next.js");
  });

  it("should skip git analysis when skipGit is true", async () => {
    const result = await projectAnalysisTool.execute({ skipGit: true }, CTX);
    const report = JSON.parse(result.content);
    expect(report.git.isGitRepo).toBe(false);
  });

  it("should detect package managers", async () => {
    mockReaddir.mockResolvedValue([]);
    mockReadFile.mockImplementation(async (p: any) => {
      const pathStr = String(p);
      if (pathStr.endsWith("package.json")) {
        return JSON.stringify({ dependencies: { express: "^4.0.0" } });
      }
      throw new Error("ENOENT");
    });
    mockExistsSync.mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith("pnpm-lock.yaml");
    });

    const result = await projectAnalysisTool.execute({}, CTX);
    const report = JSON.parse(result.content);
    expect(report.packageManager).toBe("pnpm");
  });

  it("should find entry points", async () => {
    mockReaddir.mockImplementation(async (dir: fs.PathLike) => {
      const pathStr = String(dir);
      if (pathStr === "/project") {
        return [
          { name: "index.ts", isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false },
          { name: "main.ts", isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false },
        ] as any;
      }
      return [];
    });

    mockStat.mockImplementation(async (p: fs.PathLike) => {
      const pathStr = String(p);
      if (pathStr === "/project") {
        return { isFile: () => false, isDirectory: () => true } as any;
      }
      return { isFile: () => true, isDirectory: () => false, size: 50 } as any;
    });

    mockReadFile.mockResolvedValue("// entry\n");

    const result = await projectAnalysisTool.execute({}, CTX);
    const report = JSON.parse(result.content);
    expect(report.entryPoints).toContain("index.ts");
    expect(report.entryPoints).toContain("main.ts");
  });

  it("should include metadata with summary info", async () => {
    const result = await projectAnalysisTool.execute({}, CTX);
    expect(result.metadata).toBeDefined();
    expect(result.metadata?.totalFiles).toBe(0);
  });
});
