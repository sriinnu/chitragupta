import { describe, it, expect } from "vitest";
import {
	parseSkillMarkdown,
	parseFrontmatter,
	writeSkillMarkdown,
} from "@chitragupta/vidhya-skills";
import type {
	EnhancedSkillManifest,
	KulaType,
	PranamayaRequirements,
} from "@chitragupta/vidhya-skills";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a minimal valid skill.md with optional extra frontmatter lines. */
function makeSkillMd(extraFrontmatter: string = "", body: string = ""): string {
	return `---
name: test-skill
version: 1.0.0
description: A test skill
tags: [test]
source:
  type: tool
  toolName: test_tool
updatedAt: 2025-06-01T00:00:00Z
${extraFrontmatter}---
${body}`;
}

/** Build a complete enhanced skill.md with all v2 fields. */
function makeFullEnhancedSkillMd(): string {
	return `---
name: enhanced-reader
version: 2.1.0
description: Enhanced file reader with kula and requirements
author: Chitragupta
tags: [file, read, io, enhanced]
source:
  type: tool
  toolName: read_file
updatedAt: 2025-06-15T00:00:00Z
kula: antara
requirements:
  bins: [node, ffmpeg]
  env: [HOME, PATH]
  os: [linux, darwin]
  network: false
  privilege: false
whenToUse: [reading local files, parsing config files, loading templates]
whenNotToUse: [binary files, very large files over 100MB]
complements: [file-writer, code-analyzer]
supersedes: [old-file-reader]
---

## Capabilities

### read / file
Read a file from the local filesystem.

**Parameters:**
- \`path\` (string, required): Path to the file

## When To Use
- Reading local files
- Parsing config files

## When Not To Use
- Binary files
- Very large files over 100MB

## Anti-Patterns
- Do not use for streaming data
`;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Parser V2 — Enhanced Frontmatter Parsing", () => {

	// ─── Kula Field ─────────────────────────────────────────────────────

	describe("kula field", () => {
		it("parses kula: antara correctly", () => {
			const md = makeSkillMd("kula: antara\n");
			const manifest = parseSkillMarkdown(md);
			expect(manifest.kula).toBe("antara");
		});

		it("parses kula: bahya correctly", () => {
			const md = makeSkillMd("kula: bahya\n");
			const manifest = parseSkillMarkdown(md);
			expect(manifest.kula).toBe("bahya");
		});

		it("parses kula: shiksha correctly", () => {
			const md = makeSkillMd("kula: shiksha\n");
			const manifest = parseSkillMarkdown(md);
			expect(manifest.kula).toBe("shiksha");
		});

		it("invalid kula values are ignored (undefined)", () => {
			const md = makeSkillMd("kula: invalid_tier\n");
			const manifest = parseSkillMarkdown(md);
			expect(manifest.kula).toBeUndefined();
		});

		it("numeric kula value is ignored", () => {
			const md = makeSkillMd("kula: 42\n");
			const manifest = parseSkillMarkdown(md);
			expect(manifest.kula).toBeUndefined();
		});
	});

	// ─── Requirements (Pranamaya) ───────────────────────────────────────

	describe("requirements nested object", () => {
		it("parses bins, env, os, network, privilege all correctly", () => {
			const md = makeSkillMd(
				"requirements:\n" +
				"  bins: [docker, ffmpeg]\n" +
				"  env: [OPENAI_API_KEY, HOME]\n" +
				"  os: [linux, darwin]\n" +
				"  network: true\n" +
				"  privilege: false\n",
			);
			const manifest = parseSkillMarkdown(md);
			expect(manifest.requirements).toBeDefined();
			expect(manifest.requirements!.bins).toEqual(["docker", "ffmpeg"]);
			expect(manifest.requirements!.env).toEqual(["OPENAI_API_KEY", "HOME"]);
			expect(manifest.requirements!.os).toEqual(["linux", "darwin"]);
			expect(manifest.requirements!.network).toBe(true);
			expect(manifest.requirements!.privilege).toBe(false);
		});

		it("requirements with empty arrays are valid PranamayaRequirements", () => {
			const md = makeSkillMd(
				"requirements:\n" +
				"  bins: []\n" +
				"  env: []\n" +
				"  os: []\n" +
				"  network: false\n" +
				"  privilege: false\n",
			);
			const manifest = parseSkillMarkdown(md);
			expect(manifest.requirements).toBeDefined();
			expect(manifest.requirements!.bins).toEqual([]);
			expect(manifest.requirements!.env).toEqual([]);
			expect(manifest.requirements!.os).toEqual([]);
			expect(manifest.requirements!.network).toBe(false);
			expect(manifest.requirements!.privilege).toBe(false);
		});

		it("missing requirements returns undefined (not empty object)", () => {
			const md = makeSkillMd("");
			const manifest = parseSkillMarkdown(md);
			expect(manifest.requirements).toBeUndefined();
		});

		it("requirements with only bins populated", () => {
			const md = makeSkillMd(
				"requirements:\n" +
				"  bins: [node]\n",
			);
			const manifest = parseSkillMarkdown(md);
			expect(manifest.requirements).toBeDefined();
			expect(manifest.requirements!.bins).toEqual(["node"]);
			// Missing sub-fields default to empty/false
			expect(manifest.requirements!.env).toEqual([]);
			expect(manifest.requirements!.network).toBe(false);
			expect(manifest.requirements!.privilege).toBe(false);
		});
	});

	// ─── Selection Wisdom Fields ────────────────────────────────────────

	describe("selection wisdom fields", () => {
		it("whenToUse as frontmatter array is parsed as string[]", () => {
			const md = makeSkillMd("whenToUse: [reading files, parsing configs]\n");
			const manifest = parseSkillMarkdown(md);
			expect(manifest.whenToUse).toEqual(["reading files", "parsing configs"]);
		});

		it("whenNotToUse as frontmatter array is parsed as string[]", () => {
			const md = makeSkillMd("whenNotToUse: [binary files, large uploads]\n");
			const manifest = parseSkillMarkdown(md);
			expect(manifest.whenNotToUse).toEqual(["binary files", "large uploads"]);
		});

		it("complements array is parsed", () => {
			const md = makeSkillMd("complements: [file-writer, code-analyzer]\n");
			const manifest = parseSkillMarkdown(md);
			expect(manifest.complements).toEqual(["file-writer", "code-analyzer"]);
		});

		it("supersedes array is parsed (even empty array)", () => {
			const md = makeSkillMd("supersedes: []\n");
			const manifest = parseSkillMarkdown(md);
			// Empty arrays should NOT be spread into the manifest
			expect(manifest.supersedes).toBeUndefined();
		});

		it("supersedes with values is parsed", () => {
			const md = makeSkillMd("supersedes: [old-reader, legacy-reader]\n");
			const manifest = parseSkillMarkdown(md);
			expect(manifest.supersedes).toEqual(["old-reader", "legacy-reader"]);
		});

		it("missing wisdom fields are not present on manifest", () => {
			const md = makeSkillMd("");
			const manifest = parseSkillMarkdown(md);
			expect("whenToUse" in manifest).toBe(false);
			expect("whenNotToUse" in manifest).toBe(false);
			expect("complements" in manifest).toBe(false);
			expect("supersedes" in manifest).toBe(false);
		});
	});

	// ─── Backward Compatibility ─────────────────────────────────────────

	describe("backward compatibility", () => {
		it("skill.md without any v2 fields parses as valid EnhancedSkillManifest", () => {
			const md = `---
name: plain-skill
version: 0.5.0
description: A plain old skill
tags: [basic]
source:
  type: tool
  toolName: plain_tool
updatedAt: 2025-01-01T00:00:00Z
---

## Capabilities

### read / data
Read some data.
`;
			const manifest = parseSkillMarkdown(md);
			expect(manifest.name).toBe("plain-skill");
			expect(manifest.version).toBe("0.5.0");
			expect(manifest.capabilities).toHaveLength(1);
			// No v2 fields present
			expect(manifest.kula).toBeUndefined();
			expect(manifest.requirements).toBeUndefined();
			expect("whenToUse" in manifest).toBe(false);
		});

		it("only base fields (name, version, description, tags, source) work exactly as before", () => {
			const md = `---
name: base-only
version: 1.0.0
description: Base fields only
tags: [alpha, beta]
source:
  type: manual
  filePath: /skills/base.md
updatedAt: 2025-03-01
---
`;
			const manifest = parseSkillMarkdown(md);
			expect(manifest.name).toBe("base-only");
			expect(manifest.version).toBe("1.0.0");
			expect(manifest.description).toBe("Base fields only");
			expect(manifest.tags).toEqual(["alpha", "beta"]);
			expect(manifest.source).toEqual({ type: "manual", filePath: "/skills/base.md" });
		});

		it("mixed v1 and v2 fields are both present", () => {
			const md = `---
name: mixed-skill
version: 2.0.0
description: Mixed v1 and v2 fields
author: Tester
tags: [file, io]
source:
  type: tool
  toolName: mixed_tool
updatedAt: 2025-06-01
kula: bahya
whenToUse: [general file operations]
---

## Capabilities

### read / file
Read a file.

## Anti-Patterns
- Not for streaming
`;
			const manifest = parseSkillMarkdown(md);
			// V1 fields
			expect(manifest.name).toBe("mixed-skill");
			expect(manifest.author).toBe("Tester");
			expect(manifest.capabilities).toHaveLength(1);
			expect(manifest.antiPatterns).toEqual(["Not for streaming"]);
			// V2 fields
			expect(manifest.kula).toBe("bahya");
			expect(manifest.whenToUse).toEqual(["general file operations"]);
		});
	});

	// ─── Body Section Fallback ──────────────────────────────────────────

	describe("body section fallback", () => {
		/*
		 * NOTE: The current parser implementation uses `toStringArray(frontmatter.whenToUse) ?? parseBulletSection(...)`.
		 * Since `toStringArray(undefined)` returns `[]` (not null/undefined), the `??` operator
		 * never falls through to the body section parser. The body fallback is effectively
		 * unreachable when the frontmatter field is absent. The empty array then fails the
		 * `whenToUse.length > 0` guard, so the field is excluded from the manifest.
		 *
		 * These tests document the ACTUAL behavior.
		 */

		it("body-only whenToUse is not parsed when frontmatter field is absent (toStringArray returns [])", () => {
			const md = `---
name: body-wisdom
version: 1.0.0
description: Wisdom from body
tags: [test]
source:
  type: tool
  toolName: body_tool
updatedAt: 2025-01-01
---

## When To Use
- Reading configuration files
- Loading user preferences
- Parsing JSON data
`;
			const manifest = parseSkillMarkdown(md);
			// Body fallback now works: when frontmatter has no whenToUse, parseBulletSection is called
			expect("whenToUse" in manifest).toBe(true);
			expect(manifest.whenToUse).toEqual([
				"Reading configuration files",
				"Loading user preferences",
				"Parsing JSON data",
			]);
		});

		it("body-only whenNotToUse is parsed via body section fallback", () => {
			const md = `---
name: body-antiuse
version: 1.0.0
description: Anti-use from body
tags: [test]
source:
  type: tool
  toolName: body_tool2
updatedAt: 2025-01-01
---

## When Not To Use
- Binary file processing
- Large file streaming
`;
			const manifest = parseSkillMarkdown(md);
			expect("whenNotToUse" in manifest).toBe(true);
			expect(manifest.whenNotToUse).toEqual([
				"Binary file processing",
				"Large file streaming",
			]);
		});

		it("frontmatter takes precedence over body sections for whenToUse", () => {
			const md = `---
name: precedence-test
version: 1.0.0
description: Precedence test
tags: [test]
source:
  type: tool
  toolName: prec_tool
updatedAt: 2025-01-01
whenToUse: [from frontmatter]
---

## When To Use
- from body section
`;
			const manifest = parseSkillMarkdown(md);
			expect(manifest.whenToUse).toEqual(["from frontmatter"]);
		});

		it("frontmatter takes precedence over body sections for whenNotToUse", () => {
			const md = `---
name: precedence-test-2
version: 1.0.0
description: Precedence test 2
tags: [test]
source:
  type: tool
  toolName: prec_tool2
updatedAt: 2025-01-01
whenNotToUse: [frontmatter override]
---

## When Not To Use
- body section item
`;
			const manifest = parseSkillMarkdown(md);
			expect(manifest.whenNotToUse).toEqual(["frontmatter override"]);
		});

		it("absent frontmatter + absent body section => field not present", () => {
			const md = `---
name: no-wisdom
version: 1.0.0
description: No wisdom at all
tags: []
source:
  type: tool
  toolName: no_wisdom_tool
updatedAt: 2025-01-01
---
`;
			const manifest = parseSkillMarkdown(md);
			expect("whenToUse" in manifest).toBe(false);
			expect("whenNotToUse" in manifest).toBe(false);
		});

		it("frontmatter whenToUse with items is always used even if body also has section", () => {
			const md = `---
name: both-present
version: 1.0.0
description: Both frontmatter and body
tags: [test]
source:
  type: tool
  toolName: both_tool
updatedAt: 2025-01-01
whenToUse: [frontmatter alpha, frontmatter beta]
---

## When To Use
- Body item alpha
- Body item beta
`;
			const manifest = parseSkillMarkdown(md);
			expect(manifest.whenToUse).toEqual(["frontmatter alpha", "frontmatter beta"]);
		});
	});

	// ─── Round-Trip ─────────────────────────────────────────────────────

	describe("round-trip (parse -> write -> parse)", () => {
		it("parse enhanced SKILL.md -> write -> parse preserves base fields", () => {
			const original = parseSkillMarkdown(makeFullEnhancedSkillMd());

			// Write back to markdown
			const written = writeSkillMarkdown(original);

			// Re-parse
			const reparsed = parseSkillMarkdown(written);

			expect(reparsed.name).toBe(original.name);
			expect(reparsed.version).toBe(original.version);
			expect(reparsed.description).toBe(original.description);
			expect(reparsed.author).toBe(original.author);
			expect(reparsed.tags).toEqual(original.tags);
			expect(reparsed.source).toEqual(original.source);
		});

		it("capabilities survive round-trip", () => {
			const original = parseSkillMarkdown(makeFullEnhancedSkillMd());
			const written = writeSkillMarkdown(original);
			const reparsed = parseSkillMarkdown(written);

			expect(reparsed.capabilities).toHaveLength(original.capabilities.length);
			expect(reparsed.capabilities[0].verb).toBe(original.capabilities[0].verb);
			expect(reparsed.capabilities[0].object).toBe(original.capabilities[0].object);
		});

		it("anti-patterns survive round-trip", () => {
			const original = parseSkillMarkdown(makeFullEnhancedSkillMd());
			const written = writeSkillMarkdown(original);
			const reparsed = parseSkillMarkdown(written);

			expect(reparsed.antiPatterns).toEqual(original.antiPatterns);
		});
	});

	// ─── Full Enhanced Parse ────────────────────────────────────────────

	describe("full enhanced skill.md parse", () => {
		it("parses all v2 fields from a complete enhanced skill.md", () => {
			const manifest = parseSkillMarkdown(makeFullEnhancedSkillMd());

			expect(manifest.name).toBe("enhanced-reader");
			expect(manifest.version).toBe("2.1.0");
			expect(manifest.kula).toBe("antara");

			expect(manifest.requirements).toBeDefined();
			expect(manifest.requirements!.bins).toEqual(["node", "ffmpeg"]);
			expect(manifest.requirements!.env).toEqual(["HOME", "PATH"]);
			expect(manifest.requirements!.os).toEqual(["linux", "darwin"]);
			expect(manifest.requirements!.network).toBe(false);
			expect(manifest.requirements!.privilege).toBe(false);

			// Frontmatter whenToUse takes precedence over body
			expect(manifest.whenToUse).toEqual([
				"reading local files",
				"parsing config files",
				"loading templates",
			]);
			expect(manifest.whenNotToUse).toEqual([
				"binary files",
				"very large files over 100MB",
			]);
			expect(manifest.complements).toEqual(["file-writer", "code-analyzer"]);
			expect(manifest.supersedes).toEqual(["old-file-reader"]);
		});

		it("parseFrontmatter handles v2 nested objects", () => {
			const yaml = `name: test
kula: antara
requirements:
  bins: [docker]
  env: [API_KEY]
  os: [linux]
  network: true
  privilege: false
whenToUse: [reading files]
complements: [writer]`;
			const parsed = parseFrontmatter(yaml);

			expect(parsed.kula).toBe("antara");
			expect(parsed.requirements).toEqual({
				bins: ["docker"],
				env: ["API_KEY"],
				os: ["linux"],
				network: true,
				privilege: false,
			});
			expect(parsed.whenToUse).toEqual(["reading files"]);
			expect(parsed.complements).toEqual(["writer"]);
		});
	});
});
