import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseArgs, printHelp } from "../src/args.js";

describe("parseArgs", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // Print mode (-p / --print)
  // ═══════════════════════════════════════════════════════════════════════

  describe("-p / --print", () => {
    it("should parse -p with prompt", () => {
      const args = parseArgs(["-p", "explain this code"]);
      expect(args.print).toBe(true);
      expect(args.prompt).toBe("explain this code");
    });

    it("should parse --print with prompt", () => {
      const args = parseArgs(["--print", "what is this?"]);
      expect(args.print).toBe(true);
      expect(args.prompt).toBe("what is this?");
    });

    it("should set print to true even without a following prompt", () => {
      const args = parseArgs(["-p"]);
      expect(args.print).toBe(true);
      expect(args.prompt).toBeUndefined();
    });

    it("should not consume a flag as the prompt", () => {
      const args = parseArgs(["-p", "--model", "gpt-4"]);
      expect(args.print).toBe(true);
      expect(args.prompt).toBeUndefined();
      expect(args.model).toBe("gpt-4");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Continue (-c / --continue)
  // ═══════════════════════════════════════════════════════════════════════

  describe("-c / --continue", () => {
    it("should parse -c flag", () => {
      const args = parseArgs(["-c"]);
      expect(args.continue).toBe(true);
    });

    it("should parse --continue flag", () => {
      const args = parseArgs(["--continue"]);
      expect(args.continue).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Resume (-r / --resume)
  // ═══════════════════════════════════════════════════════════════════════

  describe("-r / --resume", () => {
    it("should parse -r flag", () => {
      const args = parseArgs(["-r"]);
      expect(args.resume).toBe(true);
    });

    it("should parse --resume flag", () => {
      const args = parseArgs(["--resume"]);
      expect(args.resume).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Model (-m / --model)
  // ═══════════════════════════════════════════════════════════════════════

  describe("-m / --model", () => {
    it("should parse -m with model name", () => {
      const args = parseArgs(["-m", "claude-sonnet-4-5-20250929"]);
      expect(args.model).toBe("claude-sonnet-4-5-20250929");
    });

    it("should parse --model with model name", () => {
      const args = parseArgs(["--model", "gpt-4o"]);
      expect(args.model).toBe("gpt-4o");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Provider (--provider)
  // ═══════════════════════════════════════════════════════════════════════

  describe("--provider", () => {
    it("should parse --provider flag", () => {
      const args = parseArgs(["--provider", "openai"]);
      expect(args.provider).toBe("openai");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Profile (--profile)
  // ═══════════════════════════════════════════════════════════════════════

  describe("--profile", () => {
    it("should parse --profile flag", () => {
      const args = parseArgs(["--profile", "reviewer"]);
      expect(args.profile).toBe("reviewer");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // No Memory (--no-memory)
  // ═══════════════════════════════════════════════════════════════════════

  describe("--no-memory", () => {
    it("should parse --no-memory flag", () => {
      const args = parseArgs(["--no-memory"]);
      expect(args.noMemory).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Version (-v / --version)
  // ═══════════════════════════════════════════════════════════════════════

  describe("-v / --version", () => {
    it("should parse -v flag", () => {
      const args = parseArgs(["-v"]);
      expect(args.version).toBe(true);
    });

    it("should parse --version flag", () => {
      const args = parseArgs(["--version"]);
      expect(args.version).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Help (-h / --help)
  // ═══════════════════════════════════════════════════════════════════════

  describe("-h / --help", () => {
    it("should parse -h flag", () => {
      const args = parseArgs(["-h"]);
      expect(args.help).toBe(true);
    });

    it("should parse --help flag", () => {
      const args = parseArgs(["--help"]);
      expect(args.help).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Subcommands
  // ═══════════════════════════════════════════════════════════════════════

  describe("subcommands", () => {
    it("should parse 'provider list'", () => {
      const args = parseArgs(["provider", "list"]);
      expect(args.command).toBe("provider");
      expect(args.subcommand).toBe("list");
    });

    it("should parse 'provider add' with rest args", () => {
      const args = parseArgs(["provider", "add", "openai"]);
      expect(args.command).toBe("provider");
      expect(args.subcommand).toBe("add");
      expect(args.rest).toContain("openai");
    });

    it("should parse 'session show' with session ID", () => {
      const args = parseArgs(["session", "show", "abc-123"]);
      expect(args.command).toBe("session");
      expect(args.subcommand).toBe("show");
      expect(args.rest).toContain("abc-123");
    });

    it("should parse 'memory search' with query", () => {
      const args = parseArgs(["memory", "search", "auth", "login"]);
      expect(args.command).toBe("memory");
      expect(args.subcommand).toBe("search");
      expect(args.rest).toEqual(["auth", "login"]);
    });

    it("should parse 'agent create' with name", () => {
      const args = parseArgs(["agent", "create", "my-agent"]);
      expect(args.command).toBe("agent");
      expect(args.subcommand).toBe("create");
      expect(args.rest).toContain("my-agent");
    });

    it("should parse 'config set' with key and value", () => {
      const args = parseArgs(["config", "set", "theme", "dark"]);
      expect(args.command).toBe("config");
      expect(args.subcommand).toBe("set");
      expect(args.rest).toEqual(["theme", "dark"]);
    });

    it("should parse 'plugin list'", () => {
      const args = parseArgs(["plugin", "list"]);
      expect(args.command).toBe("plugin");
      expect(args.subcommand).toBe("list");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Bare prompt (positional arguments)
  // ═══════════════════════════════════════════════════════════════════════

  describe("bare prompt", () => {
    it("should capture bare words as prompt text", () => {
      const args = parseArgs(["explain", "this", "code"]);
      expect(args.prompt).toBe("explain this code");
    });

    it("should capture a single word prompt", () => {
      const args = parseArgs(["hello"]);
      expect(args.prompt).toBe("hello");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Combined flags
  // ═══════════════════════════════════════════════════════════════════════

  describe("combined flags", () => {
    it("should handle multiple flags together", () => {
      const args = parseArgs(["-c", "--no-memory", "-m", "gpt-4", "--provider", "openai"]);
      expect(args.continue).toBe(true);
      expect(args.noMemory).toBe(true);
      expect(args.model).toBe("gpt-4");
      expect(args.provider).toBe("openai");
    });

    it("should handle print mode with model override", () => {
      const args = parseArgs(["-p", "what is this?", "-m", "claude-opus-4-0-20250514"]);
      expect(args.print).toBe(true);
      expect(args.prompt).toBe("what is this?");
      expect(args.model).toBe("claude-opus-4-0-20250514");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Empty args
  // ═══════════════════════════════════════════════════════════════════════

  describe("empty arguments", () => {
    it("should return defaults for empty argv", () => {
      const args = parseArgs([]);
      expect(args.command).toBeUndefined();
      expect(args.prompt).toBeUndefined();
      expect(args.print).toBeUndefined();
      expect(args.continue).toBeUndefined();
      expect(args.resume).toBeUndefined();
      expect(args.model).toBeUndefined();
      expect(args.rest).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Unknown flags
  // ═══════════════════════════════════════════════════════════════════════

  describe("unknown flags", () => {
    it("should push unknown flags to rest", () => {
      const args = parseArgs(["--unknown-flag", "--another"]);
      expect(args.rest).toContain("--unknown-flag");
      expect(args.rest).toContain("--another");
    });
  });
});

describe("printHelp", () => {
  it("should write help text to stdout without throwing", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    printHelp();
    expect(writeSpy).toHaveBeenCalled();
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain("Chitragupta");
    expect(output).toContain("-p, --print");
    expect(output).toContain("-c, --continue");
    expect(output).toContain("-r, --resume");
    writeSpy.mockRestore();
  });
});
