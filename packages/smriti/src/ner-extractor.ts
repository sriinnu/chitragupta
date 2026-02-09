/**
 * Naama — Named Entity Recognition for GraphRAG.
 *
 * Named "Naama" (Sanskrit: नाम — name). Identifying and naming
 * the entities that exist within text.
 *
 * Two modes:
 * - GLiNER2: Local NER model via HTTP API (zero cloud cost)
 * - Heuristic: Regex-based fallback (always available)
 *
 * Used by GraphRAG to auto-extract nodes from conversation turns:
 * people, tools, files, concepts, decisions, errors, etc.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Supported entity categories for NER extraction. */
export type EntityType =
  | "person"
  | "tool"
  | "file"
  | "concept"
  | "decision"
  | "error"
  | "technology"
  | "action"
  | "location"
  | "organization";

/** A single entity extracted from text. */
export interface ExtractedEntity {
  /** The raw surface form found in text. */
  text: string;
  /** Classified entity type. */
  type: EntityType;
  /** Confidence score in [0, 1]. GLiNER2 typically yields 0.8+; heuristics yield 0.6. */
  confidence: number;
  /** Character offsets [start, end) within the source text. */
  span: [number, number];
}

/** Configuration for the NER extractor. */
export interface NERConfig {
  /** GLiNER2 HTTP endpoint. Default: "http://localhost:8501". */
  glinerEndpoint?: string;
  /** GLiNER2 model name. Default: "gliner-large-v2.1". */
  glinerModel?: string;
  /** Entity types to extract. Default: all EntityType values. */
  entityTypes?: EntityType[];
  /** Minimum confidence to include an entity. Default: 0.5. */
  minConfidence?: number;
  /** Maximum entities to return per text. Default: 50. */
  maxEntities?: number;
  /** Whether to use heuristic fallback when GLiNER2 is unavailable. Default: true. */
  useHeuristic?: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_ENDPOINT = "http://localhost:8501";
const DEFAULT_MODEL = "gliner-large-v2.1";
const DEFAULT_MIN_CONFIDENCE = 0.5;
const DEFAULT_MAX_ENTITIES = 50;
const GLINER_TIMEOUT_MS = 10_000;
const GLINER_PROBE_TIMEOUT_MS = 3_000;

/** All supported entity types. */
const ALL_ENTITY_TYPES: EntityType[] = [
  "person", "tool", "file", "concept", "decision",
  "error", "technology", "action", "location", "organization",
];

/**
 * Maps GLiNER2 label conventions to our EntityType.
 * GLiNER2 may return labels in various formats; we normalize them.
 */
const GLINER_LABEL_MAP: Record<string, EntityType> = {
  // Standard NER tags
  per: "person",
  person: "person",
  org: "organization",
  organization: "organization",
  loc: "location",
  location: "location",
  gpe: "location",
  // Our custom labels (sent as GLiNER request labels)
  tool: "tool",
  file: "file",
  concept: "concept",
  decision: "decision",
  error: "error",
  technology: "technology",
  action: "action",
};

// ─── Heuristic Patterns ──────────────────────────────────────────────────────

/** Confidence assigned to heuristic matches (lower than GLiNER2's typical 0.8+). */
const HEURISTIC_CONFIDENCE = 0.6;

/** File path pattern: /foo/bar.ts, ./src/index.ts, package.json, etc. */
const FILE_PATTERN = /(?:^|[\s"'`(])([./][\w/.-]+\.\w{1,10})\b/g;

/**
 * Technology keywords. Matched case-insensitively as whole words.
 * Sorted alphabetically for maintainability.
 */
const TECHNOLOGY_WORDS = [
  "angular", "aws", "azure", "bash", "bun", "c\\+\\+", "css", "deno",
  "docker", "elasticsearch", "express", "fastify", "firebase", "git",
  "go", "golang", "graphql", "html", "java", "javascript", "jest",
  "kafka", "kotlin", "kubernetes", "linux", "mongodb", "mysql", "nest",
  "next\\.js", "nextjs", "node", "node\\.js", "nodejs", "npm",
  "ollama", "postgres", "postgresql", "prisma", "python", "react",
  "redis", "rust", "sql", "svelte", "swift", "terraform", "typescript",
  "vite", "vitest", "vue", "webpack", "yarn", "zod",
];
const TECHNOLOGY_PATTERN = new RegExp(
  `\\b(${TECHNOLOGY_WORDS.join("|")})\\b`,
  "gi",
);

/** Chitragupta tool names. */
const TOOL_WORDS = [
  "read", "write", "edit", "bash", "grep", "find", "ls", "diff", "watch",
  "glob", "notebookedit", "webfetch", "websearch",
];
const TOOL_PATTERN = new RegExp(
  `\\b(${TOOL_WORDS.join("|")})\\b`,
  "gi",
);

/** Error patterns: "Error:", "failed to", "TypeError", "ENOENT", etc. */
const ERROR_PATTERN =
  /\b((?:[A-Z]\w*Error)\b|(?:ENOENT|EACCES|ECONNREFUSED|ETIMEDOUT|EPERM)\b|(?:failed\s+to\s+\w+)|(?:error:\s*\S+))/gi;

/** Decision phrases: "decided to", "chose", "selected", "switched to", "migrated to". */
const DECISION_PATTERN =
  /\b((?:decided|chose|selected|opted|switched|migrated|moved)\s+to\s+\w[\w\s]{0,30})/gi;

/** Action phrases: "created", "deleted", "modified", "installed", "deployed", "fixed", etc. */
const ACTION_PATTERN =
  /\b((?:created|deleted|removed|modified|updated|installed|uninstalled|deployed|fixed|refactored|renamed|merged|rebased|reverted|committed|pushed|pulled)\s+\w[\w\s]{0,30})/gi;

/**
 * Concept pattern: Capitalized multi-word phrases (2-4 words), e.g. "Agent Identity", "Policy Engine".
 * Only matched when not already captured by other patterns.
 */
const CONCEPT_PATTERN = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g;

// ─── NERExtractor Class ──────────────────────────────────────────────────────

export class NERExtractor {
  private readonly endpoint: string;
  private readonly model: string;
  private readonly entityTypes: EntityType[];
  private readonly minConfidence: number;
  private readonly maxEntities: number;
  private readonly useHeuristic: boolean;

  /** Cached GLiNER2 availability probe result (null = not yet probed). */
  private glinerAvailable: boolean | null = null;

  constructor(config: NERConfig = {}) {
    this.endpoint = config.glinerEndpoint ?? DEFAULT_ENDPOINT;
    this.model = config.glinerModel ?? DEFAULT_MODEL;
    this.entityTypes = config.entityTypes ?? ALL_ENTITY_TYPES;
    this.minConfidence = config.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    this.maxEntities = config.maxEntities ?? DEFAULT_MAX_ENTITIES;
    this.useHeuristic = config.useHeuristic ?? true;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Extract entities from text.
   * Tries GLiNER2 first; falls back to heuristic if GLiNER2 is unavailable
   * and `useHeuristic` is enabled.
   */
  async extract(text: string): Promise<ExtractedEntity[]> {
    if (!text || text.trim().length === 0) return [];

    // Try GLiNER2 first
    const glinerUp = await this.isGLiNERAvailable();
    if (glinerUp) {
      try {
        const entities = await this.extractViaGLiNER(text);
        return this.postProcess(entities);
      } catch {
        // GLiNER2 request failed; fall through to heuristic
      }
    }

    // Heuristic fallback
    if (this.useHeuristic) {
      const entities = this.extractViaHeuristic(text);
      return this.postProcess(entities);
    }

    return [];
  }

  /**
   * Extract entities from multiple texts in batch.
   * Each text is processed independently; results are returned in order.
   */
  async extractBatch(texts: string[]): Promise<ExtractedEntity[][]> {
    // Process all texts concurrently
    return Promise.all(texts.map((t) => this.extract(t)));
  }

  /**
   * Probe whether GLiNER2 is reachable at the configured endpoint.
   * Caches the result after the first successful probe.
   */
  async isGLiNERAvailable(): Promise<boolean> {
    if (this.glinerAvailable !== null) return this.glinerAvailable;

    try {
      const response = await fetch(this.endpoint, {
        method: "GET",
        signal: AbortSignal.timeout(GLINER_PROBE_TIMEOUT_MS),
      });
      this.glinerAvailable = response.ok;
    } catch {
      this.glinerAvailable = false;
    }

    return this.glinerAvailable;
  }

  // ─── GLiNER2 Integration ─────────────────────────────────────────────────

  /**
   * Call GLiNER2's /predict endpoint to extract entities.
   *
   * Request format:
   *   POST /predict { text, labels, model }
   *
   * Response format:
   *   { entities: [{ text, label, score, start, end }] }
   */
  private async extractViaGLiNER(text: string): Promise<ExtractedEntity[]> {
    const response = await fetch(`${this.endpoint}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        labels: this.entityTypes,
        model: this.model,
      }),
      signal: AbortSignal.timeout(GLINER_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`GLiNER2 prediction error: ${response.status}`);
    }

    interface GLiNEREntity {
      text: string;
      label: string;
      score: number;
      start: number;
      end: number;
    }

    const data = (await response.json()) as { entities: GLiNEREntity[] };

    if (!data.entities || !Array.isArray(data.entities)) {
      return [];
    }

    return data.entities.map((e) => ({
      text: e.text,
      type: this.mapGLiNERLabel(e.label),
      confidence: e.score,
      span: [e.start, e.end] as [number, number],
    }));
  }

  /**
   * Map a GLiNER2 label string to our EntityType enum.
   * Falls back to "concept" for unknown labels.
   */
  private mapGLiNERLabel(label: string): EntityType {
    const normalized = label.toLowerCase().trim();
    return GLINER_LABEL_MAP[normalized] ?? "concept";
  }

  // ─── Heuristic Fallback ──────────────────────────────────────────────────

  /**
   * Regex-based NER extraction.
   * Each pattern extracts entities of a specific type.
   * All heuristic matches receive a fixed confidence of 0.6.
   */
  private extractViaHeuristic(text: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];
    /** Track spans to avoid overlapping entity extractions. */
    const coveredSpans: Array<[number, number]> = [];

    const addMatch = (
      match: RegExpExecArray,
      type: EntityType,
      groupIndex = 1,
    ): void => {
      const captured = match[groupIndex];
      if (!captured) return;

      // Compute actual span from the capture group
      const start = match.index + match[0].indexOf(captured);
      const end = start + captured.length;

      // Skip if this span overlaps with an already-extracted entity
      if (this.spanOverlaps([start, end], coveredSpans)) return;

      coveredSpans.push([start, end]);
      entities.push({
        text: captured.trim(),
        type,
        confidence: HEURISTIC_CONFIDENCE,
        span: [start, end],
      });
    };

    // Order matters: more specific patterns first to claim spans
    // before less specific ones.

    // 1. Files
    this.execAll(FILE_PATTERN, text, (m) => addMatch(m, "file"));

    // 2. Errors
    this.execAll(ERROR_PATTERN, text, (m) => addMatch(m, "error"));

    // 3. Technologies
    this.execAll(TECHNOLOGY_PATTERN, text, (m) => addMatch(m, "technology"));

    // 4. Tools
    this.execAll(TOOL_PATTERN, text, (m) => addMatch(m, "tool"));

    // 5. Decisions
    this.execAll(DECISION_PATTERN, text, (m) => addMatch(m, "decision"));

    // 6. Actions
    this.execAll(ACTION_PATTERN, text, (m) => addMatch(m, "action"));

    // 7. Concepts (last — most generic)
    this.execAll(CONCEPT_PATTERN, text, (m) => addMatch(m, "concept"));

    return entities;
  }

  // ─── Utilities ───────────────────────────────────────────────────────────

  /**
   * Execute a global regex against text, calling `fn` for each match.
   * Resets the regex lastIndex before and after execution.
   */
  private execAll(
    pattern: RegExp,
    text: string,
    fn: (match: RegExpExecArray) => void,
  ): void {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      fn(match);
    }
    pattern.lastIndex = 0;
  }

  /**
   * Check if a candidate span overlaps with any existing span.
   */
  private spanOverlaps(
    candidate: [number, number],
    existing: Array<[number, number]>,
  ): boolean {
    const [cs, ce] = candidate;
    return existing.some(([es, ee]) => cs < ee && ce > es);
  }

  /**
   * Post-process extracted entities:
   * 1. Filter by requested entity types
   * 2. Filter by minimum confidence
   * 3. Deduplicate by normalized text
   * 4. Sort by confidence descending
   * 5. Cap at maxEntities
   */
  private postProcess(entities: ExtractedEntity[]): ExtractedEntity[] {
    const typeSet = new Set<string>(this.entityTypes);

    // Filter by type and confidence
    let filtered = entities.filter(
      (e) => typeSet.has(e.type) && e.confidence >= this.minConfidence,
    );

    // Deduplicate: keep highest-confidence entry per normalized text
    const seen = new Map<string, ExtractedEntity>();
    for (const entity of filtered) {
      const key = `${entity.type}::${entity.text.toLowerCase().trim()}`;
      const existing = seen.get(key);
      if (!existing || entity.confidence > existing.confidence) {
        seen.set(key, entity);
      }
    }
    filtered = [...seen.values()];

    // Sort by confidence descending, then by span start ascending
    filtered.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return a.span[0] - b.span[0];
    });

    // Cap at maxEntities
    return filtered.slice(0, this.maxEntities);
  }
}
