#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "[release-verify] core engine readiness checks"
pnpm run verify:engine --no-build-check

echo "[release-verify] marga benchmark assertions"
pnpm benchmark:marga -- \
	--runs "${MARGA_RUNS:-80}" \
	--warmup "${MARGA_WARMUP:-20}" \
	--assert-p95-ms "${MARGA_ASSERT_P95_MS:-25}" \
	--assert-throughput "${MARGA_ASSERT_THROUGHPUT:-300}"

echo "[release-verify] mesh soak assertions"
pnpm benchmark:mesh-soak -- \
	--duration-sec "${MESH_DURATION_SEC:-12}" \
	--churn-every-sec "${MESH_CHURN_EVERY_SEC:-4}" \
	--nodes "${MESH_NODES:-3}" \
	--ask-interval-ms "${MESH_ASK_INTERVAL_MS:-70}" \
	--ask-timeout-ms "${MESH_ASK_TIMEOUT_MS:-2500}" \
	--assert-success-rate "${MESH_ASSERT_SUCCESS_RATE:-0.70}" \
	--assert-p95-ms "${MESH_ASSERT_P95_MS:-1500}"

echo "[release-verify] all assertions passed"
