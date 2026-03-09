# Sessions and Memory Canonical Guide

This document is the canonical reference for how Smriti stores sessions, memory, and cross-device sync snapshots.

## 1. Storage Model

Smriti uses a dual-layer persistence model:

- Sessions: Markdown files under `~/.chitragupta/sessions/<project-hash>/YYYY/MM/*.md` (source of truth).
- Session index/search: SQLite rows in `agent.db` (`sessions`, `turns`, `turns_fts`) as an accelerator.
- Scoped memory: Markdown files under `~/.chitragupta/memory/**` for `global`, `project`, and `agent` scopes. Session memory stays inside the session ledger and is accessed through session APIs, not standalone memory CRUD.

Rule: Markdown is authoritative. SQLite write-through is best-effort to preserve session durability even when DB writes fail.

## 2. Session Invariants

Session callers should rely on these invariants:

- `createSession()` creates an ID and on-disk `.md` path deterministically for project/date.
- `addTurn()` appends turns and advances `meta.updated`.
- `saveSession()` persists metadata + turns and mirrors to SQLite.
- `loadSession()` always reconstructs from Markdown (cache may serve hot reads, but cache invalidates on mutations).

## 3. Memory Invariants

Memory callers should use scoped APIs:

- `getMemory(scope)`
- `updateMemory(scope, content)`
- `appendMemory(scope, content)`
- `listMemoryScopes()`

Memory drift mitigation:

- Memory writes remain file-based and auditable.
- Sync import merges memory entries with local-first deduplication.
- Session import is non-destructive (`skip-if-exists` by session ID).

## 4. Cross-Device Sync Formats

Smriti now supports two snapshot formats:

- Plain snapshot JSON (legacy/default): created via `createCrossMachineSnapshot()` + `writeCrossMachineSnapshot()`.
- Encrypted snapshot envelope (new): passphrase-protected JSON envelope with PBKDF2-SHA256 + AES-256-GCM.

### 4.1 Encrypted API

```ts
import {
	createCrossMachineSnapshot,
	writeEncryptedCrossMachineSnapshot,
	readEncryptedCrossMachineSnapshot,
	importEncryptedCrossMachineSnapshot,
} from "@chitragupta/smriti";

const snapshot = createCrossMachineSnapshot({ includeDays: true, includeMemory: true });

// Export encrypted snapshot
writeEncryptedCrossMachineSnapshot(
	snapshot,
	"./snapshot.enc.json",
	process.env.CHITRAGUPTA_SYNC_PASSPHRASE!,
	{ iterations: 210_000 },
);

// Read/decrypt
const decrypted = readEncryptedCrossMachineSnapshot(
	"./snapshot.enc.json",
	process.env.CHITRAGUPTA_SYNC_PASSPHRASE!,
);

// Import decrypted snapshot
importEncryptedCrossMachineSnapshot(
	"./snapshot.enc.json",
	process.env.CHITRAGUPTA_SYNC_PASSPHRASE!,
	{ strategy: "safe" },
);
```

### 4.2 Envelope Contract

Encrypted sync files use:

- `kind: "chitragupta-sync-encrypted"`
- `version: 1`
- `kdf: pbkdf2-sha256` metadata (`iterations`, `saltB64`)
- `cipher: aes-256-gcm` metadata (`ivB64`, `tagB64`)
- `payloadB64`: authenticated ciphertext of the snapshot JSON

Tamper handling and wrong passphrases both fail closed with decryption errors.

## 5. Recommended Operating Pattern

1. Keep plaintext sync for trusted local pipelines only.
2. Use encrypted sync for cross-device transfer, shared folders, or backups.
3. Keep passphrases out of committed files; inject via environment or secret store.
4. Use `dryRun: true` before actual imports when applying snapshots from other devices.

## 6. Current Gaps

- CLI/MCP sync commands still default to plaintext snapshot read/write flows.
- Encrypted sync is currently exposed as Smriti library APIs and must be invoked by callers that need passphrase-protected transport.
