# Coding Agent

`coding_agent` is Chitragupta's user-facing autonomous coding entrypoint. It is exposed through MCP and uses Lucy for context injection, Takumi when available, and plain CLI routing as a fallback.

This document is intentionally practical. It focuses on what operators and users can rely on today.

## Concept Scope vs Current Wiring

Lucy and Scarlett are platform-wide runtime concepts inside Chitragupta. They are not limited to outer MCP clients, external agents, or Takumi.

| Concept | Platform scope | What this document covers |
| --- | --- | --- |
| Lucy | Platform-wide autonomy/runtime concept across Chitragupta, including internal systems such as Smriti-backed context flows and other runtime subsystems. | The currently user-visible coding path: Lucy context injection and no-cache behavior for `coding_agent`. |
| Scarlett | Platform-wide health/watchdog concept for Chitragupta runtime supervision. | Only the parts that indirectly affect the coding path or operator expectations. |

This document does **not** claim that every Lucy/Scarlett concept is already wired end-to-end into every surface. It documents the coding path that users can rely on today, while calling out where behavior is broader in concept than in current integration.

## Provenance and Boundaries

The user-facing coding path lives in a broader ecosystem of coding-agent tools, and some CLI/session ergonomics are adjacent to patterns seen in projects such as pi-mono.

That is not the whole provenance story. The Lucy/Scarlett framing, Smriti-backed context layering, and the Akasha/Buddhi/Nidra-style runtime composition are Chitragupta-native concepts in this repo family.

This document also distinguishes current implementation from future binding plans. Internal Takumi binding notes describe richer bidirectional observation, prediction, and healing channels, but the stable contract today is the CLI-compatible bridge documented below.

## Execution Modes

| Mode | What it does | Executes changes? |
| --- | --- | --- |
| `full` | Runs Lucy context injection, tries the Takumi bridge first, then falls back to the generic coding CLI router if needed. | Yes |
| `plan-only` | Builds a plan, shows context preview, and reports available CLIs. | No |
| `cli` | Skips Lucy and the Takumi bridge. Routes directly to the best available coding CLI. | Yes |

## Fresh / No-Cache Behavior

Two user-facing surfaces support a fresh execution path:

| Surface | Flag | Current behavior |
| --- | --- | --- |
| `coding_agent` | `noCache: true` | Bypasses Transcendence predictive hints, runs the live memory prompt refresh path, and forwards fresh intent into the Takumi bridge. |
| `chitragupta_recall` | `noCache: true` or `fresh: true` | Suppresses predictive Transcendence hits and searches live memory layers only. |

### What `noCache` means today

- Lucy does not prepend predictive Transcendence context.
- Recall does not return predicted hits ahead of live recall results.
- The agent-side memory prompt context is rebuilt on every turn and falls back to the last successful context only if a refresh fails.
- When the Takumi bridge is active, fresh intent is forwarded in:
  - the synthesized task prompt
  - bridge environment hints (`CHITRAGUPTA_NO_CACHE=1`, `CHITRAGUPTA_FRESH=1`)
  - bridge result metadata (`cacheIntent: "fresh"`)

### What `noCache` does not guarantee

- It does not disable every internal cache inside external tools.
- It does not bypass CLI detection caches that only decide which executable is available.
- It does not create a direct RPC connection to a checked-out Takumi repo.
- It does not mean every Lucy/Scarlett runtime signal inside Chitragupta is already shared end-to-end with the coding path.

## Strict Engine Route Inputs

`coding_agent` now accepts optional engine-routing inputs when the caller wants fail-closed lane selection instead of generic best-effort routing:

- `sessionId`
- `consumer`
- `routeClass`
- `capability`

If `routeClass` or `capability` is supplied, the coding path forwards that contract into Lucy and the daemon bridge. That lets operators require an engine-selected lane such as `coding.review.strict` or a raw capability such as `coding.review` instead of letting the coding path fall back to generic CLI discovery.

When a canonical `sessionId` is present but no explicit `routeClass` is supplied, Chitragupta now infers a default engine route class from the task itself before calling `route.resolve`. That keeps the interactive agent, MCP `coding_agent`, and Takumi bridge on the same engine-owned lane policy instead of leaving the session-aware path partially local.

If the engine resolves that request to the local `tool.coding_agent` lane, the bridge respects that decision and falls back to the generic local coding CLI path instead of treating the resolution as an error.

## Takumi Bridge

When `coding_agent` runs in `full` mode, Chitragupta tries the Takumi bridge first.

