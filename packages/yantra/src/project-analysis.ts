/**
 * @chitragupta/yantra — Project analysis tool.
 *
 * Analyzes a project's structure, dependencies, size, and git status.
 * Returns a structured JSON report with:
 *   - File counts by type
 *   - Framework/language detection
 *   - Entry point identification
 *   - Dependency analysis (from package.json, Cargo.toml, go.mod)
 *   - Size analysis (total files, total lines, largest files)
 *   - Git analysis (recent commits, active branches, uncommitted changes)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import type { ToolHandler, ToolContext, ToolResult } from "./types.js";
import {
  type FileTypeCount,
  type DependencyInfo,
  type LargestFile,
  SKIP_DIRS,
  BINARY_EXTENSIONS,
  detectLanguages,
  detectFrameworks,
  findEntryPoints,
  analyzeDependencies,
  analyzeFileTypes,
} from "./framework-detectors.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface GitInfo {
  isGitRepo: boolean;
  branch?: string;
  recentCommits?: Array<{ hash: string; message: string; author: string; date: string }>;
  activeBranches?: string[];
  uncommittedChanges?: number;
  untrackedFiles?: number;
}

interface ProjectReport {
  projectPath: string;
  analyzedAt: string;

  // Structure
  filesByType: FileTypeCount[];
  totalFiles: number;
  totalDirectories: number;
  totalLines: number;
  largestFiles: LargestFile[];

  // Framework/language detection
  detectedLanguages: string[];
  detectedFrameworks: string[];
  entryPoints: string[];

  // Dependencies
  packageManager?: string;
  dependencies: DependencyInfo[];

  // Git
  git: GitInfo;
}

// ─── Walk Project ───────────────────────────────────────────────────────────

interface WalkResult {
  files: Array<{ path: string; ext: string; size: number }>;
  dirCount: number;
}

async function walkProject(
  dir: string,
  maxFiles: number = 10_000,
  signal?: AbortSignal,
): Promise<WalkResult> {
  const files: Array<{ path: string; ext: string; size: number }> = [];
  let dirCount = 0;

  async function walk(currentDir: string): Promise<void> {
    if (signal?.aborted || files.length >= maxFiles) return;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (signal?.aborted || files.length >= maxFiles) return;

      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        dirCount++;
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) continue;

        let size = 0;
        try {
          const stat = await fs.promises.stat(fullPath);
          size = stat.size;
        } catch {
          continue;
        }

        files.push({ path: fullPath, ext, size });
      }
    }
  }

  await walk(dir);
  return { files, dirCount };
}

// ─── Git Analysis ───────────────────────────────────────────────────────────

function analyzeGit(projectPath: string): GitInfo {
  // Check if it's a git repo
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd: projectPath,
      stdio: "pipe",
    });
  } catch {
    return { isGitRepo: false };
  }

  const info: GitInfo = { isGitRepo: true };

  // Current branch
  try {
    info.branch = execSync("git branch --show-current", {
      cwd: projectPath,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
  } catch {
    // Ignore
  }

  // Recent commits (last 5)
  try {
    const log = execSync(
      'git log --oneline --format="%H|%s|%an|%ai" -5',
      { cwd: projectPath, encoding: "utf-8", stdio: "pipe" },
    ).trim();

    if (log) {
      info.recentCommits = log.split("\n").map((line) => {
        const [hash, message, author, date] = line.split("|");
        return {
          hash: hash?.slice(0, 8) ?? "",
          message: message ?? "",
          author: author ?? "",
          date: date ?? "",
        };
      });
    }
  } catch {
    // Ignore
  }

  // Active branches (last 10)
  try {
    const branches = execSync(
      "git branch --sort=-committerdate --format='%(refname:short)' | head -10",
      { cwd: projectPath, encoding: "utf-8", stdio: "pipe", shell: "/bin/sh" },
    ).trim();

    if (branches) {
      info.activeBranches = branches.split("\n").map((b) => b.trim()).filter(Boolean);
    }
  } catch {
    // Ignore
  }

  // Uncommitted changes
  try {
    const status = execSync("git status --porcelain", {
      cwd: projectPath,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();

    if (status) {
      const lines = status.split("\n").filter(Boolean);
      info.uncommittedChanges = lines.filter((l) => !l.startsWith("??")).length;
      info.untrackedFiles = lines.filter((l) => l.startsWith("??")).length;
    } else {
      info.uncommittedChanges = 0;
      info.untrackedFiles = 0;
    }
  } catch {
    // Ignore
  }

  return info;
}

// ─── Tool Handler ───────────────────────────────────────────────────────────

/**
 * Project analysis tool handler.
 *
 * Analyzes a project's structure, dependencies, size, and git status.
 * Returns a structured JSON report with file counts, detected frameworks
 * and languages, entry points, dependency lists, and git information.
 *
 * @example
 * ```ts
 * const result = await projectAnalysisTool.execute(
 *   { path: "/my/project", skipGit: false },
 *   context,
 * );
 * const report = JSON.parse(result.content);
 * ```
 */
