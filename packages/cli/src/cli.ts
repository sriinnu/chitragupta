#!/usr/bin/env node

/**
 * @chitragupta/cli — Entry point.
 *
 * The main CLI binary. Parses arguments, routes to subcommands
 * or launches the main interactive/print mode.
 */

import { ChitraguptaError } from "@chitragupta/core";
import { parseArgs, printHelp } from "./args.js";
import { main } from "./main.js";
import { handleSubcommand } from "./cli-commands.js";

const VERSION = "0.1.0";

// ─── Run ────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	// ─── Version ────────────────────────────────────────────────────────
	if (args.version) {
		process.stdout.write(`chitragupta v${VERSION}\n`);
		process.exit(0);
	}

	// ─── Help ───────────────────────────────────────────────────────────
	if (args.help) {
		printHelp();
		process.exit(0);
	}

	// ─── Subcommands ────────────────────────────────────────────────────
	if (args.command) {
		await handleSubcommand(args.command, args.subcommand, args.rest, { port: args.port, host: args.host });
		process.exit(0);
	}

	// ─── Main mode (interactive or print) ───────────────────────────────
	try {
		await main(args);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const code = error instanceof ChitraguptaError ? error.code : undefined;

		// Friendly error messages for common issues
		if (code === "AUTH_ERROR") {
			process.stderr.write(
				`\nAuthentication error: ${message}\n\n` +
				"Run `chitragupta provider list` to see available providers.\n" +
				"Run `chitragupta provider add <id>` to configure a provider.\n\n",
			);
		} else if (code === "PROVIDER_ERROR") {
			process.stderr.write(
				`\nProvider error: ${message}\n\n`,
			);
		} else {
			process.stderr.write(
				`\nError: ${message}\n\n`,
			);
		}

		process.exit(1);
	}
}

run().catch((error) => {
	process.stderr.write(`\nFatal error: ${error?.message ?? error}\n\n`);
	process.exit(1);
});
