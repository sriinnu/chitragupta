# Pickup Notes — Self-Healing Actuation Layer

## What Was Done (commit a2bdf37)

All 5 phases of the self-healing actuation layer are implemented and passing:

### Phase 1: KaalaBrahma Activation + Deep-Sleep Enhancement
- `kaala.startMonitoring()` now runs in both TUI and serve modes
- Status changes broadcast to Samiti `#alerts` channel
- Deep-sleep handler expanded: WAL checkpoint + VACUUM (all 3 dbs), FTS5 optimize, consolidation_log pruning, Rta audit persist

### Phase 2: KaalaLifecycle + Heartbeat + Rta Persistence
- KaalaLifecycle interface expanded with monitoring/healing methods
- Agent heartbeat now includes token usage from LLM responses
- `rta_audit` table (schema v4) with indices
- RtaEngine.persistAuditLog() / loadViolationHistory() — duck-typed db
- Rta audit persisted on CLI shutdown + deep-sleep

### Phase 3: Triguna Actuation (NEW FILE)
- `TrigunaActuator` in `packages/anina/src/triguna-actuator.ts`
- Bridges Triguna health events → KaalaBrahma healing + Samiti broadcasts
- Triguna integrated into ChetanaController as 5th subsystem
- Tool error rate, latency, success rate fed into Kalman filter

### Phase 4: Kartavya Dispatcher (NEW FILE)
- `KartavyaDispatcher` in `packages/niyanta/src/kartavya-dispatcher.ts`
- Periodic evaluation (60s), rate-limited (3 concurrent max)
- 4 action types: notification, tool_sequence, vidhi, command
- Command actions disabled by default, Rta-checked

### Phase 5: Knowledge Exposure
- NEW MCP tool: `chitragupta_vidhis` — list/search learned procedures
- Provider context enriched with top 5 vasanas automatically

---

## What To Do Next

### Immediate
- [ ] **`/svapna` CLI command** — expose Swapna consolidation as a CLI command
  - `chitragupta --consolidate [date]` or `chitragupta svapna [date]`
  - If no date: consolidate today. If date provided: consolidate that day
  - Could also be a MCP tool: `chitragupta_consolidate`
  - Implementation: call `ConsolidationEngine` directly, show progress phases
  - Also useful as `/svapna` skill in vidhya-skills

### Smoke Tests to Run
- [ ] Start CLI TUI, wait 5min idle → verify daemon logs "Deep sleep maintenance complete"
- [ ] Spawn sub-agent, kill it → verify `#alerts` gets status change broadcast
- [ ] Check `SELECT * FROM rta_audit` after a session with denied tool calls
- [ ] Trigger high error rate → verify tamas_alert → healTree()
- [ ] Call `chitragupta_vidhis` MCP tool after consolidation
- [ ] Start new session, call `chitragupta_context` → verify vasanas included

### Later Improvements
- [ ] Daemon auto-start (not just within MCP server process)
- [ ] Cross-machine sync for day files + memory
- [ ] Day file pruning/archival (keep last N months, archive older)
- [ ] Full benchmark suite
- [ ] L1 session cache for hot-path reads
- [ ] TrigunaActuator: add heartbeat frequency adjustment on rajas/tamas alerts
- [ ] KartavyaDispatcher: add actual tool execution (currently queues via Samiti)
- [ ] Expose consolidated artifacts in serve-mode API endpoints

---

## Build Status
- **15/15 packages compile clean** (`pnpm build` passes)
- **299/302 test files pass** (pre-existing E2E timeout + load test perf failures)
- **728 targeted tests pass** (dharma, niyanta, anina, smriti)
