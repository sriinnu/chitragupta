# @chitragupta/vidhya-skills

![Logo](../../assets/logos/vidhya-skills.svg)

**विद्या (vidhya) -- Knowledge**

**Skill discovery system with Trait Vector Matching (TVM), Pancha Kosha five-sheath assessment, Ashrama lifecycle management, Kula tiered registry, Parampara trust chains, Samskara usage impressions, Yoga skill composition, Vamsha evolutionary tracking, Suraksha security scanning, Pariksha ingestion pipeline, Pratiksha staging, Crystallization from procedural memory, Shiksha autonomous learning, Setu cross-format porting, and Vidya Orchestrator unified lifecycle control.**

"Vidhya" means knowledge or wisdom in Sanskrit, from the root "vid" (to know) -- the same root that gives us "Veda." In the Vedic tradition, knowledge is not merely information but structured, discoverable, and transmissible wisdom. This package embodies that principle: every capability in the system is described by a compact, self-describing manifest (like a Vedic sutra), fingerprinted into a 128-dimensional trait vector (inspired by Shiksha, the Vedic science of phonetics), and matched against natural language queries without requiring an LLM or external embeddings. The Vidya-Tantra ecosystem extends this with five-sheath quality assessment, lifecycle state machines, trust provenance, usage-driven mastery tracking, skill composition discovery, evolutionary lineage tracking, and crystallization of procedural memory into polished skills.

---

## Key Features

- **Trait Vector Matching (TVM)** -- 128-dimensional semantic fingerprinting that matches skills to queries purely algorithmically, no LLM or external embeddings needed
- **skill.md format** -- Human-readable Markdown with YAML frontmatter for skill definitions, version-controllable and hand-authorable
- **Scoring pipeline** -- Three-phase matching: cosine similarity + tag boosting + capability verb matching - anti-pattern penalties, all with configurable weights
- **In-memory registry** -- Four parallel index structures (primary, tag, verb, vector) for O(1) lookups by any access pattern
- **File system + npm discovery** -- Recursively scan directories and `node_modules` for `skill.md` files, with hot-reload via `fs.watch`
- **Auto-generation** -- Convert raw tool definitions (MCP servers, built-in tools) into full skill manifests with verb/object extraction and tag inference
- **Validation** -- Check manifests for required fields, structural invariants, and optional quality improvements
- **VidyaBridge** -- Integration bridge between the skill registry and the agent system for real-time skill recommendation
- **Skill Evolution** -- Online gradient descent on trait vectors, Thompson Sampling + Dreyfus model, health scoring with composite metrics, auto-deprecation, and fusion detection
- **Pancha Kosha** -- Five-sheath quality assessment (structural, runtime, documentation, strategic, mastery) with weighted composite scoring
- **Ashrama lifecycle** -- Four-stage lifecycle state machine (brahmacharya/grihastha/vanaprastha/sannyasa) with hysteresis-based transitions to prevent oscillation
- **Kula registry** -- Three-tier priority registry (antara/bahya/shiksha) with shadowing: core skills override community, community overrides learned
- **Parampara trust chains** -- Merkle-inspired SHA-256 hash chains for tamper-evident skill provenance tracking with trust scoring
- **Samskara usage bridge** -- Collects usage impressions, maintains Dreyfus mastery levels, detects preference overrides via Wilson confidence intervals
- **Yoga composition** -- Auto-discovers skill compositions from co-occurrence and mutual information (karma/shakti/tantra types)
- **Vamsha evolutionary tracking** -- Records mutations, speciations, symbiosis, extinctions; platform-aware variant detection
- **Suraksha security scanner** -- Deep static analysis across 8 threat categories with Shannon entropy and identifier ratio heuristics
- **Pariksha ingestion pipeline** -- Wires scan + quarantine + staging + promotion + evolution tracking into a single flow with event emission
- **Pratiksha staging** -- Filesystem-based quarantine with 0o700/0o600 permissions, symlink-safe operations, human-readable review files
- **Skill Crystallization** -- Transforms mature Vidhi procedures into Vidhya skills via identify/synthesize/scan/test/approve/register pipeline with Thompson Sampling
- **Shiksha autonomous learning** -- Zero-cost NLU gap detection, 6-tier cascading sourcer, skill builder, cloud-aware extension
- **Setu skill porter** -- Bidirectional conversion between Chitragupta vidhya, Claude Code SKILL.md, and Gemini CLI extension.json formats
- **Vidya Orchestrator** -- Unified lifecycle controller (Sutradhara) orchestrating all subsystems with state persistence

