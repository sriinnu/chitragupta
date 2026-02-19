# Marga Routing Contract (Swara)

Last updated: 2026-02-19

## Scope

Define what Swara decides and what it must not decide, so Vaayu gateway remains the final orchestrator.

## Swara Responsibilities

- classify `taskType`
- classify `complexity`
- emit resolution hints (`llm`, `tool-only`, `local-compute`, etc.)
- emit `skipLLM` for deterministic local lanes

## Swara Non-Responsibilities

Swara does not have final authority over:
- provider health overrides
- cooldown gates
- budget policy decisions
- session-level route pinning
- policy/approval enforcement

Those remain gateway responsibilities.

## Task-Type Baseline

Current explicit task types include:
- `heartbeat`
- `smalltalk`
- `tool-exec`
- `memory`
- `file-op`
- `api-call`
- plus chat/reasoning/translation/summarize/etc.

Key routing semantics:
- `heartbeat` -> `local-compute`
- `smalltalk` -> `local-compute`

## Heartbeat vs Smalltalk

Heartbeat:
- liveness probes (`ping`, `status`, `health`, `are you there`)
- deterministic ack behavior

Smalltalk:
- greeting/check-in/ack conversational turns
- deterministic local reply behavior

This separation prevents generic greeting text from being treated as infrastructure heartbeat traffic.

## Gateway Integration Contract

Gateway may consume Swara output as:
- primary hint for route class
- `skipLLM` optimization signal

Gateway may override Swara recommendation when:
- provider is unhealthy
- provider is cooling down
- policy requires different route
- budget/session pinning constraints require reroute

## Validation Baseline

Swara regression tests:

```bash
pnpm -C chitragupta exec vitest run \
  packages/swara/test/router-task-type.test.ts \
  packages/swara/test/router-pipeline.test.ts \
  packages/swara/test/marga-decide.test.ts
```

Targeted e2e sanity:

```bash
pnpm -C chitragupta exec vitest run \
  packages/swara/test/e2e/routing-pipeline.test.ts \
  -t "heartbeat|smalltalk|translation"
```
