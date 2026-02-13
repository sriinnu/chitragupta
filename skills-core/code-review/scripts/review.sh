#!/bin/bash
set -euo pipefail

# review.sh — Run basic linting checks on a file or directory.
# Usage: review.sh <path> [--fix]

TARGET="${1:-.}"
FIX_FLAG="${2:-}"

echo "=== Code Review Linter ==="
echo "Target: $TARGET"
echo ""

# Detect available linters and run them
run_linter() {
	local name="$1"
	local cmd="$2"
	if command -v "$name" &>/dev/null; then
		echo "--- Running $name ---"
		eval "$cmd" || true
		echo ""
	fi
}

# JavaScript/TypeScript
if command -v npx &>/dev/null; then
	if [ -f "$(dirname "$TARGET")/node_modules/.bin/eslint" ] || [ -f "./node_modules/.bin/eslint" ]; then
		if [ "$FIX_FLAG" = "--fix" ]; then
			run_linter "npx" "npx eslint '$TARGET' --fix 2>&1"
		else
			run_linter "npx" "npx eslint '$TARGET' 2>&1"
		fi
	fi

	if [ -f "$(dirname "$TARGET")/node_modules/.bin/biome" ] || [ -f "./node_modules/.bin/biome" ]; then
		run_linter "npx" "npx biome check '$TARGET' 2>&1"
	fi
fi

# Python
run_linter "ruff" "ruff check '$TARGET' 2>&1"
run_linter "flake8" "flake8 '$TARGET' 2>&1"
run_linter "mypy" "mypy '$TARGET' 2>&1"

# Rust
run_linter "cargo" "cargo clippy --quiet 2>&1"

# Go
run_linter "golangci-lint" "golangci-lint run '$TARGET' 2>&1"

# Shell
run_linter "shellcheck" "shellcheck '$TARGET' 2>&1"

# Generic checks
echo "--- Generic Checks ---"

# Check for debug statements
echo "Debug statements:"
grep -rn "console\.log\|debugger\|print(\|puts \|binding\.pry\|import pdb" "$TARGET" 2>/dev/null | head -20 || echo "  None found."

# Check for TODO/FIXME/HACK
echo ""
echo "TODO/FIXME/HACK markers:"
grep -rn "TODO\|FIXME\|HACK\|XXX" "$TARGET" 2>/dev/null | head -20 || echo "  None found."

# Check for hardcoded secrets patterns
echo ""
echo "Potential hardcoded secrets:"
grep -rn "password\s*=\s*['\"].\+['\"]\\|api_key\s*=\s*['\"].\+['\"]\\|secret\s*=\s*['\"].\+['\"]" "$TARGET" 2>/dev/null | head -10 || echo "  None found."

echo ""
echo "=== Review Complete ==="