export const projectAnalysisTool: ToolHandler = {
  definition: {
    name: "project_analysis",
    description:
      "Analyze a project's structure, dependencies, size, and git status. " +
      "Returns a structured JSON report including file counts by type, " +
      "detected frameworks, entry points, dependency list, size metrics, " +
      "and git information.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Project root directory. Defaults to working directory.",
        },
        skipGit: {
          type: "boolean",
          description: "Skip git analysis. Defaults to false.",
        },
        skipDependencies: {
          type: "boolean",
          description: "Skip dependency analysis. Defaults to false.",
        },
        maxFiles: {
          type: "number",
          description: "Maximum number of files to analyze. Defaults to 10000.",
        },
      },
      required: [],
    },
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const projectPath = args.path
      ? path.isAbsolute(args.path as string)
        ? (args.path as string)
        : path.resolve(context.workingDirectory, args.path as string)
      : context.workingDirectory;

    const skipGit = args.skipGit === true;
    const skipDeps = args.skipDependencies === true;
    const maxFiles = (args.maxFiles as number) || 10_000;

    // Verify path exists and is a directory
    try {
      const stat = await fs.promises.stat(projectPath);
      if (!stat.isDirectory()) {
        return { content: `Error: Path is not a directory: ${projectPath}`, isError: true };
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return { content: `Error: Directory not found: ${projectPath}`, isError: true };
      }
      return { content: `Error: ${err.message}`, isError: true };
    }

    // Walk the project
    const walkResult = await walkProject(projectPath, maxFiles, context.signal);

    // Analyze file types
    const { byType, totalLines, largest } = await analyzeFileTypes(walkResult.files);

    // Detect languages and frameworks
    const detectedLanguages = detectLanguages(byType);
    const detectedFrameworks = await detectFrameworks(projectPath);

    // Find entry points
    const entryPoints = findEntryPoints(walkResult.files, projectPath);

    // Analyze dependencies
    let deps: DependencyInfo[] = [];
    let packageManager: string | undefined;
    if (!skipDeps) {
      const depResult = await analyzeDependencies(projectPath);
      deps = depResult.deps;
      packageManager = depResult.packageManager;
    }

    // Git analysis
    const git = skipGit ? { isGitRepo: false } : analyzeGit(projectPath);

    const report: ProjectReport = {
      projectPath,
      analyzedAt: new Date().toISOString(),
      filesByType: byType.slice(0, 20), // Top 20 file types
      totalFiles: walkResult.files.length,
      totalDirectories: walkResult.dirCount,
      totalLines,
      largestFiles: largest,
      detectedLanguages,
      detectedFrameworks,
      entryPoints,
      packageManager,
      dependencies: deps,
      git,
    };

    return {
      content: JSON.stringify(report, null, 2),
      metadata: {
        totalFiles: report.totalFiles,
        totalLines: report.totalLines,
        languages: report.detectedLanguages,
        frameworks: report.detectedFrameworks,
      },
    };
  },
};
