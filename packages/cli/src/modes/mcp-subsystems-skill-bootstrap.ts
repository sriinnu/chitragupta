import type {
	SkillRegistryLike,
	UIExtensionRegistryLike,
	SkillDiscoveryLike,
} from "./mcp-subsystems-types.js";

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

export async function bootstrapSkillRegistry(
	registry: SkillRegistryLike,
	getUiExtensionRegistryBestEffort: () => Promise<UIExtensionRegistryLike | null>,
): Promise<void> {
	try {
		const [{ SkillDiscovery }, { getChitraguptaHome }, fs, path] = await Promise.all([
			import("@chitragupta/vidhya-skills"),
			import("@chitragupta/core"),
			import("node:fs"),
			import("node:path"),
		]);

		const discovery = new SkillDiscovery() as unknown as SkillDiscoveryLike;
		const uiRegistry = await getUiExtensionRegistryBestEffort();
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
					if (uiRegistry) registerUiContributionFromSkill(uiRegistry, manifest);
				} catch {
					// Best-effort: malformed skill should not break registry bootstrap.
				}
			}
		}
	} catch {
		// Best-effort bootstrap: keep registry available even if discovery fails.
	}
}