## Architecture

| Module | Purpose |
|--------|---------|
| `types.ts` | `SkillManifest`, `SkillCapability`, `SkillQuery`, `SkillMatch`, `ValidationResult`, `SkillSource` |
| `types-v2.ts` | `EnhancedSkillManifest`, `PanchaKoshaScores`, `AshramamStage`, `KulaType`, `ParamparaLink`, `YogaComposition`, `VamshaLineage`, `DreyfusLevel` |
| `fingerprint.ts` | TVM algorithm -- `computeTraitVector`, `computeQueryVector`, `fnv1a`, L2 normalization |
| `buckets.ts` | Eight bucket computation functions (name n-grams, description tokens, parameter types, tag hashes, capability verbs, IO schema shape, example patterns, metadata signals) |
| `parser.ts` | `parseSkillMarkdown`, `parseFrontmatter`, `parseCapabilitiesSection`, `parseExamplesSection` |
| `writer.ts` | `writeSkillMarkdown`, `writeFrontmatter` -- inverse of the parser |
| `matcher.ts` | `matchSkills`, `cosineSimilarityF32`, `rankAndFilter` -- three-phase scoring pipeline with context-aware matching |
| `registry.ts` | `SkillRegistry` -- in-memory store with secondary indices (by tag, verb, vector) |
| `discovery.ts` | `SkillDiscovery` -- directory scanning, npm package scanning, file watching |
| `generator.ts` | `generateSkillFromTool`, `generateSkillsFromTools`, `extractVerbObject` -- auto-generation from tool definitions |
| `validator.ts` | `validateSkill`, `validateSkillMarkdown` -- completeness and correctness checking |
| `bridge.ts` | `VidyaBridge` -- agent-facing skill recommendation and tool registration |
| `skill-evolution.ts` | `SkillEvolution` -- online learning with Thompson Sampling + Dreyfus model, health scoring, deprecation, fusion suggestions |
| `pancha-kosha.ts` | `buildPanchaKosha`, `checkPranamaya`, `clearPranamayaCache` -- five-sheath quality assessment |
| `ashrama.ts` | `AshramamMachine`, `createInitialState` -- lifecycle state machine with hysteresis |
| `kula.ts` | `KulaRegistry` -- three-tier priority skill registry with shadowing |
| `parampara.ts` | `createChain`, `appendLink`, `verifyChain`, `computeTrust`, `computeContentHash` -- Merkle-inspired trust provenance |
| `samskara-skill.ts` | `SamskaraSkillBridge` -- usage impression collection, Dreyfus mastery tracking, preference detection |
| `yoga.ts` | `YogaEngine` -- skill composition discovery via co-occurrence and mutual information |
| `vamsha.ts` | `VamshaTracker` -- evolutionary biology: mutations, speciations, symbiosis, extinctions, platform variants |
| `suraksha.ts` | `SurakshaScanner` -- deep static security analysis across 8 threat categories |
| `skill-sandbox.ts` | `SkillSandbox` -- quarantine for skill mutations with health-gated promotion |
| `pratiksha.ts` | `PratikshaManager` -- filesystem staging area with 0o700/0o600 permissions |
| `pariksha.ts` | `ParikshaOrchestrator` -- ingestion pipeline wiring scan + quarantine + staging + promotion |
| `crystallization.ts` | `SkillCrystallizer` -- transforms mature Vidhi procedures into skills with Thompson Sampling |
| `porter.ts` | `SkillPorter` -- bidirectional conversion between Chitragupta, Claude Code, and Gemini formats |
| `vidya-orchestrator.ts` | `VidyaOrchestrator` (Sutradhara) -- unified lifecycle controller for the entire skill ecosystem |
| `shiksha/vimarsh.ts` | Zero-cost NLU analysis with UTILITY_MAP (6 domains, ~55 utilities) |
| `shiksha/praptya.ts` | 6-tier cascading sourcer: builtin, shell, cloud-recipe, npm, github, code-gen |
| `shiksha/nirmana.ts` | Skill builder: manifest generation, typed implementations (shell/tool-chain/typescript/llm-chain) |
| `shiksha/controller.ts` | `ShikshaController` -- orchestrates gap detection, analysis, sourcing, building, scanning, approval |
| `shiksha/megha.ts` | Cloud-aware extension: 5 providers, 10 service categories, 15 pre-built recipes |

