/**
 * @chitragupta/smriti -- Vasana Engine
 *
 * Crystallizes repeated samskaras into stable vasanas using Bayesian Online
 * Change-Point Detection (Adams & MacKay 2007, arxiv 0710.3742).
 *
 * Pipeline: samskaras -> feature extraction -> BOCPD stability check ->
 *           holdout validation -> vasana creation/reinforcement
 *
 * BOCPD math, config types, and serialization live in vasana-bocpd.ts.
 * @module
 */

import { DatabaseManager } from "./db/database.js";
import type { Vasana, SamskaraRecord } from "./types.js";
import {
	fnv1a,
	initBOCPD,
	updateBOCPD,
	serializeBOCPD,
	deserializeBOCPD,
	DEFAULT_VASANA_CONFIG,
	HARD_CEILINGS,
} from "./vasana-bocpd.js";
import type {
	VasanaConfig,
	DeviationType,
	BOCPDState,
	SerializedBOCPDState,
} from "./vasana-bocpd.js";

// Re-export everything from vasana-bocpd so index.ts needs no changes
export { fnv1a, initBOCPD, updateBOCPD, serializeBOCPD, deserializeBOCPD,
	DEFAULT_VASANA_CONFIG, HARD_CEILINGS, logsumexp, lgamma, logStudentT,
} from "./vasana-bocpd.js";
export type { VasanaConfig, DeviationType, BOCPDState, SuffStats,
	SerializedBOCPDState } from "./vasana-bocpd.js";

// ─── Result Types ───────────────────────────────────────────────────────────

/** Result of a crystallization pass over observed samskaras. */
export interface CrystallizationResult {
	created: Vasana[];
	reinforced: Vasana[];
	pending: string[];
	changePoints: string[];
	/** Temporary anomalies detected (one-off deviations, not regime shifts). */
	anomalies: string[];
	timestamp: number;
}

/** Result of promoting project-level vasanas to global scope. */
export interface PromotionResult {
	promoted: Vasana[];
	projectSources: Record<string, string[]>;
	timestamp: number;
}

// ─── DB Row Shape ───────────────────────────────────────────────────────────

type VasanaRow = {
	id: number; name: string; description: string; valence: string;
	strength: number; stability: number; source_samskaras: string | null;
	project: string | null; created_at: number; updated_at: number;
	last_activated: number | null; activation_count: number;
};

type SamskaraRow = {
	id: string; session_id: string; pattern_type: string;
	pattern_content: string; observation_count: number; confidence: number;
	pramana_type: string | null; project: string | null;
	created_at: number; updated_at: number;
};

// ─── VasanaEngine ───────────────────────────────────────────────────────────

/**
 * Crystallizes repeated samskaras into stable vasanas using BOCPD.
 *
 * Maintains a sliding window of feature observations, runs Bayesian Online
 * Change-Point Detection per dimension, and crystallizes when features remain
 * stable for `stabilityWindow` consecutive sessions with holdout accuracy above
 * `accuracyThreshold`.
 */
export class VasanaEngine {
	private cfg: VasanaConfig;
	private states = new Map<string, BOCPDState>();
	private obs = new Map<string, number[]>();
	private cache = new Map<string, Vasana>();

	constructor(config?: Partial<VasanaConfig>) {
		const merged = { ...DEFAULT_VASANA_CONFIG, ...config };
		for (const [k, ceil] of Object.entries(HARD_CEILINGS)) {
			const key = k as keyof VasanaConfig;
			if (typeof merged[key] === "number" && typeof ceil === "number")
				(merged as Record<string, number>)[key] = Math.min(merged[key] as number, ceil);
		}
		this.cfg = merged;
	}

	// ── Core API ─────────────────────────────────────────────────────────

