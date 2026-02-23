/**
 * @module agent-skills-loader
 * @description Discovers and loads Agent Skills from SKILL.md files following
 * the open standard format (YAML frontmatter + Markdown body).
 *
 * Scans a directory for `* /SKILL.md` (one level deep), parses the YAML
 * frontmatter (name, description, metadata, tags), and converts each into
 * a {@link SkillManifest} compatible with {@link SkillRegistry}.
 *
 * Fingerprinting (SimHash) and relevance scoring (BM25 + Jaccard + SimHash)
 * live in `agent-skills-fingerprint.ts` and `agent-skills-scoring.ts`.
 *
 * @packageDocumentation
 */

import fs from "fs";
import path from "path";
import type { SkillManifest } from "./types.js";
import {
	extractFeatures,
	computeTfIdf,
	computeSimHash,
	skillSimilarity,
} from "./agent-skills-fingerprint.js";

// Re-export public types and functions for backward compatibility.
// Consumers importing from "./agent-skills-loader.js" continue to work.
export { fnv1a64, computeSimHash, skillSimilarity } from "./agent-skills-fingerprint.js";
export type { AgentSkillEntry } from "./agent-skills-fingerprint.js";
export { scoreSkillRelevance } from "./agent-skills-scoring.js";
export type { ScoredSkill } from "./agent-skills-scoring.js";

/** Result of loading agent skills from a directory. */
export interface AgentSkillLoadResult {
	/** Successfully loaded skill manifests. */
	skills: SkillManifest[];
	/** Paths that were skipped due to errors, with reasons. */
	skipped: Array<{ path: string; reason: string }>;
}

// ── YAML Frontmatter Parser ──────────────────────────────────────────────────

/**
 * Parse YAML frontmatter from a SKILL.md file.
 *
 * Handles folded scalars (`>`) and inline arrays (`[a, b, c]`) — the two
 * YAML features actually used in the Agent Skills format. No external deps.
 */
function parseFrontmatter(raw: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const lines = raw.split("\n");

	const stack: Array<{ obj: Record<string, unknown>; indent: number }> = [
		{ obj: result, indent: -1 },
	];

	let foldKey: string | null = null;
	let foldParent: Record<string, unknown> | null = null;
	let foldLines: string[] = [];
	let foldIndent = 0;

	const flushFold = () => {
		if (foldKey && foldParent) {
			foldParent[foldKey] = foldLines.join(" ").trim();
		}
		foldKey = null;
		foldParent = null;
		foldLines = [];
	};

	for (const line of lines) {
		const trimmed = line.trim();

		// Inside a folded scalar — collect continuation lines
		if (foldKey !== null) {
			const lineIndent = line.search(/\S/);
			if (trimmed === "" || (lineIndent >= 0 && lineIndent > foldIndent)) {
				if (trimmed !== "") foldLines.push(trimmed);
				continue;
			}
			flushFold();
		}

		if (trimmed === "" || trimmed.startsWith("#")) continue;

		const indent = line.search(/\S/);
		if (indent < 0) continue;

		const colonIdx = line.indexOf(":");
		if (colonIdx < 0) continue;

		const key = line.slice(indent, colonIdx).trim();
		const rawValue = line.slice(colonIdx + 1).trim();

		// Pop stack to correct parent
		while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
			stack.pop();
		}
		const parent = stack[stack.length - 1].obj;

		if (rawValue === ">" || rawValue === "|") {
			foldKey = key;
			foldParent = parent;
			foldLines = [];
			foldIndent = indent;
		} else if (rawValue === "" || rawValue === undefined) {
			const nested: Record<string, unknown> = {};
			parent[key] = nested;
			stack.push({ obj: nested, indent });
		} else {
			parent[key] = parseValue(rawValue);
		}
	}

	flushFold();
	return result;
}

/** Parse a single YAML value (scalar, inline array, quoted string). */
function parseValue(raw: string): unknown {
	const t = raw.trim();
	if (t.startsWith("[") && t.endsWith("]")) {
		const inner = t.slice(1, -1).trim();
		if (inner === "") return [];
		return inner.split(",").map((s) => parseValue(s.trim()));
	}
	if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
		return t.slice(1, -1);
	}
	if (t === "true") return true;
	if (t === "false") return false;
	if (t === "null" || t === "~") return null;
	const num = Number(t);
	if (!isNaN(num) && t !== "") return num;
	return t;
}

/**
 * Extract YAML frontmatter (between `---` markers) from file content.
 * Returns null if no valid frontmatter is found.
 */
function extractFrontmatter(content: string): string | null {
	const first = content.indexOf("---");
	if (first < 0) return null;
	const second = content.indexOf("---", first + 3);
	if (second < 0) return null;
	return content.slice(first + 3, second);
}

/** List scripts in a skill directory (relative paths under `scripts/`). */
function listScripts(skillDir: string): string[] {
	const scriptsDir = path.join(skillDir, "scripts");
	if (!fs.existsSync(scriptsDir) || !fs.statSync(scriptsDir).isDirectory()) {
		return [];
	}
	return fs.readdirSync(scriptsDir)
		.filter((f) => !f.startsWith("."))
		.map((f) => `scripts/${f}`);
}