## API

### Fingerprinting (TVM)

The core innovation. Eight semantic buckets, each contributing 16 dimensions, are concatenated and L2-normalized into a unit-length 128-dimensional trait vector.

| Bucket | Dims | Feature | Shiksha Analogy |
|--------|------|---------|-----------------|
| 0 | 0-15 | Name N-grams | Varna (letter form) |
| 1 | 16-31 | Description Tokens | Artha (meaning) |
| 2 | 32-47 | Parameter Types | Vyakarana (grammar) |
| 3 | 48-63 | Tag Hashes | Jati (category) |
| 4 | 64-79 | Capability Verbs | Kriya (action) |
| 5 | 80-95 | IO Schema Shape | Rupa (form) |
| 6 | 96-111 | Example Patterns | Prayoga (usage) |
| 7 | 112-127 | Metadata Signals | Lakshana (characteristics) |

```typescript
import {
	computeTraitVector,
	computeQueryVector,
	fnv1a,
	TRAIT_DIMENSIONS,
	BUCKET_SIZE,
} from "@chitragupta/vidhya-skills";

// Compute a 128-dimensional trait vector for a skill manifest
const vector = computeTraitVector(mySkillManifest);
console.log(vector.length);  // 128
console.log(vector instanceof Float32Array);  // true

// Compute a query vector from natural language
const queryVec = computeQueryVector({ text: "read a typescript file" });

// FNV-1a hash for dimension mapping
const hash = fnv1a("read");
const bucketIdx = hash % BUCKET_SIZE;  // Maps to one of 16 dims
```

**Mathematical formulation:**

```
T = L2_normalize(concat(B_0, B_1, ..., B_7))

B_i[fnv1a(feature) mod 16] += weight(feature)

sim(T_a, T_b) = T_a . T_b    (since ||T|| = 1)
```

### Parsing and Writing skill.md

The skill.md format uses YAML frontmatter for structured metadata and Markdown body sections for capabilities, examples, and anti-patterns. The YAML parser is hand-rolled with no external dependencies.

```typescript
import {
	parseSkillMarkdown,
	writeSkillMarkdown,
	parseFrontmatter,
} from "@chitragupta/vidhya-skills";

// Parse a skill.md file into a SkillManifest
const manifest = parseSkillMarkdown(`---
name: file-reader
version: 1.0.0
description: Read files from the local filesystem
tags: [filesystem, read, file]
source:
  type: tool
  toolName: read_file
updatedAt: 2026-02-05T00:00:00Z
---

## Capabilities

### read / files
Read the contents of a file at a given path.

## Examples

- **Read a config file**: \`{ "path": "config.json" }\`
`);

console.log(manifest.name);  // "file-reader"
console.log(manifest.capabilities[0].verb);  // "read"

// Write a manifest back to skill.md format
const markdown = writeSkillMarkdown(manifest);
```

### Matching Skills

The matching pipeline computes trait vector similarity, then applies tag boosting, capability verb matching, and anti-pattern penalties.

**Scoring formula:**

```
score = clamp(
  0.6 * traitSimilarity
  + 0.15 * tagBoost
  + 0.15 * capabilityMatch
  - 0.3 * antiPatternPenalty,
  0, 1
)
```

```typescript
import { matchSkills, cosineSimilarityF32 } from "@chitragupta/vidhya-skills";
import type { SkillMatch } from "@chitragupta/vidhya-skills";

// Match skills against a natural language query
const matches: SkillMatch[] = matchSkills(
	{ text: "read a typescript file", tags: ["filesystem"], topK: 5, threshold: 0.1 },
	allSkillManifests,
);

console.log(matches[0].skill.name);                // "file-reader"
console.log(matches[0].score);                      // 0.87
console.log(matches[0].breakdown.traitSimilarity);  // 0.72
console.log(matches[0].breakdown.tagBoost);          // 1.0
console.log(matches[0].breakdown.capabilityMatch);   // 0.8
console.log(matches[0].breakdown.antiPatternPenalty); // 0.0

