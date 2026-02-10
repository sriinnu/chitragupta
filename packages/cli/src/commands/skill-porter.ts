/**
 * @chitragupta/cli — Skill Porter (Setu) CLI commands.
 *
 * chitragupta skill import <file>           — auto-detect format and import to vidhya
 * chitragupta skill export <name> --format  — export a vidhya skill to claude|gemini
 * chitragupta skill convert <file> --to     — convert between formats
 * chitragupta skill detect <file>           — detect the format of a skill file
 */

import fs from "fs";
import path from "path";
import {
	bold,
	green,
	gray,
	yellow,
	cyan,
	dim,
	red,
} from "@chitragupta/ui/ansi";

// ─── Subcommands ────────────────────────────────────────────────────────────

/**
 * Detect the format of a skill file.
 *
 * @param filePath - Path to the skill file.
 */
export async function detect(filePath: string): Promise<void> {
	if (!filePath) {
		process.stderr.write(
			red("\n  Error: File path required.\n") +
			gray("  Usage: chitragupta skill detect <file>\n\n"),
		);
		process.exit(1);
	}

	const resolved = path.resolve(filePath);
	if (!fs.existsSync(resolved)) {
		process.stderr.write(
			red(`\n  Error: File not found: ${resolved}\n\n`),
		);
		process.exit(1);
	}

	const content = fs.readFileSync(resolved, "utf-8");

	const { detectFormat } = await import("@chitragupta/vidhya-skills");
	const format = detectFormat(content);

	const formatLabels: Record<string, string> = {
		vidhya: "Vidhya skill.md (Chitragupta)",
		claude: "Claude Code SKILL.md",
		gemini: "Gemini CLI extension (JSON)",
		unknown: "Unknown format",
	};

	const formatColors: Record<string, (s: string) => string> = {
		vidhya: cyan,
		claude: green,
		gemini: yellow,
		unknown: red,
	};

	process.stdout.write("\n");
	process.stdout.write(`  File:   ${dim(resolved)}\n`);
	process.stdout.write(`  Format: ${formatColors[format](formatLabels[format])}\n`);
	process.stdout.write("\n");
}

/**
 * Import a skill file (auto-detect format) and save as vidhya skill.md.
 *
 * @param filePath - Path to the source skill file.
 * @param options - Optional output path.
 */
export async function importSkill(
	filePath: string,
	options: { output?: string } = {},
): Promise<void> {
	if (!filePath) {
		process.stderr.write(
			red("\n  Error: File path required.\n") +
			gray("  Usage: chitragupta skill import <file> [--output <dir>]\n\n"),
		);
		process.exit(1);
	}

	const resolved = path.resolve(filePath);
	if (!fs.existsSync(resolved)) {
		process.stderr.write(
			red(`\n  Error: File not found: ${resolved}\n\n`),
		);
		process.exit(1);
	}

	const content = fs.readFileSync(resolved, "utf-8");

	const { detectFormat, convert } = await import("@chitragupta/vidhya-skills");
	const sourceFormat = detectFormat(content);

	if (sourceFormat === "unknown") {
		process.stderr.write(
			red("\n  Error: Cannot detect skill format.\n") +
			gray("  Supported: Claude SKILL.md, Gemini gemini-extension.json, Vidhya skill.md\n\n"),
		);
		process.exit(1);
	}

	if (sourceFormat === "vidhya") {
		process.stdout.write(
			yellow("\n  File is already in vidhya format. No conversion needed.\n\n"),
		);
		return;
	}

	const vidhyaContent = convert(content, "vidhya");

	// Determine output path
	const baseName = path.basename(filePath, path.extname(filePath));
	const outputDir = options.output
		? path.resolve(options.output)
		: path.resolve("skills", baseName);

	fs.mkdirSync(outputDir, { recursive: true });
	const outputPath = path.join(outputDir, "skill.md");
	fs.writeFileSync(outputPath, vidhyaContent, "utf-8");

	const formatLabels: Record<string, string> = {
		claude: "Claude Code SKILL.md",
		gemini: "Gemini CLI extension",
	};

	process.stdout.write("\n");
	process.stdout.write(
		green(`  Imported ${bold(formatLabels[sourceFormat])} as vidhya skill.`) + "\n",
	);
	process.stdout.write(`  Source:  ${dim(resolved)}\n`);
	process.stdout.write(`  Output:  ${cyan(outputPath)}\n`);
	process.stdout.write("\n");
}

/**
 * Export a vidhya skill file to another format.
 *
 * @param filePath - Path to the vidhya skill.md file.
 * @param options - Format and output options.
 */
export async function exportSkill(
	filePath: string,
	options: { format?: string; output?: string } = {},
): Promise<void> {
	if (!filePath) {
		process.stderr.write(
			red("\n  Error: File path required.\n") +
			gray("  Usage: chitragupta skill export <file> --format claude|gemini [--output <file>]\n\n"),
		);
		process.exit(1);
	}

	const targetFormat = options.format ?? "claude";
	if (targetFormat !== "claude" && targetFormat !== "gemini") {
		process.stderr.write(
			red(`\n  Error: Unsupported format '${targetFormat}'.\n`) +
			gray("  Supported formats: claude, gemini\n\n"),
		);
		process.exit(1);
	}

	const resolved = path.resolve(filePath);
	if (!fs.existsSync(resolved)) {
		process.stderr.write(
			red(`\n  Error: File not found: ${resolved}\n\n`),
		);
		process.exit(1);
	}

	const content = fs.readFileSync(resolved, "utf-8");

	const { convert, detectFormat } = await import("@chitragupta/vidhya-skills");
	const sourceFormat = detectFormat(content);

	if (sourceFormat === "unknown") {
		process.stderr.write(
			red("\n  Error: Cannot detect source format.\n\n"),
		);
		process.exit(1);
	}

	const converted = convert(content, targetFormat as "claude" | "gemini");

	if (options.output) {
		const outputPath = path.resolve(options.output);
		fs.mkdirSync(path.dirname(outputPath), { recursive: true });
		fs.writeFileSync(outputPath, converted, "utf-8");

		process.stdout.write("\n");
		process.stdout.write(
			green(`  Exported to ${bold(targetFormat)} format.`) + "\n",
		);
		process.stdout.write(`  Output: ${cyan(outputPath)}\n`);
		process.stdout.write("\n");
	} else {
		// Write to stdout
		process.stdout.write(converted);
	}
}

