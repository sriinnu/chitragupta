#!/bin/bash
set -euo pipefail

# install-deps.sh — Install dependencies using the correct package manager.
# Usage: install-deps.sh [package] [--dev]
#   No arguments: install all deps from lock file
#   With package: install a specific package
#   --dev: install as dev dependency

PACKAGE="${1:-}"
DEV_FLAG=""

for arg in "$@"; do
	if [ "$arg" = "--dev" ] || [ "$arg" = "-D" ]; then
		DEV_FLAG="1"
		# Remove --dev from package if it was first arg
		if [ "$PACKAGE" = "--dev" ] || [ "$PACKAGE" = "-D" ]; then
			PACKAGE="${2:-}"
		fi
	fi
done

echo "=== Dependency Installer ==="

# Detect package manager
if [ -f "pnpm-lock.yaml" ]; then
	PM="pnpm"
elif [ -f "yarn.lock" ]; then
	PM="yarn"
elif [ -f "bun.lockb" ]; then
	PM="bun"
elif [ -f "package-lock.json" ]; then
	PM="npm"
elif [ -f "Pipfile" ]; then
	PM="pipenv"
elif [ -f "poetry.lock" ]; then
	PM="poetry"
elif [ -f "requirements.txt" ] || [ -f "pyproject.toml" ]; then
	PM="pip"
elif [ -f "Cargo.toml" ]; then
	PM="cargo"
elif [ -f "go.mod" ]; then
	PM="go"
else
	echo "ERROR: No recognized package manager detected."
	exit 1
fi

echo "Package manager: $PM"

if [ -z "$PACKAGE" ]; then
	echo "Action: Install all dependencies"
	echo "---"
	case "$PM" in
		pnpm)   pnpm install ;;
		yarn)   yarn install ;;
		bun)    bun install ;;
		npm)    npm install ;;
		pipenv) pipenv install ;;
		poetry) poetry install ;;
		pip)    pip install -r requirements.txt ;;
		cargo)  cargo build ;;
		go)     go mod download ;;
	esac
else
	echo "Package: $PACKAGE"
	echo "Dev dependency: ${DEV_FLAG:-no}"
	echo "---"
	case "$PM" in
		pnpm)
			if [ -n "$DEV_FLAG" ]; then pnpm add -D "$PACKAGE"
			else pnpm add "$PACKAGE"; fi
			;;
		yarn)
			if [ -n "$DEV_FLAG" ]; then yarn add -D "$PACKAGE"
			else yarn add "$PACKAGE"; fi
			;;
		bun)
			if [ -n "$DEV_FLAG" ]; then bun add -d "$PACKAGE"
			else bun add "$PACKAGE"; fi
			;;
		npm)
			if [ -n "$DEV_FLAG" ]; then npm install --save-dev "$PACKAGE"
			else npm install "$PACKAGE"; fi
			;;
		pipenv)
			if [ -n "$DEV_FLAG" ]; then pipenv install --dev "$PACKAGE"
			else pipenv install "$PACKAGE"; fi
			;;
		poetry)
			if [ -n "$DEV_FLAG" ]; then poetry add --group dev "$PACKAGE"
			else poetry add "$PACKAGE"; fi
			;;
		pip)    pip install "$PACKAGE" ;;
		cargo)  cargo add "$PACKAGE" ;;
		go)     go get "$PACKAGE" ;;
	esac
fi

echo ""
echo "=== Installation Complete ==="