// Raw cosine similarity between two Float32Arrays
const sim = cosineSimilarityF32(vectorA, vectorB);
```

### Registry

In-memory skill registry with four parallel index structures for O(1) lookups.

```typescript
import { SkillRegistry } from "@chitragupta/vidhya-skills";

const registry = new SkillRegistry();

// Register skills (trait vectors are auto-computed if missing)
registry.register(fileReaderSkill);
registry.register(codeAnalyzerSkill);

// Query by natural language
const matches = registry.query({ text: "read a file" });
console.log(matches[0].skill.name);  // "file-reader"

// Direct lookup by name
const skill = registry.get("file-reader");

// Lookup by tag (O(1) via secondary index)
const fsSkills = registry.getByTag("filesystem");

// Lookup by capability verb (O(1) via secondary index)
const readers = registry.getByVerb("read");

// Registry stats
console.log(registry.size);  // 2

// Unregister a skill (cleans all indices)
registry.unregister("code-analyzer");

// Clear everything
registry.clear();
```

### Discovery

Scan directories and npm packages for `skill.md` files, with hot-reload support.

```typescript
import { SkillDiscovery } from "@chitragupta/vidhya-skills";
import type { SkillChangeEvent } from "@chitragupta/vidhya-skills";

const discovery = new SkillDiscovery();

// Discover all skill.md files in a directory tree
const skills = await discovery.discoverFromDirectory("./skills");

// Discover from npm packages with "chitragupta-skill" keyword
const npmSkills = await discovery.discoverFromNodeModules("./my-project");

// Discover from multiple paths at once
const allSkills = await discovery.discoverAll([
	"./skills",
	"./plugins",
	"./my-project",
]);

// Watch a directory for skill.md changes (hot-reload)
const stopWatching = discovery.watchDirectory("./skills", (event: SkillChangeEvent) => {
	console.log(event.type);      // "added" | "changed" | "removed"
	console.log(event.filePath);  // Absolute path to the skill.md
	if (event.manifest) {
		registry.register(event.manifest);
	}
});

// Later: stop watching
stopWatching();

// Or stop all watchers at once
discovery.stopWatching();
```

### Generator

Auto-generate skill manifests from raw tool definitions. Handles `snake_case`, `kebab-case`, `camelCase`, and `PascalCase` tool names.

```typescript
import {
	generateSkillFromTool,
	generateSkillsFromTools,
	extractVerbObject,
} from "@chitragupta/vidhya-skills";
import type { ToolDefinition } from "@chitragupta/vidhya-skills";

// Generate a full SkillManifest from a tool definition
const skill = generateSkillFromTool({
	name: "read_file",
	description: "Read the contents of a file at a given path",
	inputSchema: {
		type: "object",
		properties: {
			path: { type: "string", description: "File path" },
		},
		required: ["path"],
	},
});

console.log(skill.capabilities[0].verb);    // "read"
console.log(skill.capabilities[0].object);  // "file"
console.log(skill.tags);                     // ["read", "file", "filesystem"]
console.log(skill.traitVector?.length);      // 128

// Batch generate from multiple tools
const skills = generateSkillsFromTools(allToolDefs);

// Extract verb/object from any naming convention
extractVerbObject("read_file");         // { verb: "read", object: "file" }
extractVerbObject("searchCode");        // { verb: "search", object: "code" }
extractVerbObject("list-directories");  // { verb: "list", object: "directories" }
extractVerbObject("grep");              // { verb: "grep", object: "content" }
```

### Validator

Check manifests for required fields, structural invariants, and optional quality improvements.

```typescript
import {
	validateSkill,
	validateSkillMarkdown,
} from "@chitragupta/vidhya-skills";
import type { ValidationResult } from "@chitragupta/vidhya-skills";

// Validate a SkillManifest object
const result: ValidationResult = validateSkill(myManifest);

if (!result.valid) {
	for (const err of result.errors) {
		console.error(`ERROR ${err.field}: ${err.message}`);
	}
}

for (const warn of result.warnings) {
	console.warn(`WARN ${warn.field}: ${warn.message}`);
	if (warn.suggestion) {
		console.warn(`  -> ${warn.suggestion}`);
	}
}

