#!/usr/bin/env bash
#
# publish.sh — Build, bundle, and publish @yugenlab/chitragupta as a single npm package.
#
# Usage:
#   ./scripts/publish.sh                 # dry-run (default)
#   ./scripts/publish.sh --real          # actually publish to npm
#   ./scripts/publish.sh --bump patch    # bump version before publish (patch|minor|major)
#   ./scripts/publish.sh --bump minor --real
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ── Defaults ──────────────────────────────────────────────────────────
DRY_RUN=true
BUMP=""
SKIP_TESTS=false

# ── Parse flags ───────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
	case "$1" in
		--real)
			DRY_RUN=false
			shift
			;;
		--bump)
			BUMP="$2"
			if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
				echo "Error: --bump must be patch, minor, or major (got: $BUMP)"
				exit 1
			fi
			shift 2
			;;
		--skip-tests)
			SKIP_TESTS=true
			shift
			;;
		--help|-h)
			echo "Usage: ./scripts/publish.sh [--real] [--bump patch|minor|major] [--skip-tests]"
			echo ""
			echo "  --real          Actually publish (default is dry-run)"
			echo "  --bump <level>  Bump version before publishing"
			echo "  --skip-tests    Skip test suite"
			echo "  --help          Show this help message"
			exit 0
			;;
		*)
			echo "Unknown flag: $1"
			exit 1
			;;
	esac
done

# ── Colors ────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
fail()  { echo -e "${RED}[fail]${NC}  $*"; exit 1; }

echo ""
echo -e "${CYAN}━━━ @yugenlab/chitragupta publish ━━━${NC}"
echo ""

# ── Pre-flight checks ────────────────────────────────────────────────
info "Pre-flight checks..."

NODE_VERSION=$(node -v)
NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v\([0-9]*\).*/\1/')
if [[ "$NODE_MAJOR" -lt 22 ]]; then
	fail "Node.js >= 22 required (found $NODE_VERSION)"
fi
ok "Node.js $NODE_VERSION"

if [[ "$DRY_RUN" == false ]]; then
	if ! npm whoami &>/dev/null; then
		fail "Not logged in to npm. Run 'npm login' first."
	fi
	ok "Logged in as $(npm whoami)"
else
	warn "Dry-run mode — skipping npm auth check"
fi

# ── Version bump ──────────────────────────────────────────────────────
PUBLISH_JSON="$ROOT/package.publish.json"

if [[ -n "$BUMP" ]]; then
	info "Bumping version ($BUMP)..."

	CURRENT=$(node -p "JSON.parse(require('fs').readFileSync('$PUBLISH_JSON','utf8')).version")
	IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

	case "$BUMP" in
		major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
		minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
		patch) PATCH=$((PATCH + 1)) ;;
	esac

	NEW_VERSION="$MAJOR.$MINOR.$PATCH"

	# Update package.publish.json
	node -e "
		const fs = require('fs');
		const pkg = JSON.parse(fs.readFileSync('$PUBLISH_JSON', 'utf8'));
		pkg.version = '$NEW_VERSION';
		fs.writeFileSync('$PUBLISH_JSON', JSON.stringify(pkg, null, '\t') + '\n');
	"

	# Update root package.json to match
	node -e "
		const fs = require('fs');
		const pkg = JSON.parse(fs.readFileSync('$ROOT/package.json', 'utf8'));
		pkg.version = '$NEW_VERSION';
		fs.writeFileSync('$ROOT/package.json', JSON.stringify(pkg, null, '\t') + '\n');
	"

	ok "Version bumped: $CURRENT -> $NEW_VERSION"
fi

VERSION=$(node -p "JSON.parse(require('fs').readFileSync('$PUBLISH_JSON','utf8')).version")
info "Publishing version: $VERSION"

# ── Clean ─────────────────────────────────────────────────────────────
info "Cleaning previous builds..."
rm -rf "$ROOT/dist"
pnpm run clean 2>/dev/null || true
ok "Clean"

# ── Build all packages with tsc ──────────────────────────────────────
info "Building all packages (tsc)..."
pnpm -r run build
ok "All packages built"

# ── Bundle with esbuild ──────────────────────────────────────────────
info "Bundling with esbuild..."
node scripts/bundle.mjs
ok "Bundle complete"

# ── Assemble type declarations ────────────────────────────────────────
info "Assembling type declarations..."
node scripts/build-types.mjs
ok "Types assembled"

# ── Prepare dist/ for publishing ──────────────────────────────────────
info "Preparing dist/ for publish..."

# Copy publishable package.json
cp "$PUBLISH_JSON" "$ROOT/dist/package.json"

# Copy README (use npm-specific if it exists, otherwise root)
if [[ -f "$ROOT/README.npm.md" ]]; then
	cp "$ROOT/README.npm.md" "$ROOT/dist/README.md"
elif [[ -f "$ROOT/README.md" ]]; then
	cp "$ROOT/README.md" "$ROOT/dist/README.md"
fi

# Copy LICENSE
if [[ -f "$ROOT/LICENSE" ]]; then
	cp "$ROOT/LICENSE" "$ROOT/dist/LICENSE"
fi

# Remove metafile (not for publishing)
rm -f "$ROOT/dist/meta.json"

ok "dist/ ready"

# ── Tests ─────────────────────────────────────────────────────────────
if [[ "$SKIP_TESTS" == true ]]; then
	warn "Skipping tests (--skip-tests)"
else
	info "Running tests..."
	if npx vitest run; then
		ok "All tests passed"
	else
		warn "Some tests failed — review output above"
		if [[ "$DRY_RUN" == false ]]; then
			fail "Cannot publish with failing tests. Fix tests or use --skip-tests."
		fi
	fi
fi

# ── Publish ───────────────────────────────────────────────────────────
echo ""
if [[ "$DRY_RUN" == true ]]; then
	info "=== DRY RUN ==="
	echo ""
	info "Package contents:"
	npm pack --dry-run "$ROOT/dist" 2>&1 | head -50
	echo ""
	ok "Dry run complete. Use --real to publish for real."
else
	warn "=== PUBLISHING TO NPM ==="
	echo ""

	# Publish from dist/
	npm publish "$ROOT/dist"
	ok "@yugenlab/chitragupta@$VERSION published!"

	# Git tag
	TAG="v$VERSION"
	info "Creating git tag: $TAG"
	git tag "$TAG"
	ok "Tagged $TAG"

	echo ""
	ok "Done! Run 'git push && git push --tags' to push."
fi
