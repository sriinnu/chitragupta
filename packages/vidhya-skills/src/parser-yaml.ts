/**
 * @module parser-yaml
 * @description Hand-rolled YAML frontmatter parser for skill.md files.
 *
 * Handles scalar values, nested objects (via indentation), inline arrays,
 * folded/literal block scalars, and block sequences.
 *
 * @packageDocumentation
 */

// ─── Frontmatter Parsing ────────────────────────────────────────────────────

/**
 * Parse YAML frontmatter from raw text between `---` delimiters.
 *
 * Handles:
 * - Scalar values (strings, numbers, booleans)
 * - Inline arrays: `[a, b, c]`
 * - Nested objects via indentation (2-space)
 * - Quoted strings (single and double)
 *
 * Does NOT handle:
 * - Anchors/aliases (&, *)
 * - Complex YAML features
 *
 * @param raw - The raw YAML text (without `---` delimiters).
 * @returns A parsed key-value record.
 */
export function parseFrontmatter(raw: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const lines = raw.split("\n");
	const stack: { obj: Record<string, unknown>; indent: number }[] = [
		{ obj: result, indent: -1 },
	];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Skip empty lines and comments
		if (line.trim() === "" || line.trim().startsWith("#")) continue;

		// Determine indentation level
		const indent = line.search(/\S/);
		if (indent < 0) continue;

		// Find the colon separator
		const colonIdx = line.indexOf(":");
		if (colonIdx < 0) continue;

		const key = line.slice(indent, colonIdx).trim();
		const rawValue = line.slice(colonIdx + 1).trim();

		// Pop stack to find the correct parent for this indentation level
		while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
			stack.pop();
		}
		const parent = stack[stack.length - 1].obj;

		if (rawValue === ">" || rawValue === "|") {
			// Folded (>) or literal (|) block scalar — collect indented continuation lines
			const blockLines: string[] = [];
			const sep = rawValue === ">" ? " " : "\n";
			while (i + 1 < lines.length) {
				const next = lines[i + 1];
				// Continuation line must be indented deeper than the key, or be blank
				if (next.trim() === "") {
					blockLines.push("");
					i++;
				} else if (next.search(/\S/) > indent) {
					blockLines.push(next.trim());
					i++;
				} else {
					break;
				}
			}
			parent[key] = blockLines.filter(Boolean).join(sep).trim();
		} else if (rawValue === "" || rawValue === undefined) {
			// Peek ahead: if next meaningful line starts with "- ", this is a block sequence (array).
			// Otherwise, it's a nested object.
			const nextMeaningful = peekNextMeaningfulLine(lines, i + 1);
			if (nextMeaningful !== null && nextMeaningful.trimmed.startsWith("- ") || nextMeaningful?.trimmed === "-") {
				// Block sequence — parse array items
				const arr: unknown[] = [];
				parent[key] = arr;
				const seqIndent = indent;
				while (i + 1 < lines.length) {
					const nextLine = lines[i + 1];
					const nextTrimmed = nextLine.trim();
					const nextIndent = nextLine.search(/\S/);
					// Stop if we reach a line at same or lower indent that isn't a continuation
					if (nextTrimmed === "" || nextTrimmed.startsWith("#")) { i++; continue; }
					if (nextIndent >= 0 && nextIndent <= seqIndent && !nextTrimmed.startsWith("-")) break;
					if (!nextTrimmed.startsWith("-")) { i++; continue; }
					i++;
					// This line starts a new array item
					const afterDash = nextTrimmed.slice(1).trim();
					if (afterDash === "") {
						// Bare "-" — collect nested object from subsequent indented lines
						const itemObj: Record<string, unknown> = {};
						const dashIndent = nextIndent;
						collectNestedObject(lines, i, dashIndent, itemObj);
						// Advance i past the collected lines
						while (i + 1 < lines.length) {
							const itemLine = lines[i + 1];
							const itemTrimmed = itemLine.trim();
							const itemIndent = itemLine.search(/\S/);
							if (itemTrimmed === "" || itemTrimmed.startsWith("#")) { i++; continue; }
							if (itemIndent >= 0 && itemIndent <= dashIndent) break;
							i++;
						}
						arr.push(itemObj);
					} else {
						// "- key: value" — inline object start
						const dashColon = afterDash.indexOf(":");
						if (dashColon >= 0) {
							const itemObj: Record<string, unknown> = {};
							const itemKey = afterDash.slice(0, dashColon).trim();
							const itemValue = afterDash.slice(dashColon + 1).trim();
							if (itemValue === "") {
								// Nested object after "- key:\n  subkey: val"
								const nestedObj: Record<string, unknown> = {};
								collectNestedObject(lines, i, nextIndent + 2, nestedObj);
								itemObj[itemKey] = nestedObj;
							} else {
								itemObj[itemKey] = parseYamlValue(itemValue);
							}
							// Collect remaining key-value pairs at deeper indent
							const dashIndent = nextIndent;
							while (i + 1 < lines.length) {
								const itemLine = lines[i + 1];
								const itemTrimmed = itemLine.trim();
								const itemIndent = itemLine.search(/\S/);
								if (itemTrimmed === "" || itemTrimmed.startsWith("#")) { i++; continue; }
								if (itemIndent >= 0 && itemIndent <= dashIndent) break;
								const itemColon = itemLine.indexOf(":");
								if (itemColon < 0) { i++; continue; }
								i++;
								const ik = itemLine.slice(itemIndent, itemColon).trim();
								const iv = itemLine.slice(itemColon + 1).trim();
								if (iv === "") {
									const nestedObj: Record<string, unknown> = {};
									collectNestedObject(lines, i, itemIndent, nestedObj);
									// Advance past collected nested lines
									while (i + 1 < lines.length) {
										const nl = lines[i + 1];
										const nt = nl.trim();
										const ni = nl.search(/\S/);
										if (nt === "" || nt.startsWith("#")) { i++; continue; }
										if (ni >= 0 && ni <= itemIndent) break;
										i++;
									}
									itemObj[ik] = nestedObj;
								} else {
									itemObj[ik] = parseYamlValue(iv);
								}
							}
							arr.push(itemObj);
						} else {
							// Plain scalar array item: "- value"
							arr.push(parseYamlValue(afterDash));
						}
					}
				}
			} else {
				// Nested object — the value will be filled by subsequent indented lines
				const nested: Record<string, unknown> = {};
				parent[key] = nested;
				stack.push({ obj: nested, indent });
			}
		} else {
			// Scalar or inline array
			parent[key] = parseYamlValue(rawValue);
		}
	}

	return result;
}