// Validate directly from raw skill.md content (parse + validate)
const mdResult = validateSkillMarkdown(rawSkillMdContent);
```

**Required fields (produce errors):** `name`, `version` (semver), `description`, `capabilities` (non-empty, each with verb + object), `tags` (non-empty), `source` (valid discriminated union).

**Optional checks (produce warnings):** missing examples, empty anti-patterns, missing inputSchema, very short description, missing author, duplicate tags, capability without description.

### VidyaBridge

Integration bridge between the skill registry and the agent system. Mediates between the agent's intent and the system's capabilities.

```typescript
import { VidyaBridge, SkillRegistry } from "@chitragupta/vidhya-skills";

const registry = new SkillRegistry();
const bridge = new VidyaBridge(registry);

// Register all available tools as skills
bridge.registerToolsAsSkills([
	{ name: "read_file", description: "Read a file", inputSchema: { ... } },
	{ name: "write_file", description: "Write a file", inputSchema: { ... } },
	{ name: "grep", description: "Search file contents", inputSchema: { ... } },
]);

// Register MCP server tools with source attribution
bridge.registerMCPServerTools("server-1", "My MCP Server", mcpTools);

// Agent asks: "I need to read a configuration file"
const match = bridge.recommendSkill("read a configuration file");
if (match) {
	console.log(match.skill.name);  // "read_file"
	console.log(match.score);        // 0.85
}

// Get multiple recommendations
const topMatches = bridge.recommendSkills("search for TODO comments", 3);

// Look up skill metadata for a known tool
const skillInfo = bridge.getSkillForTool("read_file");

// Stats
console.log(bridge.registeredCount);  // 3

// Teardown
bridge.unregisterAll();
```

### Skill Evolution

Skills that evolve -- learning from usage via online gradient descent on the 128-dimensional trait space. Tracks match/use/reject events, computes health scores, detects deprecation candidates, and suggests skill fusions.

```typescript
import { SkillEvolution } from "@chitragupta/vidhya-skills";
import type {
	SkillHealthReport,
	SkillEvolutionState,
	FusionSuggestion,
} from "@chitragupta/vidhya-skills";

const evolution = new SkillEvolution(0.05);  // learning rate

// Record events as they happen
evolution.recordMatch("file-reader", "read a config file", 0.85);
evolution.recordUsage("file-reader", true, "config-editing");
evolution.recordReject("code-analyzer");  // Matched but not used

// Evolve the trait vector toward actual usage patterns
// v_new = L2_normalize((1 - lr) * v_old + lr * v_query)
evolution.evolveTraitVector("file-reader", queryVector);
const evolved = evolution.getEvolvedVector("file-reader");

// End a session to flush co-occurrence data
evolution.flushSession();

// Health scoring
const health: SkillHealthReport = evolution.getSkillHealth("file-reader");
console.log(health.health);          // 0.72
console.log(health.useRate);         // uses / matches
console.log(health.successRate);     // successes / uses
console.log(health.freshnessScore);  // 1 / (1 + daysSinceLastUse)
console.log(health.diversityScore);  // uniqueContexts / totalUses
console.log(health.flaggedForReview);  // true if health < 0.1 after 50+ matches

// Full evolution report (sorted by health ascending -- worst first)
const report = evolution.getEvolutionReport();

// Deprecation candidates
const deprecated = evolution.getDeprecationCandidates();

// Fusion suggestions (skills with >60% co-occurrence rate)
const fusions: FusionSuggestion[] = evolution.suggestFusions();
for (const f of fusions) {
	console.log(`Merge ${f.skillA} + ${f.skillB}: ${f.reason}`);
}

// Serialize for persistence
const state: SkillEvolutionState = evolution.serialize();