	/** Observe a samskara: extract features and update BOCPD state per dimension. */
	observe(samskara: SamskaraRecord): void {
		for (const [feat, val] of this.extractFeatures(samskara)) {
			if (!this.states.has(feat)) this.states.set(feat, initBOCPD(this.cfg));
			const buf = this.obs.get(feat) ?? [];
			buf.push(val);
			if (buf.length > this.cfg.windowSize) buf.splice(0, buf.length - this.cfg.windowSize);
			this.obs.set(feat, buf);
			updateBOCPD(this.states.get(feat)!, val, this.cfg);
		}
	}

	/** Run crystallization: stability check, holdout validation, vasana upsert. */
	crystallize(project: string): CrystallizationResult {
		const now = Date.now();
		const res: CrystallizationResult = { created: [], reinforced: [], pending: [], changePoints: [], anomalies: [], timestamp: now };
		const db = DatabaseManager.instance().get("agent");

		const rows = db.prepare(
			`SELECT id, session_id, pattern_type, pattern_content, observation_count,
			        confidence, pramana_type, project, created_at, updated_at
			 FROM samskaras WHERE project = ? OR project IS NULL
			 ORDER BY updated_at DESC LIMIT ?`
		).all(project, this.cfg.windowSize * 10) as SamskaraRow[];

		for (const [key, ids] of this.clusterSamskaras(rows)) {
			const feat = `cluster:${key}`;
			const st = this.states.get(feat);
			if (!st) { res.pending.push(key); continue; }

			const deviation = this.classifyDeviation(st);
			if (deviation === "change-point") { st.stableCount = 0; res.changePoints.push(key); continue; }
			if (deviation === "anomaly") { res.anomalies.push(key); continue; }
			st.stableCount++;
			if (st.stableCount < this.cfg.stabilityWindow) { res.pending.push(key); continue; }

			const o = this.obs.get(feat) ?? [];
			if (o.length < 4) { res.pending.push(key); continue; }
			const acc = this.holdoutValidation(o);
			if (acc < this.cfg.accuracyThreshold) { res.pending.push(key); continue; }

			const stability = this.stabilityScore(st);
			const valence = this.assignValence(rows.filter(r => ids.has(r.id)));
			const vid = fnv1a(key + ":" + project);
			const existing = this.loadVasana(vid);

			if (existing) {
				existing.strength = Math.min(1, existing.strength + 0.1);
				existing.stability = stability;
				existing.reinforcementCount++;
				existing.lastActivated = now;
				existing.predictiveAccuracy = acc;
				existing.updatedAt = now;
				this.saveVasana(existing);
				res.reinforced.push(existing);
			} else {
				const rep = rows.find(r => ids.has(r.id));
				const v: Vasana = {
					id: vid, tendency: key.replace(/:/g, "-"),
					description: rep?.pattern_content ?? key,
					strength: 0.5 + acc * 0.3, stability, valence,
					sourceSamskaras: [...ids], reinforcementCount: 1,
					lastActivated: now, predictiveAccuracy: acc,
					project, createdAt: now, updatedAt: now,
				};
				this.saveVasana(v);
				res.created.push(v);
			}
		}
		return res;
	}

	/** Reinforce with diminishing returns: delta = 0.1 / (1 + ln(1 + count)). */
	reinforce(vasanaId: string): void {
		const v = this.loadVasana(vasanaId);
		if (!v) return;
		v.strength = Math.min(1, v.strength + 0.1 / (1 + Math.log(1 + v.reinforcementCount)));
		v.reinforcementCount++;
		v.lastActivated = v.updatedAt = Date.now();
		this.saveVasana(v);
	}

	/** Weaken by fixed decrement. */
	weaken(vasanaId: string): void {
		const v = this.loadVasana(vasanaId);
		if (!v) return;
		v.strength = Math.max(0, v.strength - 0.15);
		v.updatedAt = Date.now();
		this.saveVasana(v);
	}

	/** Get vasanas for a project (includes global), sorted by strength desc. */
	getVasanas(project: string, topK = 20): Vasana[] {
		const rows = DatabaseManager.instance().get("agent").prepare(
			`SELECT id,name,description,valence,strength,stability,source_samskaras,
			        project,created_at,updated_at,last_activated,activation_count
			 FROM vasanas WHERE project=? OR project IS NULL OR project='__global__'
			 ORDER BY strength DESC LIMIT ?`
		).all(project, topK) as VasanaRow[];
		return rows.map(r => this.toVasana(r));
	}

