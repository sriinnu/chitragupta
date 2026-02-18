import fs from "fs";
import path from "path";
import { ConfigError } from "./errors.js";
import type { Config, ConfigLayer, ChitraguptaSettings } from "./types.js";
import { DEFAULT_SETTINGS } from "./types.js";

/**
 * Deep-get a nested value from an object using dot-notation keys.
 */
function deepGet(obj: Record<string, unknown>, key: string): unknown {
	const parts = key.split(".");
	let current: unknown = obj;
	for (const part of parts) {
		if (current == null || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

/**
 * Deep-set a nested value on an object using dot-notation keys.
 */
export function deepSet(obj: Record<string, unknown>, key: string, value: unknown): void {
	const parts = key.split(".");
	let current: Record<string, unknown> = obj;
	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i];
		if (current[part] == null || typeof current[part] !== "object") {
			current[part] = {};
		}
		current = current[part] as Record<string, unknown>;
	}
	current[parts[parts.length - 1]] = value;
}

/**
 * Deep-delete a nested key from an object.
 */
function deepDelete(obj: Record<string, unknown>, key: string): void {
	const parts = key.split(".");
	let current: Record<string, unknown> = obj;
	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i];
		if (current[part] == null || typeof current[part] !== "object") return;
		current = current[part] as Record<string, unknown>;
	}
	delete current[parts[parts.length - 1]];
}

/**
 * Deep-merge source into target (mutates target). Arrays are replaced, not concatenated.
 * Only plain objects are recursed; class instances, Date, etc. are treated as leaves.
 */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
	for (const key of Object.keys(source)) {
		const sv = source[key];
		const tv = target[key];
		if (
			sv !== null && typeof sv === "object" && !Array.isArray(sv) &&
			tv !== null && typeof tv === "object" && !Array.isArray(tv)
		) {
			deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>);
		} else {
			target[key] = sv;
		}
	}
}

/**
 * Create a config layer backed by an in-memory object with dot-notation key support.
 *
 * Supports nested get/set/has/delete using dot-notation keys (e.g. `"a.b.c"`),
 * as well as bulk merge and snapshot via `all()`.
 *
 * @param layer - The config layer type (global, workspace, project, session).
 * @param initial - Optional initial key-value pairs.
 * @returns A new {@link Config} instance.
 *
 * @example
 * ```ts
 * const cfg = createConfig("project", { theme: "dark" });
 * cfg.set("api.key", "sk-...");
 * cfg.get("api.key"); // "sk-..."
 * ```
 */
export function createConfig(layer: ConfigLayer, initial: Record<string, unknown> = {}): Config {
	const data = { ...initial };

	return {
		layer,

		get<T>(key: string, fallback?: T): T | undefined {
			const val = deepGet(data, key);
			return (val !== undefined ? val : fallback) as T | undefined;
		},

		set(key: string, value: unknown): void {
			deepSet(data, key, value);
		},

		has(key: string): boolean {
			return deepGet(data, key) !== undefined;
		},

		delete(key: string): void {
			deepDelete(data, key);
		},

		all(): Record<string, unknown> {
			return { ...data };
		},

		merge(other: Record<string, unknown>): void {
			deepMerge(data, other);
		},
	};
}

/**
 * Cascade multiple config layers into a single merged config.
 *
 * Layers are applied left-to-right, so later layers override earlier ones
 * on key conflicts. The resulting config has layer type "session".
 *
 * @param layers - Config layers to merge, in order of increasing priority.
 * @returns A new merged {@link Config} instance.
 *
 * @example
 * ```ts
 * const merged = cascadeConfigs(globalCfg, projectCfg, sessionCfg);
 * ```
 */
export function cascadeConfigs(...layers: Config[]): Config {
	const merged = createConfig("session");
	for (const layer of layers) {
		merged.merge(layer.all());
	}
	return merged;
}

/**
 * Get the Chitragupta home directory path (~/.chitragupta).
 *
 * Honors `CHITRAGUPTA_HOME` when set, otherwise falls back to
 * `$HOME/.chitragupta` (`$USERPROFILE` on Windows).
 *
 * Uses `HOME` on Unix/macOS and `USERPROFILE` on Windows, falling back to "~".
 *
 * @returns Absolute path to the Chitragupta home directory.
 */
export function getChitraguptaHome(): string {
	const override = process.env.CHITRAGUPTA_HOME?.trim();
	if (override) return override;
	return path.join(process.env.HOME || process.env.USERPROFILE || "~", ".chitragupta");
}

/**
 * Load global settings from `~/.chitragupta/config/settings.json`.
 *
 * Merges the on-disk settings with {@link DEFAULT_SETTINGS} so that any
 * missing keys fall back to their defaults. Returns pure defaults if the
 * file does not exist or is corrupted.
 *
 * @returns The resolved {@link ChitraguptaSettings}.
 */
export function loadGlobalSettings(): ChitraguptaSettings {
	const settingsPath = path.join(getChitraguptaHome(), "config", "settings.json");
	try {
		if (fs.existsSync(settingsPath)) {
			const raw = fs.readFileSync(settingsPath, "utf-8");
			const parsed = JSON.parse(raw);
			return { ...DEFAULT_SETTINGS, ...parsed };
		}
	} catch {
		// Corrupted settings file — use defaults
	}
	return { ...DEFAULT_SETTINGS };
}

/**
 * Save global settings to `~/.chitragupta/config/settings.json`.
 *
 * Creates the config directory if it does not exist. Writes the file with
 * tab-indented JSON formatting.
 *
 * @param settings - The {@link ChitraguptaSettings} to persist.
 */
export function saveGlobalSettings(settings: ChitraguptaSettings): void {
	const configDir = path.join(getChitraguptaHome(), "config");
	fs.mkdirSync(configDir, { recursive: true });
	const settingsPath = path.join(configDir, "settings.json");
	fs.writeFileSync(settingsPath, JSON.stringify(settings, null, "\t"), "utf-8");
}

/**
 * Load project-level configuration from `<projectPath>/chitragupta.json`.
 *
 * Returns an empty object if the file does not exist.
 *
 * @param projectPath - Absolute path to the project root.
 * @returns The parsed project config as a key-value record.
 * @throws {ConfigError} If the file exists but cannot be parsed as JSON.
 */
export function loadProjectConfig(projectPath: string): Record<string, unknown> {
	const configPath = path.join(projectPath, "chitragupta.json");
	try {
		if (fs.existsSync(configPath)) {
			return JSON.parse(fs.readFileSync(configPath, "utf-8"));
		}
	} catch {
		throw new ConfigError(`Failed to parse ${configPath}`);
	}
	return {};
}