// Restore from serialized state
const restored = SkillEvolution.deserialize(state);
```

**Health formula:**

```
health = useRate * 0.4 + successRate * 0.3 + freshness * 0.2 + diversity * 0.1
```

**Auto-deprecation:** Skills with `health < 0.1` after `50+` matches are flagged for review.

**Fusion detection:** When two skills have a co-occurrence rate exceeding `60%` (used together in `10+` sessions), they are suggested for merging.

## Vidya-Tantra Ecosystem

The Vidya-Tantra ecosystem extends the core skill system with seven interconnected subsystems, each named after a Vedic concept.

### Pancha Kosha -- Five-Sheath Quality Assessment

Inspired by the Taittiriya Upanishad's model of the five sheaths (koshas) enveloping the atman, each skill is assessed across five layers:

| Sheath | Sanskrit | Assessment | Weight |
|--------|----------|------------|--------|
| Annamaya | अन्नमय (Physical) | Structural completeness, security scan results | 0.25 |
| Pranamaya | प्राणमय (Vital) | Runtime requirements: binaries, env vars, OS, privileges | 0.20 |
| Manomaya | मनोमय (Mental) | Documentation quality: description, examples, anti-patterns | 0.20 |
| Vijnanamaya | विज्ञानमय (Wisdom) | Strategic guidance: related skills, migration paths | 0.15 |
| Anandamaya | आनन्दमय (Bliss) | Mastery through experience: Dreyfus level, success rate | 0.20 |

```typescript
import { buildPanchaKosha, checkPranamaya } from "@chitragupta/vidhya-skills";

// Build a complete quality assessment
const scores = buildPanchaKosha(manifest, scanResult);
console.log(scores.annamaya);    // 0.85 (structural)
console.log(scores.pranamaya);   // 1.0  (runtime OK)
console.log(scores.manomaya);    // 0.7  (docs quality)
console.log(scores.vijnanamaya); // 0.5  (no wisdom metadata yet)
console.log(scores.anandamaya);  // 0.3  (novice mastery)
console.log(scores.composite);   // weighted average

// Check runtime requirements before execution
const check = checkPranamaya(requirements);
if (!check.satisfied) {
	console.log("Missing binaries:", check.missing.bins);
	console.log("Missing env vars:", check.missing.env);
}
```

### Ashrama -- Lifecycle State Machine

Inspired by the four ashramas of the Vedic lifecycle. Skills progress through stages based on health, usage, and maturity, with hysteresis to prevent oscillation.

```
brahmacharya (student) --> grihastha (active) --> vanaprastha (deprecated) --> sannyasa (archived)
```

```typescript
import { AshramamMachine, createInitialState } from "@chitragupta/vidhya-skills";

const machine = new AshramamMachine();
const state = createInitialState("brahmacharya");

// Evaluate transitions based on health score and inactivity
const newState = machine.evaluate(state, 0.85, 0); // high health -> promote to grihastha
console.log(newState.stage); // "grihastha"

// Hysteresis prevents rapid oscillation:
// promote threshold: 0.7, demote threshold: 0.3 (configurable)
```

### Kula -- Tiered Priority Registry

Three-tier registry where core skills shadow community skills, which shadow auto-learned skills.

```typescript
import { KulaRegistry } from "@chitragupta/vidhya-skills";

const kula = new KulaRegistry();

kula.register(coreSkill, "antara");    // Built-in, highest priority
kula.register(communitySkill, "bahya"); // Community, medium priority
kula.register(learnedSkill, "shiksha"); // Auto-generated, lowest priority

// Resolve uses priority shadowing
const resolved = kula.resolve("file-reader"); // Returns antara version if exists
const all = kula.resolveAll(); // All skills, highest priority per name
```

### Parampara -- Trust Provenance Chains

Merkle-inspired SHA-256 hash chains that record every action taken on a skill, providing tamper-evident provenance tracking and trust scoring.

```typescript
import {
	createChain,
	appendLink,
	verifyChain,
	computeTrust,
	computeContentHash,
} from "@chitragupta/vidhya-skills";

// Create a genesis chain
const chain = createChain("file-reader", "system", computeContentHash(content));

// Append actions
appendLink(chain, "scanned", "suraksha", contentHash);
appendLink(chain, "reviewed", "human-admin", contentHash);

// Verify integrity (detect tampering)
const integrity = verifyChain(chain);
console.log(integrity.valid); // true

// Compute trust score
const trust = computeTrust(chain, "antara");
console.log(trust.score);  // 0.0-1.0
console.log(trust.level);  // "untrusted" | "low" | "medium" | "high" | "verified"
```

### Samskara -- Usage Impression Bridge

Connects SkillEvolution, Samskaara Consolidation (smriti), and Chetana Self-Model (anina) via usage impressions. Tracks Dreyfus mastery levels and detects preference overrides using Wilson confidence intervals.

```typescript
import { SamskaraSkillBridge } from "@chitragupta/vidhya-skills";