	/** Promote project vasanas to global when found in >= promotionMinProjects. */
	promoteToGlobal(): PromotionResult {
		const now = Date.now();
		const res: PromotionResult = { promoted: [], projectSources: {}, timestamp: now };
		const db = DatabaseManager.instance().get("agent");

		const rows = db.prepare(
			`SELECT id,name,description,valence,strength,stability,source_samskaras,
			        project,created_at,updated_at,last_activated,activation_count
			 FROM vasanas WHERE project IS NOT NULL AND project!='__global__' AND strength>=0.4
			 ORDER BY name`
		).all() as VasanaRow[];

		const byName = new Map<string, VasanaRow[]>();
		for (const r of rows) { const k = r.name.toLowerCase(); byName.set(k, [...(byName.get(k) ?? []), r]); }

		for (const [tendency, group] of byName) {
			const projects = new Set(group.map(r => r.project!));
			if (projects.size < this.cfg.promotionMinProjects) continue;
			if (db.prepare(`SELECT 1 FROM vasanas WHERE name=? AND (project IS NULL OR project='__global__')`).get(tendency)) continue;

			const allSrc: string[] = [];
			for (const r of group) allSrc.push(...jsonArr(r.source_samskaras));

			const votes = { positive: 0, negative: 0, neutral: 0 };
			for (const r of group) votes[r.valence as keyof typeof votes]++;
			const valence = (["positive", "negative", "neutral"] as const)
				.reduce((a, b) => votes[a] >= votes[b] ? a : b);

			const gv: Vasana = {
				id: fnv1a(tendency + ":__global__"), tendency,
				description: group[0].description,
				strength: group.reduce((s, r) => s + r.strength, 0) / group.length,
				stability: Math.max(...group.map(r => r.stability)), valence,
				sourceSamskaras: [...new Set(allSrc)],
				reinforcementCount: group.reduce((s, r) => s + r.activation_count, 0),
				lastActivated: now,
				predictiveAccuracy: Math.max(...group.map(r => r.stability)),
				project: "__global__", createdAt: now, updatedAt: now,
			};
			this.saveVasana(gv);
			res.promoted.push(gv);
			res.projectSources[tendency] = [...projects];
		}
		return res;
	}

	/** Exponential decay: strength *= exp(-ln2 * elapsed / halfLife). Deletes below 0.01. */
	decay(halfLifeMs?: number): number {
		const hl = halfLifeMs ?? this.cfg.decayHalfLifeMs;
		const now = Date.now();
		const db = DatabaseManager.instance().get("agent");
		const rows = db.prepare(`SELECT id, strength, last_activated FROM vasanas`).all() as
			Array<{ id: number; strength: number; last_activated: number | null }>;
		let deleted = 0;
		for (const r of rows) {
			const elapsed = now - (r.last_activated ?? now);
			if (elapsed <= 0) continue;
			const s = r.strength * Math.exp(-Math.LN2 * elapsed / hl);
			if (s < 0.01) { db.prepare(`DELETE FROM vasanas WHERE id=?`).run(r.id); deleted++; }
			else db.prepare(`UPDATE vasanas SET strength=?,updated_at=? WHERE id=?`).run(s, now, r.id);
		}
		return deleted;
	}

	/** Persist BOCPD state (run-length distributions + observations) to SQLite. */
	persist(): void {
		const json = JSON.stringify(serializeBOCPD(this.states, this.obs));
		DatabaseManager.instance().get("agent").prepare(
			`INSERT OR REPLACE INTO consolidation_rules
			 (id, category, rule_text, confidence, source_sessions, created_at, updated_at, hit_count, project)
			 VALUES ((SELECT id FROM consolidation_rules WHERE category='bocpd_state' AND project='__vasana_engine__'),
			         'bocpd_state',?,1.0,NULL,?,?,1,'__vasana_engine__')`
		).run(json, Date.now(), Date.now());
	}

