/**
 * @chitragupta/cli — Argument parser.
 *
 * Simple CLI argument parser with no external dependencies.
 * Parses flags, subcommands, and positional arguments from argv.
 */

export interface ParsedArgs {
	command?: string;
	subcommand?: string;
	prompt?: string;
	print?: boolean;
	continue?: boolean;
	resume?: boolean;
	model?: string;
	provider?: string;
	profile?: string;
	noMemory?: boolean;
	version?: boolean;
	help?: boolean;
	/** Port for the HTTP server (--port flag with 'serve' subcommand). */
	port?: number;
	/** Host for the HTTP server (--host flag with 'serve' subcommand). */
	host?: string;
	/** Disable Kavach TLS (--no-tls flag with 'serve' subcommand). */
	noTls?: boolean;
	rest: string[];
}

/**
 * Known subcommands that take a second-level command.
 */
const SUBCOMMANDS = new Set(["provider", "session", "memory", "agent", "config", "plugin", "mcp", "serve", "mcp-server", "init", "code", "orchestrate", "workflow", "skill", "swapna", "sync", "daemon"]);

/**
 * Parse process.argv (or a custom argv array) into structured arguments.
 *
 * Expects argv WITHOUT the leading `node` and script path entries,
 * i.e., pass `process.argv.slice(2)`.
 *
 * @param argv - Array of CLI arguments (without node/script entries).
 * @returns Parsed arguments with flags, subcommands, prompt, and rest array.
 */
export function parseArgs(argv: string[]): ParsedArgs {
	const result: ParsedArgs = {
		rest: [],
	};

	let i = 0;

	while (i < argv.length) {
		const arg = argv[i];

		// ─── Flags with values ──────────────────────────────────────────
		if (arg === "-p" || arg === "--print") {
			result.print = true;
			// If the next argument is not a flag, treat it as the prompt
			if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
				i++;
				result.prompt = argv[i];
			}
			i++;
			continue;
		}

		if (arg === "-m" || arg === "--model") {
			i++;
			if (i < argv.length) {
				result.model = argv[i];
			}
			i++;
			continue;
		}

		if (arg === "--provider") {
			i++;
			if (i < argv.length) {
				result.provider = argv[i];
			}
			i++;
			continue;
		}

		if (arg === "--profile") {
			i++;
			if (i < argv.length) {
				result.profile = argv[i];
			}
			i++;
			continue;
		}

		// ─── Boolean flags ──────────────────────────────────────────────
		if (arg === "-c" || arg === "--continue") {
			result.continue = true;
			i++;
			continue;
		}

		if (arg === "-r" || arg === "--resume") {
			result.resume = true;
			i++;
			continue;
		}

		if (arg === "--no-memory") {
			result.noMemory = true;
			i++;
			continue;
		}

		if (arg === "-v" || arg === "--version") {
			result.version = true;
			i++;
			continue;
		}

		if (arg === "-h" || arg === "--help") {
			result.help = true;
			i++;
			continue;
		}

		// ─── Subcommands ────────────────────────────────────────────────
		if (!arg.startsWith("-") && !result.command && !result.prompt && SUBCOMMANDS.has(arg)) {
			result.command = arg;
			i++;
			// Next non-flag argument is the subcommand
			if (i < argv.length && !argv[i].startsWith("-")) {
				result.subcommand = argv[i];
				i++;
			}
			// Collect remaining args as rest
			while (i < argv.length) {
				result.rest.push(argv[i]);
				i++;
			}
			continue;
		}

		// ─── Bare positional arguments (prompt text) ────────────────────
		if (!arg.startsWith("-") && !result.command) {
			// Treat bare positional arguments as prompt text
			if (!result.prompt) {
				result.prompt = arg;
			} else {
				result.prompt += " " + arg;
			}
			i++;
			continue;
		}

		// ─── Unknown flags — push to rest ───────────────────────────────
		result.rest.push(arg);
		i++;
	}

	// ─── Post-process: extract --port and --host from rest (for serve) ──
	if (result.command === "serve") {
		const remaining: string[] = [];
		for (let j = 0; j < result.rest.length; j++) {
			if (result.rest[j] === "--port" && j + 1 < result.rest.length) {
				const parsed = parseInt(result.rest[j + 1], 10);
				if (!isNaN(parsed)) result.port = parsed;
				j++; // skip value
			} else if (result.rest[j] === "--host" && j + 1 < result.rest.length) {
				result.host = result.rest[j + 1];
				j++; // skip value
			} else if (result.rest[j] === "--no-tls") {
				result.noTls = true;
			} else {
				remaining.push(result.rest[j]);
			}
		}
		result.rest = remaining;
	}

	return result;
}

/**
 * Print the CLI help text to stdout.
 */
export function printHelp(): void {
	const help = `
Chitragupta — A bold, opinionated AI coding assistant

Usage:
  chitragupta                      Interactive mode (default)
  chitragupta "prompt"             Quick prompt in interactive mode
  chitragupta -p "prompt"          Print mode (single response, then exit)

Options:
  -p, --print <prompt>          Print mode: respond and exit
  -c, --continue                Continue the last session
  -r, --resume                  Resume a session (interactive picker)
  -m, --model <model>           Override the default model
  --provider <id>               Override the default provider
  --profile <id>                Override the agent profile
  --no-memory                   Disable memory loading
  -v, --version                 Show version
  -h, --help                    Show this help

Subcommands:
  code "task" [--mode M] [--plan]  Run coding agent (plan, code, validate, review)
  init [--client <name>]        Set up MCP + instructions (claude|codex|gemini|copilot)
  provider list|add|test        Manage AI providers (anthropic,openai,google,ollama,...)
  session list|show|search|export|import  Manage sessions
  memory show|edit|search       Manage project memory
  agent list|create|use         Manage agent profiles
  config [set <key> <val>]      View/edit configuration
  mcp list|add|remove|test      Manage MCP servers
  plugin install|list|remove    Manage plugins
  swapna [date]                 Run Swapna memory consolidation
  sync status|export|import     Cross-machine sync for days/memory
  daemon start|stop|status|restart  Manage background daemon
  serve [--port N] [--host H] [--no-tls]  Start HTTP API server (TLS on by default)
  mcp-server [--sse] [--port N] [--agent]  Run as MCP server

Interactive shortcuts:
  Ctrl+C                        Clear editor (twice to quit)
  Escape                        Abort current operation
  Ctrl+L                        Model selector overlay
  Shift+Tab                     Cycle thinking level
  Enter                         Send message

Slash commands (in interactive mode):
  /model <name>                 Switch model
  /thinking <level>             Set thinking level (none|low|medium|high)
  /compact                      Compact conversation context
  /memory                       Show project memory
  /help                         Show help
  /clear                        Clear conversation
  /quit                         Exit Chitragupta
`;
	process.stdout.write(help.trimStart());
}
