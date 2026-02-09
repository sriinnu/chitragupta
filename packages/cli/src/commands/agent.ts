/**
 * @chitragupta/cli — Agent profile management commands.
 *
 * Handles listing, creating, and switching agent profiles.
 * Profiles define the personality, expertise, and behavior of the AI agent.
 */

import fs from "fs";
import path from "path";
import * as readline from "readline";
import {
	getChitraguptaHome,
	loadGlobalSettings,
	saveGlobalSettings,
	BUILT_IN_PROFILES,
	resolveProfile,
} from "@chitragupta/core";
import type { AgentProfile, ThinkingLevel, VoiceStyle } from "@chitragupta/core";
import {
	bold,
	green,
	gray,
	yellow,
	cyan,
	dim,
	red,
} from "@chitragupta/ui/ansi";

/**
 * Get the custom profiles directory.
 */
function getProfilesDir(): string {
	return path.join(getChitraguptaHome(), "profiles");
}

/**
 * Load custom profiles from disk.
 */
function loadCustomProfiles(): Record<string, AgentProfile> {
	const dir = getProfilesDir();
	const profiles: Record<string, AgentProfile> = {};

	if (!fs.existsSync(dir)) return profiles;

	try {
		const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
		for (const file of files) {
			try {
				const content = fs.readFileSync(path.join(dir, file), "utf-8");
				const profile = JSON.parse(content) as AgentProfile;
				if (profile.id) {
					profiles[profile.id] = profile;
				}
			} catch {
				// Skip invalid profiles
			}
		}
	} catch {
		// Directory not readable
	}

	return profiles;
}

/**
 * Save a custom profile to disk.
 */
function saveCustomProfile(profile: AgentProfile): void {
	const dir = getProfilesDir();
	fs.mkdirSync(dir, { recursive: true });
	const filePath = path.join(dir, `${profile.id}.json`);
	fs.writeFileSync(filePath, JSON.stringify(profile, null, "\t"), "utf-8");
}

/**
 * Prompt the user for input.
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
 * List all available agent profiles (built-in and custom).
 */
export async function list(): Promise<void> {
	const settings = loadGlobalSettings();
	const customProfiles = loadCustomProfiles();

	process.stdout.write("\n" + bold("Agent Profiles") + "\n\n");

	// Built-in profiles
	process.stdout.write(dim("  Built-in:") + "\n\n");

	for (const [id, profile] of Object.entries(BUILT_IN_PROFILES)) {
		const isActive = settings.agentProfile === id;
		const activeTag = isActive ? cyan(" (active)") : "";
		const voiceTag = gray(` [${profile.voice}]`);

		process.stdout.write(
			`  ${bold(profile.name)}${activeTag}${voiceTag}\n`,
		);
		process.stdout.write(
			`    ${dim(profile.id)} — ${dim(profile.personality.split("\n")[0].slice(0, 80))}...\n`,
		);

		if (profile.expertise.length > 0) {
			process.stdout.write(
				`    ${gray("Expertise:")} ${profile.expertise.join(", ")}\n`,
			);
		}

		process.stdout.write("\n");
	}

	// Custom profiles
	const customEntries = Object.entries(customProfiles);
	if (customEntries.length > 0) {
		process.stdout.write(dim("  Custom:") + "\n\n");

		for (const [id, profile] of customEntries) {
			const isActive = settings.agentProfile === id;
			const activeTag = isActive ? cyan(" (active)") : "";

			process.stdout.write(
				`  ${bold(profile.name)}${activeTag}\n`,
			);
			process.stdout.write(
				`    ${dim(profile.id)} — ${dim(profile.personality.split("\n")[0].slice(0, 80))}...\n`,
			);

			process.stdout.write("\n");
		}
	}

	process.stdout.write(
		gray("  Use `chitragupta agent use <id>` to switch profiles.\n\n"),
	);
}

/**
 * Create a new custom agent profile interactively.
 */
export async function create(name: string): Promise<void> {
	process.stdout.write("\n" + bold("Create Agent Profile") + "\n\n");

	// Generate an ID from the name
	const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

	// Check for conflicts
	const customProfiles = loadCustomProfiles();
	if (BUILT_IN_PROFILES[id] || customProfiles[id]) {
		process.stderr.write(
			red(`\n  Error: Profile "${id}" already exists.\n\n`),
		);
		process.exit(1);
	}

	process.stdout.write(`  ID: ${cyan(id)}\n`);
	process.stdout.write(`  Name: ${bold(name)}\n\n`);

	// Prompt for personality
	const personality = await promptUser(
		"  Describe the personality (or press Enter for a default): ",
	);

	// Prompt for expertise
	const expertiseRaw = await promptUser(
		"  Expertise areas (comma-separated, or Enter to skip): ",
	);
	const expertise = expertiseRaw
		? expertiseRaw.split(",").map((s) => s.trim()).filter(Boolean)
		: [];

	// Prompt for voice style
	const voiceInput = await promptUser(
		"  Voice style (bold/friendly/minimal/custom) [bold]: ",
	);
	const voice = (["bold", "friendly", "minimal", "custom"].includes(voiceInput) ? voiceInput : "bold") as VoiceStyle;

	let customVoice: string | undefined;
	if (voice === "custom") {
		customVoice = await promptUser("  Custom voice description: ");
	}

	// Prompt for thinking level
	const thinkingInput = await promptUser(
		"  Preferred thinking level (none/low/medium/high) [medium]: ",
	);
	const preferredThinking = (["none", "low", "medium", "high"].includes(thinkingInput) ? thinkingInput : "medium") as ThinkingLevel;

	const profile: AgentProfile = {
		id,
		name,
		personality: personality || `You are ${name}, a helpful coding assistant.`,
		expertise,
		preferredThinking,
		voice,
		customVoice,
	};

	saveCustomProfile(profile);

	process.stdout.write(
		"\n" + green(`  Profile "${name}" created successfully.`) + "\n",
	);
	process.stdout.write(
		gray(`  Saved to: ${path.join(getProfilesDir(), `${id}.json`)}`) + "\n",
	);
	process.stdout.write(
		gray(`  Use \`chitragupta agent use ${id}\` to activate it.`) + "\n\n",
	);
}

/**
 * Switch the active agent profile.
 */
export async function use(profileId: string): Promise<void> {
	const customProfiles = loadCustomProfiles();
	const profile = resolveProfile(profileId, customProfiles);

	if (!profile) {
		const allIds = [
			...Object.keys(BUILT_IN_PROFILES),
			...Object.keys(customProfiles),
		];
		process.stderr.write(
			red(`\n  Error: Profile "${profileId}" not found.\n`) +
			gray(`  Available profiles: ${allIds.join(", ")}\n\n`),
		);
		process.exit(1);
	}

	const settings = loadGlobalSettings();
	settings.agentProfile = profileId;

	// Update preferred model if the profile specifies one
	if (profile.preferredModel) {
		settings.defaultModel = profile.preferredModel;
	}

	// Update thinking level if the profile specifies one
	if (profile.preferredThinking) {
		settings.thinkingLevel = profile.preferredThinking;
	}

	saveGlobalSettings(settings);

	process.stdout.write(
		"\n" + green(`  Switched to ${bold(profile.name)} profile.`) + "\n",
	);

	if (profile.preferredModel) {
		process.stdout.write(dim(`  Model: ${profile.preferredModel}`) + "\n");
	}
	if (profile.preferredThinking) {
		process.stdout.write(dim(`  Thinking: ${profile.preferredThinking}`) + "\n");
	}

	process.stdout.write("\n");
}
