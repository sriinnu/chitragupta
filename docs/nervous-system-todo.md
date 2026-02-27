# Nervous System TODO

## Completed in `feat/nervous-system-wiring-10825`

- [x] Wired dynamic missing-tool callback from `AgentConfig` into `ToolExecutor`.
  - `chitragupta/packages/anina/src/agent.ts`
  - `chitragupta/packages/anina/src/types.ts`
- [x] Wired skill-gap callback from `AgentConfig` into loop deps.
  - `chitragupta/packages/anina/src/agent.ts`
- [x] Wired `LearningLoop` session flush path through `AgentConfig.learningPersistPath`.
  - `chitragupta/packages/anina/src/agent.ts`
  - `chitragupta/packages/anina/src/types.ts`
- [x] Added persistent load/flush lifecycle for bridge `SkillLearner` state.
  - `vaayu/apps/gateway/src/chitragupta-bridge/bridge.ts`
  - `vaayu/packages/tools/src/skill-learner.ts`
- [x] Added explicit debug telemetry when `ShikshaController` or crystallizer is unavailable.
  - `vaayu/apps/gateway/src/chitragupta-bridge/bridge.ts`
- [x] Seeded three default mesh actors during lazy ActorSystem startup.
  - `chitragupta/packages/cli/src/modes/mcp-subsystems.ts`

## Validation executed

- [x] `pnpm -C /tmp/auriva-nervous-1772136204 exec vitest run chitragupta/packages/anina/test/wiring-integration.test.ts`
- [x] `pnpm -C /tmp/auriva-nervous-1772136204 exec vitest run chitragupta/packages/anina/test/agent.test.ts`
- [x] `pnpm -C /tmp/auriva-nervous-1772136204/vaayu/apps/gateway exec node --import tsx --test src/__tests__/chitragupta-bridge-integration.test.ts`
- [x] `pnpm -C /tmp/auriva-nervous-1772136204/vaayu/packages/tools exec vitest run test/skill-learner.test.ts --config vitest.config.ts`
- [x] `pnpm -C /tmp/auriva-nervous-1772136204 exec vitest run chitragupta/packages/cli/test/mcp-subsystems.test.ts`

## Remaining blockers (next pass)

- [ ] MCP streamable-http compatibility
  - Symptom: `Unexpected content type: text/plain` on initialize with streamable HTTP client.
  - Impact: some MCP clients cannot complete handshake against current HTTP transport mode.
- [ ] Root vitest alias drift for `@vaayu/*` packages
  - Symptom: root vitest run resolves `@vaayu/tools` incorrectly in gateway tests.
  - Impact: cross-repo test commands fail unless package-local test runner is used.
- [ ] Root-level typecheck noise from project-reference baseline
  - Symptom: `TS6306` on composite references when checking gateway from workspace root.
  - Impact: root `tsc -p` cannot be used as a clean signal for gateway-specific changes.

## Notes

- `pnpm-lock.yaml` was already dirty in this worktree before this pass and was intentionally not included in the fix commit.
