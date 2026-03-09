# Release and Repo Hygiene

This document defines the root-level release/operator flow for Chitragupta's engine-first monorepo slice.

## Scope

- Root `scripts/`
- Root `package.json` scripts
- Root docs that point operators to build/publish/subtree actions

No package-internal behavior is changed by this flow.

## Build Hygiene

Use the dependency-audited workspace build path:

```bash
pnpm run build:check
pnpm run build
```

- `build:check` validates workspace import/dependency declarations and build graph order.
- `build` executes package builds in graph order via `scripts/build-workspace.mjs`.

For production readiness on core runtime surfaces:

```bash
pnpm run verify:engine
```

This verifies critical daemon/cli/smriti/tantra auth, recovery, memory, and autonomous orchestration paths with targeted typechecks + vitest suites.

For additional source-shape audits (stricter but more refactor-sensitive), run:

```bash
pnpm run verify:engine --with-audits
```

## Publish Hygiene

Dry run:

```bash
pnpm run publish:dry
```

Real publish:

```bash
pnpm run publish:real
```

`scripts/publish.sh` now:

1. runs `build:check` then `build`
2. bundles + assembles types
3. prepares `dist/` and runs pack preview from inside `dist/`
4. publishes from inside `dist/`
5. tags git only when safe for current repository layout

`scripts/release-verify.sh` now starts by running:

```bash
pnpm run verify:engine --no-build-check
```

before benchmark assertions.

### Subtree-safe tagging

If Chitragupta is nested inside a larger git root, publish skips tagging by default to avoid tagging the parent repo unintentionally.

- Force tag anyway: `ALLOW_SUBTREE_GIT_TAG=1 pnpm run publish:real`
- Skip tag explicitly: `SKIP_GIT_TAG=1 pnpm run publish:real`

## Subtree Hygiene

When this directory is maintained as a subtree in a larger repo, use:

```bash
pnpm run subtree:split
pnpm run subtree:push
```

Or direct script usage:

```bash
bash scripts/subtree-sync.sh --remote chitragupta-repo --branch main --push
```

Behavior:

- auto-detects git top-level
- auto-detects subtree prefix from package root to top-level
- prints split SHA in dry mode
- pushes split SHA to selected remote/branch in push mode

Override defaults with:

- `SUBTREE_REMOTE`
- `SUBTREE_BRANCH`
