/**
 * @module parser
 * @description Parse skill.md files into SkillManifest objects.
 *
 * The skill.md format uses YAML frontmatter (between --- delimiters) for
 * structured metadata and Markdown body sections for capabilities, examples,
 * and anti-patterns.
 *
 * @packageDocumentation
 */

import type {
	SkillCapability,
	SkillExample,
	SkillManifest,
	SkillParameter,
	SkillSource,
} from "./types.js";
import type {
	KulaType,
	PranamayaRequirements,
	EnhancedSkillManifest,
	GranularPermissions,
	GranularNetworkPermissions,
	GranularUserDataPermissions,
	GranularFilesystemPermissions,
	ApproachLadderEntry,
	EvalCase,
} from "./types-v2.js";
import { EMPTY_PRANAMAYA } from "./types-v2.js";

// Re-export YAML and section parsers
export { parseFrontmatter } from "./parser-yaml.js";
export { parseCapabilitiesSection, parseExamplesSection } from "./parser-sections.js";

import { parseFrontmatter } from "./parser-yaml.js";
import { parseCapabilitiesSection, parseExamplesSection } from "./parser-sections.js";
import { extractSection } from "./parser-sections.js";

// ─── Main API ───────────────────────────────────────────────────────────────

/**
 * Parse a skill.md file into a {@link SkillManifest}.
 *
 * The file format is YAML frontmatter (metadata) + Markdown body (capabilities,
 * examples, anti-patterns).
 *
 * @param content - The full text content of a skill.md file.
 * @returns A fully populated SkillManifest.
 * @throws If the frontmatter is missing required fields.
 */
