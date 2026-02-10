#!/bin/bash
set -euo pipefail

# branch-check.sh — Verify branch hygiene before committing or pushing.
# Usage: branch-check.sh

echo "=== Branch Hygiene Check ==="
echo ""

# Current branch
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "NOT_A_GIT_REPO")

if [ "$BRANCH" = "NOT_A_GIT_REPO" ]; then
	echo "ERROR: Not inside a git repository."
	exit 1
fi

echo "Branch: $BRANCH"
echo ""

# Check if on main/master (warn)
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
	echo "WARNING: You are on the default branch ($BRANCH)."
	echo "  Consider creating a feature branch before committing."
	echo ""
fi

# Check branch naming convention
if echo "$BRANCH" | grep -qE "^(feat|fix|refactor|docs|test|chore|perf|ci)/"; then
	echo "Branch naming: OK (follows convention)"
elif [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ] || [ "$BRANCH" = "develop" ]; then
	echo "Branch naming: OK (default branch)"
else
	echo "Branch naming: WARNING — does not follow <type>/<description> convention."
	echo "  Expected: feat/*, fix/*, refactor/*, docs/*, test/*, chore/*, perf/*, ci/*"
fi
echo ""

# Uncommitted changes
DIRTY=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
echo "Uncommitted changes: $DIRTY file(s)"
if [ "$DIRTY" -gt 0 ]; then
	git status --short
fi
echo ""

# Unpushed commits
UPSTREAM=$(git rev-parse --abbrev-ref '@{upstream}' 2>/dev/null || echo "NONE")
if [ "$UPSTREAM" != "NONE" ]; then
	AHEAD=$(git rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo "0")
	BEHIND=$(git rev-list --count 'HEAD..@{upstream}' 2>/dev/null || echo "0")
	echo "Upstream: $UPSTREAM"
	echo "  Ahead: $AHEAD commit(s)"
	echo "  Behind: $BEHIND commit(s)"
	if [ "$BEHIND" -gt 0 ]; then
		echo "  WARNING: Branch is behind upstream. Consider rebasing."
	fi
else
	echo "Upstream: Not set (branch has not been pushed)"
fi
echo ""

# Check for large files staged
echo "Large staged files (>1MB):"
git diff --cached --name-only 2>/dev/null | while read -r file; do
	if [ -f "$file" ]; then
		SIZE=$(wc -c < "$file" 2>/dev/null || echo "0")
		if [ "$SIZE" -gt 1048576 ]; then
			echo "  WARNING: $file ($(( SIZE / 1024 ))KB)"
		fi
	fi
done || true
echo "  Check complete."

echo ""
echo "=== Branch Check Complete ==="
