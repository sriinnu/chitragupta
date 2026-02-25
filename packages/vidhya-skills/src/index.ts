/**
 * @module @chitragupta/vidhya-skills
 * @description Vidhya-Skills — the Skill Discovery System for Chitragupta.
 *
 * "Vidhya" (विद्या) means knowledge or wisdom in Sanskrit, from the root
 * "vid" (to know), the same root that gives us "Veda." This package
 * embodies the Vedic principle that knowledge should be discoverable,
 * structured, and transmissible.
 *
 * ## Core Innovation: Trait Vector Matching (TVM)
 *
 * A novel 128-dimensional fingerprinting algorithm that matches skills
 * to queries WITHOUT needing an LLM or external embeddings. Inspired by
 * Shiksha (Vedic phonetics), which classified every sound by precise
 * articulatory features.
 *
 * ## Package Exports
 *
 * - **Types**: SkillManifest, SkillQuery, SkillMatch, and related types
 * - **Fingerprint**: TVM algorithm (`computeTraitVector`, `computeQueryVector`, `fnv1a`)
 * - **Parser/Writer**: Skill.md file format serialization
 * - **Matcher**: Query-skill matching with boosting and penalties
 * - **Registry**: In-memory skill registry with secondary indices
 * - **Discovery**: File system and npm package scanning
 * - **Generator**: Auto-generate skills from tool definitions
 * - **Validator**: Manifest completeness and correctness checking
 * - **Bridge**: Integration point between skills and the agent system
 * - **Porter (Setu)**: Bidirectional format converter (Claude SKILL.md, Gemini extensions)
 *
 * ## Vidya-Tantra (विद्या-तन्त्र) — Extended Skill Lifecycle
 *
 * - **Pancha Kosha**: Five-sheath completeness scoring
 * - **Ashrama**: Four-stage lifecycle with hysteresis
 * - **Parampara**: Merkle-chained trust lineage
 * - **Kula**: Core/community/auto-generated tier registry
 * - **Samskara**: Usage impression bridge across subsystems
 * - **Yoga**: Skill composition (sequential/parallel/conditional)
 * - **Vamsha**: Evolutionary biology — mutation, speciation, extinction
 *
 * @packageDocumentation
 */

// ── Types ────────────────────────────────────────────────────────────────────
/** Core skill manifest, query, match, and validation types. */
export type {
	SkillManifest,
	SkillCapability,
	SkillParameter,
	SkillExample,
	SkillSource,
	SkillQuery,
	SkillMatch,
	ValidationResult,
	ValidationError,
	ValidationWarning,
} from "./types.js";

// ── Fingerprint (TVM Algorithm) ─────────────────────────────────────────────
/** 128-dimensional trait vector matching for LLM-free skill-to-query similarity. */
export {
	computeTraitVector,
	computeQueryVector,
	fnv1a,
	TRAIT_DIMENSIONS,
	BUCKET_SIZE,
} from "./fingerprint.js";

// ── Parser ──────────────────────────────────────────────────────────────────
/** Parse SKILL.md files into structured SkillManifest objects. */
export {
	parseSkillMarkdown,
	parseFrontmatter,
	parseCapabilitiesSection,
	parseExamplesSection,
} from "./parser.js";

// ── Writer ──────────────────────────────────────────────────────────────────
/** Serialize SkillManifest objects back to SKILL.md format. */
export {
	writeSkillMarkdown,
	writeFrontmatter,
} from "./writer.js";

// ── Matcher ─────────────────────────────────────────────────────────────────
/** V1 matcher: cosine similarity on trait vectors with tag boosting and anti-pattern penalties. */
export {
	matchSkills,
	cosineSimilarityF32,
	rankAndFilter,
} from "./matcher.js";

// ── Registry ────────────────────────────────────────────────────────────────
/** In-memory skill registry with secondary indices for tag and capability lookup. */
export { SkillRegistry } from "./registry.js";

// ── Discovery ───────────────────────────────────────────────────────────────
/** File system and npm package scanner for automatic skill discovery. */
export { SkillDiscovery } from "./discovery.js";
export type { SkillChangeEvent } from "./discovery.js";