const bridge = new SamskaraSkillBridge({
	onMasteryChange: (name, mastery) => {
		console.log(`${name} is now ${mastery.dreyfusLevel}`);
	},
	onPreferenceDetected: (preferred, over, confidence) => {
		console.log(`Prefers ${preferred} over ${over} (${confidence})`);
	},
});

// Record a usage impression
bridge.recordImpression("file-reader", {
	timestamp: Date.now(),
	sessionId: "sess-1",
	context: "config-editing",
	success: true,
	latencyMs: 42,
	overrodeSkill: "legacy-reader",
});

// Get mastery state
const mastery = bridge.getMastery("file-reader");
console.log(mastery.dreyfusLevel); // "novice" | "advanced_beginner" | "competent" | "proficient" | "expert"
console.log(mastery.wilsonLower);  // Lower bound of Wilson CI
```

### Yoga -- Skill Composition

Discovers and manages skill compositions from usage patterns. Three composition types inspired by paths of Yoga.

| Type | Sanskrit | Pattern |
|------|----------|---------|
| Karma | कर्म (Action) | Sequential execution -- A then B then C |
| Shakti | शक्ति (Power) | Parallel execution -- A and B and C |
| Tantra | तन्त्र (Technique) | Conditional branching -- if X then A else B |

```typescript
import { YogaEngine } from "@chitragupta/vidhya-skills";

const yoga = new YogaEngine();

// Feed session data for co-occurrence detection
yoga.recordSession(["read_file", "grep", "write_file"]);
yoga.recordSession(["read_file", "grep", "write_file"]);

// Discover compositions from patterns
const compositions = yoga.discoverCompositions();
for (const comp of compositions) {
	console.log(`${comp.name}: ${comp.type} [${comp.skills.join(" -> ")}]`);
}
```

### Vamsha -- Evolutionary Biology

Tracks the lineage and evolution of skills over time. Records mutations (version updates), speciations (platform-specific variants), symbiosis (frequently co-used skills), and extinctions (abandoned skills).

```typescript
import { VamshaTracker } from "@chitragupta/vidhya-skills";

const vamsha = new VamshaTracker();

// Record a version mutation
vamsha.recordMutation("file-reader", "2.0.0", "Added async streaming");

// Record speciation (platform variant)
vamsha.recordSpeciation("file-reader", "file-reader-win32", "Windows-specific paths");

// Record symbiosis
vamsha.recordSymbiosis("read_file", "write_file", 0.85);

// Get full lineage
const lineage = vamsha.getLineage("file-reader");
console.log(lineage.variants);   // ["file-reader-win32"]
console.log(lineage.symbionts);  // ["write_file"]
console.log(lineage.ancestor);   // null (root species)
```

## Suraksha -- Deep Security Scanner

Eight threat categories scanned before any skill enters the ecosystem. Zero external dependencies.

| ID | Category | Severity | Detection |
|----|----------|----------|-----------|
| T1 | Prompt Injection | critical | LLM manipulation attempts |
| T2 | Code Injection | block | eval(), Function(), require() |
| T3 | Proto Pollution | block | __proto__, constructor.prototype |
| T4 | Network Exfil | block | fetch(), http.request(), WebSocket |
| T5 | FS Escape | block | Path traversal, symlinks, /etc/ |
| T6 | Env Probing | critical | process.env, os.userInfo() |
| T7 | Supply Chain | warning | postinstall, curl\|bash |
| T8 | Dynamic Exec | block | setTimeout('str'), WebAssembly |

**Heuristics:**
- Shannon entropy: string literals >50 chars with entropy >4.5 bits/char flag as possible obfuscated payloads
- Identifier ratio: >60% single-char variable names suggest minification or obfuscation

## Skill Crystallization (Sphateekarana)

Transforms mature Vidhi procedures (from `@chitragupta/smriti`) into polished Vidhya skills. When a Vidhi procedure reaches sufficient confidence, success rate, and execution count, it is "crystallized" through a six-stage pipeline.

**Pipeline:**
```
1. Identify   -- Scan Vidhis for crystallization candidates (threshold gating)
2. Synthesize -- Generate a tool-chain implementation from Vidhi steps
3. Scan       -- Security analysis (Suraksha-lite: network, FS, creds, exec, loops)
4. Test       -- Structural validation (parse, tool existence, param types)
5. Approve    -- Manual or auto-approval gating
6. Register   -- Insert into the skill registry
```

**Thompson Sampling:** Each crystallized skill carries a Beta(alpha, beta) distribution for exploration-exploitation tracking. Successes increment alpha, failures increment beta. Skills whose posterior mean drops below the deprecation threshold (default 0.3) are auto-deprecated.

```typescript
import { SkillCrystallizer } from "@chitragupta/vidhya-skills";
import type {
	CrystallizationCandidate,
	CrystallizedSkill,
} from "@chitragupta/vidhya-skills";

