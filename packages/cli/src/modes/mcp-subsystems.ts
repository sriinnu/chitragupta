/**
 * MCP Subsystem Lazy Singletons.
 *
 * Lazily initialised singletons for collective-intelligence subsystems.
 * Heavy classes are resolved via dynamic `import()` on first access.
 * Duck-typed interfaces live in mcp-subsystems-types.ts.
 *
 * @module
 */

import type {
	ActorSystemLike,
	AkashaFieldLike,
	ChetanaControllerLike,
	SabhaEngineLike,
	SamitiLike,
	SkillDiscoveryLike,
	SkillRegistryLike,
	SoulManagerLike,
	TrigunaLike,
	UIExtensionRegistryLike,
	VasanaEngineLike,
} from "./mcp-subsystems-types.js";

// Re-export all types so existing consumers don't break.
export type {
	ActorSystemLike,
	AkashaFieldLike,
	ChetanaControllerLike,
	SabhaEngineLike,
	SamitiLike,
	SkillRegistryLike,
	SoulManagerLike,
	TrigunaLike,
	VasanaEngineLike,
} from "./mcp-subsystems-types.js";

// ─── Lazy Singletons ────────────────────────────────────────────────────────

let _samiti: SamitiLike | undefined;
let _sabha: SabhaEngineLike | undefined;
let _akasha: AkashaFieldLike | undefined;
let _vasana: VasanaEngineLike | undefined;
let _triguna: TrigunaLike | undefined;
let _chetana: ChetanaControllerLike | undefined;
let _soulManager: SoulManagerLike | undefined;
let _actorSystem: ActorSystemLike | undefined;
let _skillRegistry: SkillRegistryLike | undefined;
let _skillRegistryBootstrap: Promise<void> | undefined;

/** Lazily create or return the Samiti singleton. */
export async function getSamiti(): Promise<SamitiLike> {
	if (!_samiti) {
		const { Samiti } = await import("@chitragupta/sutra");
		_samiti = new Samiti() as unknown as SamitiLike;
	}
	return _samiti;
}

/** Lazily create or return the SabhaEngine singleton. */
export async function getSabha(): Promise<SabhaEngineLike> {
	if (!_sabha) {
		const { SabhaEngine } = await import("@chitragupta/sutra");
		_sabha = new SabhaEngine() as unknown as SabhaEngineLike;
	}
	return _sabha;
}

/** Lazily create or return the AkashaField singleton with DB persistence. */
export async function getAkasha(): Promise<AkashaFieldLike> {
	if (!_akasha) {
		const { AkashaField } = await import("@chitragupta/smriti");
		const akasha = new AkashaField();
		try {
			const { DatabaseManager } = await import("@chitragupta/smriti/db/database");
			const db = DatabaseManager.instance().get("agent");
			if (db) akasha.restore(db);
		} catch {
			/* best-effort restore */
		}
		_akasha = akasha as unknown as AkashaFieldLike;
	}
	return _akasha;
}

/** Persist akasha traces to SQLite (call after deposit). */
export async function persistAkasha(): Promise<void> {
	if (!_akasha) return;
	try {
		const { DatabaseManager } = await import("@chitragupta/smriti/db/database");
		const db = DatabaseManager.instance().get("agent");
		if (db) {
			const akasha = _akasha as unknown as { persist(db: unknown): void };
			akasha.persist(db);
		}
	} catch {
		/* best-effort persist */
	}
}

/** Lazily create or return the VasanaEngine singleton. */
export async function getVasana(): Promise<VasanaEngineLike> {
	if (!_vasana) {
		try {
			const { VasanaEngine } = await import("@chitragupta/smriti");
			_vasana = new VasanaEngine() as unknown as VasanaEngineLike;
		} catch (err) {
			const m = err instanceof Error ? err.message : String(err);
			const hint = /NODE_MODULE_VERSION|better-sqlite3/.test(m) ? "Run: npm rebuild better-sqlite3" : m;
			throw new Error(`Vasana engine unavailable: ${hint}`);
		}
	}
	return _vasana;
}

