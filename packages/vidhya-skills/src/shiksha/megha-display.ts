/**
 * Megha Display Formatter - Formats cloud detection results for display.
 *
 * Extracted from megha.ts to keep files under 450 LOC.
 *
 * @packageDocumentation
 */

import type {
	CloudProvider,
	CloudRecipe,
	CloudSourceResult,
} from "./megha-types.js";
import { PROVIDER_REGISTRY } from "./megha-data.js";

// ─── Display Formatter ──────────────────────────────────────────────────────

// ANSI helpers (minimal — avoid importing @chitragupta/ui dependency)
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

/**
 * Format a CloudSourceResult into a human-readable ANSI string.
 */
export function formatCloudDisplay(result: CloudSourceResult, query: string): string {
	const lines: string[] = [];

	// ── Header ─────────────────────────────
	const recipeName = result.recipe?.name
		?? result.alternatives[0]?.recipe.name
		?? guessRecipeName(query);
	lines.push(`${BOLD}${CYAN}Cloud Recipe: ${recipeName}${RESET}`);
	lines.push("");

	// ── Provider Status ────────────────────
	for (const det of result.detections) {
		if (!det.installed && det.authStatus === "cli_not_installed") continue; // skip uninstalled by default
		const statusIcon = det.authStatus === "authenticated"
			? `${GREEN}authenticated${RESET}`
			: `${YELLOW}installed but not authenticated${RESET}`;
		const hint = det.accountHint ? ` (${det.accountHint})` : "";
		lines.push(`  ${det.cliName} (${det.provider}): ${statusIcon}${hint}`);
	}

	// Show the requested provider's status if it was not installed
	if (result.installGuidance) {
		const g = result.installGuidance;
		lines.push(`  ${g.provider}: ${RED}not installed${RESET}`);
	}
	if (result.authGuidance && !result.authGuidance.installed) {
		const g = result.authGuidance;
		lines.push(`  ${g.provider}: ${RED}not installed${RESET}`);
	}

	lines.push("");

	// ── Auth Guidance ──────────────────────
	if (result.authGuidance) {
		const g = result.authGuidance;
		lines.push(`  ${YELLOW}${g.provider.toUpperCase()} CLI: installed but not authenticated${RESET}`);
		if (g.loginCommand) {
			lines.push(`    Login: ${BOLD}${g.loginCommand}${RESET}`);
		}
		lines.push(`    Docs:  ${DIM}${g.docsUrl}${RESET}`);
		lines.push("");
	}

	// ── Install Guidance ───────────────────
	if (result.installGuidance) {
		const g = result.installGuidance;
		lines.push(`  ${RED}${g.provider.toUpperCase()} CLI: not installed${RESET}`);
		if (g.installCommand) {
			lines.push(`    Install: ${BOLD}${g.installCommand}${RESET}`);
		}
		lines.push(`    Docs:    ${DIM}${g.docsUrl}${RESET}`);
		lines.push("");
	}

	// ── Primary Recipe ─────────────────────
	if (result.recipe) {
		formatRecipe(result.recipe, lines, false);
	}

	// ── Alternatives ───────────────────────
	if (result.alternatives.length > 0) {
		const alt = result.alternatives[0]; // Show best alternative
		lines.push(`  ${GREEN}Alternative: ${alt.reason}${RESET}`);
		lines.push(`    Equivalent service: ${BOLD}${alt.serviceName}${RESET}`);
		lines.push("");
		formatRecipe(alt.recipe, lines, true);
	}

	// ── No Providers ───────────────────────
	if (!result.recipe && result.alternatives.length === 0 && !result.authGuidance) {
		lines.push(`  ${DIM}No cloud providers are currently authenticated.${RESET}`);
		lines.push(`  ${DIM}Install and authenticate a cloud CLI to get started.${RESET}`);
	}

	return lines.join("\n");
}

function formatRecipe(recipe: CloudRecipe, lines: string[], isAlternative: boolean): void {
	const prefix = isAlternative ? "  " : "";
	lines.push(`${prefix}  ${BOLD}Recipe: ${recipe.name} (${recipe.steps.length} steps):${RESET}`);

	for (const step of recipe.steps) {
		lines.push(`${prefix}    ${step.order}. ${step.description}`);
		lines.push(`${prefix}       ${DIM}$ ${step.command}${RESET}`);
	}

	lines.push("");

	// Placeholders
	const placeholderEntries = Object.entries(recipe.placeholders);
	if (placeholderEntries.length > 0) {
		lines.push(`${prefix}  ${BOLD}Placeholders:${RESET}`);
		const maxKeyLen = Math.max(...placeholderEntries.map(([k]) => k.length));
		for (const [key, desc] of placeholderEntries) {
			lines.push(`${prefix}    {${key}}${" ".repeat(maxKeyLen - key.length + 1)} ${DIM}${desc}${RESET}`);
		}
		lines.push("");
	}

	// Cost + Docs
	if (recipe.estimatedCost) {
		lines.push(`${prefix}  ${DIM}Cost: ${recipe.estimatedCost}${RESET}`);
	}
	if (recipe.docsUrl) {
		lines.push(`${prefix}  ${DIM}Docs: ${recipe.docsUrl}${RESET}`);
	}
	lines.push("");
}

function guessRecipeName(query: string): string {
	// Best-effort: capitalize first letter of each word
	const words = query.split(/\s+/).filter((w) => w.length > 0);
	return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