// ── Generator ───────────────────────────────────────────────────────────────
/** Auto-generate SKILL.md manifests from MCP tool definitions. */
export {
	generateSkillFromTool,
	generateSkillsFromTools,
	extractVerbObject,
} from "./generator.js";
export type { ToolDefinition } from "./generator.js";

// ── Validator ───────────────────────────────────────────────────────────────
/** Validate skill manifests for completeness, correctness, and best practices. */
export {
	validateSkill,
	validateSkillMarkdown,
} from "./validator.js";

// ── Bridge ──────────────────────────────────────────────────────────────────
/** Integration bridge between skill system and agent tool invocation layer. */
export { VidyaBridge } from "./bridge.js";

// ── Skill Evolution ─────────────────────────────────────────────────────────
/** Track skill health metrics and suggest fusion/deprecation based on usage patterns. */
export { SkillEvolution } from "./skill-evolution.js";
export type {
	SkillHealthReport,
	SkillEvolutionState,
	FusionSuggestion,
} from "./skill-evolution.js";

// ── Skill Sandbox (Kshetra-Vidya) — Quarantine for skill learning ──────────
/** Quarantine sandbox for testing untrusted skills before promotion. */
export { SkillSandbox } from "./skill-sandbox.js";
export type { SandboxConfig, QuarantinedSkill, SandboxValidationResult } from "./skill-sandbox.js";

// ── Skill Porter (Setu) — Bidirectional format converter ────────────────────
/** Bidirectional converter between Chitragupta, Claude SKILL.md, and Gemini extension formats. */
export {
	SkillPorter,
	detectFormat,
	importClaudeSkill,
	exportClaudeSkill,
	importGeminiExtension,
	exportGeminiExtension,
	convert,
} from "./porter.js";
export type {
	SkillFormat,
	ClaudeSkillData,
	GeminiExtensionData,
	GeminiMcpServer,
	GeminiTool,
} from "./porter.js";

// ── Suraksha (सुरक्षा) — Security Scanner ───────────────────────────────────
/** Security scanner that detects prompt injection, data exfiltration, and malicious patterns. */
export { SurakshaScanner, shannonEntropy } from "./suraksha.js";
export type {
	ThreatCategory,
	FindingSeverity,
	SurakshaFinding,
	SurakshaVerdict,
	SurakshaScanResult,
	SurakshaConfig,
	CustomPattern,
} from "./suraksha.js";

// ── Pratiksha (प्रतीक्षा) — Staging Manager ─────────────────────────────────
/** Staging area manager for skill review, approval, and archival workflows. */
export { PratikshaManager } from "./pratiksha.js";
export type {
	StagedSkillSummary,
	ApprovedSkillSummary,
	ArchivedSkillSummary,
	PratikshaConfig,
} from "./pratiksha.js";

// ── Pariksha (परीक्षा) — Pipeline Orchestrator ──────────────────────────────
/** End-to-end skill ingestion pipeline: parse, validate, scan, stage, and approve. */
export { SkillPipeline } from "./pariksha.js";
export type {
	SkillIngestSource,
	IngestResult,
	FullSkillReview,
	PipelineEventType,
	PipelineEvent,
	SkillPipelineConfig,
} from "./pariksha.js";

// ── Shiksha (शिक्षा) — Autonomous Skill Learning ───────────────────────────
/** Autonomous skill learning: analyze tasks, source implementations, and build new skills. */
export { ShikshaController, analyzeTask, sourceSkill, buildSkill } from "./shiksha/index.js";
export { DEFAULT_SHIKSHA_CONFIG, SHIKSHA_HARD_CEILINGS } from "./shiksha/index.js";
export type {
	ExecutionStrategy,
	TaskDomain,
	IntentDecomposition,
	CandidateUtility,
	TaskAnalysis,
	SourceTier,
	SourceResult,
	SourceImplementation,
	GeneratedSkill,
	ShikshaConfig,
	ShikshaResult,
	ShikshaEvent,
	ShikshaEventType,
	BashExecutor,
	ShikshaControllerConfig,
} from "./shiksha/index.js";

