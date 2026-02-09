/**
 * @chitragupta/cli — Provider management commands.
 *
 * Handles listing, adding, and testing AI provider configurations.
 */

import fs from "fs";
import path from "path";
import * as readline from "readline";
import {
	getChitraguptaHome,
	loadGlobalSettings,
	saveGlobalSettings,
} from "@chitragupta/core";
import { createProviderRegistry } from "@chitragupta/swara/provider-registry";
import { anthropicProvider } from "@chitragupta/swara/providers/anthropic";
import { openaiProvider } from "@chitragupta/swara/providers/openai";
import type { ProviderDefinition } from "@chitragupta/swara/types";
import {
	bold,
	green,
	red,
	yellow,
	gray,
	cyan,
	dim,
	reset,
} from "@chitragupta/ui/ansi";

/**
 * Get the built-in provider definitions.
 */
function getBuiltinProviders(): ProviderDefinition[] {
	return [anthropicProvider, openaiProvider];
}

/**
 * Check if an API key is configured for a provider (via env var).
 */
function isProviderConfigured(provider: ProviderDefinition): boolean {
	if (provider.auth.type === "env" && provider.auth.envVar) {
		return !!process.env[provider.auth.envVar];
	}
	return false;
}

/**
 * List all registered providers with their models and configuration status.
 */
export async function list(): Promise<void> {
	const providers = getBuiltinProviders();
	const settings = loadGlobalSettings();

	process.stdout.write("\n" + bold("AI Providers") + "\n\n");

	for (const provider of providers) {
		const configured = isProviderConfigured(provider);
		const isDefault = settings.defaultProvider === provider.id;
		const statusIcon = configured ? green("[configured]") : red("[not configured]");
		const defaultTag = isDefault ? cyan(" (default)") : "";

		process.stdout.write(
			`  ${bold(provider.name)} ${gray("(" + provider.id + ")")}${defaultTag} ${statusIcon}\n`,
		);

		if (provider.auth.type === "env" && provider.auth.envVar) {
			process.stdout.write(`    Auth: ${dim("env var")} ${provider.auth.envVar}\n`);
		}

		process.stdout.write(`    Models:\n`);

		for (const model of provider.models) {
			const pricing = `$${model.pricing.input}/$${model.pricing.output} per 1M tokens`;
			const capabilities: string[] = [];
			if (model.capabilities.thinking) capabilities.push("thinking");
			if (model.capabilities.vision) capabilities.push("vision");
			if (model.capabilities.toolUse) capabilities.push("tools");

			const capStr = capabilities.length > 0 ? gray(" [" + capabilities.join(", ") + "]") : "";
			const ctxStr = gray(`${Math.round(model.contextWindow / 1000)}k ctx`);
			const isDefaultModel = settings.defaultModel === model.id;
			const modelDefault = isDefaultModel ? cyan(" *") : "";

			process.stdout.write(
				`      ${model.name}${modelDefault} ${dim("(" + model.id + ")")} — ${ctxStr} — ${dim(pricing)}${capStr}\n`,
			);
		}

		process.stdout.write("\n");
	}

	process.stdout.write(
		gray("  * = default model. Use `chitragupta config set defaultModel <id>` to change.\n\n"),
	);
}

/**
 * Prompt the user for input on a single line.
 */
function promptUser(question: string): Promise<string> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

/**
 * Guide the user through configuring a provider.
 *
 * Prompts for the API key, validates it if possible, and saves
 * the configuration to global settings.
 */