	/** Restore BOCPD state from SQLite. No-op if nothing persisted. */
	restore(): void {
		const row = DatabaseManager.instance().get("agent").prepare(
			`SELECT rule_text FROM consolidation_rules
			 WHERE category='bocpd_state' AND project='__vasana_engine__' LIMIT 1`
		).get() as { rule_text: string } | undefined;
		if (!row) return;
		try {
			const raw = JSON.parse(row.rule_text) as SerializedBOCPDState;
			const { states, obs } = deserializeBOCPD(raw);
			this.states = states;
			this.obs = obs;
		} catch (err) {
			process.stderr.write(`[vasana-engine] restore() failed to parse BOCPD state: ${err instanceof Error ? err.message : err}\n`);
			this.states.clear(); this.obs.clear();
		}
	}

	// ── Deviation Classification ─────────────────────────────────────────

	/**
	 * Classify a deviation as change-point, anomaly, or stable.
	 *
	 * Joint anomaly/change-point discrimination (arxiv 2508.06385):
	 * - If P(r=0) > threshold and persists across the revert window -> change-point
	 * - If P(r=0) > threshold but reverts within the window -> anomaly (one-off)
	 * - Otherwise -> stable
	 */
	classifyDeviation(st: BOCPDState): DeviationType {
		if (st.logR.length === 0) return "stable";
		const cpProb = Math.exp(st.logR[0]);
		if (cpProb <= this.cfg.changePointThreshold) return "stable";

		// Count how many of the recent observations exceeded the threshold
		const recent = st.recentCpProbs ?? [cpProb];
		const exceedCount = recent.filter(p => p > this.cfg.changePointThreshold).length;
		const ratio = exceedCount / Math.max(1, recent.length);

		// If enough of the revert window shows change-point, it's genuine
		if (recent.length >= this.cfg.anomalyRevertWindow && ratio >= this.cfg.anomalyConfirmRatio) {
			return "change-point";
		}

		// Still in the revert window but current observation is high -- call it anomaly for now
		return "anomaly";
	}

	private stabilityScore(st: BOCPDState): number {
		if (st.logR.length === 0) return 0;
		return Math.max(0, Math.min(1, 1 - Math.exp(st.logR[0])));
	}

	// ── Feature Extraction & Validation ──────────────────────────────────

	private extractFeatures(s: SamskaraRecord): Map<string, number> {
		const f = new Map<string, number>();
		const tMap: Record<string, number> = {
			"tool-sequence": 0.2, preference: 0.4, decision: 0.6, correction: 0.8, convention: 1.0 };
		f.set(`type:${s.patternType}`, tMap[s.patternType] ?? 0.5);
		f.set("confidence", s.confidence);
		f.set("log_obs", Math.min(1, Math.log(1 + s.observationCount) / Math.log(101)));
		const ch = parseInt(fnv1a(s.patternContent), 16);
		f.set(`cluster:${s.patternType}:${fnv1a(s.patternContent)}`, ch / 0xffffffff);
		return f;
	}

	/** 70/30 holdout: fraction of test points within 1.5 sigma of train mean. */
	private holdoutValidation(obs: number[]): number {
		if (obs.length < 4) return 0;
		const si = Math.floor(obs.length * this.cfg.holdoutTrainRatio);
		const train = obs.slice(0, si), test = obs.slice(si);
		if (!train.length || !test.length) return 0;
		const mu = train.reduce((a, b) => a + b, 0) / train.length;
		const std = Math.sqrt(train.reduce((a, v) => a + (v - mu) ** 2, 0) / train.length + 1e-10);
		let ok = 0;
		for (const v of test) if (Math.abs(v - mu) <= 1.5 * std) ok++;
		return ok / test.length;
	}