export function parseSkillMarkdown(content: string): EnhancedSkillManifest {
	// Split frontmatter from body
	const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!fmMatch) {
		throw new Error("Invalid skill.md: missing YAML frontmatter delimiters (---)");
	}

	const frontmatter = parseFrontmatter(fmMatch[1]);
	const body = fmMatch[2];

	// Parse source (nested object)
	const rawSource = frontmatter.source as Record<string, unknown> | undefined;
	let source: SkillSource;
	if (rawSource?.type === "tool") {
		source = { type: "tool", toolName: String(rawSource.toolName ?? "") };
	} else if (rawSource?.type === "mcp-server") {
		source = {
			type: "mcp-server",
			serverId: String(rawSource.serverId ?? ""),
			serverName: String(rawSource.serverName ?? ""),
		};
	} else if (rawSource?.type === "plugin") {
		source = { type: "plugin", pluginName: String(rawSource.pluginName ?? "") };
	} else if (rawSource?.type === "generated") {
		source = { type: "generated", generator: String(rawSource.generator ?? "") };
	} else {
		source = { type: "manual", filePath: String(rawSource?.filePath ?? "") };
	}

	// Parse capabilities from markdown body
	const capabilities = parseCapabilitiesSection(body);

	// Parse examples from markdown body
	const examples = parseExamplesSection(body);

	// Parse anti-patterns section
	const antiPatterns = parseAntiPatternsSection(body);

	// Assemble tags — check both root-level and metadata.tags
	const metadata = frontmatter.metadata as Record<string, unknown> | undefined;
	const rawTags = frontmatter.tags ?? metadata?.tags;
	const tags = Array.isArray(rawTags) ? rawTags.map(String) : [];

	// Resolve version / author from root or metadata
	const resolvedVersion = frontmatter.version ?? metadata?.version;
	const resolvedAuthor = frontmatter.author ?? metadata?.author;

	// ── Vidya-Tantra extensions (all optional, backward-compatible) ──

	// Kula tier
	const rawKula = frontmatter.kula as string | undefined;
	const kula: KulaType | undefined =
		rawKula === "antara" || rawKula === "bahya" || rawKula === "shiksha"
			? rawKula
			: undefined;

	// Pranamaya requirements (nested object)
	const rawReq = frontmatter.requirements as Record<string, unknown> | undefined;
	const requirements: PranamayaRequirements | undefined = rawReq
		? {
			bins: toStringArray(rawReq.bins),
			env: toStringArray(rawReq.env),
			os: toStringArray(rawReq.os) as NodeJS.Platform[],
			network: rawReq.network === true,
			privilege: rawReq.privilege === true,
		}
		: undefined;

	// Selection wisdom — from frontmatter first, body sections as fallback
	// Use || instead of ?? because toStringArray returns [] (truthy) for undefined input
	const fmWhenToUse = Array.isArray(frontmatter.whenToUse) ? toStringArray(frontmatter.whenToUse) : null;
	const fmWhenNotToUse = Array.isArray(frontmatter.whenNotToUse) ? toStringArray(frontmatter.whenNotToUse) : null;
	const whenToUse = fmWhenToUse ?? parseBulletSection(body, "When To Use");
	const whenNotToUse = fmWhenNotToUse ?? parseBulletSection(body, "When Not To Use");
	const complements = toStringArray(frontmatter.complements);
	const supersedes = toStringArray(frontmatter.supersedes);

	// Granular permissions (superset of requirements)
	const rawPermissions = frontmatter.permissions as Record<string, unknown> | undefined;
	const permissions: GranularPermissions | undefined = rawPermissions
		? parseGranularPermissions(rawPermissions)
		: undefined;

	// Approach ladder (compliance reasoning)
	const rawLadder = frontmatter.approachLadder;
	const approachLadder: ApproachLadderEntry[] | undefined = Array.isArray(rawLadder)
		? (rawLadder as Array<Record<string, unknown>>)
			.map(parseApproachEntry)
			.filter((e): e is ApproachLadderEntry => e !== null)
		: undefined;

	// Eval cases (inline in frontmatter — also loadable from eval/cases/*.json)
	const rawEvalCases = frontmatter.evalCases;
	const evalCases: EvalCase[] | undefined = Array.isArray(rawEvalCases)
		? (rawEvalCases as Array<Record<string, unknown>>)
			.filter(isValidInlineEvalCase)
			.map((ec) => ({
				id: String(ec.id),
				input: ec.input as Record<string, unknown>,
				expected: ec.expected as Record<string, unknown> | string,
				...(ec.type !== undefined && { type: ec.type as "golden" | "adversarial" }),
				...(ec.description !== undefined && { description: String(ec.description) }),
			}))
		: undefined;

	const manifest: EnhancedSkillManifest = {
		name: String(frontmatter.name ?? ""),
		version: String(resolvedVersion ?? "0.0.0"),
		description: String(frontmatter.description ?? ""),
		author: resolvedAuthor ? String(resolvedAuthor) : undefined,
		body: body.trim() || undefined,
		capabilities,
		inputSchema: frontmatter.inputSchema as Record<string, unknown> | undefined,
		outputSchema: frontmatter.outputSchema as Record<string, unknown> | undefined,
		examples: examples.length > 0 ? examples : undefined,
		tags,
		traitVector: frontmatter.traitVector as number[] | undefined,
		source,
		antiPatterns: antiPatterns.length > 0 ? antiPatterns : undefined,
		updatedAt: String(frontmatter.updatedAt ?? new Date().toISOString()),
		// Vidya-Tantra extensions (all optional, only set if present)
		...(kula !== undefined && { kula }),
		...(requirements !== undefined && { requirements }),
		...(whenToUse.length > 0 && { whenToUse }),
		...(whenNotToUse.length > 0 && { whenNotToUse }),
		...(complements.length > 0 && { complements }),
		...(supersedes.length > 0 && { supersedes }),
		...(permissions !== undefined && { permissions }),
		...(approachLadder !== undefined && approachLadder.length > 0 && { approachLadder }),
		...(evalCases !== undefined && evalCases.length > 0 && { evalCases }),
	};

	return manifest;
}

/**
 * Safely coerce an unknown value to string[].
 * Returns empty array if input is not an array.
 */
function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map(String);
}

/**
 * Parse a bullet-list section from markdown body.
 * Falls back for whenToUse / whenNotToUse when not in frontmatter.
 */
function parseBulletSection(markdown: string, headingText: string): string[] {
	const section = extractSection(markdown, headingText, 2);
	if (!section) return [];
	return section
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("- "))
		.map((line) => line.slice(2).trim());
}

