// @yugenlab/chitragupta — Main entry point
// Re-exports core primitives and the full memory (smriti) API.
//
// Consumers:
//   import { createSession, recall, ChitraguptaError } from "@yugenlab/chitragupta"
//
// For individual subsystems, use sub-path imports:
//   import { ... } from "@yugenlab/chitragupta/swara"
//   import { ... } from "@yugenlab/chitragupta/anina"

// Foundation: types, errors, config, events, validation, auth, observability
export * from "@chitragupta/core";

// Memory: sessions, recall, search, GraphRAG, fact extraction, day consolidation
export * from "@chitragupta/smriti";