/** Lazily create or return the Triguna singleton. */
export async function getTriguna(): Promise<TrigunaLike> {
	if (!_triguna) {
		const { Triguna } = await import("@chitragupta/anina");
		_triguna = new Triguna() as unknown as TrigunaLike;
	}
	return _triguna;
}

/** Lazily create or return the ChetanaController singleton. */
export async function getChetana(): Promise<ChetanaControllerLike> {
	if (!_chetana) {
		const { ChetanaController } = await import("@chitragupta/anina");
		_chetana = new ChetanaController() as unknown as ChetanaControllerLike;
	}
	return _chetana;
}

/** Lazily create or return the SoulManager singleton (loads persisted souls from disk). */
export async function getSoulManager(): Promise<SoulManagerLike> {
	if (!_soulManager) {
		const { SoulManager } = await import("@chitragupta/anina");
		_soulManager = new SoulManager({ persist: true }) as unknown as SoulManagerLike;
	}
	return _soulManager;
}

/** Lazily create or return the ActorSystem singleton (local-only, P2P optional). */
export async function getActorSystem(): Promise<ActorSystemLike> {
	if (!_actorSystem) {
		const { ActorSystem } = await import("@chitragupta/sutra");
		const sys = new ActorSystem();
		sys.start();
		_actorSystem = sys as unknown as ActorSystemLike;
	}
	return _actorSystem;
}

function parseEnvSkillPaths(value: string | undefined, delimiter: string): string[] {
	if (!value) return [];
	return value
		.split(delimiter)
		.map((v) => v.trim())
		.filter((v) => v.length > 0);
}

function buildSkillScanPaths(opts: {
	projectPath: string;
	chitraguptaHome: string;
	homeDir: string;
	delimiter: string;
	join: (...parts: string[]) => string;
}): string[] {
	const { projectPath, chitraguptaHome, homeDir, delimiter, join } = opts;
	const envPaths = parseEnvSkillPaths(process.env.CHITRAGUPTA_SKILL_PATHS ?? process.env.VAAYU_SKILL_PATHS, delimiter);

	const candidates = [
		...envPaths,
		chitraguptaHome ? join(chitraguptaHome, "skills") : "",
		join(projectPath, "skills"),
		join(projectPath, "skills-core"),
		join(projectPath, "chitragupta", "skills-core"),
		join(projectPath, "chitragupta", "skills"),
		homeDir ? join(homeDir, ".agents", "skills") : "",
		homeDir ? join(homeDir, ".codex", "skills") : "",
	];

	return [...new Set(candidates.filter((v) => v.length > 0))];
}

async function getUIExtensionRegistryBestEffort(): Promise<UIExtensionRegistryLike | null> {
	try {
		const { getUIExtensionRegistry } = await import("./mcp-tools-plugins.js");
		return getUIExtensionRegistry() as unknown as UIExtensionRegistryLike;
	} catch {
		return null;
	}
}

function toStringOrUndefined(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toRecordArray(value: unknown): Array<Record<string, unknown>> {
	if (!Array.isArray(value)) return [];
	return value.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null);
}

const WIDGET_POS = new Set(["left", "center", "right"]);
const WIDGET_FMT = new Set(["plain", "ansi", "json"]);
const PANEL_FMT = new Set(["plain", "ansi", "markdown", "json"]);
const PANEL_TYPE = new Set(["sidebar", "modal", "overlay", "tab"]);