### Preferred path

```bash
takumi --print --stream ndjson --cwd <project>
```

This gives Chitragupta structured event parsing and richer result synthesis.

### Compatibility fallback

```bash
takumi --print --cwd <project>
```

If structured streaming is unavailable, Chitragupta falls back to plain printed output and still returns a synthesized result.

### What is wired today

- Chitragupta looks for `takumi` on `PATH`.
- Takumi is treated as both a consumer of Chitragupta context and an executable coding capability, not as the authority over durable memory, auth, or routing.
- Context is injected by synthesizing it into the prompt.
- The bridge also exports compatibility env vars for future Takumi-side consumption.
- The bridge now exports explicit engine-route env vars (`CHITRAGUPTA_ROUTE_CLASS`, `CHITRAGUPTA_ROUTE_CAPABILITY`, `CHITRAGUPTA_SELECTED_CAPABILITY_ID`) and marks the injected lane as authoritative.
- If Takumi is unavailable, Chitragupta falls back to the generic coding CLI router.
- If the engine selects a compatible model/runtime lane such as a discovered model capability or `engine.local.llamacpp`, Chitragupta keeps Takumi as the executor but passes that engine-selected lane through as an enforced envelope instead of treating it as an override error.

### What is not wired today

- No direct bridge to a local Takumi checkout path by default.
- No dedicated Takumi RPC protocol beyond the current CLI surface.
- The daemon binding is only partially aligned with the internal Takumi note; the core RPC/storage path now exists, but the full protocol is not complete.
- Not every platform-wide Lucy/Scarlett runtime signal is shared end-to-end with every Lucy caller yet.

## Takumi Binding Status

The internal note at `/Users/srinivaspendela/Documents/for-takumi-chitragupta-binding.md` describes a larger Chitragupta <-> Takumi contract than the repo currently ships.

The table below keeps that note and the current codebase aligned:

| Binding phase from the note | Current repo status | Practical meaning today |
| --- | --- | --- |
| C1: daemon push notifications | Implemented | The daemon can now deliver JSON-RPC notifications to connected clients, and the client library consumes them through `onNotification()`. |
| C2: observation engine | Implemented | The daemon now exposes `observe.batch` and persists normalized observation events into the binding schema. |
| C3: pattern detection push | Partial | `pattern_detected` notifications now exist, but the note's broader evolving/autonomous loop is still narrower than the final design. |
| C4: prediction engine push | Partial | `predict.next` exists and `prediction` notifications can be emitted, but the full proactive daemon-driven prediction loop from the note is not complete. |
| C5: health + self-heal reports | Partial | `health.status` and `heal.report` now exist, but the broader self-healing control loop is still incomplete. |
| C6: new JSON-RPC server methods | Implemented | `observe.batch`, `pattern.query`, `predict.next`, `health.status`, `heal.report`, and `preference.update` are now registered on the daemon. |
| C7: push notification types | Partial | `pattern_detected`, `prediction`, `anomaly_alert`, `preference_update`, and `heal_reported` now exist, but the note's full notification taxonomy is still broader. |
| C8: dedicated binding schema | Implemented | Observation, pattern, Markov-transition, preference, and healing tables are now present in the agent schema. |

The remaining gap is intentional in this document: the coding path here describes the stable CLI-compatible bridge that exists today plus the partial daemon binding that now exists in code, not the full future protocol sketched in the note.

## CLI Fallback Order

If the Takumi bridge cannot run, Chitragupta uses the best available coding CLI in this order:

```text
takumi > claude > codex > aider > gemini > zai
```

If none of these are available, `coding_agent` returns an error instead of silently pretending work happened.

## Operator Notes

- Use `plan-only` when you want Lucy's planning/context behavior without touching files.
- Use `cli` when you want a plain external coding CLI run with no Lucy/Takumi bridge behavior.
- Use `noCache` when you suspect predictive context is stale or you need a fresh-memory execution path.
- Expect the richest results when Takumi structured streaming is available.

## Related Files

- [README.md](../README.md)
- [docs/getting-started.md](getting-started.md)
- [docs/runtime-integrity.md](runtime-integrity.md)
- [packages/cli/src/modes/mcp-tools-coding.ts](../packages/cli/src/modes/mcp-tools-coding.ts)
- [packages/cli/src/modes/takumi-bridge.ts](../packages/cli/src/modes/takumi-bridge.ts)
- [packages/cli/src/modes/lucy-bridge.ts](../packages/cli/src/modes/lucy-bridge.ts)
