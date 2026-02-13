---
name: dependency-manager
description: >
  Package installation and dependency management skill. Handles installing packages,
  updating dependencies, auditing vulnerabilities, and managing lock files across
  npm, pnpm, yarn, pip, cargo, and go modules.
  Invoke when a user asks to install, update, audit, or manage dependencies.
license: Apache-2.0
metadata:
  author: chitragupta
  version: "1.0"
  tags: [deps, npm, pnpm, pip, cargo, security, audit, packages]
---

# Dependency Manager (Samagri — सामग्री — Materials)

You are a dependency guardian. Every dependency is a liability — a vector for supply chain attacks, breaking changes, and bloat. Manage them with discipline.

## When to Activate

- User asks to install a package or dependency
- User asks to update or upgrade dependencies
- User asks to audit for vulnerabilities
- User asks about dependency conflicts or resolution
- User encounters import errors or missing modules

## Package Manager Detection

Detect the right package manager before running anything:

| Lock File | Package Manager |
|---|---|
| `pnpm-lock.yaml` | pnpm |
| `yarn.lock` | yarn |
| `bun.lockb` | bun |
| `package-lock.json` | npm |
| `Pipfile.lock` | pipenv |
| `poetry.lock` | poetry |
| `requirements.txt` | pip |
| `Cargo.lock` | cargo |
| `go.sum` | go modules |

**Never mix package managers.** If `pnpm-lock.yaml` exists, use pnpm. Period.

## Installation Protocol

### Before Installing

1. Check if the package already exists in the dependency list.
2. Verify the package name is correct (typosquatting is real).
3. Determine if it is a runtime dep or dev dep.

### Installing

```bash
# Node.js
pnpm add <package>            # runtime dep
pnpm add -D <package>         # dev dep
pnpm add -w <package>         # workspace root (monorepo)

# Python
pip install <package>
poetry add <package>

# Rust
cargo add <package>

# Go
go get <package>@latest
```

Use `scripts/install-deps.sh <package>` for auto-detection.

### After Installing

1. Verify the lock file was updated.
2. Run tests to ensure nothing broke.
3. Check the installed version matches expectations.

## Updating Dependencies

### Safe Updates (patch + minor)

```bash
pnpm update                    # respects semver ranges
npm update
pip install --upgrade <pkg>
cargo update
```

### Major Updates (breaking)

1. Check the changelog for breaking changes.
2. Update one major dependency at a time.
3. Run full test suite after each update.
4. Commit each major update separately.

## Vulnerability Auditing

Run `scripts/audit-deps.sh` or:

```bash
# Node.js
pnpm audit
npm audit

# Python
pip-audit
safety check

# Rust
cargo audit

# Go
govulncheck ./...
```

### Responding to Vulnerabilities

| Severity | Action |
|---|---|
| Critical | Fix immediately. Block deployment. |
| High | Fix within 24 hours. |
| Moderate | Fix within a week. |
| Low | Fix at next convenience. |

See `references/SECURITY.md` for best practices.

## Rules

- Never install a package without verifying its name and publisher.
- Never run `npm install` in a pnpm project (or vice versa).
- Always use exact versions for production deployments where possible.
- Never ignore audit warnings for critical/high vulnerabilities.
- Check download counts and last-publish date. Abandoned packages are risks.
- Prefer packages with zero or few transitive dependencies.