/**
 * Parse the Anti-Patterns section from markdown body.
 * Each bullet point is an anti-pattern.
 */
function parseAntiPatternsSection(markdown: string): string[] {
	const section = extractSection(markdown, "Anti-Patterns", 2);
	if (!section) return [];

	return section
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("- "))
		.map((line) => line.slice(2).trim());
}

// ─── Extended Field Parsers ─────────────────────────────────────────────────

/**
 * Parse granular permissions from a raw frontmatter object.
 */
function parseGranularPermissions(raw: Record<string, unknown>): GranularPermissions {
	const result: Record<string, unknown> = {};

	// Inherit PranamayaRequirements fields
	if (raw.bins !== undefined) result.bins = toStringArray(raw.bins);
	if (raw.env !== undefined) result.env = toStringArray(raw.env);
	if (raw.os !== undefined) result.os = toStringArray(raw.os);
	if (raw.network !== undefined) result.network = raw.network === true;
	if (raw.privilege !== undefined) result.privilege = raw.privilege === true;

	// Network policy (nested object)
	const rawNp = raw.networkPolicy as Record<string, unknown> | undefined;
	if (rawNp && typeof rawNp === "object") {
		const np: Record<string, unknown> = {
			allowlist: toStringArray(rawNp.allowlist),
		};
		if (rawNp.denylist !== undefined) np.denylist = toStringArray(rawNp.denylist);
		if (rawNp.timeoutMs !== undefined) np.timeoutMs = Number(rawNp.timeoutMs);
		if (rawNp.rateLimit && typeof rawNp.rateLimit === "object") {
			const rl = rawNp.rateLimit as Record<string, unknown>;
			np.rateLimit = { maxPerMinute: Number(rl.maxPerMinute ?? 60) };
		}
		result.networkPolicy = np;
	}

	// Secrets
	if (raw.secrets !== undefined) result.secrets = toStringArray(raw.secrets);

	// User data (nested object)
	const rawUd = raw.userData as Record<string, unknown> | undefined;
	if (rawUd && typeof rawUd === "object") {
		const ud: Record<string, unknown> = {};
		if (rawUd.location !== undefined) ud.location = String(rawUd.location);
		if (rawUd.memory !== undefined) ud.memory = String(rawUd.memory);
		if (rawUd.calendar !== undefined) ud.calendar = rawUd.calendar === true;
		if (rawUd.email !== undefined) ud.email = rawUd.email === true;
		result.userData = ud;
	}

	// Filesystem (nested object)
	const rawFs = raw.filesystem as Record<string, unknown> | undefined;
	if (rawFs && typeof rawFs === "object") {
		const fs: Record<string, unknown> = { scope: String(rawFs.scope ?? "none") };
		if (rawFs.maxWriteMb !== undefined) fs.maxWriteMb = Number(rawFs.maxWriteMb);
		result.filesystem = fs;
	}

	// PII policy
	if (raw.piiPolicy !== undefined) result.piiPolicy = String(raw.piiPolicy);

	// Retention days
	if (raw.retentionDays !== undefined) result.retentionDays = Number(raw.retentionDays);

	return result as unknown as GranularPermissions;
}

/**
 * Parse a single approach ladder entry from raw frontmatter.
 */
function parseApproachEntry(raw: Record<string, unknown>): ApproachLadderEntry | null {
	if (!raw.name || !raw.status || !raw.why) return null;
	const validStatuses = ["preferred", "fallback", "blocked"];
	const status = String(raw.status);
	if (!validStatuses.includes(status)) return null;

	return {
		name: String(raw.name),
		status: status as "preferred" | "fallback" | "blocked",
		why: String(raw.why),
		...(raw.requirements !== undefined && { requirements: toStringArray(raw.requirements) }),
		...(raw.risks !== undefined && { risks: toStringArray(raw.risks) }),
	};
}

/**
 * Type guard for inline eval cases from frontmatter.
 */
function isValidInlineEvalCase(obj: Record<string, unknown>): boolean {
	return (
		typeof obj.id === "string" &&
		obj.id.length > 0 &&
		typeof obj.input === "object" &&
		obj.input !== null &&
		obj.expected !== undefined
	);
}
