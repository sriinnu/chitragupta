/**
 * MCP Subsystem Duck Types & Lazy Singletons.
 *
 * Duck-typed interfaces for collective-intelligence subsystems and lazily
 * initialised singletons. We avoid importing heavy classes at module load
 * time — they are resolved via dynamic `import()` on first access.
 *
 * @module
 */

// ─── Duck-Typed Interfaces ──────────────────────────────────────────────────

/** Duck-typed Samiti (ambient channels). */
export interface SamitiLike {
	listChannels(): Array<{
		name: string;
		description: string;
		messages: Array<{ id: string; sender: string; severity: string; content: string; timestamp: number }>;
		subscribers: Set<string>;
	}>;
	listen(
		channel: string,
		opts?: { limit?: number },
	): Array<{
		id: string;
		sender: string;
		severity: string;
		category: string;
		content: string;
		timestamp: number;
	}>;
	broadcast(
		channel: string,
		message: { sender: string; severity: "info" | "warning" | "critical"; category: string; content: string },
	): { id: string };
}

/** Duck-typed SabhaEngine (multi-agent deliberation). */
export interface SabhaEngineLike {
	convene(
		topic: string,
		convener: string,
		participants: Array<{ id: string; role: string; expertise: number; credibility: number }>,
	): { id: string };
	propose(
		sabhaId: string,
		proposerId: string,
		syllogism: {
			pratijna: string;
			hetu: string;
			udaharana: string;
			upanaya: string;
			nigamana: string;
		},
	): unknown;
	vote(sabhaId: string, participantId: string, position: "support" | "oppose" | "abstain", reasoning: string): unknown;
	conclude(sabhaId: string): { finalVerdict: string | null; topic: string };
	explain(sabhaId: string): string;
}

/** Duck-typed AkashaField (shared knowledge traces). */
export interface AkashaFieldLike {
	query(
		topic: string,
		opts?: { type?: string; limit?: number },
	): Array<{
		id: string;
		agentId: string;
		traceType: string;
		topic: string;
		content: string;
		strength: number;
		reinforcements: number;
	}>;
	leave(agentId: string, type: string, topic: string, content: string): { id: string };
}

/** Duck-typed VasanaEngine (behavioral tendencies). */
export interface VasanaEngineLike {
	getVasanas(
		project: string,
		topK?: number,
	): Array<{
		id: string;
		tendency: string;
		description: string;
		strength: number;
		stability: number;
		valence: string;
		reinforcementCount: number;
		predictiveAccuracy: number;
	}>;
}

/** Duck-typed Triguna (system health). */
export interface TrigunaLike {
	getState(): { sattva: number; rajas: number; tamas: number };
	getDominant(): string;
	getTrend(): { sattva: string; rajas: string; tamas: string };
	getHistory(limit?: number): Array<{
		state: { sattva: number; rajas: number; tamas: number };
		timestamp: number;
		dominant: string;
	}>;
	/** Feed an observation to update the Kalman filter. */
	update(obs: {
		errorRate: number;
		tokenVelocity: number;
		loopCount: number;
		latency: number;
		successRate: number;
		userSatisfaction: number;
	}): { sattva: number; rajas: number; tamas: number };
}

/** Duck-typed ChetanaController (consciousness layer). */
export interface ChetanaControllerLike {
	getCognitiveReport(): {
		affect: { valence: number; arousal: number; confidence: number; frustration: number };
		topConcepts: Array<{ concept: string; weight: number }>;
		topTools: Array<{ tool: string; weight: number }>;
		selfSummary: {
			calibration: number;
			learningVelocity: number;
			topTools: Array<{ tool: string; mastery: { successRate: number } }>;
			limitations: string[];
			style: Map<string, unknown>;
		};
		intentions: unknown[];
	};
}

/** Duck-typed SoulManager (agent identity). */
export interface SoulManagerLike {
	getAll(): Array<{
		id: string;
		name: string;
		archetype: { name: string; traits: string[]; strengths: string[] };
		purpose: string;
		learnedTraits: string[];
		confidenceModel: Map<string, number>;
		values: string[];
	}>;
	get(agentId: string):
		| {
				id: string;
				name: string;
				archetype: { name: string; traits: string[]; strengths: string[] };
				purpose: string;
				learnedTraits: string[];
				confidenceModel: Map<string, number>;
				values: string[];
		  }
		| undefined;
}

/** Duck-typed ActorSystem (P2P mesh). */
export interface ActorSystemLike {
	readonly actorCount: number;
	readonly isRunning: boolean;
	spawn(id: string, behavior: unknown, opts?: Record<string, unknown>): unknown;
	tell(from: string, to: string, payload: unknown, opts?: Record<string, unknown>): void;
	ask(from: string, to: string, payload: unknown, opts?: Record<string, unknown>): Promise<unknown>;
	start(): void;
	shutdown(): Promise<void>;
	getRouter(): unknown;
	getGossipProtocol(): {
		getView(): Array<{
			actorId: string;
			status: string;
			expertise?: string[];
			capabilities?: string[];
			generation: number;
			lastSeen: number;
			originNodeId?: string;
		}>;
		findByCapability(cap: string): Array<{
			actorId: string;
			status: string;
			capabilities?: string[];
			originNodeId?: string;
			lastSeen: number;
			generation: number;
		}>;
		findByExpertise(
			exp: string,
		): Array<{ actorId: string; status: string; expertise?: string[]; originNodeId?: string; lastSeen: number }>;
		findAlive(): Array<{
			actorId: string;
			status: string;
			capabilities?: string[];
			expertise?: string[];
			originNodeId?: string;
			lastSeen: number;
		}>;
	} | null;
	getConnectionManager(): {
		readonly nodeId: string;
		readonly connectedCount: number;
		readonly peerCount: number;
		getPeers(): Array<{ peerId: string; endpoint: string; state: string; outbound: boolean }>;
	} | null;
	getCapabilityRouter(): {
		resolve(query: {
			capabilities: string[];
			strategy?: string;
		}): { actorId: string; status: string; capabilities?: string[]; originNodeId?: string } | undefined;
		findMatchingAll(
			caps: string[],
		): Array<{ actorId: string; status: string; capabilities?: string[]; originNodeId?: string }>;
	} | null;
	getNetworkGossip(): { readonly locationCount: number; getLocations(): ReadonlyMap<string, string> } | null;
}

/** Duck-typed SkillRegistry (vidhya-skills). */
export interface SkillRegistryLike {
	readonly size: number;
	register(manifest: Record<string, unknown>): void;
	getByName(name: string): Record<string, unknown> | undefined;
	getByTag(tag: string): Array<Record<string, unknown>>;
	getByVerb(verb: string): Array<Record<string, unknown>>;
	getAll(): Array<Record<string, unknown>>;
}

/** Duck-typed SkillDiscovery (vidhya-skills). */
interface SkillDiscoveryLike {
	discoverFromDirectory(path: string): Promise<Array<Record<string, unknown>>>;
}

/** Duck-typed UI extension registry used by MCP plugin tools. */
interface UIExtensionRegistryLike {
	register(extension: {
		skillName: string;
		version: string;
		widgets: Array<Record<string, unknown>>;
		keybinds: Array<Record<string, unknown>>;
		panels: Array<Record<string, unknown>>;
		registeredAt: number;
	}): void;
}

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
