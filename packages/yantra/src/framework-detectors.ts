/**
 * @chitragupta/yantra — Framework, language, and tool detection.
 *
 * Detection functions for frameworks, languages, package managers,
 * entry points, and dependencies used by the project analysis tool.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FileTypeCount {
  extension: string;
  count: number;
  totalLines: number;
}

export interface DependencyInfo {
  name: string;
  version: string;
  type: "direct" | "dev";
}

export interface LargestFile {
  path: string;
  lines: number;
  bytes: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage",
  "__pycache__", ".cache", ".vscode", ".idea", "target", "vendor",
  ".terraform", ".tox", "venv", ".venv", "env",
]);

export const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg",
  ".woff", ".woff2", ".ttf", ".eot",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".exe", ".dll", ".so", ".dylib",
  ".mp3", ".mp4", ".avi", ".mov", ".wav",
  ".pyc", ".class", ".o", ".obj",
  ".wasm", ".map",
]);

const FRAMEWORK_INDICATORS: Record<string, Array<{ file: string; dep?: string }>> = {
  "React": [{ file: "package.json", dep: "react" }],
  "Next.js": [{ file: "next.config.js" }, { file: "next.config.mjs" }, { file: "next.config.ts" }],
  "Vue": [{ file: "package.json", dep: "vue" }],
  "Nuxt": [{ file: "nuxt.config.ts" }, { file: "nuxt.config.js" }],
  "Angular": [{ file: "angular.json" }],
  "Svelte": [{ file: "svelte.config.js" }],
  "Express": [{ file: "package.json", dep: "express" }],
  "Fastify": [{ file: "package.json", dep: "fastify" }],
  "Django": [{ file: "manage.py" }],
  "Flask": [{ file: "requirements.txt", dep: "flask" }],
  "FastAPI": [{ file: "requirements.txt", dep: "fastapi" }],
  "Rails": [{ file: "Gemfile", dep: "rails" }],
  "Cargo (Rust)": [{ file: "Cargo.toml" }],
  "Go module": [{ file: "go.mod" }],
  "Deno": [{ file: "deno.json" }, { file: "deno.jsonc" }],
  "Bun": [{ file: "bunfig.toml" }],
  "Docker": [{ file: "Dockerfile" }, { file: "docker-compose.yml" }, { file: "docker-compose.yaml" }],
  "Terraform": [{ file: "main.tf" }],
};

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript",
  ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".py": "Python", ".pyi": "Python",
  ".rs": "Rust",
  ".go": "Go",
  ".java": "Java",
  ".kt": "Kotlin",
  ".swift": "Swift",
  ".rb": "Ruby",
  ".php": "PHP",
  ".cs": "C#",
  ".c": "C", ".h": "C",
  ".cpp": "C++", ".hpp": "C++", ".cc": "C++",
  ".zig": "Zig",
  ".lua": "Lua",
  ".r": "R",
  ".dart": "Dart",
  ".ex": "Elixir", ".exs": "Elixir",
  ".erl": "Erlang",
  ".hs": "Haskell",
  ".ml": "OCaml",
  ".scala": "Scala",
  ".vue": "Vue",
  ".svelte": "Svelte",
};

const ENTRY_POINT_NAMES = new Set([
  "index.ts", "index.js", "main.ts", "main.js",
  "app.ts", "app.js", "server.ts", "server.js",
  "index.tsx", "index.jsx", "main.tsx", "main.jsx",
  "main.py", "app.py", "__main__.py",
  "main.go", "main.rs", "lib.rs",
  "Program.cs", "Main.java",
]);

// ─── Detection Functions ────────────────────────────────────────────────────

export function detectLanguages(byType: FileTypeCount[]): string[] {
  const languages = new Set<string>();
  for (const ft of byType) {
    const lang = LANGUAGE_BY_EXTENSION[ft.extension];
    if (lang && ft.count > 0) {
      languages.add(lang);
    }
  }
  return Array.from(languages);
}

export async function detectFrameworks(projectPath: string): Promise<string[]> {
  const detected: string[] = [];

  // Read package.json for dependency-based detection
  let packageDeps = new Set<string>();
  try {
    const pkgPath = path.join(projectPath, "package.json");
    const pkg = JSON.parse(await fs.promises.readFile(pkgPath, "utf-8"));
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
    packageDeps = new Set(Object.keys(allDeps));
  } catch {
    // No package.json
  }

  // Read requirements.txt for Python deps
  let requirementsDeps = new Set<string>();
  try {
    const reqPath = path.join(projectPath, "requirements.txt");
    const content = await fs.promises.readFile(reqPath, "utf-8");
    for (const line of content.split("\n")) {
      const dep = line.trim().split(/[>=<!\s]/)[0].toLowerCase();
      if (dep) requirementsDeps.add(dep);
    }
  } catch {
    // No requirements.txt
  }

  for (const [framework, indicators] of Object.entries(FRAMEWORK_INDICATORS)) {
    for (const indicator of indicators) {
      if (indicator.dep) {
        // Check dependencies
        if (indicator.file === "package.json" && packageDeps.has(indicator.dep)) {
          detected.push(framework);
          break;
        }
        if (indicator.file === "requirements.txt" && requirementsDeps.has(indicator.dep)) {
          detected.push(framework);
          break;
        }
        if (indicator.file === "Gemfile") {
          try {
            const gemfile = await fs.promises.readFile(
              path.join(projectPath, "Gemfile"), "utf-8",
            );
            if (gemfile.includes(indicator.dep)) {
              detected.push(framework);
              break;
            }
          } catch {
            // No Gemfile
          }
        }
      } else {
        // Check file existence
        try {
          await fs.promises.access(path.join(projectPath, indicator.file));
          detected.push(framework);
          break;
        } catch {
          // File doesn't exist
        }
      }
    }
  }

  return detected;
}

export function findEntryPoints(
  files: Array<{ path: string; ext: string; size: number }>,
  projectPath: string,
): string[] {
  const entries: string[] = [];

  for (const file of files) {
    const basename = path.basename(file.path);
    if (ENTRY_POINT_NAMES.has(basename)) {
      entries.push(path.relative(projectPath, file.path));
    }
  }

  return entries.sort();
}

export async function analyzeDependencies(projectPath: string): Promise<{
  deps: DependencyInfo[];
  packageManager?: string;
}> {
  const deps: DependencyInfo[] = [];
  let packageManager: string | undefined;

  // package.json (Node.js)
  try {
    const pkgPath = path.join(projectPath, "package.json");
    const pkg = JSON.parse(await fs.promises.readFile(pkgPath, "utf-8"));

    // Detect package manager
    if (fs.existsSync(path.join(projectPath, "bun.lockb"))) {
      packageManager = "bun";
    } else if (fs.existsSync(path.join(projectPath, "pnpm-lock.yaml"))) {
      packageManager = "pnpm";
    } else if (fs.existsSync(path.join(projectPath, "yarn.lock"))) {
      packageManager = "yarn";
    } else if (fs.existsSync(path.join(projectPath, "package-lock.json"))) {
      packageManager = "npm";
    }

    if (pkg.dependencies) {
      for (const [name, version] of Object.entries(pkg.dependencies)) {
        deps.push({ name, version: String(version), type: "direct" });
      }
    }
    if (pkg.devDependencies) {
      for (const [name, version] of Object.entries(pkg.devDependencies)) {
        deps.push({ name, version: String(version), type: "dev" });
      }
    }
  } catch {
    // No package.json
  }

  // Cargo.toml (Rust)
  try {
    const cargoPath = path.join(projectPath, "Cargo.toml");
    const content = await fs.promises.readFile(cargoPath, "utf-8");

    let inDeps = false;
    let inDevDeps = false;
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "[dependencies]") {
        inDeps = true;
        inDevDeps = false;
        continue;
      }
      if (trimmed === "[dev-dependencies]") {
        inDevDeps = true;
        inDeps = false;
        continue;
      }
      if (trimmed.startsWith("[")) {
        inDeps = false;
        inDevDeps = false;
        continue;
      }

      if (inDeps || inDevDeps) {
        const match = trimmed.match(/^(\S+)\s*=\s*"([^"]+)"/);
        if (match) {
          deps.push({
            name: match[1],
            version: match[2],
            type: inDevDeps ? "dev" : "direct",
          });
        }
      }
    }
  } catch {
    // No Cargo.toml
  }

  // go.mod (Go)
  try {
    const goModPath = path.join(projectPath, "go.mod");
    const content = await fs.promises.readFile(goModPath, "utf-8");

    let inRequire = false;
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "require (") {
        inRequire = true;
        continue;
      }
      if (trimmed === ")") {
        inRequire = false;
        continue;
      }

      if (inRequire) {
        const match = trimmed.match(/^(\S+)\s+(\S+)/);
        if (match) {
          deps.push({
            name: match[1],
            version: match[2],
            type: "direct",
          });
        }
      }
    }
  } catch {
    // No go.mod
  }

  return { deps, packageManager };
}

// ─── File Analysis Helpers ──────────────────────────────────────────────────

export function countLines(content: string): number {
  if (!content) return 0;
  let count = 1;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") count++;
  }
  return count;
}

export async function analyzeFileTypes(
  files: Array<{ path: string; ext: string; size: number }>,
): Promise<{ byType: FileTypeCount[]; totalLines: number; largest: LargestFile[] }> {
  const typeMap = new Map<string, { count: number; totalLines: number }>();
  let totalLines = 0;
  const fileLineCounts: Array<{ path: string; lines: number; bytes: number }> = [];

  for (const file of files) {
    const ext = file.ext || "(no ext)";

    // Only count lines for small-ish files (< 1MB)
    let lines = 0;
    if (file.size < 1_000_000) {
      try {
        const content = await fs.promises.readFile(file.path, "utf-8");
        lines = countLines(content);
      } catch {
        continue;
      }
    }

    totalLines += lines;
    fileLineCounts.push({ path: file.path, lines, bytes: file.size });

    const existing = typeMap.get(ext);
    if (existing) {
      existing.count++;
      existing.totalLines += lines;
    } else {
      typeMap.set(ext, { count: 1, totalLines: lines });
    }
  }

  const byType = Array.from(typeMap.entries())
    .map(([extension, data]) => ({
      extension,
      count: data.count,
      totalLines: data.totalLines,
    }))
    .sort((a, b) => b.count - a.count);

  const largest = fileLineCounts
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 10);

  return { byType, totalLines, largest };
}
