/**
 * Praptya (प्राप्त्य — Attainable) — 5-Tier Solution Sourcer.
 *
 * Given a TaskAnalysis, finds the best way to fulfill the task using
 * a cascading fallback chain:
 *
 * 1. **builtin-tool**: Check the SkillRegistry with relaxed threshold
 * 2. **system-utility**: Verify `which <cmd>`, build shell script
 * 3. **npm-package**: `npm search --json` (opt-in, requires network)
 * 4. **github-repo**: `gh search repos --json` (opt-in, requires network)
 * 5. **code-generation**: Flag for sub-agent (LLM required)
 *
 * Returns on first success. Tiers 1-2 are local (~10ms).
 * Tiers 3-4 need network (disabled by default).
 *
 * @packageDocumentation
 */

import { execFile } from "node:child_process";
import type { TaskAnalysis, SourceResult, SourceTier, ShikshaConfig } from "./types.js";
import type { SkillRegistry } from "../registry.js";
import { detectProviders, buildCloudResult } from "./megha.js";

// ─── Which Command Verification ────────────────────────────────────────────

/**
 * Check if a command is available on the system via `which`.
 * Returns the path if found, null otherwise.
 */
function whichCommand(cmd: string): Promise<string | null> {
	return new Promise((resolve) => {
		execFile("which", [cmd], { timeout: 2000 }, (err, stdout) => {
			if (err) {
				resolve(null);
			} else {
				resolve(stdout.trim() || null);
			}
		});
	});
}

// ─── Tier 1: Builtin Tool ──────────────────────────────────────────────────

async function tryBuiltinTool(
	analysis: TaskAnalysis,
	registry?: SkillRegistry,
): Promise<SourceResult | null> {
	if (!registry) return null;

	// Relaxed threshold (0.15) to catch near-misses
	const matches = registry.query({
		text: analysis.query,
		topK: 1,
		threshold: 0.15,
	});

	if (matches.length === 0) return null;

	const match = matches[0];
	return {
		tier: "builtin-tool",
		implementation: {
			type: "tool-chain",
			tools: [match.skill.name],
			steps: [`Use ${match.skill.name}: ${match.skill.description}`],
		},
		commands: [],
		toolChain: [match.skill.name],
	};
}

// ─── Tier 2: System Utility ────────────────────────────────────────────────

async function trySystemUtility(
	analysis: TaskAnalysis,
): Promise<SourceResult | null> {
	if (analysis.candidateUtilities.length === 0) return null;

	// Try candidates in order of confidence
	for (const candidate of analysis.candidateUtilities) {
		const path = await whichCommand(candidate.command);
		if (path) {
			return {
				tier: "system-utility",
				implementation: {
					type: "shell",
					script: candidate.template,
				},
				commands: [candidate.template],
				toolChain: [],
			};
		}
	}

	return null;
}

// ─── Tier 2.5: Cloud Recipe ────────────────────────────────────────────────

async function tryCloudRecipe(
	analysis: TaskAnalysis,
	config: ShikshaConfig,
): Promise<SourceResult | null> {
	if (!config.enableCloudDetection) return null;
	if (analysis.domain !== "cloud" && !analysis.cloudContext) return null;

	const detections = await detectProviders(config.cloudDetectionCacheTTL);

	// Update the analysis's cloud context with detection results
	if (analysis.cloudContext) {
		analysis.cloudContext.detections = detections;
	}

	const cloudResult = buildCloudResult(analysis, detections);

	// Only return a result if we have something useful
	if (!cloudResult.recipe && cloudResult.alternatives.length === 0 && !cloudResult.authGuidance && !cloudResult.installGuidance) {
		return null;
	}

	return {
		tier: "cloud-recipe",
		implementation: { type: "shell", script: "" }, // placeholder — never auto-executed
		commands: [],
		toolChain: [],
		cloudResult,
	};
}

// ─── Tier 3: npm Package ───────────────────────────────────────────────────

async function tryNpmPackage(
	analysis: TaskAnalysis,
	config: ShikshaConfig,
): Promise<SourceResult | null> {
	if (!config.enableRemoteSourcing) return null;

	// Build a search query from intents
	const searchTerms = analysis.intents
		.map((i) => `${i.verb} ${i.object}`)
		.join(" ");

	if (!searchTerms.trim()) return null;

	try {
		const result = await execWithTimeout(
			"npm",
			["search", "--json", "--long", searchTerms],
			config.sourcingTimeoutMs,
		);

		if (!result) return null;

		const packages: NpmSearchResult[] = JSON.parse(result);
		if (packages.length === 0) return null;

		// Filter by minimum downloads
		const qualified = packages.filter(
			(p) => (p.downloads ?? 0) >= config.minNpmDownloads,
		);

		if (qualified.length === 0) return null;

		const best = qualified[0];
		return {
			tier: "npm-package",
			implementation: {
				type: "typescript",
				code: `// Install: npm i ${best.name}\nimport pkg from "${best.name}";\n`,
				entrypoint: "index.ts",
			},
			commands: [`npm install ${best.name}`],
			toolChain: [],
			packageInfo: {
				name: best.name,
				version: best.version,
				downloads: best.downloads,
				url: `https://www.npmjs.com/package/${best.name}`,
			},
		};
	} catch {
		return null;
	}
}

