import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { detectProject } from "../src/project-detector.js";
import fs from "fs";
import path from "path";

// Mock the fs module
vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

describe("detectProject", () => {
  const mockDir = "/mock/project";

  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockReturnValue("");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Node.js / TypeScript
  // ═══════════════════════════════════════════════════════════════════════

  describe("Node.js / TypeScript detection", () => {
    it("should detect a basic node project from package.json", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p) === path.join(mockDir, "package.json");
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        name: "my-node-app",
      }));

      const result = detectProject(mockDir);
      expect(result.type).toBe("node");
      expect(result.name).toBe("my-node-app");
      expect(result.path).toBe(mockDir);
    });

    it("should detect TypeScript when tsconfig.json exists", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const s = String(p);
        return s === path.join(mockDir, "package.json") ||
               s === path.join(mockDir, "tsconfig.json");
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        name: "ts-project",
      }));

      const result = detectProject(mockDir);
      expect(result.type).toBe("typescript");
    });

    it("should detect TypeScript from typescript dependency", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p) === path.join(mockDir, "package.json");
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        name: "ts-dep-project",
        devDependencies: { typescript: "^5.0.0" },
      }));

      const result = detectProject(mockDir);
      expect(result.type).toBe("typescript");
    });

    it("should detect Next.js framework", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p) === path.join(mockDir, "package.json");
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        name: "nextjs-app",
        dependencies: { next: "14.0.0", react: "18.0.0" },
      }));

      const result = detectProject(mockDir);
      expect(result.framework).toBe("next.js");
    });

    it("should detect React framework (without Next)", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p) === path.join(mockDir, "package.json");
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        name: "react-app",
        dependencies: { react: "18.0.0" },
      }));

      const result = detectProject(mockDir);
      expect(result.framework).toBe("react");
    });

    it("should detect Vue framework", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p) === path.join(mockDir, "package.json");
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        name: "vue-app",
        dependencies: { vue: "3.0.0" },
      }));

      const result = detectProject(mockDir);
      expect(result.framework).toBe("vue");
    });

    it("should detect Express framework", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p) === path.join(mockDir, "package.json");
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        name: "express-app",
        dependencies: { express: "4.0.0" },
      }));

      const result = detectProject(mockDir);
      expect(result.framework).toBe("express");
    });

    it("should detect Angular framework", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p) === path.join(mockDir, "package.json");
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        name: "ng-app",
        dependencies: { "@angular/core": "17.0.0" },
      }));

      const result = detectProject(mockDir);
      expect(result.framework).toBe("angular");
    });

    it("should detect pnpm package manager", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const s = String(p);
        return s === path.join(mockDir, "package.json") ||
               s === path.join(mockDir, "pnpm-lock.yaml");
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ name: "app" }));

      const result = detectProject(mockDir);
      expect(result.packageManager).toBe("pnpm");
    });

    it("should detect yarn package manager", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const s = String(p);
        return s === path.join(mockDir, "package.json") ||
               s === path.join(mockDir, "yarn.lock");
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ name: "app" }));

      const result = detectProject(mockDir);
      expect(result.packageManager).toBe("yarn");
    });

    it("should detect npm package manager", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const s = String(p);
        return s === path.join(mockDir, "package.json") ||
               s === path.join(mockDir, "package-lock.json");
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ name: "app" }));

      const result = detectProject(mockDir);
      expect(result.packageManager).toBe("npm");
    });

    it("should detect bun package manager", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const s = String(p);
        return s === path.join(mockDir, "package.json") ||
               s === path.join(mockDir, "bun.lockb");
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ name: "app" }));

      const result = detectProject(mockDir);
      expect(result.packageManager).toBe("bun");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Rust
  // ═══════════════════════════════════════════════════════════════════════

  describe("Rust detection", () => {
    it("should detect a Rust project from Cargo.toml", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p) === path.join(mockDir, "Cargo.toml");
      });
      vi.mocked(fs.readFileSync).mockReturnValue('[package]\nname = "my-crate"\n');

      const result = detectProject(mockDir);
      expect(result.type).toBe("rust");
      expect(result.name).toBe("my-crate");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Go
  // ═══════════════════════════════════════════════════════════════════════

  describe("Go detection", () => {
    it("should detect a Go project from go.mod", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p) === path.join(mockDir, "go.mod");
      });
      vi.mocked(fs.readFileSync).mockReturnValue("module github.com/user/mymod\n");

      const result = detectProject(mockDir);
      expect(result.type).toBe("go");
      expect(result.name).toBe("github.com/user/mymod");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Python
  // ═══════════════════════════════════════════════════════════════════════

  describe("Python detection", () => {
    it("should detect a Python project from pyproject.toml", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p) === path.join(mockDir, "pyproject.toml");
      });
      vi.mocked(fs.readFileSync).mockReturnValue('[project]\nname = "my-py-project"\n');

      const result = detectProject(mockDir);
      expect(result.type).toBe("python");
      expect(result.name).toBe("my-py-project");
      expect(result.packageManager).toBe("pip");
    });

    it("should detect Django framework in pyproject.toml", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p) === path.join(mockDir, "pyproject.toml");
      });
      vi.mocked(fs.readFileSync).mockReturnValue(
        '[project]\nname = "web-app"\ndependencies = ["django>=4.0"]',
      );

      const result = detectProject(mockDir);
      expect(result.framework).toBe("django");
    });

    it("should detect poetry package manager", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const s = String(p);
        return s === path.join(mockDir, "pyproject.toml") ||
               s === path.join(mockDir, "poetry.lock");
      });
      vi.mocked(fs.readFileSync).mockReturnValue('[project]\nname = "app"');

      const result = detectProject(mockDir);
      expect(result.packageManager).toBe("poetry");
    });

    it("should detect requirements.txt as Python project", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p) === path.join(mockDir, "requirements.txt");
      });

      const result = detectProject(mockDir);
      expect(result.type).toBe("python");
      expect(result.packageManager).toBe("pip");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Ruby
  // ═══════════════════════════════════════════════════════════════════════

  describe("Ruby detection", () => {
    it("should detect a Ruby project from Gemfile", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p) === path.join(mockDir, "Gemfile");
      });
      vi.mocked(fs.readFileSync).mockReturnValue('gem "rails"');

      const result = detectProject(mockDir);
      expect(result.type).toBe("ruby");
      expect(result.framework).toBe("rails");
      expect(result.packageManager).toBe("bundler");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Java
  // ═══════════════════════════════════════════════════════════════════════

  describe("Java detection", () => {
    it("should detect Maven project from pom.xml", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p) === path.join(mockDir, "pom.xml");
      });

      const result = detectProject(mockDir);
      expect(result.type).toBe("java");
      expect(result.packageManager).toBe("maven");
    });

    it("should detect Gradle project from build.gradle", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p) === path.join(mockDir, "build.gradle");
      });

      const result = detectProject(mockDir);
      expect(result.type).toBe("java");
      expect(result.packageManager).toBe("gradle");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Unknown
  // ═══════════════════════════════════════════════════════════════════════

  describe("unknown project", () => {
    it("should return 'unknown' type when no known files exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = detectProject(mockDir);
      expect(result.type).toBe("unknown");
      expect(result.path).toBe(mockDir);
      expect(result.name).toBeUndefined();
      expect(result.framework).toBeUndefined();
    });
  });
});
