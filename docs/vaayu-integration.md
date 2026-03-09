# Vaayu Integration

Vaayu is the primary personal-assistant consumer of Chitragupta.

This document describes the user-facing integration contract as it exists today:

- Chitragupta is the engine and authority.
- Vaayu is a consumer of that engine.
- Durable sessions, memory, routing policy, and bridge auth belong to Chitragupta.
- Vaayu can remain specialized in assistant UX, channels, and install suggestions.

---

## Ownership Model

| Concern | Owner | Notes |
| --- | --- | --- |
| Durable memory | Chitragupta | Global, project, agent, and session continuity stay engine-owned. |
| Canonical session ledger | Chitragupta | Vaayu can attach its own metadata, but it should not fork session truth. |
| Provider and CLI routing | Chitragupta | Vaayu asks for capability; the engine decides the lane. |
| Bridge auth and scopes | Chitragupta | Use bridge identity and scoped access, not ad hoc app-local keys. |
| Assistant UX and channel behavior | Vaayu | Vaayu remains the primary user-facing product surface. |
| Install suggestions and onboarding hints | Vaayu | Vaayu may suggest tools or providers, but the engine still registers and governs them. |

---

## Runtime Shape

Current recommended integration path:

1. Vaayu talks to the Chitragupta daemon.
2. Vaayu opens or resumes an engine-owned session.
3. Vaayu reports observations and turn activity back to the daemon.
4. Chitragupta returns memory, recall, prediction, and health context.

This keeps Vaayu thin where continuity matters and specialized where UX matters.

---

## What Vaayu Should Ask For

Vaayu should ask for capabilities, not vendor names.

Examples:

| Vaayu intent | Engine decides |
| --- | --- |
| `assistant.reply` | local tool, local model, or cloud provider based on policy |
| `memory.recall` | daemon-backed recall path |
| `session.create` / `turn.add` | canonical session persistence |
| `predict.next` | Lucy intuition / anticipation |
| `health.status` | Scarlett integrity / healing state |
| `sabha.ask` | future council / peer-consultation path |

This prevents Vaayu from becoming a second routing authority.

---

## Data Boundaries

| Data type | Where it belongs |
| --- | --- |
| user identity and preferences | Chitragupta |
| cross-project memory | Chitragupta |
| project memory | Chitragupta |
| session turns and transcripts | Chitragupta |
| Vaayu UI state | Vaayu |
| transient presentation state | Vaayu |
| install recommendations | Vaayu, with engine registration afterward |

Session-scoped content is not a standalone memory file. It lives in the session ledger and is accessed through session APIs.

---

## Auth Boundary

Current engine model:

| Surface | Auth shape |
| --- | --- |
| daemon socket / named pipe | `auth.handshake` bridge token + method scopes |
| serve HTTP | serve auth surface (pairing/JWT/API auth), separate from daemon socket auth |
| MCP HTTP/SSE | bridge token family + scope checks |

Vaayu should identify itself as a bridge client with explicit scopes instead of relying on implicit local trust beyond loopback.

---

## Failure Model

| Condition | Expected behavior |
| --- | --- |
| daemon healthy | Vaayu uses daemon-backed sessions, memory, and recall |
| daemon degraded | read-only fallback may exist for limited flows, but writes fail closed by default |
| daemon unavailable and local fallback not enabled | Vaayu should surface degraded mode, not silently create a second durable truth |
| local fallback explicitly enabled | fallback is an override, not the default contract |

The important rule is fail closed on writes unless the operator has deliberately opted into local fallback.

---

## Lucy and Scarlett in Vaayu

Vaayu consumes the engine's internal nervous system rather than re-implementing it.

| Runtime faculty | What Vaayu should consume |
| --- | --- |
| Lucy | recall, prediction, live context hints, fresh/no-cache behavior |
| Scarlett | health, anomaly, heal-report, degradation signals |
| Sabha | future peer consultation and council-style coordination |

Vaayu should render or act on these signals, not become the source of truth for them.

---

## Current Status

| Capability | Current state |
| --- | --- |
| daemon-owned sessions and memory | live |
| serve memory routes through daemon | live |
| daemon-backed memory/session writes in main runtime surfaces | live |
| local fallback only by explicit opt-in | live |
| Takumi-style dedicated adapter protocol reused by Vaayu | not the current path; Vaayu should use the engine contract directly |

---

## Recommended Integration Pattern

1. Connect Vaayu to the daemon, not to raw Smriti files.
2. Treat Chitragupta as the authority for session ids, memory, provider/CLI policy, and health.
3. Keep Vaayu specialized in experience, channels, and user workflow.
4. Let Vaayu suggest installs and preferences, then hand authority back to the engine.

That keeps the architecture aligned:

- Chitragupta = engine
- Vaayu = primary consumer
- Takumi = specialized consumer + executable capability
