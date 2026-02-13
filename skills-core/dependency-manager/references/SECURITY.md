# Dependency Security Best Practices

## Supply Chain Threats

| Threat | Description | Mitigation |
|---|---|---|
| Typosquatting | Malicious package with similar name | Verify name, check publisher, check download count |
| Dependency confusion | Private name hijacked on public registry | Use scoped packages, configure registry |
| Compromised maintainer | Legit package taken over | Pin versions, review changelogs |
| Malicious postinstall | Code runs during `npm install` | Use `--ignore-scripts` for untrusted packages |
| Protestware | Maintainer adds destructive code | Lock versions, audit updates |
| Abandoned packages | No security patches | Check last publish date, find alternatives |

## Verification Checklist

Before adding a new dependency:

1. **Is it necessary?** Can you write 20 lines instead of adding a dependency?
2. **Who publishes it?** Known org/person or anonymous?
3. **How many downloads?** Below 1000/week is a red flag for non-niche packages.
4. **When was it last updated?** Over 2 years ago = likely abandoned.
5. **How many dependencies?** Fewer is better. Check transitive deps.
6. **Is it typed?** Built-in types or @types/ available?
7. **What's the license?** Compatible with your project?
8. **Does it have postinstall scripts?** Review them.

## Lock Files

- **Always commit lock files** (pnpm-lock.yaml, package-lock.json, etc.)
- Lock files ensure reproducible builds.
- Never manually edit lock files.
- Regenerate if corrupted: delete lock file and node_modules, reinstall.

## Version Pinning Strategy

| Environment | Strategy | Why |
|---|---|---|
| Libraries | Semver ranges (`^1.2.3`) | Consumers need flexibility |
| Applications | Exact versions or lock file | Reproducible deployments |
| CI/CD | Lock file only | Deterministic builds |

## Automated Auditing

Set up automated vulnerability scanning:

- **GitHub**: Dependabot or Renovate
- **GitLab**: Dependency Scanning
- **CI**: Run `pnpm audit` / `npm audit` in CI pipeline
- **Pre-commit**: Add audit to pre-push hooks

## Responding to CVEs

1. Check if the vulnerability is exploitable in your usage.
2. If yes: update immediately, even if it means a breaking change.
3. If no: update at next convenience, document the decision.
4. If no patch exists: find an alternative package or patch locally.
5. Never ignore critical vulnerabilities. Ever.
