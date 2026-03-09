# Runtime Constitution

This is the user-facing statement of what Chitragupta is in the product family.

It exists to keep architecture, docs, and integrations aligned.

---

## Core Rule

Chitragupta is the engine.

It owns:

- durable memory
- canonical sessions
- provider and CLI routing policy
- bridge auth and scopes
- health, healing, and runtime integrity

Consumers integrate with Chitragupta.
They do not become authorities over durable truth.

---

## Runtime Roles

| Runtime role | Meaning |
| --- | --- |
| Chitragupta | the core engine and sovereign runtime |
| Sabha | the council and peer-consultation layer |
| Lucy | intuition, anticipation, live context shaping |
| Scarlett | integrity, healing, anomaly detection, adaptation |
| Smriti | durable memory and session continuity |
| Buddhi | decision formation and recorded reasoning |
| Nidra | consolidation, pruning, and sleep-cycle maintenance |

These are faculties of the same system, not separate products.

---

## Consumer Roles

| Consumer | Role |
| --- | --- |
| Vaayu | primary personal-assistant consumer |
| Takumi | specialized coding consumer and executable capability |
| future bridges | additional consumers over the same engine contracts |

---

## Ownership Boundaries

| Concern | Owner | Why |
| --- | --- | --- |
| durable session ledger | Chitragupta | one canonical continuity model |
| durable memory | Chitragupta | prevents split-brain memory between consumers |
| provider / CLI routing | Chitragupta | one policy center |
| auth / bridge identity / method scopes | Chitragupta | one trust boundary |
| assistant UX | Vaayu | consumer-specific behavior |
| coding workflow UX | Takumi | consumer-specific behavior |
| ephemeral local state | consumer | allowed, but not canonical |

---

## Takumi

Takumi is modeled as both:

- a consumer of Chitragupta context, memory, prediction, and health
- an executable coding capability that Chitragupta may route into

Takumi is not the authority for:

- durable memory
- canonical sessions
- bridge auth
- routing policy

---

## Vaayu

Vaayu is the primary assistant surface.

It should:

- consume daemon-backed session and memory services
- render Lucy/Scarlett signals to the user when useful
- suggest installs or configuration improvements when needed

It should not become a second persistence or routing authority.

---

## Local-First Policy

The engine prefers:

1. deterministic local logic
2. local tools, indexes, and CLIs
3. local models
4. remote providers

That order is an engine policy, not a per-consumer accident.

---

## Operational Rule

Normal runtime behavior is daemon-first:

- daemon owns persistent writes
- clients connect through authenticated RPC
- degraded fallback is intentionally narrow
- writes fail closed unless local fallback is explicitly enabled

---

## What To Expect

If you are building on Chitragupta:

- ask for capabilities, not vendor names
- attach your app identity to engine sessions instead of inventing a separate truth
- keep your local state ephemeral unless you intentionally hand it to the engine
- treat Lucy and Scarlett as engine faculties that your app consumes

See also:

- [current-status.md](./current-status.md)
- [consumer-contract.md](./consumer-contract.md)
- [sabha-protocol.md](./sabha-protocol.md)