export async function add(providerId: string): Promise<void> {
	const providers = getBuiltinProviders();
	const provider = providers.find((p) => p.id === providerId);

	if (!provider) {
		process.stderr.write(
			red(`\nError: Unknown provider "${providerId}"\n`) +
			`Available providers: ${providers.map((p) => p.id).join(", ")}\n\n`,
		);
		process.exit(1);
	}

	process.stdout.write("\n" + bold(`Configure ${provider.name}`) + "\n\n");

	if (provider.auth.type === "env" && provider.auth.envVar) {
		const currentValue = process.env[provider.auth.envVar];
		if (currentValue) {
			process.stdout.write(
				green(`  ${provider.auth.envVar} is already set.\n\n`),
			);
			const overwrite = await promptUser("  Overwrite? (y/N) ");
			if (overwrite.toLowerCase() !== "y") {
				process.stdout.write(gray("  Keeping existing configuration.\n\n"));
				return;
			}
		}

		process.stdout.write(`  ${provider.name} requires an API key.\n`);
		process.stdout.write(
			gray(`  Set the ${provider.auth.envVar} environment variable.\n\n`),
		);
		process.stdout.write(
			`  Option 1: Export in your shell profile:\n`,
		);
		process.stdout.write(
			cyan(`    export ${provider.auth.envVar}="your-key-here"\n\n`),
		);

		const apiKey = await promptUser(`  Or enter your API key now: `);

		if (!apiKey) {
			process.stdout.write(yellow("\n  No key provided. Skipping.\n\n"));
			return;
		}

		// Validate if possible
		if (provider.validateKey) {
			process.stdout.write(dim("  Validating key..."));
			const valid = await provider.validateKey(apiKey);
			if (valid) {
				process.stdout.write(green(" valid!\n"));
			} else {
				process.stdout.write(red(" invalid.\n"));
				process.stderr.write(
					red("  The API key could not be validated. Please check it.\n\n"),
				);
				return;
			}
		}

		// Save API key to a credentials file
		const credDir = path.join(getChitraguptaHome(), "config");
		fs.mkdirSync(credDir, { recursive: true });
		const credPath = path.join(credDir, "credentials.json");

		let creds: Record<string, string> = {};
		try {
			if (fs.existsSync(credPath)) {
				creds = JSON.parse(fs.readFileSync(credPath, "utf-8"));
			}
		} catch {
			// Start fresh
		}

		creds[provider.auth.envVar] = apiKey;
		fs.writeFileSync(credPath, JSON.stringify(creds, null, "\t"), "utf-8");
		fs.chmodSync(credPath, 0o600);

		process.stdout.write(
			green(`\n  API key saved to ${credPath}\n`),
		);
		process.stdout.write(
			gray(`  Note: Chitragupta checks $${provider.auth.envVar} first, then falls back to this file.\n\n`),
		);

		// Set as default if it's the first provider configured
		const settings = loadGlobalSettings();
		if (!isProviderConfigured(providers.find((p) => p.id === settings.defaultProvider)!)) {
			settings.defaultProvider = provider.id;
			settings.defaultModel = provider.models[0]?.id ?? settings.defaultModel;
			saveGlobalSettings(settings);
			process.stdout.write(
				cyan(`  Set ${provider.name} as the default provider.\n\n`),
			);
		}
	} else {
		process.stdout.write(
			yellow("  This provider uses a non-standard auth method. Please consult its documentation.\n\n"),
		);
	}
}

/**
 * Test a provider connection by sending a simple prompt.
 */
export async function test(providerId: string): Promise<void> {
	const providers = getBuiltinProviders();
	const provider = providers.find((p) => p.id === providerId);

	if (!provider) {
		process.stderr.write(
			red(`\nError: Unknown provider "${providerId}"\n`) +
			`Available providers: ${providers.map((p) => p.id).join(", ")}\n\n`,
		);
		process.exit(1);
	}

	process.stdout.write(
		"\n" + bold(`Testing ${provider.name}...`) + "\n\n",
	);

	if (!isProviderConfigured(provider)) {
		process.stderr.write(
			red(`  ${provider.name} is not configured. Run \`chitragupta provider add ${provider.id}\` first.\n\n`),
		);
		process.exit(1);
	}

	const model = provider.models[0];
	process.stdout.write(dim(`  Model: ${model.name} (${model.id})\n`));
	process.stdout.write(dim(`  Sending test prompt...\n\n`));

	try {
		const context = {
			messages: [
				{
					role: "user" as const,
					content: [{ type: "text" as const, text: "Say 'Hello from Chitragupta!' and nothing else." }],
				},
			],
			systemPrompt: "You are a test assistant. Respond exactly as instructed.",
		};

		let responseText = "";

		for await (const event of provider.stream(model.id, context, { maxTokens: 100 })) {
			if (event.type === "text") {
				responseText += event.text;
			} else if (event.type === "error") {
				throw event.error;
			}
		}

		process.stdout.write(green(`  Response: ${responseText.trim()}\n\n`));
		process.stdout.write(green(`  ${provider.name} is working correctly.\n\n`));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(red(`  Test failed: ${message}\n\n`));
		process.exit(1);
	}
}
