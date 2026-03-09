#!/usr/bin/env bash
#
# subtree-sync.sh — Split/push this package directory as a subtree from a larger git root.
#
# Defaults:
#   remote: chitragupta-repo
#   branch: main
#   mode: split only (no push)
#
# Examples:
#   bash scripts/subtree-sync.sh
#   bash scripts/subtree-sync.sh --push
#   bash scripts/subtree-sync.sh --remote origin --branch release --push
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOP="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null || true)"

if [[ -z "$TOP" ]]; then
	echo "[fail] Not inside a git repository."
	exit 1
fi

REMOTE="${SUBTREE_REMOTE:-chitragupta-repo}"
BRANCH="${SUBTREE_BRANCH:-main}"
PUSH=false

while [[ $# -gt 0 ]]; do
	case "$1" in
		--)
			shift
			;;
		--remote)
			REMOTE="$2"
			shift 2
			;;
		--branch)
			BRANCH="$2"
			shift 2
			;;
		--push)
			PUSH=true
			shift
			;;
		--help|-h)
			echo "Usage: bash scripts/subtree-sync.sh [--remote <name>] [--branch <name>] [--push]"
			echo ""
			echo "  --remote <name>  Remote name to push split SHA to (default: chitragupta-repo)"
			echo "  --branch <name>  Target branch on remote (default: main)"
			echo "  --push           Push split SHA to remote branch"
			echo "  --help           Show help"
			exit 0
			;;
		*)
			echo "[fail] Unknown flag: $1"
			exit 1
			;;
	esac
done

PREFIX="."
if [[ "$ROOT" != "$TOP" ]]; then
	PREFIX="${ROOT#"$TOP"/}"
fi

echo "[info] Git top-level: $TOP"
if [[ "$PREFIX" == "." ]]; then
	echo "[info] Package root is git top-level; using HEAD directly (no subtree split needed)."
	SPLIT_SHA="$(git -C "$TOP" rev-parse HEAD)"
else
	echo "[info] Subtree prefix: $PREFIX"
	SPLIT_SHA="$(git -C "$TOP" subtree split --prefix="$PREFIX")"
fi

echo "[ok] Split SHA: $SPLIT_SHA"

if [[ "$PUSH" == true ]]; then
	echo "[info] Pushing $SPLIT_SHA to $REMOTE:$BRANCH"
	git -C "$TOP" push "$REMOTE" "$SPLIT_SHA:$BRANCH"
	echo "[ok] Push complete."
else
	echo "[info] Dry mode. Re-run with --push to publish subtree SHA."
fi