function registerUiContributionFromSkill(registry: UIExtensionRegistryLike, manifest: Record<string, unknown>): void {
	const rawUi = manifest.ui;
	if (typeof rawUi !== "object" || rawUi === null) return;
	const ui = rawUi as Record<string, unknown>;

	const widgets = toRecordArray(ui.widgets)
		.map((w) => {
			const r: Record<string, unknown> = { id: toStringOrUndefined(w.id), label: toStringOrUndefined(w.label) };
			const pos = toStringOrUndefined(w.position);
			if (pos && WIDGET_POS.has(pos)) r.position = pos;
			const ms = Number(w.refreshMs);
			if (Number.isFinite(ms) && ms > 0) r.refreshMs = ms;
			const fmt = toStringOrUndefined(w.format);
			if (fmt && WIDGET_FMT.has(fmt)) r.format = fmt;
			return r;
		})
		.filter((w) => typeof w.id === "string" && typeof w.label === "string");

	const keybinds = toRecordArray(ui.keybinds)
		.map((k) => {
			const r: Record<string, unknown> = {
				key: toStringOrUndefined(k.key),
				description: toStringOrUndefined(k.description),
				command: toStringOrUndefined(k.command),
			};
			if (typeof k.args === "object" && k.args !== null) r.args = k.args;
			return r;
		})
		.filter((k) => typeof k.key === "string" && typeof k.description === "string" && typeof k.command === "string");

	const panels = toRecordArray(ui.panels)
		.map((p) => {
			const r: Record<string, unknown> = {
				id: toStringOrUndefined(p.id),
				title: toStringOrUndefined(p.title),
				type: toStringOrUndefined(p.type),
			};
			const fmt = toStringOrUndefined(p.format);
			if (fmt && PANEL_FMT.has(fmt)) r.format = fmt;
			return r;
		})
		.filter(
			(p) =>
				typeof p.id === "string" &&
				typeof p.title === "string" &&
				typeof p.type === "string" &&
				PANEL_TYPE.has(p.type as string),
		);

	if (widgets.length === 0 && keybinds.length === 0 && panels.length === 0) return;
	const skillName = String(manifest.name ?? "").trim();
	if (!skillName) return;
	registry.register({
		skillName,
		version: String(manifest.version ?? "0.0.0"),
		widgets,
		keybinds,
		panels,
		registeredAt: Date.now(),
	});
}

async function bootstrapSkillRegistry(registry: SkillRegistryLike): Promise<void> {
	try {
		const [{ SkillDiscovery }, { getChitraguptaHome }, fs, path] = await Promise.all([
			import("@chitragupta/vidhya-skills"),
			import("@chitragupta/core"),
			import("node:fs"),
			import("node:path"),
		]);

		const discovery = new SkillDiscovery() as unknown as SkillDiscoveryLike;
		const uiRegistry = await getUIExtensionRegistryBestEffort();
		const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? "";
		const scanPaths = buildSkillScanPaths({
			projectPath: process.cwd(),
			chitraguptaHome: String(getChitraguptaHome() ?? ""),
			homeDir,
			delimiter: path.delimiter,
			join: path.join,
		});

		for (const scanPath of scanPaths) {
			if (!fs.existsSync(scanPath)) continue;

			let manifests: Array<Record<string, unknown>> = [];
			try {
				manifests = await discovery.discoverFromDirectory(scanPath);
			} catch {
				continue;
			}

			for (const manifest of manifests) {
				try {
					registry.register(manifest);
					if (uiRegistry) {
						registerUiContributionFromSkill(uiRegistry, manifest);
					}
				} catch {
					// Best-effort: malformed skill should not break registry bootstrap.
				}
			}
		}
	} catch {
		// Best-effort bootstrap: keep registry available even if discovery fails.
	}
}

/** Lazily create or return the SkillRegistry singleton. */
export async function getSkillRegistry(): Promise<SkillRegistryLike> {
	if (!_skillRegistry) {
		const { SkillRegistry } = await import("@chitragupta/vidhya-skills");
		_skillRegistry = new SkillRegistry() as unknown as SkillRegistryLike;
		_skillRegistryBootstrap = bootstrapSkillRegistry(_skillRegistry).finally(() => {
			_skillRegistryBootstrap = undefined;
		});
	}
	if (_skillRegistryBootstrap) {
		await _skillRegistryBootstrap;
	}
	return _skillRegistry;
}
