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
import { allowLocalRuntimeFallback, createDaemonSabhaProxy } from "../runtime-daemon-proxies.js";
import { ensureSharedMeshRuntime } from "../shared-mesh-runtime.js";
import {
	type DaemonAkashaProxy,
	type DaemonAnomalyAlert,
	type DaemonHealReport,
	type DurableAkashaRef,
	type FreshContextOptions,
	type NatashaObserverLike,
	type SharedRegressionSignal,
	type TranscendenceEngineLike,
	type TranscendencePrediction,
} from "./mcp-subsystems-lucy-types.js";
import { createDaemonAkashaProxy, isDaemonAkashaProxy } from "./mcp-subsystems-akasha-proxy.js";
import { bootstrapSkillRegistry } from "./mcp-subsystems-skill-bootstrap.js";
import { getAgentDbBestEffort, refreshAkashaFromDb } from "./mcp-subsystems-db.js";
import {
	lookupTranscendenceFuzzy as lookupTranscendenceFuzzyViaLucyRuntime,
	primeLucyScarlettRuntime,
	refreshTranscendenceFromSharedSignals,
	registerLiveTranscendenceEngine,
	runTranscendencePrefetch as runTranscendencePrefetchViaLucyRuntime,
} from "./mcp-subsystems-lucy-runtime.js";

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
let _skillRegistry: SkillRegistryLike | undefined;
let _skillRegistryBootstrap: Promise<void> | undefined;
let _akashaLastRefreshAt = 0;

const AKASHA_REFRESH_INTERVAL_MS = 2_000;

/** Natasha Observer singleton (temporal trending). */
let _natashaObserver: NatashaObserverLike | undefined;
/** Transcendence Engine singleton (predictive context). */
let _transcendence: TranscendenceEngineLike | undefined;

export { primeLucyScarlettRuntime };

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
		_sabha = createDaemonSabhaProxy() as unknown as SabhaEngineLike;
	}
	return _sabha;
}

/** Lazily create or return the AkashaField singleton with DB persistence. */
export async function getAkasha(): Promise<AkashaFieldLike> {
	if (!_akasha) {
		try {
			_akasha = await createDaemonAkashaProxy();
			return _akasha;
		} catch {
			if (!allowLocalRuntimeFallback()) {
				throw new Error("Daemon-backed Akasha unavailable");
			}
			const { AkashaField } = await import("@chitragupta/smriti");
			const akasha = new AkashaField() as unknown as AkashaFieldLike & DurableAkashaRef;
			const db = await getAgentDbBestEffort();
			if (db) {
				try {
					akasha.restore(db);
					_akashaLastRefreshAt = Date.now();
				} catch {
					/* best-effort restore */
				}
			}
			_akasha = akasha as unknown as AkashaFieldLike;
		}
	}
	if (!isDaemonAkashaProxy(_akasha)) {
		_akashaLastRefreshAt = await refreshAkashaFromDb(
			_akasha as unknown as DurableAkashaRef,
			_akashaLastRefreshAt,
			AKASHA_REFRESH_INTERVAL_MS,
		);
	}
	return _akasha;
}

/** Persist akasha traces to SQLite (call after deposit). */
export async function persistAkasha(): Promise<void> {
	if (!_akasha || isDaemonAkashaProxy(_akasha)) return;
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
	return ensureSharedMeshRuntime();
}

async function getUIExtensionRegistryBestEffort(): Promise<UIExtensionRegistryLike | null> {
	try {
		const { getUIExtensionRegistry } = await import("./mcp-tools-plugins.js");
		return getUIExtensionRegistry() as unknown as UIExtensionRegistryLike;
	} catch {
		return null;
	}
}

/** Lazily create or return the SkillRegistry singleton. */
export async function getSkillRegistry(): Promise<SkillRegistryLike> {
	if (!_skillRegistry) {
		const { SkillRegistry } = await import("@chitragupta/vidhya-skills");
		_skillRegistry = new SkillRegistry() as unknown as SkillRegistryLike;
		_skillRegistryBootstrap = bootstrapSkillRegistry(_skillRegistry, getUIExtensionRegistryBestEffort).finally(() => {
			_skillRegistryBootstrap = undefined;
		});
	}
	if (_skillRegistryBootstrap) {
		await _skillRegistryBootstrap;
	}
	return _skillRegistry;
}

/** Lazily create or return the NatashaObserver singleton (temporal trending). */
export async function getNatasha(): Promise<NatashaObserverLike> {
	if (!_natashaObserver) {
		const { NatashaObserver } = await import("@chitragupta/smriti");
		const { DatabaseManager } = await import("@chitragupta/smriti/db/database");
		const db = DatabaseManager.instance().get("agent");
		_natashaObserver = new NatashaObserver(db) as unknown as NatashaObserverLike;
	}
	return _natashaObserver;
}

export async function getTranscendence(): Promise<TranscendenceEngineLike> {
	if (!_transcendence) {
		const { TranscendenceEngine } = await import("@chitragupta/smriti");
		const { DatabaseManager } = await import("@chitragupta/smriti/db/database");
		const db = DatabaseManager.instance().get("agent");
		_transcendence = new TranscendenceEngine(db) as unknown as TranscendenceEngineLike;
		registerLiveTranscendenceEngine(_transcendence);
	}
	await primeLucyScarlettRuntime(_transcendence);
	await refreshTranscendenceFromSharedSignals(_transcendence);
	return _transcendence;
}

export async function lookupTranscendenceFuzzy(
	query: string,
	options?: FreshContextOptions,
): Promise<TranscendencePrediction | null> {
	return lookupTranscendenceFuzzyViaLucyRuntime(query, options, getTranscendence);
}

/**
 * Run a Transcendence prefetch cycle — feeds Natasha signals and pre-caches context.
 * Call on session start or periodically (e.g., every 5 min).
 */
export async function runTranscendencePrefetch(): Promise<unknown> {
	return runTranscendencePrefetchViaLucyRuntime(getNatasha, getTranscendence);
}
