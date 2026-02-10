#!/usr/bin/env bash
#
# publish.sh — Build, test, and publish all @chitragupta packages in dependency order.
#
# Usage:
#   ./scripts/publish.sh              # dry-run (default)
#   ./scripts/publish.sh --real       # actually publish to npm
#   ./scripts/publish.sh --bump patch # bump version before publish (patch|minor|major)
#   ./scripts/publish.sh --bump minor --real
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ── Defaults ──────────────────────────────────────────────────────────
DRY_RUN=true
BUMP=""

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
		--help|-h)
			echo "Usage: ./scripts/publish.sh [--real] [--bump patch|minor|major]"
			echo ""
			echo "  --real          Actually publish (default is dry-run)"
			echo "  --bump <level>  Bump version in all packages before publishing"
			echo "  --help          Show this help message"
			exit 0
			;;
		*)
			echo "Unknown flag: $1"
			exit 1
			;;
	esac
done

# ── Publish order (respects dependency graph) ─────────────────────────
PACKAGES=(
	core
	swara
	anina
	smriti
	ui
	yantra
	dharma
	netra
	vayu
	sutra
	tantra
	vidhya-skills
	niyanta
	cli
)

# ── Colors ────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { echo -e "${CYAN}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
fail()  { echo -e "${RED}[fail]${NC}  $*"; exit 1; }

# ── Pre-flight checks ────────────────────────────────────────────────
info "Checking Node.js version..."
NODE_VERSION=$(node -v)
NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v\([0-9]*\).*/\1/')
if [[ "$NODE_MAJOR" -lt 20 ]]; then
	fail "Node.js >= 20 required (found $NODE_VERSION)"
fi
ok "Node.js $NODE_VERSION"

info "Checking npm auth..."
if [[ "$DRY_RUN" == false ]]; then
	if ! npm whoami &>/dev/null; then
		fail "Not logged in to npm. Run 'npm login' first."
	fi
	ok "Logged in as $(npm whoami)"
else
	warn "Dry-run mode — skipping npm auth check"
fi

# ── Version bump ──────────────────────────────────────────────────────
if [[ -n "$BUMP" ]]; then
	info "Bumping version ($BUMP) across all packages..."
	for pkg in "${PACKAGES[@]}"; do
		PKG_DIR="$ROOT/packages/$pkg"
		cd "$PKG_DIR"
		npm version "$BUMP" --no-git-tag-version --silent
		NEW_VERSION=$(node -p "require('./package.json').version")
		ok "  @chitragupta/$pkg -> $NEW_VERSION"
	done

	# Update root package.json version too
	cd "$ROOT"
	npm version "$BUMP" --no-git-tag-version --silent
	ROOT_VERSION=$(node -p "require('./package.json').version")
	ok "  root -> $ROOT_VERSION"

	# Update cross-references: workspace dependencies should match new version
	info "Updating cross-package dependency versions..."
	for pkg in "${PACKAGES[@]}"; do
		PKG_JSON="$ROOT/packages/$pkg/package.json"
		# Use node to update @chitragupta/* dependency versions in-place
		node -e "
			const fs = require('fs');
			const pkg = JSON.parse(fs.readFileSync('$PKG_JSON', 'utf8'));
			let changed = false;
			for (const depType of ['dependencies', 'devDependencies', 'peerDependencies']) {
				if (!pkg[depType]) continue;
				for (const [name, ver] of Object.entries(pkg[depType])) {
					if (name.startsWith('@chitragupta/') && ver !== '$ROOT_VERSION') {
						pkg[depType][name] = '$ROOT_VERSION';
						changed = true;
					}
				}
			}
			if (changed) {
				fs.writeFileSync('$PKG_JSON', JSON.stringify(pkg, null, '\t') + '\n');
			}
		"
	done
	ok "Cross-references updated to $ROOT_VERSION"
fi

# ── Clean ─────────────────────────────────────────────────────────────
info "Cleaning previous builds..."
npm run clean 2>/dev/null || true
ok "Clean complete"

# ── Build (in dependency order) ───────────────────────────────────────
info "Building all packages in dependency order..."
for pkg in "${PACKAGES[@]}"; do
	info "  Building @chitragupta/$pkg..."
	npm run build --workspace="packages/$pkg"
	ok "  @chitragupta/$pkg built"
done
ok "All packages built successfully"

# ── Test ──────────────────────────────────────────────────────────────
info "Running tests..."
if npx vitest run; then
	ok "All tests passed"
else
	warn "Some tests failed — review output above"
	if [[ "$DRY_RUN" == false ]]; then
		fail "Cannot publish with failing tests. Fix tests or use dry-run mode."
	fi
fi

# ── Publish ───────────────────────────────────────────────────────────
echo ""
if [[ "$DRY_RUN" == true ]]; then
	info "=== DRY RUN — nothing will be published ==="
else
	warn "=== PUBLISHING TO NPM FOR REAL ==="
fi
echo ""

PUBLISH_FLAGS=""
if [[ "$DRY_RUN" == true ]]; then
	PUBLISH_FLAGS="--dry-run"
fi

for pkg in "${PACKAGES[@]}"; do
	info "Publishing @chitragupta/$pkg..."
	npm publish --workspace="packages/$pkg" $PUBLISH_FLAGS
	ok "  @chitragupta/$pkg published"
done

echo ""
if [[ "$DRY_RUN" == true ]]; then
	ok "Dry run complete. Use --real to publish for real."
else
	ok "All 14 @chitragupta packages published successfully!"
fi
