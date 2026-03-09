#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RUN_BUILD_CHECK=true
RUN_TYPECHECK=true
RUN_AUDITS=false

while [[ $# -gt 0 ]]; do
	case "$1" in
		--no-build-check)
			RUN_BUILD_CHECK=false
			shift
			;;
		--tests-only)
			RUN_BUILD_CHECK=false
			RUN_TYPECHECK=false
			shift
			;;
		--no-typecheck)
			RUN_TYPECHECK=false
			shift
			;;
		--with-audits)
			RUN_AUDITS=true
			shift
			;;
		--help|-h)
			echo "Usage: bash scripts/verify-engine-readiness.sh [--no-build-check] [--no-typecheck] [--tests-only] [--with-audits]"
			echo ""
			echo "  --no-build-check  Skip workspace build-graph audit"
			echo "  --no-typecheck    Skip targeted typechecks"
			echo "  --tests-only      Run only the critical vitest suites"
			echo "  --with-audits     Include brittle source-structure audit tests"
			echo "  --help            Show help"
			exit 0
			;;
		*)
			echo "[fail] Unknown flag: $1"
			exit 1
			;;
	esac
done

echo ""
echo "[verify:engine] Starting core engine readiness verification"
echo "[verify:engine] Scope: daemon + cli + smriti + tantra (auth/recovery/memory/autonomous paths)"

if [[ "$RUN_BUILD_CHECK" == true ]]; then
	echo ""
	echo "[verify:engine] build graph check"
	pnpm run build:check
fi

if [[ "$RUN_TYPECHECK" == true ]]; then
	echo ""
	echo "[verify:engine] targeted typechecks"
	pnpm exec tsc -p packages/daemon/tsconfig.json --noEmit
	pnpm exec tsc -p packages/cli/tsconfig.json --noEmit
	pnpm exec tsc -p packages/smriti/tsconfig.json --noEmit
	pnpm exec tsc -p packages/tantra/tsconfig.json --noEmit
fi

echo ""
echo "[verify:engine] targeted vitest suites"
TEST_FILES=(
	packages/daemon/test/auth.test.ts
	packages/daemon/test/server-auth.test.ts
	packages/daemon/test/resilience.test.ts
	packages/daemon/test/scarlett-internal.test.ts
	packages/daemon/test/scarlett-signal-bridge.test.ts
	packages/daemon/test/server-integration.test.ts
	packages/daemon/test/services-collaboration-contract.test.ts
	packages/daemon/test/services-collaboration-helpers.test.ts
	packages/daemon/test/services-contract-catalog.test.ts
	packages/daemon/test/services-discovery.test.ts
	packages/daemon/test/services-binding.test.ts
	packages/cli/test/daemon-bridge-contract.test.ts
	packages/cli/test/daemon-bridge-recovery.test.ts
	packages/cli/test/mcp-tool-guidance.test.ts
	packages/cli/test/nervous-system-wiring.test.ts
	packages/cli/test/coding-agent-tool.test.ts
	packages/cli/test/mcp-subsystems-transcendence.test.ts
	packages/cli/test/lucy-bridge-fresh.test.ts
	packages/smriti/test/session-store.test.ts
	packages/smriti/test/db.test.ts
	packages/smriti/test/akasha.test.ts
	packages/smriti/test/transcendence.test.ts
	packages/tantra/test/mcp-autonomous.test.ts
	packages/tantra/test/server-lifecycle.test.ts
	packages/tantra/test/client.test.ts
	packages/tantra/test/server.test.ts
	packages/tantra/test/transport-streamable-http.test.ts
)

if [[ "$RUN_AUDITS" == true ]]; then
	echo "[verify:engine] including source-structure audit suites"
	TEST_FILES+=(
		packages/cli/test/daemon-data-plane-audit.test.ts
		packages/cli/test/daemon-bridge-contract.test.ts
	)
fi

pnpm exec vitest run "${TEST_FILES[@]}"

echo ""
echo "[verify:engine] PASS"
