#!/bin/bash
set -euo pipefail

# run-tests.sh — Run tests with the detected framework.
# Usage: run-tests.sh [--coverage] [--watch] [path]

COVERAGE=""
WATCH=""
TARGET=""

for arg in "$@"; do
	case "$arg" in
		--coverage) COVERAGE="1" ;;
		--watch) WATCH="1" ;;
		*) TARGET="$arg" ;;
	esac
done

echo "=== Test Runner ==="

# Detect package manager
detect_pm() {
	if [ -f "pnpm-lock.yaml" ]; then echo "pnpm"
	elif [ -f "yarn.lock" ]; then echo "yarn"
	elif [ -f "bun.lockb" ]; then echo "bun"
	elif [ -f "package-lock.json" ]; then echo "npm"
	else echo "npm"
	fi
}

# Node.js project
if [ -f "package.json" ]; then
	PM=$(detect_pm)
	echo "Package manager: $PM"

	# Detect test framework
	if [ -f "vitest.config.ts" ] || [ -f "vitest.config.js" ] || [ -f "vitest.config.mts" ]; then
		FRAMEWORK="vitest"
	elif grep -q '"jest"' package.json 2>/dev/null; then
		FRAMEWORK="jest"
	elif [ -f ".mocharc.yml" ] || [ -f ".mocharc.json" ]; then
		FRAMEWORK="mocha"
	else
		FRAMEWORK="script"
	fi

	echo "Framework: $FRAMEWORK"
	echo ""

	case "$FRAMEWORK" in
		vitest)
			CMD="npx vitest run"
			[ -n "$COVERAGE" ] && CMD="$CMD --coverage"
			[ -n "$WATCH" ] && CMD="npx vitest"
			[ -n "$TARGET" ] && CMD="$CMD $TARGET"
			;;
		jest)
			CMD="npx jest"
			[ -n "$COVERAGE" ] && CMD="$CMD --coverage"
			[ -n "$WATCH" ] && CMD="$CMD --watch"
			[ -n "$TARGET" ] && CMD="$CMD $TARGET"
			;;
		mocha)
			CMD="npx mocha"
			[ -n "$TARGET" ] && CMD="$CMD $TARGET"
			;;
		script)
			CMD="$PM test"
			;;
	esac

	echo "Running: $CMD"
	echo "---"
	eval "$CMD"
	exit $?
fi

# Python project
if [ -f "pyproject.toml" ] || [ -f "pytest.ini" ] || [ -f "setup.py" ]; then
	CMD="pytest -v"
	[ -n "$COVERAGE" ] && CMD="$CMD --cov=src --cov-report=term-missing"
	[ -n "$TARGET" ] && CMD="$CMD $TARGET"
	echo "Framework: pytest"
	echo "Running: $CMD"
	echo "---"
	eval "$CMD"
	exit $?
fi

# Rust project
if [ -f "Cargo.toml" ]; then
	CMD="cargo test"
	[ -n "$TARGET" ] && CMD="$CMD $TARGET"
	echo "Framework: cargo test"
	echo "Running: $CMD"
	echo "---"
	eval "$CMD"
	exit $?
fi

# Go project
if [ -f "go.mod" ]; then
	CMD="go test -v"
	[ -n "$COVERAGE" ] && CMD="$CMD -coverprofile=coverage.out"
	if [ -n "$TARGET" ]; then
		CMD="$CMD $TARGET"
	else
		CMD="$CMD ./..."
	fi
	echo "Framework: go test"
	echo "Running: $CMD"
	echo "---"
	eval "$CMD"
	exit $?
fi

echo "ERROR: No recognized test framework detected."
exit 1
