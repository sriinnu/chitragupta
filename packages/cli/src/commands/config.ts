/**
 * @chitragupta/cli — Configuration commands.
 *
 * Handles viewing and editing global Chitragupta configuration.
 */

import {
	loadGlobalSettings,
	saveGlobalSettings,
	getChitraguptaHome,
	deepSet,
} from "@chitragupta/core";
import type { ChitraguptaSettings } from "@chitragupta/core";
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
 * Display the current configuration.
 */
export async function show(): Promise<void> {
	const settings = loadGlobalSettings();

	process.stdout.write("\n" + bold("Chitragupta Configuration") + "\n");
	process.stdout.write(gray(`  Home: ${getChitraguptaHome()}`) + "\n\n");

	const entries = flattenObject(settings as unknown as Record<string, unknown>);

	for (const [key, value] of entries) {
		const valueStr = typeof value === "string" ? value : JSON.stringify(value);
		process.stdout.write(
			`  ${cyan(key)} ${gray("=")} ${valueStr}\n`,
		);
	}

	process.stdout.write(
		"\n" + gray("  Use `chitragupta config set <key> <value>` to change a setting.") + "\n\n",
	);
}

/**
 * Set a configuration value using dot-notation keys.
 *
 * Examples:
 *   chitragupta config set defaultModel gpt-4o
 *   chitragupta config set thinkingLevel high
 *   chitragupta config set compaction.threshold 90
 *   chitragupta config set memory.autoSave false
 */
export async function set(key: string, value: string): Promise<void> {
	if (!key) {
		process.stderr.write(red("\n  Error: Key is required.\n\n"));
		process.exit(1);
	}

	const settings = loadGlobalSettings();
	const settingsObj = settings as unknown as Record<string, unknown>;

	// Validate the key exists (or is a valid path)
	const validKeys = new Set(
		flattenObject(settingsObj).map(([k]) => k),
	);

	if (!validKeys.has(key)) {
		// Check if it's a prefix of valid keys (nested object)
		const isPrefix = [...validKeys].some((k) => k.startsWith(key + "."));
		if (!isPrefix) {
			process.stderr.write(
				yellow(`\n  Warning: "${key}" is not a recognized setting.\n`) +
				gray("  Known settings:\n"),
			);
			for (const [k] of flattenObject(settingsObj)) {
				process.stderr.write(gray(`    ${k}\n`));
			}
			process.stderr.write("\n");
			// Still allow setting it for forward-compatibility
		}
	}

	// Parse the value
	const parsed = parseValue(value);

	// Deep-set the value
	deepSet(settingsObj, key, parsed);

	saveGlobalSettings(settingsObj as unknown as ChitraguptaSettings);

	const displayValue = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
	process.stdout.write(
		"\n" + green(`  ${key} = ${displayValue}`) + "\n\n",
	);
}

/**
 * Parse a string value into its appropriate type.
 * Handles booleans, numbers, arrays, and plain strings.
 */
function parseValue(value: string): unknown {
	// Booleans
	if (value === "true") return true;
	if (value === "false") return false;
	if (value === "null") return null;

	// Numbers
	const num = Number(value);
	if (!Number.isNaN(num) && value.trim() !== "") return num;

	// JSON arrays/objects
	if ((value.startsWith("[") && value.endsWith("]")) || (value.startsWith("{") && value.endsWith("}"))) {
		try {
			return JSON.parse(value);
		} catch {
			// Fall through to string
		}
	}

	// Plain string
	return value;
}

/**
 * Flatten a nested object into dot-notation key-value pairs.
 */
function flattenObject(
	obj: Record<string, unknown>,
	prefix = "",
): Array<[string, unknown]> {
	const entries: Array<[string, unknown]> = [];

	for (const [key, value] of Object.entries(obj)) {
		const fullKey = prefix ? `${prefix}.${key}` : key;

		if (value !== null && typeof value === "object" && !Array.isArray(value)) {
			entries.push(...flattenObject(value as Record<string, unknown>, fullKey));
		} else {
			entries.push([fullKey, value]);
		}
	}

	return entries;
}

