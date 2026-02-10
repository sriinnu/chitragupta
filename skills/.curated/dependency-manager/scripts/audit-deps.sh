#!/bin/bash
set -euo pipefail

# audit-deps.sh — Check dependencies for known vulnerabilities.
# Usage: audit-deps.sh [directory]

ROOT="${1:-.}"
cd "$ROOT"

echo "=== Dependency Audit ==="
echo "Directory: $(pwd)"
echo ""

FOUND_PM=0

# Node.js — pnpm
if [ -f "pnpm-lock.yaml" ]; then
	FOUND_PM=1
	echo "--- pnpm audit ---"
	pnpm audit 2>&1 || true
	echo ""
fi

# Node.js — npm
if [ -f "package-lock.json" ] && [ ! -f "pnpm-lock.yaml" ]; then
	FOUND_PM=1
	echo "--- npm audit ---"
	npm audit 2>&1 || true
	echo ""
fi

# Node.js — yarn
if [ -f "yarn.lock" ]; then
	FOUND_PM=1
	echo "--- yarn audit ---"
	yarn audit 2>&1 || true
	echo ""
fi

# Python — pip-audit
if [ -f "requirements.txt" ] || [ -f "pyproject.toml" ] || [ -f "Pipfile" ]; then
	FOUND_PM=1
	if command -v pip-audit &>/dev/null; then
		echo "--- pip-audit ---"
		pip-audit 2>&1 || true
	elif command -v safety &>/dev/null; then
		echo "--- safety check ---"
		safety check 2>&1 || true
	else
		echo "Python project detected but no audit tool found."
		echo "Install: pip install pip-audit"
	fi
	echo ""
fi

# Rust
if [ -f "Cargo.lock" ]; then
	FOUND_PM=1
	if command -v cargo-audit &>/dev/null; then
		echo "--- cargo audit ---"
		cargo audit 2>&1 || true
	else
		echo "Rust project detected but cargo-audit not found."
		echo "Install: cargo install cargo-audit"
	fi
	echo ""
fi

# Go
if [ -f "go.sum" ]; then
	FOUND_PM=1
	if command -v govulncheck &>/dev/null; then
		echo "--- govulncheck ---"
		govulncheck ./... 2>&1 || true
	else
		echo "Go project detected but govulncheck not found."
		echo "Install: go install golang.org/x/vuln/cmd/govulncheck@latest"
	fi
	echo ""
fi

if [ "$FOUND_PM" -eq 0 ]; then
	echo "No recognized package manager detected."
	exit 1
fi

echo "=== Audit Complete ==="