// ── Vidya-Tantra (विद्या-तन्त्र) — Extended Types ──────────────────────────
export type {
	KulaType,
	AshramamStage,
	AshramamState,
	AshramamTransition,
	AshramamHysteresis,
	PranamayaRequirements,
	VijnanamayaWisdom,
	AnandamayaMastery,
	DreyfusLevel,
	PanchaKoshaScores,
	ParamparaLink,
	ParamparaTrust,
	ParamparaChain,
	YogaType,
	YogaComposition,
	VamshaEvent,
	VamshaEventType,
	VamshaLineage,
	SamskaraImpression,
	VidyaTantraExtension,
	EnhancedSkillManifest,
	SkillState,
	VidyaTantraMatch,
	VidyaTantraConfig,
	VidyaTantraState,
	// Mudra types (integrity + signing)
	SkillIntegrity,
	SkillSignature,
	IntegrityVerification,
	// Granular permissions
	GranularNetworkPermissions,
	GranularUserDataPermissions,
	GranularFilesystemPermissions,
	GranularPermissions,
	// Approach ladder
	ApproachLadderEntry,
	// Eval cases
	EvalCase,
	EvalResult,
	// UI contribution points
	SkillUIContributions,
	SkillWidgetContribution,
	SkillKeybindContribution,
	SkillPanelContribution,
	UIOutputFormat,
	PanelType,
} from "./types-v2.js";
export {
	KULA_WEIGHTS,
	ASHRAMA_ORDER,
	ASHRAMA_MATCH_WEIGHT,
	DEFAULT_HYSTERESIS,
	HYSTERESIS_CEILINGS,
	KOSHA_WEIGHTS,
	TRUST_WEIGHTS,
	DREYFUS_THRESHOLDS,
	EMPTY_PRANAMAYA,
	EMPTY_VIJNANAMAYA,
	INITIAL_ANANDAMAYA,
	DEFAULT_VIDYA_TANTRA_CONFIG,
	VIDYA_TANTRA_CEILINGS,
} from "./types-v2.js";

// ── Pancha Kosha (पञ्च कोश) — Five-Sheath Scoring ──────────────────────────
/** Five-sheath completeness scorer: annamaya, pranamaya, manomaya, vijnanamaya, anandamaya. */
export {
	checkPranamaya,
	scoreAnnamaya,
	scorePranamaya,
	scoreManomaya,
	scoreVijnanamaya,
	scoreAnandamaya,
	buildPanchaKosha,
	clearPranamayaCache,
} from "./pancha-kosha.js";
export type { PranamayaCheckResult } from "./pancha-kosha.js";

// ── Ashrama (आश्रम) — Lifecycle State Machine ───────────────────────────────
/** Four-stage lifecycle state machine with hysteresis for skill maturity transitions. */
export { AshramamMachine, createInitialState } from "./ashrama.js";

// ── Kula (कुल) — Provenance Tier Registry ───────────────────────────────────
/** Core/community/auto-generated provenance registry with weighted trust scoring. */
export { KulaRegistry } from "./kula.js";
export type { MergeResult } from "./kula.js";

// ── Parampara (परम्परा) — Trust Lineage ─────────────────────────────────────
/** Merkle-chained trust lineage for skill provenance verification. */
export {
	computeLinkHash,
	computeContentHash,
	createGenesisLink,
	appendLink,
	verifyChain,
	computeTrust,
	createChain,
	serializeChain,
	deserializeChain,
} from "./parampara.js";

// ── Samskara (संस्कार) — Usage Impression Bridge ────────────────────────────
/** Usage impression bridge that tracks skill invocations and computes Dreyfus mastery levels. */
export { SamskaraSkillBridge, computeDreyfusLevel } from "./samskara-skill.js";

// ── Yoga (योग) — Skill Composition ──────────────────────────────────────────
/** Compose skills into sequential, parallel, or conditional pipelines. */
export { YogaEngine } from "./yoga.js";

