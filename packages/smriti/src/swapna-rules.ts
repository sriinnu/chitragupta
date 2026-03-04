/**
 * @chitragupta/smriti — Svapna Rules (Phase 3: CRYSTALLIZE)
 *
 * Vasana formation: aggregate samskaras by pattern type and content
 * similarity, crystallizing stable behavioral tendencies.
 */

import { DatabaseManager } from "./db/index.js";
import type { SvapnaConfig, CrystallizeResult } from "./svapna-consolidation.js";

// ─── FNV-1a Hash ────────────────────────────────────────────────────────────

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Compute a 32-bit FNV-1a hash as a zero-padded hex string. */
function fnv1a(input: string): string {
	let hash = FNV_OFFSET;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = (Math.imul(hash, FNV_PRIME)) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

// ─── Text Utilities ─────────────────────────────────────────────────────────

/**
 * Bigram-based Dice coefficient for text similarity.
 *
 * @returns Similarity in [0, 1].
 */
export function textSimilarity(a: string, b: string): number {
	const normalize = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");
	const na = normalize(a);
	const nb = normalize(b);

	if (na === nb) return 1.0;
	if (na.length < 2 || nb.length < 2) return 0.0;

	const bigrams = (s: string): Map<string, number> => {
		const map = new Map<string, number>();
		for (let i = 0; i < s.length - 1; i++) {
			const bg = s.substring(i, i + 2);
			map.set(bg, (map.get(bg) ?? 0) + 1);
		}
		return map;
	};

	const bga = bigrams(na);
	const bgb = bigrams(nb);
	let intersection = 0;
	for (const [bg, count] of bga) {
		intersection += Math.min(count, bgb.get(bg) ?? 0);
	}

	return (2 * intersection) / (na.length - 1 + nb.length - 1);
}

/** Convert a descriptive string into a URL-safe slug. */
export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, "")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 80);
}

// ─── Phase 3: CRYSTALLIZE (Vasana Formation) ────────────────────────────────

/**
 * Aggregate samskaras by pattern type and content similarity, creating
 * or reinforcing vasanas (stable behavioral tendencies).
 *
 * A samskara becomes a vasana candidate when:
 *   1. observation_count >= minPatternFrequency
 *   2. confidence > 0.5
 *   3. Consistent across >= 2 sessions (stability heuristic)
 */
export async function svapnaCrystallize(
	db: DatabaseManager,
	config: SvapnaConfig,
): Promise<CrystallizeResult> {
	const start = performance.now();
	const agentDb = db.get("agent");
	let vasanasCreated = 0;
	let vasanasReinforced = 0;

	const samskaras = agentDb
		.prepare(
			`SELECT id, session_id, pattern_type, pattern_content,
			        observation_count, confidence, pramana_type, project
			 FROM samskaras
			 WHERE (project = ? OR project IS NULL)
			   AND observation_count >= ?
			   AND confidence > 0.5
			 ORDER BY confidence DESC`,
		)
		.all(config.project, config.minPatternFrequency) as Array<{
			id: string; session_id: string; pattern_type: string; pattern_content: string;
			observation_count: number; confidence: number; pramana_type: string | null; project: string | null;
		}>;

	if (samskaras.length === 0) {
		return { vasanasCreated: 0, vasanasReinforced: 0, durationMs: performance.now() - start };
	}

	// Cluster samskaras by pattern_type + content similarity (bigram Dice > 0.7)
	interface Cluster {
		representative: string;
		samskaraIds: string[];
		totalObservations: number;
		maxConfidence: number;
		patternType: string;
		sessionIds: Set<string>;
	}

	const clusters: Cluster[] = [];

	for (const sam of samskaras) {
		let merged = false;
		for (const cluster of clusters) {
			if (
				cluster.patternType === sam.pattern_type &&
				textSimilarity(sam.pattern_content, cluster.representative) > 0.7
			) {
				cluster.samskaraIds.push(sam.id);
				cluster.totalObservations += sam.observation_count;
				cluster.maxConfidence = Math.max(cluster.maxConfidence, sam.confidence);
				cluster.sessionIds.add(sam.session_id);
				merged = true;
				break;
			}
		}

		if (!merged) {
			clusters.push({
				representative: sam.pattern_content,
				samskaraIds: [sam.id],
				totalObservations: sam.observation_count,
				maxConfidence: sam.confidence,
				patternType: sam.pattern_type,
				sessionIds: new Set([sam.session_id]),
			});
		}
	}

	// For each qualifying cluster, create or reinforce a vasana
	const now = Date.now();

	for (const cluster of clusters) {
		if (cluster.sessionIds.size < 2) continue;

		const tendency = slugify(cluster.representative);
		const vasanaId = fnv1a(`${tendency}:${config.project}`);

		const existing = agentDb
			.prepare("SELECT id, strength, activation_count FROM vasanas WHERE name = ? AND (project = ? OR project IS NULL)")
			.get(tendency, config.project) as { id: number; strength: number; activation_count: number } | undefined;

		if (existing) {
			const newStrength = Math.min(1.0, existing.strength + 0.1);
			agentDb
				.prepare(
					`UPDATE vasanas SET strength = ?, last_activated = ?, activation_count = ?, updated_at = ?, source_samskaras = ?
					 WHERE id = ?`,
				)
				.run(newStrength, now, existing.activation_count + 1, now, JSON.stringify(cluster.samskaraIds), existing.id);
			vasanasReinforced++;
		} else {
			let valence: "positive" | "negative" | "neutral" = "neutral";
			if (cluster.patternType === "correction") valence = "negative";
			else if (cluster.patternType === "preference" || cluster.patternType === "convention") {
				valence = "positive";
			}

			agentDb
				.prepare(
					`INSERT INTO vasanas (name, description, valence, strength, stability,
					 source_samskaras, project, created_at, updated_at, last_activated, activation_count)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					tendency, cluster.representative, valence,
					Math.min(1.0, cluster.maxConfidence),
					cluster.sessionIds.size / config.maxSessionsPerCycle,
					JSON.stringify(cluster.samskaraIds), config.project,
					now, now, now, 1,
				);
			vasanasCreated++;
		}
	}

	return { vasanasCreated, vasanasReinforced, durationMs: performance.now() - start };
}