/**
 * Peek at the next non-empty, non-comment line without advancing the cursor.
 */
export function peekNextMeaningfulLine(lines: string[], startIdx: number): { trimmed: string; indent: number } | null {
	for (let j = startIdx; j < lines.length; j++) {
		const trimmed = lines[j].trim();
		if (trimmed === "" || trimmed.startsWith("#")) continue;
		return { trimmed, indent: lines[j].search(/\S/) };
	}
	return null;
}

/**
 * Collect key-value pairs from lines indented deeper than `parentIndent`
 * into the `target` object. Used for nested objects within block sequences.
 */
export function collectNestedObject(
	lines: string[],
	startIdx: number,
	parentIndent: number,
	target: Record<string, unknown>,
): void {
	for (let j = startIdx + 1; j < lines.length; j++) {
		const line = lines[j];
		const trimmed = line.trim();
		const lineIndent = line.search(/\S/);

		// Skip empty lines and comments
		if (trimmed === "" || trimmed.startsWith("#")) continue;

		// Stop if we hit same or lower indent
		if (lineIndent >= 0 && lineIndent <= parentIndent) break;

		// Parse key: value
		const colonIdx = line.indexOf(":");
		if (colonIdx < 0) continue;

		const key = line.slice(lineIndent, colonIdx).trim();
		const rawValue = line.slice(colonIdx + 1).trim();

		if (rawValue === "" || rawValue === undefined) {
			// Nested object — recurse
			const nested: Record<string, unknown> = {};
			collectNestedObject(lines, j, lineIndent, nested);
			target[key] = nested;
			// Skip past the nested lines
			while (j + 1 < lines.length) {
				const nl = lines[j + 1];
				const nt = nl.trim();
				const ni = nl.search(/\S/);
				if (nt === "" || nt.startsWith("#")) { j++; continue; }
				if (ni >= 0 && ni <= lineIndent) break;
				j++;
			}
		} else {
			target[key] = parseYamlValue(rawValue);
		}
	}
}

/**
 * Parse a single YAML scalar value.
 *
 * @param raw - The raw value string after the colon.
 * @returns The parsed value (string, number, boolean, null, or array).
 */
export function parseYamlValue(raw: string): unknown {
	const trimmed = raw.trim();

	// Inline array: [a, b, c]
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		const inner = trimmed.slice(1, -1).trim();
		if (inner === "") return [];
		return inner.split(",").map((item) => parseYamlValue(item.trim()));
	}

	// Quoted string
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}

	// Boolean
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;

	// Null
	if (trimmed === "null" || trimmed === "~") return null;

	// Number
	const num = Number(trimmed);
	if (!isNaN(num) && trimmed !== "") return num;

	// Plain string
	return trimmed;
}