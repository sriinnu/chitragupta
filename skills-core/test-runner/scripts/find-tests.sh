#!/bin/bash
set -euo pipefail

# find-tests.sh — Discover test files by framework convention.
# Usage: find-tests.sh [directory]

ROOT="${1:-.}"

echo "=== Test File Discovery ==="
echo "Root: $ROOT"
echo ""

count_files() {
	local pattern="$1"
	local label="$2"
	local count
	count=$(find "$ROOT" -type f -name "$pattern" \
		-not -path "*/node_modules/*" \
		-not -path "*/.git/*" \
		-not -path "*/dist/*" \
		-not -path "*/build/*" \
		-not -path "*/__pycache__/*" \
		-not -path "*/target/*" \
		2>/dev/null | wc -l | tr -d ' ')
	if [ "$count" -gt 0 ]; then
		echo "$label: $count file(s)"
		find "$ROOT" -type f -name "$pattern" \
			-not -path "*/node_modules/*" \
			-not -path "*/.git/*" \
			-not -path "*/dist/*" \
			-not -path "*/build/*" \
			-not -path "*/__pycache__/*" \
			-not -path "*/target/*" \
			2>/dev/null | head -20
		if [ "$count" -gt 20 ]; then
			echo "  ... and $(( count - 20 )) more"
		fi
		echo ""
	fi
}

# JavaScript / TypeScript
count_files "*.test.ts" "TypeScript tests (*.test.ts)"
count_files "*.spec.ts" "TypeScript specs (*.spec.ts)"
count_files "*.test.tsx" "React/TSX tests (*.test.tsx)"
count_files "*.test.js" "JavaScript tests (*.test.js)"
count_files "*.spec.js" "JavaScript specs (*.spec.js)"

# Python
count_files "test_*.py" "Python tests (test_*.py)"
count_files "*_test.py" "Python tests (*_test.py)"

# Rust (tests are inline, but check for integration tests)
if [ -d "$ROOT/tests" ]; then
	count_files "*.rs" "Rust integration tests"
fi

# Go
count_files "*_test.go" "Go tests (*_test.go)"

# Detect framework from config
echo "--- Framework Detection ---"
[ -f "$ROOT/vitest.config.ts" ] || [ -f "$ROOT/vitest.config.js" ] && echo "Detected: Vitest" || true
[ -f "$ROOT/jest.config.ts" ] || [ -f "$ROOT/jest.config.js" ] || [ -f "$ROOT/jest.config.json" ] && echo "Detected: Jest" || true
[ -f "$ROOT/pytest.ini" ] || [ -f "$ROOT/pyproject.toml" ] && echo "Detected: Pytest" || true
[ -f "$ROOT/.mocharc.yml" ] || [ -f "$ROOT/.mocharc.json" ] && echo "Detected: Mocha" || true
[ -f "$ROOT/Cargo.toml" ] && echo "Detected: Cargo test" || true

echo ""
echo "=== Discovery Complete ==="