interface NpmSearchResult {
	name: string;
	version: string;
	description?: string;
	downloads?: number;
}

// ─── Tier 4: GitHub Repo ───────────────────────────────────────────────────

async function tryGithubRepo(
	analysis: TaskAnalysis,
	config: ShikshaConfig,
): Promise<SourceResult | null> {
	if (!config.enableRemoteSourcing) return null;

	const searchTerms = analysis.intents
		.map((i) => `${i.verb} ${i.object}`)
		.join(" ");

	if (!searchTerms.trim()) return null;

	try {
		const result = await execWithTimeout(
			"gh",
			["search", "repos", "--json", "name,description,stargazersCount,url", "--limit", "5", searchTerms],
			config.sourcingTimeoutMs,
		);

		if (!result) return null;

		const repos: GithubSearchResult[] = JSON.parse(result);
		if (repos.length === 0) return null;

		// Filter by minimum stars
		const qualified = repos.filter(
			(r) => (r.stargazersCount ?? 0) >= config.minGithubStars,
		);

		if (qualified.length === 0) return null;

		const best = qualified[0];
		return {
			tier: "github-repo",
			implementation: {
				type: "typescript",
				code: `// From: ${best.url}\n// ${best.description ?? ""}\n`,
				entrypoint: "index.ts",
			},
			commands: [],
			toolChain: [],
			packageInfo: {
				name: best.name,
				stars: best.stargazersCount,
				url: best.url,
			},
		};
	} catch {
		return null;
	}
}

interface GithubSearchResult {
	name: string;
	description?: string;
	stargazersCount?: number;
	url: string;
}

// ─── Tier 5: Code Generation ───────────────────────────────────────────────

function flagCodeGeneration(analysis: TaskAnalysis): SourceResult {
	return {
		tier: "code-generation",
		implementation: {
			type: "llm-chain",
			systemPrompt: `Generate a solution for: ${analysis.query}`,
			steps: analysis.intents.map(
				(i) => `${i.verb} ${i.object}${i.modifier ? ` ${i.modifier}` : ""}`,
			),
		},
		commands: [],
		toolChain: [],
	};
}

// ─── Main Entry Point ──────────────────────────────────────────────────────

/**
 * Source a skill implementation using the 5-tier fallback chain.
 *
 * Returns on **first success**. Tiers 1-2 are local (~10ms).
 * Tiers 3-4 need network (opt-in). Tier 5 needs LLM.
 *
 * @param analysis - Task analysis from VimarshAnalyzer.
 * @param config - Shiksha configuration.
 * @param registry - Optional skill registry for builtin tool lookup.
 * @returns Source result with implementation details.
 */
export async function sourceSkill(
	analysis: TaskAnalysis,
	config: ShikshaConfig,
	registry?: SkillRegistry,
): Promise<SourceResult> {
	const tiers: Array<{ name: SourceTier; fn: () => Promise<SourceResult | null> }> = [
		{ name: "builtin-tool", fn: () => tryBuiltinTool(analysis, registry) },
		{ name: "system-utility", fn: () => trySystemUtility(analysis) },
		{ name: "cloud-recipe", fn: () => tryCloudRecipe(analysis, config) },
		{ name: "npm-package", fn: () => tryNpmPackage(analysis, config) },
		{ name: "github-repo", fn: () => tryGithubRepo(analysis, config) },
	];

	for (const tier of tiers) {
		const result = await tier.fn();
		if (result) return result;
	}

	// Tier 5: always succeeds (flags for code generation)
	return flagCodeGeneration(analysis);
}

// ─── Utilities ─────────────────────────────────────────────────────────────

/**
 * Execute a command with a timeout.
 * Returns stdout on success, null on failure.
 */
function execWithTimeout(
	cmd: string,
	args: string[],
	timeoutMs: number,
): Promise<string | null> {
	return new Promise((resolve) => {
		execFile(cmd, args, { timeout: timeoutMs }, (err, stdout) => {
			if (err) {
				resolve(null);
			} else {
				resolve(stdout);
			}
		});
	});
}

// ─── Exports for testing ───────────────────────────────────────────────────

export { whichCommand, tryBuiltinTool, trySystemUtility, tryCloudRecipe, tryNpmPackage, tryGithubRepo, flagCodeGeneration };
