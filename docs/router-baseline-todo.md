# Router Baseline TODO (Chitragupta / Swara)

## Scope

Make Marga task typing production-safe for smalltalk and heartbeat so Vaayu can stay deterministic under provider degradation.

## Completed (2026-02-19)

- [x] Added `smalltalk` as explicit `TaskType`.
- [x] Tightened `heartbeat` matcher to ping/health/status/alive checks (no generic greetings).
- [x] Routed both `smalltalk` and `heartbeat` to `local-compute` (`skipLLM=true`).
- [x] Added bindings for `smalltalk` and `heartbeat` in local/cloud/hybrid binding sets.
- [x] Updated Swara docs to reflect 15 task types.
- [x] Updated Swara tests for new smalltalk + heartbeat behavior.

## Next P0

- [ ] Add confidence-aware abstain output to `margaDecide` when top-2 task scores are near-tied.
- [ ] Add explicit `checkin` subtype (greeting/ack/checkin) in Marga decision contract.
- [ ] Add provider-health hint channel in decision output (advisory only; enforcement stays in Vaayu).

## Next P1

- [ ] Add multilingual phrase fixtures for smalltalk classifier (Indic + Romance + Turkic + Slavic + Arabic).
- [ ] Add regression corpus that mixes greeting tokens with actionable verbs to prevent false smalltalk captures.
- [ ] Add benchmark target: p95 task-classification latency <= 2ms on baseline hardware.

## Validation Notes

- Focused Swara suites pass:
  - `packages/swara/test/router-task-type.test.ts`
  - `packages/swara/test/router-pipeline.test.ts`
  - `packages/swara/test/marga-decide.test.ts`
  - Targeted subset in `packages/swara/test/e2e/routing-pipeline.test.ts` for smalltalk/heartbeat.
