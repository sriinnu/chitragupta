# API Reference

## CLI Commands

### Core

```bash
chitragupta                          # Interactive mode
chitragupta "fix the auth bug"       # Direct prompt
chitragupta --model sonnet           # Model selection
chitragupta serve                    # HTTP API server
chitragupta mcp                      # MCP server mode (stdio or SSE)
```

### Slash Commands (Interactive Mode)

```
/code                                # Switch to Kartru (coding agent)
/review                              # Switch to Parikshaka (reviewer)
/debug                               # Switch to Anveshi (debugger)
/research                            # Switch to Shodhaka (researcher)
/refactor                            # Switch to Parikartru (refactorer)
/docs                                # Switch to Lekhaka (documenter)
/chetana                             # Consciousness visualization (ANSI)
/vidya                               # Skill ecosystem dashboard
/learn <query>                       # Autonomous skill learning
/skills                              # Skill status and management
```

### Memory and Knowledge

```bash
chitragupta memory search "auth"     # Search project memory (GraphRAG)
chitragupta sessions list            # List all sessions
chitragupta sessions show <id>       # Show session content
chitragupta vasana list              # Crystallized behavioral tendencies
chitragupta vasana inspect <id>      # Tendency details + source samskaras
chitragupta knowledge inspect <ent>  # Entity details with pramana types
chitragupta vidhi list               # Learned procedures
chitragupta vidhi run <name>         # Execute a learned procedure
```

### Consciousness and Health

```bash
chitragupta health                   # Triguna state: [sattva, rajas, tamas]
chitragupta health history           # Guna trajectory over time
chitragupta nidra status             # Sleep daemon state
chitragupta nidra wake               # Force wake from sleep
chitragupta nidra dream-log          # What was learned during last dream cycle
chitragupta atman                    # Full self-report: identity, vasanas, guna, capabilities
```

### Multi-Agent

```bash
chitragupta samiti listen <channel>  # Listen to ambient channel
chitragupta samiti history <channel> # Channel message history
chitragupta sabha convene <topic>    # Start formal deliberation
chitragupta sabha status             # Active deliberations
chitragupta lokapala status          # Guardian agent states
chitragupta lokapala findings        # Recent security/perf/correctness findings
```

### Auto-Execution and Routing

```bash
chitragupta kartavya list            # Active auto-execution duties
chitragupta kartavya pause <id>      # Pause a duty
chitragupta kartavya history         # Execution log
chitragupta turiya status            # Model routing state
chitragupta turiya routing-stats     # Cost savings breakdown
chitragupta explain <decision-id>    # Nyaya reasoning chain
chitragupta rta list                 # Invariant rules
chitragupta rta audit                # Audit log of Rta checks
```

---

## REST API (`chitragupta serve`)

### Sessions and Memory

```
GET    /api/sessions                 # List sessions
GET    /api/sessions/:id             # Session content
POST   /api/sessions                 # Create session
GET    /api/memory/search?q=...      # Search project memory
```

### Agent

```
POST   /api/agent/prompt             # Send prompt to agent
GET    /api/agent/tree               # Agent tree state
POST   /api/agent/spawn              # Spawn sub-agent
DELETE /api/agent/:id                # Kill agent
```

### Sleep and Consolidation

```
GET    /api/nidra/status             # Sleep daemon state
POST   /api/nidra/wake               # Force wake
GET    /api/nidra/history            # Consolidation history
GET    /api/nidra/dream-log          # Dream cycle results
```

### Health

```
GET    /api/health/guna              # Triguna [sattva, rajas, tamas]
GET    /api/health/guna/history      # Guna trajectory
```

### Vasana and Knowledge

```
GET    /api/vasanas                  # Crystallized tendencies
GET    /api/vasanas/:id              # Tendency details
GET    /api/knowledge/:entity        # Entity with pramana types
GET    /api/vidhi                    # Learned procedures
POST   /api/vidhi/:name/run          # Execute procedure
GET    /api/decisions/:id/reasoning  # Nyaya reasoning chain
```

### Auto-Execution

```
GET    /api/kartavya                 # Active duties
POST   /api/kartavya/:id/pause       # Pause duty
GET    /api/kartavya/:id/history     # Execution log
```

### Multi-Agent

```
GET    /api/samiti/channels          # Ambient channels
GET    /api/samiti/:channel/messages # Channel messages
POST   /api/sabha/convene            # Start deliberation
GET    /api/sabha/:id                # Deliberation state
GET    /api/sabha/:id/transcript     # Full transcript
```

### Guardians

```
GET    /api/lokapala/status          # Guardian states
GET    /api/lokapala/findings        # Recent findings
POST   /api/lokapala/:name/pause     # Pause guardian
```

### Routing and Safety

```
GET    /api/turiya/status            # Model routing state
GET    /api/turiya/routing           # Cost savings
GET    /api/rta/rules                # Invariant rules
GET    /api/rta/audit-log            # Rta audit log
GET    /api/atman                    # Full self-awareness report
```

### Skills

```
GET    /api/skills                   # Registered skills
GET    /api/skills/:id               # Skill details
POST   /api/skills/learn             # Trigger skill learning
GET    /api/skills/ecosystem         # Ecosystem stats
```

### Vaayu Integration

```
WS     /ws                           # WebSocket for real-time agent interaction
POST   /api/jobs                     # Submit background job
GET    /api/jobs/:id                 # Job status
```

---

## MCP Server (`chitragupta mcp`)

Exposed as MCP tools for integration with Claude Code and other MCP clients:

### File Operations (12 tools)

```
read, write, edit, bash, grep, find, ls, diff, watch, project_analysis, memory_search, session_list
```

### Memory

```
memory_search            # Search project memory
session_list             # List sessions
session_show             # Show session content
```

### Agent

```
agent_prompt             # Send prompt (opt-in)
```

### Sleep and Health

```
nidra_status             # Sleep daemon state
nidra_wake               # Force wake
guna_status              # Current [sattva, rajas, tamas]
```

### Knowledge

```
vasana_list              # Crystallized tendencies
vasana_inspect           # Tendency details
vidhi_list               # Learned procedures
vidhi_run                # Execute procedure
explain_decision         # Nyaya reasoning chain
```

### Auto-Execution

```
kartavya_list            # Active duties
kartavya_pause           # Pause duty
kartavya_trigger         # Manually trigger
```

### Multi-Agent

```
samiti_listen            # Channel messages
samiti_history           # Channel history
sabha_convene            # Start deliberation
sabha_status             # Active deliberations
```

### Guardians and Routing

```
lokapala_status          # Guardian states
lokapala_findings        # Recent findings
turiya_status            # Model routing
turiya_routing_stats     # Cost savings
atman_report             # Full self-awareness
```

### Resources and Prompts

```
Resource: chitragupta://memory/project  # Project memory content
Prompt:   code_review                   # Structured review template
```

---

## Vayu DAG Integration

All modules expose Vayu-compatible task nodes:

```typescript
// Example: Svapna consolidation as a Vayu DAG
const svapnaDag = {
  nodes: [
    { id: 'replay', task: 'svapna.replay', input: 'session' },
    { id: 'recombine', task: 'svapna.recombine', dependsOn: ['replay'] },
    { id: 'crystallize', task: 'svapna.crystallize', dependsOn: ['recombine'] },
    { id: 'proceduralize', task: 'svapna.proceduralize', dependsOn: ['crystallize'] },
    { id: 'compress', task: 'svapna.compress', dependsOn: ['proceduralize'] },
  ]
};
```