/**
 * Convert a skill file between formats.
 *
 * @param filePath - Path to the source file.
 * @param options - Target format and output options.
 */
export async function convertSkill(
	filePath: string,
	options: { to?: string; output?: string } = {},
): Promise<void> {
	if (!filePath) {
		process.stderr.write(
			red("\n  Error: File path required.\n") +
			gray("  Usage: chitragupta skill convert <file> --to vidhya|claude|gemini [--output <file>]\n\n"),
		);
		process.exit(1);
	}

	const targetFormat = options.to;
	if (!targetFormat || !["vidhya", "claude", "gemini"].includes(targetFormat)) {
		process.stderr.write(
			red("\n  Error: Target format required.\n") +
			gray("  Usage: chitragupta skill convert <file> --to vidhya|claude|gemini\n\n"),
		);
		process.exit(1);
	}

	const resolved = path.resolve(filePath);
	if (!fs.existsSync(resolved)) {
		process.stderr.write(
			red(`\n  Error: File not found: ${resolved}\n\n`),
		);
		process.exit(1);
	}

	const content = fs.readFileSync(resolved, "utf-8");

	const { convert, detectFormat } = await import("@chitragupta/vidhya-skills");
	const sourceFormat = detectFormat(content);

	if (sourceFormat === "unknown") {
		process.stderr.write(
			red("\n  Error: Cannot detect source format.\n") +
			gray("  Supported: vidhya, claude, gemini\n\n"),
		);
		process.exit(1);
	}

	process.stdout.write(
		dim(`\n  Detected: ${sourceFormat} -> converting to ${targetFormat}\n`),
	);

	const converted = convert(content, targetFormat as "vidhya" | "claude" | "gemini");

	if (options.output) {
		const outputPath = path.resolve(options.output);
		fs.mkdirSync(path.dirname(outputPath), { recursive: true });
		fs.writeFileSync(outputPath, converted, "utf-8");

		process.stdout.write(
			green(`  Converted ${bold(sourceFormat)} -> ${bold(targetFormat)}`) + "\n",
		);
		process.stdout.write(`  Output: ${cyan(outputPath)}\n`);
		process.stdout.write("\n");
	} else {
		process.stdout.write("\n");
		process.stdout.write(converted);
	}
}

// ─── Router ─────────────────────────────────────────────────────────────────

/**
 * Route `chitragupta skill <subcommand>` to the correct handler.
 *
 * @param subcommand - The subcommand (import, export, convert, detect).
 * @param rest - Remaining positional arguments.
 */
export async function runSkillPorterCommand(
	subcommand: string | undefined,
	rest: string[],
): Promise<void> {
	// Parse flags from rest
	let format: string | undefined;
	let output: string | undefined;
	let to: string | undefined;
	const filteredRest: string[] = [];

	for (let i = 0; i < rest.length; i++) {
		if (rest[i] === "--format" && i + 1 < rest.length) {
			format = rest[++i];
		} else if (rest[i] === "--output" && i + 1 < rest.length) {
			output = rest[++i];
		} else if (rest[i] === "--to" && i + 1 < rest.length) {
			to = rest[++i];
		} else {
			filteredRest.push(rest[i]);
		}
	}

	switch (subcommand) {
		case "detect": {
			const file = filteredRest[0];
			await detect(file);
			break;
		}

		case "import": {
			const file = filteredRest[0];
			await importSkill(file, { output });
			break;
		}

		case "export": {
			const file = filteredRest[0];
			await exportSkill(file, { format, output });
			break;
		}

		case "convert": {
			const file = filteredRest[0];
			await convertSkill(file, { to, output });
			break;
		}

		default:
			process.stderr.write(
				"\n" + bold("Usage: chitragupta skill <detect|import|export|convert>") + "\n\n" +
				"  " + cyan("detect <file>") + "                    Detect skill file format\n" +
				"  " + cyan("import <file>") + "                    Import skill to vidhya format\n" +
				"  " + cyan("export <file> --format <fmt>") + "    Export vidhya skill to claude|gemini\n" +
				"  " + cyan("convert <file> --to <fmt>") + "       Convert between formats\n" +
				"\n" + dim("Flags:") + "\n" +
				"  " + dim("--format <claude|gemini>") + "        Target format for export\n" +
				"  " + dim("--to <vidhya|claude|gemini>") + "     Target format for convert\n" +
				"  " + dim("--output <file|dir>") + "             Output path\n\n" +
				dim("Supported formats:") + "\n" +
				"  " + cyan("vidhya") + "   Chitragupta skill.md (YAML frontmatter + Capabilities)\n" +
				"  " + cyan("claude") + "   Claude Code SKILL.md (YAML frontmatter + instructions)\n" +
				"  " + cyan("gemini") + "   Gemini CLI gemini-extension.json (JSON manifest)\n\n",
			);
			process.exit(1);
	}
}
