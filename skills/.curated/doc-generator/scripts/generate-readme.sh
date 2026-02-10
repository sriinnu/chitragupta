#!/bin/bash
set -euo pipefail

# generate-readme.sh — Scaffold a README.md from project metadata.
# Usage: generate-readme.sh [directory] [--stdout]

ROOT="${1:-.}"
OUTPUT_FLAG="${2:-}"

# Extract project name
if [ -f "$ROOT/package.json" ]; then
	NAME=$(grep '"name"' "$ROOT/package.json" | head -1 | sed 's/.*: *"\(.*\)".*/\1/' || echo "project")
	DESCRIPTION=$(grep '"description"' "$ROOT/package.json" | head -1 | sed 's/.*: *"\(.*\)".*/\1/' || echo "")
	VERSION=$(grep '"version"' "$ROOT/package.json" | head -1 | sed 's/.*: *"\(.*\)".*/\1/' || echo "0.1.0")
	LICENSE=$(grep '"license"' "$ROOT/package.json" | head -1 | sed 's/.*: *"\(.*\)".*/\1/' || echo "")
elif [ -f "$ROOT/Cargo.toml" ]; then
	NAME=$(grep '^name' "$ROOT/Cargo.toml" | head -1 | sed 's/.*= *"\(.*\)"/\1/' || echo "project")
	DESCRIPTION=$(grep '^description' "$ROOT/Cargo.toml" | head -1 | sed 's/.*= *"\(.*\)"/\1/' || echo "")
	VERSION=$(grep '^version' "$ROOT/Cargo.toml" | head -1 | sed 's/.*= *"\(.*\)"/\1/' || echo "0.1.0")
	LICENSE=$(grep '^license' "$ROOT/Cargo.toml" | head -1 | sed 's/.*= *"\(.*\)"/\1/' || echo "")
elif [ -f "$ROOT/pyproject.toml" ]; then
	NAME=$(grep '^name' "$ROOT/pyproject.toml" | head -1 | sed 's/.*= *"\(.*\)"/\1/' || echo "project")
	DESCRIPTION=$(grep '^description' "$ROOT/pyproject.toml" | head -1 | sed 's/.*= *"\(.*\)"/\1/' || echo "")
	VERSION=$(grep '^version' "$ROOT/pyproject.toml" | head -1 | sed 's/.*= *"\(.*\)"/\1/' || echo "0.1.0")
	LICENSE=""
else
	NAME=$(basename "$ROOT")
	DESCRIPTION=""
	VERSION="0.1.0"
	LICENSE=""
fi

README="# $NAME

${DESCRIPTION:-A brief description of what this project does.}

## Installation

\`\`\`bash
# TODO: Add installation instructions
\`\`\`

## Quick Start

\`\`\`bash
# TODO: Add quick start example
\`\`\`

## Usage

<!-- Add detailed usage examples here -->

## API

<!-- Add public API documentation here -->

## Development

\`\`\`bash
# Install dependencies
# TODO

# Run tests
# TODO

# Build
# TODO
\`\`\`

## Contributing

1. Fork the repository
2. Create a feature branch (\`git checkout -b feat/my-feature\`)
3. Commit your changes (\`git commit -m 'feat: add my feature'\`)
4. Push to the branch (\`git push origin feat/my-feature\`)
5. Open a Pull Request

## License

${LICENSE:-MIT}
"

if [ "$OUTPUT_FLAG" = "--stdout" ]; then
	echo "$README"
else
	TARGET="$ROOT/README.md"
	if [ -f "$TARGET" ]; then
		echo "README.md already exists at $TARGET"
		echo "Use --stdout to print to console instead, or remove the existing file."
		exit 1
	fi
	echo "$README" > "$TARGET"
	echo "Created $TARGET"
fi
