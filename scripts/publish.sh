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
GIT_TOP="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null || true)"
IS_SUBTREE_REPO=false
if [[ -n "$GIT_TOP" && "$GIT_TOP" != "$ROOT" ]]; then
	IS_SUBTREE_REPO=true
fi

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
	if [[ "$SKIP_TESTS" == true && "${ALLOW_UNSAFE_SKIP_TESTS:-0}" != "1" ]]; then
		fail "--skip-tests is blocked for real publishes. Set ALLOW_UNSAFE_SKIP_TESTS=1 to override explicitly."
	fi
else
	warn "Dry-run mode — skipping npm auth check"
fi

# ── Version bump ──────────────────────────────────────────────────────
PUBLISH_JSON="$ROOT/package.publish.json"
ROOT_PACKAGE_JSON="$ROOT/package.json"

if [[ -n "$BUMP" ]]; then
	info "Bumping version ($BUMP)..."

	CURRENT=$(node -p "JSON.parse(require('fs').readFileSync('$ROOT_PACKAGE_JSON','utf8')).version")
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
		const pkg = JSON.parse(fs.readFileSync('$ROOT_PACKAGE_JSON', 'utf8'));
		pkg.version = '$NEW_VERSION';
		fs.writeFileSync('$ROOT_PACKAGE_JSON', JSON.stringify(pkg, null, '\t') + '\n');
	"

	ok "Version bumped: $CURRENT -> $NEW_VERSION"
fi

ROOT_VERSION=$(node -p "JSON.parse(require('fs').readFileSync('$ROOT_PACKAGE_JSON','utf8')).version")
PUBLISH_VERSION=$(node -p "JSON.parse(require('fs').readFileSync('$PUBLISH_JSON','utf8')).version")
if [[ "$ROOT_VERSION" != "$PUBLISH_VERSION" ]]; then
	warn "package.publish.json version ($PUBLISH_VERSION) did not match package.json ($ROOT_VERSION); syncing publish metadata"
	node -e "
		const fs = require('fs');
		const publish = JSON.parse(fs.readFileSync('$PUBLISH_JSON', 'utf8'));
		publish.version = '$ROOT_VERSION';
		fs.writeFileSync('$PUBLISH_JSON', JSON.stringify(publish, null, '\t') + '\n');
	"
fi
VERSION="$ROOT_VERSION"
info "Publishing version: $VERSION"

# ── Clean ─────────────────────────────────────────────────────────────
info "Cleaning previous builds..."
rm -rf "$ROOT/dist"
pnpm run clean 2>/dev/null || true
ok "Clean"

# ── Build all packages with tsc ──────────────────────────────────────
info "Validating workspace build graph..."
pnpm run build:check
ok "Workspace build graph valid"

info "Building workspace in dependency order..."
pnpm run build
ok "Workspace build complete"

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

# Remove metafile and sourcemaps (not for publishing)
rm -f "$ROOT/dist/meta.json"
find "$ROOT/dist" -name "*.js.map" -delete

ok "dist/ ready"

# ── Secret scan ───────────────────────────────────────────────────────
info "Scanning dist/ for secrets..."
SCAN_SCRIPT="$(cd "$ROOT/.." && pwd)/scripts/scan-dist.mjs"
if [[ -f "$SCAN_SCRIPT" ]]; then
	node "$SCAN_SCRIPT" "$ROOT/dist"
	ok "Secret scan passed"
else
	warn "scan-dist.mjs not found, skipping secret scan"
fi

# ── Tests ─────────────────────────────────────────────────────────────
if [[ "$SKIP_TESTS" == true ]]; then
	warn "Skipping tests (--skip-tests)"
else
	info "Running tests..."
	if pnpm run test; then
		ok "All tests passed"
	else
		warn "Some tests failed — review output above"
		if [[ "$DRY_RUN" == false ]]; then
			fail "Cannot publish with failing tests. Fix tests or use --skip-tests."
		fi
	fi
fi

# ── Release verification gates ────────────────────────────────────────
if [[ "$DRY_RUN" == false ]]; then
	info "Running release verification gates..."
	pnpm run release:verify
	ok "Release verification gates passed"
else
	warn "Dry-run mode — skipping release verification gates"
fi

# ── Publish ───────────────────────────────────────────────────────────
echo ""
if [[ "$DRY_RUN" == true ]]; then
	info "=== DRY RUN ==="
	echo ""
	info "Package contents:"
	(
		cd "$ROOT/dist"
		npm pack --dry-run 2>&1 | head -50
	)
	echo ""
	ok "Dry run complete. Use --real to publish for real."
else
	warn "=== PUBLISHING TO NPM ==="
	echo ""

	# Publish from dist/
	(
		cd "$ROOT/dist"
		npm publish
	)
	ok "@yugenlab/chitragupta@$VERSION published!"

	# Git tag
	TAG="v$VERSION"
	if [[ "${SKIP_GIT_TAG:-0}" == "1" ]]; then
		warn "SKIP_GIT_TAG=1 set — skipping git tag $TAG"
	elif [[ "$IS_SUBTREE_REPO" == true && "${ALLOW_SUBTREE_GIT_TAG:-0}" != "1" ]]; then
		warn "Repository root differs from package root ($GIT_TOP)."
		warn "Skipping tag by default in subtree mode. Set ALLOW_SUBTREE_GIT_TAG=1 to force tagging."
	else
		info "Creating git tag: $TAG"
		if [[ -n "$GIT_TOP" ]]; then
			git -C "$GIT_TOP" tag "$TAG"
		else
			git tag "$TAG"
		fi
		ok "Tagged $TAG"
	fi

	echo ""
	ok "Done! Run 'git push && git push --tags' to push."
fi