	private assignValence(rows: Array<{ pattern_type: string; confidence: number }>):
		"positive" | "negative" | "neutral" {
		let pos = 0, neg = 0;
		for (const r of rows) {
			if (r.pattern_type === "correction") neg += r.confidence;
			else if (r.pattern_type !== "tool-sequence" || r.confidence > 0.6)
				pos += r.confidence * (r.pattern_type === "tool-sequence" ? 0.5 : 1);
		}
		const tot = pos + neg;
		if (tot < 0.1) return "neutral";
		return pos / tot > 0.6 ? "positive" : neg / tot > 0.6 ? "negative" : "neutral";
	}

	private clusterSamskaras(rows: Array<{ id: string; pattern_type: string; pattern_content: string }>):
		Map<string, Set<string>> {
		const m = new Map<string, Set<string>>();
		for (const r of rows) {
			const k = `${r.pattern_type}:${fnv1a(r.pattern_content.toLowerCase().trim().replace(/\s+/g, " "))}`;
			const s = m.get(k) ?? new Set<string>();
			s.add(r.id); m.set(k, s);
		}
		return m;
	}

	// ── SQLite Helpers ───────────────────────────────────────────────────
	// Schema mapping: Vasana.tendency->name, sourceSamskaras->source_samskaras(JSON),
	//                 reinforcementCount->activation_count, lastActivated->last_activated

	private saveVasana(v: Vasana): void {
		const db = DatabaseManager.instance().get("agent");
		const existing = db.prepare(
			`SELECT id FROM vasanas WHERE name=? AND (project=? OR (project IS NULL AND ?='__global__'))`
		).get(v.tendency, v.project, v.project) as { id: number } | undefined;

		if (existing) {
			db.prepare(
				`UPDATE vasanas SET description=?,valence=?,strength=?,stability=?,
				 source_samskaras=?,updated_at=?,last_activated=?,activation_count=? WHERE id=?`
			).run(v.description, v.valence, v.strength, v.stability,
				JSON.stringify(v.sourceSamskaras), v.updatedAt, v.lastActivated, v.reinforcementCount, existing.id);
		} else {
			db.prepare(
				`INSERT INTO vasanas (name,description,valence,strength,stability,source_samskaras,
				 project,created_at,updated_at,last_activated,activation_count) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
			).run(v.tendency, v.description, v.valence, v.strength, v.stability,
				JSON.stringify(v.sourceSamskaras), v.project === "__global__" ? null : v.project,
				v.createdAt, v.updatedAt, v.lastActivated, v.reinforcementCount);
		}
		this.cache.set(v.id, v);
	}

	private loadVasana(vid: string): Vasana | null {
		if (this.cache.has(vid)) return this.cache.get(vid)!;
		// Bounded scan (<500 vasanas), cache all
		const rows = DatabaseManager.instance().get("agent").prepare(
			`SELECT id,name,description,valence,strength,stability,source_samskaras,
			        project,created_at,updated_at,last_activated,activation_count FROM vasanas`
		).all() as VasanaRow[];
		for (const r of rows) { const v = this.toVasana(r); this.cache.set(v.id, v); }
		return this.cache.get(vid) ?? null;
	}

	private toVasana(r: VasanaRow): Vasana {
		const proj = r.project ?? "__global__";
		return {
			id: fnv1a(r.name + ":" + proj), tendency: r.name,
			description: r.description, strength: r.strength, stability: r.stability,
			valence: r.valence as "positive" | "negative" | "neutral",
			sourceSamskaras: jsonArr(r.source_samskaras),
			reinforcementCount: r.activation_count,
			lastActivated: r.last_activated ?? r.updated_at,
			predictiveAccuracy: r.stability, project: proj,
			createdAt: r.created_at, updatedAt: r.updated_at,
		};
	}
}

// ─── Utility ────────────────────────────────────────────────────────────────

/** Parse a JSON array string, returning empty array on failure. */
function jsonArr(s: string | null | undefined): string[] {
	if (!s) return [];
	try { const p = JSON.parse(s); return Array.isArray(p) ? p : []; }
	catch { return []; }
}