/** Convert parsed SKILL.md frontmatter into a SkillManifest. */
function toManifest(
	fm: Record<string, unknown>,
	skillDir: string,
	filePath: string,
): SkillManifest {
	const name = String(fm.name ?? path.basename(skillDir));
	const description = String(fm.description ?? "");
	const metadata = (fm.metadata ?? {}) as Record<string, unknown>;
	const version = String(metadata.version ?? fm.version ?? "1.0.0");
	const author = String(metadata.author ?? fm.author ?? "unknown");

	let tags: string[] = [];
	const rawTags = metadata.tags ?? fm.tags;
	if (Array.isArray(rawTags)) {
		tags = rawTags.map(String);
	} else if (typeof rawTags === "string") {
		tags = rawTags.split(",").map((t) => t.trim()).filter(Boolean);
	}

	// If no tags, extract keywords from the description
	if (tags.length === 0 && description) {
		const stopWords = new Set([
			"a", "an", "the", "and", "or", "for", "to", "of", "in", "on",
			"is", "it", "that", "this", "with", "from", "as", "by", "at",
			"be", "are", "was", "were", "been", "not", "no", "do", "does",
			"when", "what", "which", "who", "how", "all", "each", "every",
			"invoke", "asks", "user", "about",
		]);
		tags = description
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, " ")
			.split(/\s+/)
			.filter((w) => w.length > 2 && !stopWords.has(w))
			.slice(0, 8);
		tags = [...new Set(tags)];
	}

	const parts = name.split("-");
	const verb = parts.length > 1 ? parts[parts.length - 1] : "execute";
	const object = parts.length > 1 ? parts.slice(0, -1).join("-") : name;
	const scripts = listScripts(skillDir);

	return {
		name,
		version,
		description,
		author,
		capabilities: [{ verb, object, description }],
		tags,
		source: { type: "manual", filePath },
		updatedAt: new Date().toISOString(),
		...(scripts.length > 0
			? { inputSchema: { _scripts: scripts } as Record<string, unknown> }
			: {}),
	};
}

// ── Loader ───────────────────────────────────────────────────────────────────

/** Near-duplicate similarity threshold. Skills above this are deduplicated. */
const DEDUP_THRESHOLD = 0.85;

/**
 * Scan a directory for SKILL.md files and load them as SkillManifest objects.
 *
 * Expects:
 * ```
 * skillsDir/
 *   skill-name/
 *     SKILL.md          ← required
 *     scripts/           ← optional
 * ```
 *
 * Phase 1: Parse all manifests from SKILL.md frontmatter.
 * Phase 2: Compute TF-IDF weighted SimHash for near-duplicate detection.
 * Phase 3: Deduplicate via SimHash Hamming distance.
 *
 * @param skillsDir - Absolute path to the skills directory to scan.
 * @returns Loaded skills and any skipped entries.
 */
export function loadAgentSkills(skillsDir: string): AgentSkillLoadResult {
	const result: AgentSkillLoadResult = { skills: [], skipped: [] };

	if (!fs.existsSync(skillsDir)) return result;

	let entries: string[];
	try {
		entries = fs.readdirSync(skillsDir);
	} catch {
		return result;
	}

	// Phase 1: Parse all manifests
	const parsed: Array<{ manifest: SkillManifest; path: string }> = [];

	for (const entry of entries) {
		if (entry.startsWith(".")) continue;

		const entryPath = path.join(skillsDir, entry);
		try {
			if (!fs.statSync(entryPath).isDirectory()) continue;
		} catch {
			continue;
		}

		const skillMdPath = path.join(entryPath, "SKILL.md");
		if (!fs.existsSync(skillMdPath)) {
			result.skipped.push({ path: entryPath, reason: "no SKILL.md found" });
			continue;
		}

		try {
			const content = fs.readFileSync(skillMdPath, "utf8");
			const fmRaw = extractFrontmatter(content);
			if (!fmRaw) {
				result.skipped.push({ path: skillMdPath, reason: "no YAML frontmatter" });
				continue;
			}

			const fm = parseFrontmatter(fmRaw);
			if (!fm.name) {
				result.skipped.push({ path: skillMdPath, reason: "frontmatter missing 'name'" });
				continue;
			}

			const manifest = toManifest(fm, entryPath, skillMdPath);
			parsed.push({ manifest, path: skillMdPath });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			result.skipped.push({ path: skillMdPath, reason: msg });
		}
	}

	// Phase 2: Compute TF-IDF weighted SimHash for each skill
	const featureSets = parsed.map((p) =>
		extractFeatures(p.manifest.description, p.manifest.tags),
	);
	const tfidfWeights = computeTfIdf(featureSets);

	const withHash: Array<{ manifest: SkillManifest; simhash: bigint; path: string }> =
		parsed.map((p, i) => ({
			manifest: p.manifest,
			simhash: computeSimHash(featureSets[i], tfidfWeights[i]),
			path: p.path,
		}));

	// Phase 3: Deduplicate via SimHash Hamming distance
	const accepted: boolean[] = new Array(withHash.length).fill(true);

	for (let i = 0; i < withHash.length; i++) {
		if (!accepted[i]) continue;
		for (let j = i + 1; j < withHash.length; j++) {
			if (!accepted[j]) continue;
			const sim = skillSimilarity(withHash[i].simhash, withHash[j].simhash);
			if (sim > DEDUP_THRESHOLD) {
				const keepI = withHash[i].manifest.description.length >=
					withHash[j].manifest.description.length;
				const victim = keepI ? j : i;
				const keeper = keepI ? i : j;
				accepted[victim] = false;
				result.skipped.push({
					path: withHash[victim].path,
					reason: `near-duplicate of "${withHash[keeper].manifest.name}" `
						+ `(SimHash similarity=${sim.toFixed(3)})`,
				});
				if (!keepI) break;
			}
		}
	}

	for (let i = 0; i < withHash.length; i++) {
		if (accepted[i]) {
			result.skills.push(withHash[i].manifest);
		}
	}

	return result;
}
