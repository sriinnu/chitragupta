#!/bin/bash
set -euo pipefail

# scaffold.sh — Create boilerplate files from templates.
# Usage: scaffold.sh <type> <name> [directory]
#   Types: module, test, component, api-route

TYPE="${1:-}"
NAME="${2:-}"
DIR="${3:-.}"

if [ -z "$TYPE" ] || [ -z "$NAME" ]; then
	echo "Usage: scaffold.sh <type> <name> [directory]"
	echo ""
	echo "Types:"
	echo "  module     - TypeScript/JavaScript module with exports"
	echo "  test       - Test file for an existing module"
	echo "  component  - React/Vue component with test"
	echo "  api-route  - API route handler"
	echo ""
	echo "Examples:"
	echo "  scaffold.sh module user-service src/services"
	echo "  scaffold.sh test user-service src/services"
	echo "  scaffold.sh component Button src/components"
	exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

# Detect file extension
if [ -f "tsconfig.json" ] || [ -f "tsconfig.base.json" ]; then
	EXT="ts"
	TEST_EXT="test.ts"
elif [ -f "pyproject.toml" ] || [ -f "setup.py" ]; then
	EXT="py"
	TEST_EXT="test.py"
else
	EXT="ts"
	TEST_EXT="test.ts"
fi

# Convert name to different cases
KEBAB="$NAME"
PASCAL=$(echo "$NAME" | sed -r 's/(^|[-_])(\w)/\U\2/g' 2>/dev/null || echo "$NAME")
CAMEL=$(echo "$PASCAL" | sed 's/^\(.\)/\L\1/' 2>/dev/null || echo "$NAME")

mkdir -p "$DIR"

case "$TYPE" in
	module)
		FILE="$DIR/$KEBAB.$EXT"
		if [ -f "$FILE" ]; then
			echo "ERROR: $FILE already exists."
			exit 1
		fi

		if [ "$EXT" = "ts" ]; then
			cat > "$FILE" << TEMPLATE
/**
 * ${PASCAL} module.
 */

export interface ${PASCAL}Options {
	// TODO: Define options
}

export class ${PASCAL} {
	private readonly options: ${PASCAL}Options;

	constructor(options: ${PASCAL}Options) {
		this.options = options;
	}

	// TODO: Implement methods
}
TEMPLATE
		elif [ "$EXT" = "py" ]; then
			cat > "$FILE" << TEMPLATE
"""${PASCAL} module."""


class ${PASCAL}:
    """${PASCAL} implementation."""

    def __init__(self):
        """Initialize ${PASCAL}."""
        pass
TEMPLATE
		fi
		echo "Created: $FILE"

		# Also create test
		TEST_FILE="$DIR/$KEBAB.$TEST_EXT"
		if [ "$EXT" = "ts" ]; then
			cat > "$TEST_FILE" << TEMPLATE
import { describe, it, expect } from 'vitest';
import { ${PASCAL} } from './${KEBAB}.js';

describe('${PASCAL}', () => {
	it('should create an instance', () => {
		const instance = new ${PASCAL}({});
		expect(instance).toBeDefined();
	});
});
TEMPLATE
		fi
		echo "Created: $TEST_FILE"
		;;

	test)
		TEST_FILE="$DIR/$KEBAB.$TEST_EXT"
		if [ -f "$TEST_FILE" ]; then
			echo "ERROR: $TEST_FILE already exists."
			exit 1
		fi

		if [ "$EXT" = "ts" ]; then
			cat > "$TEST_FILE" << TEMPLATE
import { describe, it, expect } from 'vitest';
import { ${PASCAL} } from './${KEBAB}.js';

describe('${PASCAL}', () => {
	it('should exist', () => {
		expect(${PASCAL}).toBeDefined();
	});

	// TODO: Add test cases
});
TEMPLATE
		fi
		echo "Created: $TEST_FILE"
		;;

	component)
		COMP_DIR="$DIR/$KEBAB"
		mkdir -p "$COMP_DIR"

		cat > "$COMP_DIR/$KEBAB.$EXT"x << TEMPLATE
interface ${PASCAL}Props {
	// TODO: Define props
}

export function ${PASCAL}(props: ${PASCAL}Props) {
	return (
		<div>
			{/* TODO: Implement ${PASCAL} */}
		</div>
	);
}
TEMPLATE
		echo "Created: $COMP_DIR/$KEBAB.${EXT}x"

		cat > "$COMP_DIR/$KEBAB.${TEST_EXT}"x << TEMPLATE
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ${PASCAL} } from './${KEBAB}.js';

describe('${PASCAL}', () => {
	it('should render', () => {
		const { container } = render(<${PASCAL} />);
		expect(container).toBeDefined();
	});
});
TEMPLATE
		echo "Created: $COMP_DIR/$KEBAB.${TEST_EXT}x"

		cat > "$COMP_DIR/index.$EXT" << TEMPLATE
export { ${PASCAL} } from './${KEBAB}.js';
TEMPLATE
		echo "Created: $COMP_DIR/index.$EXT"
		;;

	api-route)
		FILE="$DIR/$KEBAB.$EXT"
		if [ -f "$FILE" ]; then
			echo "ERROR: $FILE already exists."
			exit 1
		fi

		cat > "$FILE" << TEMPLATE
import type { Request, Response } from 'express';

/**
 * ${PASCAL} route handler.
 */
export async function ${CAMEL}Handler(req: Request, res: Response): Promise<void> {
	try {
		// TODO: Implement handler
		res.json({ ok: true });
	} catch (error) {
		res.status(500).json({ error: 'Internal server error' });
	}
}
TEMPLATE
		echo "Created: $FILE"
		;;

	*)
		echo "Unknown type: $TYPE"
		echo "Supported: module, test, component, api-route"
		exit 1
		;;
esac

echo ""
echo "=== Scaffold Complete ==="
