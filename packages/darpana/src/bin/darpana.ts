#!/usr/bin/env node
/**
 * Darpana CLI — start the LLM API proxy.
 *
 * Usage:
 *   darpana [--port 8082] [--host 127.0.0.1] [--config ./darpana.json]
 *   env OPENAI_API_KEY darpana --port 8082
 */
import { loadConfig, detectCredentialSources } from "../config.js";
import { createServer } from "../server.js";

function parseArgs(argv: string[]): Record<string, string> {
	const args: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg.startsWith("--") && i + 1 < argv.length) {
			args[arg.slice(2)] = argv[i + 1];
			i++;
		}
	}
	return args;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	const config = loadConfig({
		configPath: args.config,
		port: args.port ? Number.parseInt(args.port, 10) : undefined,
		host: args.host,
	});

	// Apply quick alias overrides from CLI
	if (args["big-model"]) {
		config.aliases.opus = args["big-model"];
		config.aliases.sonnet = args["big-model"];
	}
	if (args["small-model"]) {
		config.aliases.haiku = args["small-model"];
	}

	const providerCount = Object.keys(config.providers).length;
	if (providerCount === 0) {
		console.error("No providers configured.");
		console.error("Set API key env vars (OPENAI_API_KEY, GEMINI_API_KEY, etc.) or create a darpana.json config file.");
		process.exit(1);
	}

	const server = createServer(config);
	await server.listen();

	// Startup banner
	console.log("");
	console.log("  \x1b[1m\x1b[35mdarpana\x1b[0m \x1b[2m(दर्पण)\x1b[0m  LLM API Proxy");
	console.log(`  \x1b[2mListening on\x1b[0m  http://${config.host}:${config.port}`);
	console.log("");

	// Provider table
	console.log("  \x1b[1mProviders:\x1b[0m");
	for (const [name, provider] of Object.entries(config.providers)) {
		const models = provider.models && Object.keys(provider.models).length > 0
			? Object.keys(provider.models).join(", ")
			: "*";
		const endpoint = provider.endpoint ?? (provider.type === "google" ? "generativelanguage.googleapis.com" : "api.anthropic.com");
		console.log(`    \x1b[36m${name}\x1b[0m \x1b[2m(${provider.type})\x1b[0m → ${endpoint}`);
		console.log(`      models: ${models}`);
	}
	console.log("");

	// Alias table
	if (Object.keys(config.aliases).length > 0) {
		console.log("  \x1b[1mAliases:\x1b[0m");
		for (const [alias, target] of Object.entries(config.aliases)) {
			console.log(`    \x1b[33m${alias}\x1b[0m → ${target}`);
		}
		console.log("");
	}

	// Credential sources
	const sources = detectCredentialSources();
	if (sources.length > 0) {
		console.log("  \x1b[1mCredentials:\x1b[0m");
		for (const s of sources) {
			console.log(`    \x1b[32m${s.name}\x1b[0m ← ${s.source}`);
		}
		console.log("");
	}

	console.log(`  \x1b[2mUse with Claude Code:\x1b[0m`);
	console.log(`    ANTHROPIC_BASE_URL=http://${config.host}:${config.port} claude`);
	console.log("");

	// Graceful shutdown
	const shutdown = async () => {
		console.log("\n  Shutting down...");
		await server.close();
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

main().catch((err) => {
	console.error("Fatal:", err);
	process.exit(1);
});