// ── Vamsha (वंश) — Evolutionary Biology ─────────────────────────────────────
/** Evolutionary tracker for skill mutation, speciation, and extinction events. */
export { VamshaTracker } from "./vamsha.js";

// ── Vidya Orchestrator (विद्या सूत्रधार) — Unified Lifecycle Controller ──────
/** Unified orchestrator for skill lifecycle: init, learn, evolve, persist, and report. */
export { VidyaOrchestrator } from "./vidya-orchestrator.js";
export type {
	VidyaOrchestratorConfig,
	InitResult,
	LifecycleReport,
	LearnResult,
	SkillReport,
	EcosystemStats,
	VidyaPersistedState,
} from "./vidya-orchestrator.js";

// ── Skill Crystallization (स्फटीकरण) — Vidhi → Skill Pipeline ──────────────
/** Crystallize mature procedural memories (Vidhis) into reusable skill manifests. */
export { SkillCrystallizer, DEFAULT_CRYSTALLIZATION_CONFIG, CRYSTALLIZATION_HARD_CEILINGS, promoteMatureVidhis } from "./crystallization.js";
export type {
	VidhiLike,
	CrystallizationConfig,
	CrystallizationCandidate,
	CrystallizationStatus,
	CrystallizedSkill,
} from "./crystallization.js";

// ── Agent Skills Loader (SKILL.md open standard) ────────────────────────────
/** Load agent skills from SKILL.md files with SimHash fingerprinting for deduplication. */
export {
	loadAgentSkills,
	computeSimHash,
	skillSimilarity,
	scoreSkillRelevance,
	fnv1a64,
} from "./agent-skills-loader.js";
export type {
	AgentSkillLoadResult,
	AgentSkillEntry,
	ScoredSkill,
} from "./agent-skills-loader.js";

// ── Matcher V2 (Three-Phase Pipeline) ───────────────────────────────────────
/** V2 three-phase matcher: SimHash pre-filter, trait-vector scoring, Thompson Sampling rerank. */
export { matchSkillsV2 } from "./matcher.js";
export type { MatchContext } from "./matcher.js";

// ── Prompt XML (System Prompt Injection) ────────────────────────────────────
/** Generate XML skill descriptions for system prompt injection into LLM context. */
export {
	skillToXml,
	generateSkillsXml,
	generateActivatedSkillXml,
} from "./prompt-xml.js";
export type { DisclosureTier, SkillXmlOptions } from "./prompt-xml.js";

// ── Mudra (मुद्रा) — Integrity Hashing & Cryptographic Signing ──────────────
/** Content integrity hashing and Ed25519 cryptographic signing for skill tamper detection. */
export {
	computeIntegrity,
	verifyIntegrity,
	writeIntegrity,
	readIntegrity,
	generateKeyPair,
	signIntegrity,
	verifySignature,
	writeSignature,
	readSignature,
	sealSkill,
	verifySeal,
	INTEGRITY_FILE,
	SIGNATURE_FILE,
} from "./mudra.js";

// ── Eval Harness — Structured Skill Evaluation ──────────────────────────────
/** Structured evaluation harness for running test suites against skill implementations. */
export {
	loadEvalCases,
	validateEvalCases,
	runEvalSuite,
	filterByType,
	formatEvalSummary,
} from "./eval-harness.js";
export type { EvalExecutor, EvalComparator } from "./eval-harness.js";

// ── Approval Queue — Skill Approval Workflow ────────────────────────────────
/** Skill approval queue with risk assessment and ledger-based audit trail. */
export { ApprovalQueue, assessRisk } from "./approval-queue.js";
export type {
	ApprovalStatus,
	RiskLevel,
	ApprovalRequest,
	ApprovalLedgerEntry,
	ApprovalEvent,
	ApprovalEventHandler,
} from "./approval-queue.js";

// ── Approval Notifier — Samiti Bridge ───────────────────────────────────────
/** Broadcast approval events over Samiti ambient channels for multi-agent notification. */
export { ApprovalNotifier } from "./approval-notifier.js";
export type { SamitiBroadcaster, ApprovalNotifierConfig } from "./approval-notifier.js";