const crystallizer = new SkillCrystallizer({
	minVidhiConfidence: 0.8,
	minSuccessRate: 0.7,
	minExecutions: 5,
	autoRegister: false,
	deprecationThreshold: 0.3,
});

// Identify candidates from Vidhi procedures
const candidates: CrystallizationCandidate[] = crystallizer.identifyCandidates(vidhis);

// Run the full pipeline on a candidate
const skill: CrystallizedSkill = await crystallizer.crystallize(candidate);
console.log(skill.status);          // "approved" | "registered" | "failed"
console.log(skill.thompsonAlpha);   // Beta distribution alpha
console.log(skill.thompsonBeta);    // Beta distribution beta

// Record execution outcomes (updates Thompson Sampling)
crystallizer.recordSuccess(skill.id);
crystallizer.recordFailure(skill.id);

// Check for auto-deprecation (posterior mean < threshold)
const deprecated = crystallizer.checkDeprecation();
```

## Shiksha -- Autonomous Skill Learning

When the system encounters a gap (a request with no matching skill), Shiksha autonomously discovers, builds, and registers new skills.

```typescript
import { ShikshaController } from "@chitragupta/vidhya-skills";

const controller = new ShikshaController({
	enableAutoApproval: true,
	enableCloud: true,
});

// The controller runs the full pipeline:
// NLU analysis -> source discovery -> skill building -> security scan -> approval -> execution -> registration
const result = await controller.learn("compress a directory into a tar.gz");
console.log(result.skill?.name);  // "compress-directory"
console.log(result.source);       // "shell" | "npm" | "cloud-recipe" | ...
```

## Setu -- Cross-Format Skill Porter

Bidirectional conversion between Chitragupta's vidhya format and external skill ecosystems.

```typescript
import { SkillPorter } from "@chitragupta/vidhya-skills";

const porter = new SkillPorter();

// Detect format from content
const format = porter.detectFormat(content); // "vidhya" | "claude" | "gemini"

// Convert Claude Code SKILL.md to Vidhya format
const vidhyaSkill = porter.fromClaude(claudeSkillMd);

// Convert Vidhya to Gemini CLI extension format
const geminiJson = porter.toGemini(vidhyaManifest);

// Round-trip: vidhya -> claude -> vidhya (lossless for shared fields)
const claudeMd = porter.toClaude(vidhyaManifest);
const roundTripped = porter.fromClaude(claudeMd);
```

## Vidya Orchestrator (Sutradhara)

The unified lifecycle controller that orchestrates all Vidya-Tantra subsystems. Named after the Sutradhara ("string-holder"), the puppet master in Sanskrit drama who controls all actors from behind the stage.

```typescript
import { VidyaOrchestrator } from "@chitragupta/vidhya-skills";

const orchestrator = new VidyaOrchestrator({
	registry, bridge, surakshaScanner, shikshaController,
});

await orchestrator.initialize();

// Lifecycle hooks (called from CLI/Agent loop)
orchestrator.onToolRegistered("read_file", toolDef);
orchestrator.onSkillExecuted("file-reader", true, 42);
orchestrator.onSkillMatched("file-reader", "read a file", 0.85);
orchestrator.onSessionEnd();

// Evaluate all skill lifecycles (Ashrama transitions)
const transitions = orchestrator.evaluateLifecycles();

// Get ecosystem stats
const stats = orchestrator.getEcosystemStats();
console.log(stats.totalSkills, stats.activeSkills, stats.compositions);

// Persist and restore state (atomic write: tmp -> rename)
await orchestrator.persist(".chitragupta/vidya-state.json");
await orchestrator.restore(".chitragupta/vidya-state.json");
```

---

[Back to Chitragupta root](../../README.md)
