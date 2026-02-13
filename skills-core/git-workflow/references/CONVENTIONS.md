# Commit Message Conventions

Based on [Conventional Commits](https://www.conventionalcommits.org/) v1.0.0.

## Format

```
<type>(<optional scope>): <description>

[optional body]

[optional footer(s)]
```

## Types

| Type | When to Use |
|---|---|
| `feat` | New feature for the user |
| `fix` | Bug fix for the user |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `docs` | Documentation only changes |
| `test` | Adding or fixing tests |
| `chore` | Build process, tooling, deps, CI changes |
| `perf` | Performance improvement |
| `ci` | CI/CD configuration changes |
| `style` | Formatting, semicolons, etc. — no logic change |
| `revert` | Reverts a previous commit |

## Scope

Optional. Identifies the area of the codebase affected.

```
feat(auth): add JWT refresh token rotation
fix(parser): handle empty input without crash
refactor(core): extract validation into separate module
```

## Description

- Imperative mood: "add" not "added" or "adds"
- Lowercase first letter
- No period at the end
- Under 72 characters

## Body

- Explain **why**, not what. The diff shows what.
- Wrap at 72 characters.
- Separate from subject with a blank line.

## Footer

- `BREAKING CHANGE: <description>` for breaking changes
- `Fixes #123` or `Closes #456` for issue references
- `Refs #789` for related issues

## Examples

```
feat(auth): add OAuth2 login with Google provider

Users can now sign in with their Google account. The OAuth flow
handles token exchange and profile retrieval. Refresh tokens are
stored encrypted in the session store.

Closes #42
```

```
fix(api): prevent race condition in concurrent session writes

The session store was not serializing concurrent writes, leading to
data loss when multiple requests updated the same session. Added a
per-session write queue using promise chaining.

Fixes #187
```

```
refactor(core): extract config validation into dedicated module

No behavior change. Moves validation logic out of the 800-line
bootstrap file into a focused module with proper types.
```

```
chore: update dependencies to fix npm audit warnings
```
