# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.5.x   | Yes       |
| < 0.5   | No        |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public issue
2. Email **sriinnu@proton.me** with:
   - A description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)
3. You will receive an acknowledgement within 48 hours
4. A fix will be developed privately and released as a patch

## Security Features

Chitragupta includes several security layers by design:

### Dharma Policy Engine (`@chitragupta/dharma`)

- **Permission guards** — tool calls require explicit approval for destructive operations
- **Rate limiting** — configurable per-tool and per-session limits
- **Command filtering** — destructive shell commands are detected and blocked
- **Karma tracking** — behavioral scoring for agent actions

### Credential Protection (`@chitragupta/yantra`)

- **`.env` fortress** — automatic detection and redaction of secrets in tool output
- **Credential allowlist** — only known-safe environment variables are injected
- **File permissions** — credentials stored with `chmod 600`

### Sandbox Execution

- **Git worktree isolation** — sandboxed commands run in isolated filesystem copies
- **Process isolation** — sandboxed processes run with restricted capabilities
- **Timeout enforcement** — all tool executions have configurable hard timeouts

### Memory Safety (`@chitragupta/smriti`)

- **No credential persistence** — secrets are never written to memory or session files
- **Scoped access** — memory is isolated per project and per agent
- **Compaction safety** — compaction preserves security-relevant context

## Completed Audit

A full 36-issue security audit was completed on 2026-02-07:

- **7 critical** issues — all resolved
- **10 high** issues — all resolved
- **12 medium** issues — all resolved
- **7 low** issues — all resolved

See [AUDIT_REPORT.md](AUDIT_REPORT.md) for the complete findings and resolutions.

## Dependencies

- Dependencies are kept minimal by design
- `pnpm audit` is run as part of the release process
- Native dependencies (`better-sqlite3`) are pinned and use `prebuild-install`
