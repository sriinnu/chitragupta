import { describe, it, expect, vi } from "vitest";
import { parseArgs, printHelp } from "../src/args.js";

// ═══════════════════════════════════════════════════════════════════════════════
// parseArgs
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseArgs", () => {
	// ─── Empty args ──────────────────────────────────────────────────────────

	describe("empty arguments", () => {
		it("should return an object with only rest as empty array", () => {
			const args = parseArgs([]);
			expect(args.command).toBeUndefined();
			expect(args.subcommand).toBeUndefined();
			expect(args.prompt).toBeUndefined();
			expect(args.print).toBeUndefined();
			expect(args.continue).toBeUndefined();
			expect(args.resume).toBeUndefined();
			expect(args.model).toBeUndefined();
			expect(args.provider).toBeUndefined();
			expect(args.profile).toBeUndefined();
			expect(args.noMemory).toBeUndefined();
			expect(args.version).toBeUndefined();
			expect(args.help).toBeUndefined();
			expect(args.port).toBeUndefined();
			expect(args.host).toBeUndefined();
			expect(args.rest).toEqual([]);
		});
	});

	// ─── Boolean flags ───────────────────────────────────────────────────────

	describe("boolean flags", () => {
		it("should parse -p as print=true", () => {
			const args = parseArgs(["-p"]);
			expect(args.print).toBe(true);
			expect(args.prompt).toBeUndefined();
		});

		it("should parse --print as print=true", () => {
			const args = parseArgs(["--print"]);
			expect(args.print).toBe(true);
		});

		it("should parse -p with a following non-flag arg as prompt", () => {
			const args = parseArgs(["-p", "explain code"]);
			expect(args.print).toBe(true);
			expect(args.prompt).toBe("explain code");
		});

		it("should parse --print with a following non-flag arg as prompt", () => {
			const args = parseArgs(["--print", "what is this?"]);
			expect(args.print).toBe(true);
			expect(args.prompt).toBe("what is this?");
		});

		it("should not consume a flag token as the print prompt", () => {
			const args = parseArgs(["-p", "--model", "gpt-4"]);
			expect(args.print).toBe(true);
			expect(args.prompt).toBeUndefined();
			expect(args.model).toBe("gpt-4");
		});

		it("should parse -c as continue=true", () => {
			const args = parseArgs(["-c"]);
			expect(args.continue).toBe(true);
		});

		it("should parse --continue as continue=true", () => {
			const args = parseArgs(["--continue"]);
			expect(args.continue).toBe(true);
		});

		it("should parse -r as resume=true", () => {
			const args = parseArgs(["-r"]);
			expect(args.resume).toBe(true);
		});

		it("should parse --resume as resume=true", () => {
			const args = parseArgs(["--resume"]);
			expect(args.resume).toBe(true);
		});

		it("should parse --no-memory as noMemory=true", () => {
			const args = parseArgs(["--no-memory"]);
			expect(args.noMemory).toBe(true);
		});

		it("should parse -v as version=true", () => {
			const args = parseArgs(["-v"]);
			expect(args.version).toBe(true);
		});

		it("should parse --version as version=true", () => {
			const args = parseArgs(["--version"]);
			expect(args.version).toBe(true);
		});

		it("should parse -h as help=true", () => {
			const args = parseArgs(["-h"]);
			expect(args.help).toBe(true);
		});

		it("should parse --help as help=true", () => {
			const args = parseArgs(["--help"]);
			expect(args.help).toBe(true);
		});
	});

	// ─── Value flags ─────────────────────────────────────────────────────────

	describe("value flags", () => {
		it("should parse -m <model> into model", () => {
			const args = parseArgs(["-m", "claude-sonnet-4-5-20250929"]);
			expect(args.model).toBe("claude-sonnet-4-5-20250929");
		});

		it("should parse --model <model> into model", () => {
			const args = parseArgs(["--model", "gpt-4o"]);
			expect(args.model).toBe("gpt-4o");
		});

		it("should parse --provider <name> into provider", () => {
			const args = parseArgs(["--provider", "openai"]);
			expect(args.provider).toBe("openai");
		});

		it("should parse --profile <name> into profile", () => {
			const args = parseArgs(["--profile", "reviewer"]);
			expect(args.profile).toBe("reviewer");
		});

		it("should leave model undefined when -m is last arg with no value", () => {
			const args = parseArgs(["-m"]);
			expect(args.model).toBeUndefined();
		});

		it("should leave provider undefined when --provider is last arg", () => {
			const args = parseArgs(["--provider"]);
			expect(args.provider).toBeUndefined();
		});

		it("should leave profile undefined when --profile is last arg", () => {
			const args = parseArgs(["--profile"]);
			expect(args.profile).toBeUndefined();
		});
	});

	// ─── Subcommand detection ────────────────────────────────────────────────

	describe("subcommand detection", () => {
		const subcommands = ["provider", "session", "memory", "agent", "config", "plugin", "mcp", "serve"];

		for (const cmd of subcommands) {
			it(`should recognize "${cmd}" as a command`, () => {
				const args = parseArgs([cmd]);
				expect(args.command).toBe(cmd);
			});
		}

		it("should not recognize an unknown word as a command", () => {
			const args = parseArgs(["foobar"]);
			expect(args.command).toBeUndefined();
			expect(args.prompt).toBe("foobar");
		});

		it("should only recognize the first matching subcommand", () => {
			const args = parseArgs(["provider", "session"]);
			expect(args.command).toBe("provider");
			expect(args.subcommand).toBe("session");
		});
	});

	// ─── Positional args after subcommand ────────────────────────────────────

	describe("positional args after subcommand", () => {
		it("should parse the second arg as the subcommand", () => {
			const args = parseArgs(["provider", "list"]);
			expect(args.command).toBe("provider");
			expect(args.subcommand).toBe("list");
		});

		it("should collect remaining args after subcommand into rest", () => {
			const args = parseArgs(["provider", "add", "openai"]);
			expect(args.command).toBe("provider");
			expect(args.subcommand).toBe("add");
			expect(args.rest).toContain("openai");
		});

		it("should collect multiple remaining args into rest", () => {
			const args = parseArgs(["config", "set", "theme", "dark"]);
			expect(args.command).toBe("config");
			expect(args.subcommand).toBe("set");
			expect(args.rest).toEqual(["theme", "dark"]);
		});

		it("should handle subcommand with no following args", () => {
			const args = parseArgs(["plugin"]);
			expect(args.command).toBe("plugin");
			expect(args.subcommand).toBeUndefined();
			expect(args.rest).toEqual([]);
		});

		it("should handle flags after command as rest", () => {
			const args = parseArgs(["memory", "--verbose"]);
			// --verbose starts with '-' so it doesn't become subcommand
			expect(args.command).toBe("memory");
			expect(args.subcommand).toBeUndefined();
			expect(args.rest).toEqual(["--verbose"]);
		});
	});

	// ─── serve post-processing (--port and --host) ───────────────────────────

	describe("serve post-processing", () => {
		it("should extract --port from rest into flags.port", () => {
			const args = parseArgs(["serve", "start", "--port", "3000"]);
			expect(args.command).toBe("serve");
			expect(args.port).toBe(3000);
		});

		it("should extract --host from rest into flags.host", () => {
			const args = parseArgs(["serve", "start", "--host", "0.0.0.0"]);
			expect(args.command).toBe("serve");
			expect(args.host).toBe("0.0.0.0");
		});

		it("should extract both --port and --host from rest", () => {
			const args = parseArgs(["serve", "start", "--port", "8080", "--host", "localhost"]);
			expect(args.command).toBe("serve");
			expect(args.port).toBe(8080);
			expect(args.host).toBe("localhost");
			// They should be removed from rest
			expect(args.rest).not.toContain("--port");
			expect(args.rest).not.toContain("8080");
			expect(args.rest).not.toContain("--host");
			expect(args.rest).not.toContain("localhost");
		});

		it("should leave other rest args intact after extraction", () => {
			const args = parseArgs(["serve", "start", "--port", "3000", "--extra"]);
			expect(args.port).toBe(3000);
			expect(args.rest).toContain("--extra");
		});

		it("should not extract --port for non-serve commands", () => {
			const args = parseArgs(["config", "set", "--port", "3000"]);
			expect(args.command).toBe("config");
			expect(args.port).toBeUndefined();
			expect(args.rest).toContain("--port");
			expect(args.rest).toContain("3000");
		});

		it("should not set port if the value is not a valid number", () => {
			const args = parseArgs(["serve", "start", "--port", "abc"]);
			expect(args.command).toBe("serve");
			expect(args.port).toBeUndefined();
		});

		it("should handle --port at the end with no value", () => {
			const args = parseArgs(["serve", "start", "--port"]);
			expect(args.command).toBe("serve");
			// --port with no following value stays in rest
			expect(args.rest).toContain("--port");
		});
	});

	// ─── Combined flags and subcommands ──────────────────────────────────────

	describe("combined flags and subcommands", () => {
		it("should handle flags before a subcommand", () => {
			const args = parseArgs(["--no-memory", "-m", "gpt-4", "session", "list"]);
			expect(args.noMemory).toBe(true);
			expect(args.model).toBe("gpt-4");
			expect(args.command).toBe("session");
			expect(args.subcommand).toBe("list");
		});

		it("should handle print mode with model override", () => {
			const args = parseArgs(["-p", "explain this", "-m", "claude-opus-4-0-20250514"]);
			expect(args.print).toBe(true);
			expect(args.prompt).toBe("explain this");
			expect(args.model).toBe("claude-opus-4-0-20250514");
		});

		it("should handle multiple boolean flags together", () => {
			const args = parseArgs(["-c", "--no-memory", "-v"]);
			expect(args.continue).toBe(true);
			expect(args.noMemory).toBe(true);
			expect(args.version).toBe(true);
		});

		it("should handle all value flags simultaneously", () => {
			const args = parseArgs(["--model", "gpt-4", "--provider", "openai", "--profile", "coder"]);
			expect(args.model).toBe("gpt-4");
			expect(args.provider).toBe("openai");
			expect(args.profile).toBe("coder");
		});
	});

	// ─── Unknown flags handling ──────────────────────────────────────────────

	describe("unknown flags handling", () => {
		it("should push unknown flags to rest", () => {
			const args = parseArgs(["--unknown-flag", "--another"]);
			expect(args.rest).toContain("--unknown-flag");
			expect(args.rest).toContain("--another");
		});

		it("should push unknown flags to rest while parsing known ones", () => {
			const args = parseArgs(["--custom", "-v"]);
			expect(args.rest).toContain("--custom");
			expect(args.version).toBe(true);
		});
	});

	// ─── Bare prompt (positional text) ───────────────────────────────────────

	describe("bare prompt", () => {
		it("should capture a single word as prompt", () => {
			const args = parseArgs(["hello"]);
			expect(args.prompt).toBe("hello");
		});

		it("should concatenate multiple words into prompt with spaces", () => {
			const args = parseArgs(["explain", "this", "code"]);
			expect(args.prompt).toBe("explain this code");
		});

		it("should capture prompt before flags", () => {
			const args = parseArgs(["hello", "-v"]);
			expect(args.prompt).toBe("hello");
			expect(args.version).toBe(true);
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// printHelp
// ═══════════════════════════════════════════════════════════════════════════════

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
		expect(output).toContain("-m, --model");
		expect(output).toContain("--provider");
		expect(output).toContain("--profile");
		expect(output).toContain("--no-memory");
		expect(output).toContain("-v, --version");
		expect(output).toContain("-h, --help");
		writeSpy.mockRestore();
	});

	it("should include subcommand documentation", () => {
		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		printHelp();
		const output = writeSpy.mock.calls[0][0] as string;
		expect(output).toContain("provider");
		expect(output).toContain("session");
		expect(output).toContain("memory");
		expect(output).toContain("agent");
		expect(output).toContain("config");
		expect(output).toContain("mcp");
		expect(output).toContain("plugin");
		expect(output).toContain("serve");
		writeSpy.mockRestore();
	});

	it("should include slash command documentation", () => {
		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		printHelp();
		const output = writeSpy.mock.calls[0][0] as string;
		expect(output).toContain("/model");
		expect(output).toContain("/help");
		expect(output).toContain("/quit");
		writeSpy.mockRestore();
	});
});
