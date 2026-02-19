/**
 * @chitragupta/anina — CodingOrchestrator planning phase.
 *
 * Analyzes coding tasks and produces structured execution plans.
 * Supports both LLM-based planning (when a provider is available)
 * and heuristic fallback for provider-free operation.
 */

import { createLogger } from "@chitragupta/core";

import { Agent } from "./agent.js";
import type { CodingAgent } from "./coding-agent.js";
import { safeExecSync } from "./safe-exec.js";
import type { AgentConfig } from "./types.js";
import type {
	CodingOrchestratorConfig,
	TaskPlan,
	TaskStep,
	ResolvedOrchestratorConfig,
} from "./coding-orchestrator-types.js";

const log = createLogger("anina:orchestrator:planner");

// ─── Conversational Detection ────────────────────────────────────────────────

/**
 * Detect whether user input is a conversational/non-coding query.
 * Conservative: only catches obvious greetings and identity questions.
 */
export function isConversationalQuery(task: string): boolean {
	const lower = task.toLowerCase().trim();

	if (/^(hi|hello|hey|sup|yo|thanks|thank you|bye|goodbye|ok|okay)\s*[!?.]*$/i.test(lower)) {
		return true;
	}
	if (/^(who|what|how)\s+(are|r)\s+(you|u|ya)\s*[?!.]*$/i.test(lower)) {
		return true;
	}
	if (/^(good\s+(morning|evening|night|afternoon)|what'?s?\s*up|how'?s?\s*it\s*going)\s*[?!.]*$/i.test(lower)) {
		return true;
	}

	return false;
}

// ─── Plan Task ───────────────────────────────────────────────────────────────

/**
 * Analyze a task and produce a structured plan.
 *
 * @returns The plan and an optional planning agent (created for LLM planning).
 */
export async function planTask(
	task: string,
	config: ResolvedOrchestratorConfig,
	getCodingAgent: () => CodingAgent,
	isGitRepo: boolean,
): Promise<{ plan: TaskPlan; planningAgent: Agent | null }> {
	if (isConversationalQuery(task)) {
		return {
			plan: { task, steps: [], relevantFiles: [], complexity: "small", requiresNewFiles: false },
			planningAgent: null,
		};
	}

	const simpleKeywords = ["fix typo", "rename", "add comment", "remove unused", "update import"];
	const isSimple = simpleKeywords.some((kw) => task.toLowerCase().includes(kw));

	if (isSimple) {
		return {
			plan: {
				task,
				steps: [{ index: 1, description: task, affectedFiles: [], completed: false }],
				relevantFiles: [],
				complexity: "small",
				requiresNewFiles: false,
			},
			planningAgent: null,
		};
	}

	if (config.provider) {
		try {
			const result = await llmPlan(task, config);
			if (result.plan) return { plan: result.plan, planningAgent: result.planningAgent };
		} catch (err) {
			log.warn("LLM planning failed, falling back to heuristic:", { error: String(err) });
		}
	}

	const plan = await heuristicPlan(task, getCodingAgent(), config.workingDirectory, isGitRepo);
	return { plan, planningAgent: null };
}

// ─── LLM Planning ────────────────────────────────────────────────────────────

/**
 * LLM-based planning: create a lightweight read-only agent that explores
 * the project and returns a structured JSON plan.
 */
async function llmPlan(
	task: string,
	config: ResolvedOrchestratorConfig,
): Promise<{ plan: TaskPlan | null; planningAgent: Agent }> {
	const { KARTRU_PROFILE } = await import("@chitragupta/core");

	const readOnlyNames = new Set(["read", "ls", "find", "grep", "bash"]);
	const readOnlyTools = (config.tools ?? []).filter(
		(t) => readOnlyNames.has(t.definition.name),
	);

	const planningConfig: AgentConfig = {
		profile: { ...KARTRU_PROFILE, id: "sanyojaka-planner", name: "Sanyojaka Planner" },
		providerId: config.providerId,
		model: config.modelId ?? KARTRU_PROFILE.preferredModel ?? "claude-sonnet-4-5-20250929",
		tools: readOnlyTools,
		thinkingLevel: "medium",
		workingDirectory: config.workingDirectory,
		maxTurns: 8,
		enableChetana: false,
		enableLearning: false,
		enableAutonomy: false,
		commHub: config.commHub,
		actorSystem: config.actorSystem,
		samiti: config.samiti,
		lokapala: config.lokapala,
		kaala: config.kaala,
		policyEngine: config.policyEngine,
	};

	const agent = new Agent(planningConfig);
	agent.setProvider(config.provider as import("@chitragupta/swara").ProviderDefinition);

	const contextNote = config.additionalContext
		? `\n\nProject context:\n${config.additionalContext}`
		: "";

	const planPrompt = `You are a coding task planner. Analyze the following coding task and the project structure, then produce a detailed plan.

Task: ${task}

Working directory: ${config.workingDirectory}
${contextNote}

Instructions:
1. Use the available tools (read, ls, find, grep) to explore the project structure and understand the codebase.
2. Identify which files are relevant to the task.
3. Determine what changes need to be made.
4. Create a step-by-step plan.

After exploring, respond with ONLY a JSON object (no markdown fences, no explanation) in this exact format:
{
  "steps": [
    { "index": 1, "description": "Short description of step", "affectedFiles": ["path/to/file.ts"] }
  ],
  "relevantFiles": ["path/to/file1.ts", "path/to/file2.ts"],
  "complexity": "small" | "medium" | "large",
  "requiresNewFiles": true | false
}

Where complexity is:
- "small": 1-2 files changed, simple fix
- "medium": 3-5 files, moderate changes
- "large": 6+ files or significant structural changes

Keep steps focused and actionable. Each step should describe a single coherent change.`;

	const response = await agent.prompt(planPrompt);

	const textContent = response.content
		.filter((p): p is { type: "text"; text: string } => p.type === "text")
		.map((p) => p.text)
		.join("");

	const jsonMatch = textContent.match(/\{[\s\S]*"steps"[\s\S]*\}/);
	if (!jsonMatch) {
		log.warn("LLM plan response did not contain valid JSON");
		return { plan: null, planningAgent: agent };
	}

	try {
		const parsed = JSON.parse(jsonMatch[0]) as {
			steps?: Array<{ index?: number; description?: string; affectedFiles?: string[] }>;
			relevantFiles?: string[];
			complexity?: string;
			requiresNewFiles?: boolean;
		};

		if (!parsed.steps || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
			log.warn("LLM plan has no steps");
			return { plan: null, planningAgent: agent };
		}

		const steps: TaskStep[] = parsed.steps.map((s, i) => ({
			index: s.index ?? i + 1,
			description: s.description ?? `Step ${i + 1}`,
			affectedFiles: Array.isArray(s.affectedFiles) ? s.affectedFiles : [],
			completed: false,
		}));

		const complexity = (["small", "medium", "large"] as const).includes(
			parsed.complexity as "small" | "medium" | "large",
		)
			? (parsed.complexity as TaskPlan["complexity"])
			: steps.length <= 2 ? "small" : steps.length <= 4 ? "medium" : "large";

		return {
			plan: {
				task,
				steps,
				relevantFiles: Array.isArray(parsed.relevantFiles) ? parsed.relevantFiles : [],
				complexity,
				requiresNewFiles: parsed.requiresNewFiles ?? false,
			},
			planningAgent: agent,
		};
	} catch (parseErr) {
		log.warn("Failed to parse LLM plan JSON:", { error: String(parseErr) });
		return { plan: null, planningAgent: agent };
	}
}

// ─── Heuristic Planning ──────────────────────────────────────────────────────

/** Heuristic-only planning fallback (no LLM needed). */
async function heuristicPlan(
	task: string,
	codingAgent: CodingAgent,
	workingDirectory: string,
	isGitRepo: boolean,
): Promise<TaskPlan> {
	const conventions = await codingAgent.detectConventions();
	const steps: TaskStep[] = [];
	let requiresNewFiles = false;

	if (/\b(create|add|new|implement)\b.*\b(files?|components?|modules?|class(?:es)?|functions?|endpoints?|routes?|tests?)\b/i.test(task)) {
		requiresNewFiles = true;
	}

	const mentionsTests = /\b(tests?|specs?|testing)\b/i.test(task);

	steps.push({ index: 1, description: "Understand the codebase: read relevant files and identify patterns", affectedFiles: [], completed: false });

	if (requiresNewFiles) {
		steps.push({ index: steps.length + 1, description: "Create new file(s) following project conventions", affectedFiles: [], completed: false });
	}

	steps.push({ index: steps.length + 1, description: "Implement the changes", affectedFiles: [], completed: false });

	if (mentionsTests || conventions.testCommand) {
		steps.push({ index: steps.length + 1, description: "Write or update tests", affectedFiles: [], completed: false });
	}

	const complexityKeywords = /\b(refactor|redesign|rewrite|migrate|architecture|system)\b/i;
	const complexity: TaskPlan["complexity"] = complexityKeywords.test(task)
		? "large"
		: steps.length > 3 ? "medium" : "small";

	let testSuggestion: string | undefined;
	if (requiresNewFiles && !mentionsTests) {
		testSuggestion = conventions.testPattern
			? `Consider adding tests in ${conventions.testPattern}/ for new files`
			: "Consider adding tests for newly created functions/modules";
	}

	const dependencyHints = scanDependencyHints(task, workingDirectory, isGitRepo);

	return { task, steps, relevantFiles: [], complexity, requiresNewFiles, testSuggestion, dependencyHints };
}

// ─── Task Enrichment ─────────────────────────────────────────────────────────

/** Enrich a task prompt with plan context for the coding agent. */
export function enrichTaskWithPlan(task: string, plan: TaskPlan): string {
	if (plan.steps.length <= 1 && !plan.testSuggestion && !plan.dependencyHints?.length) return task;

	const planStr = plan.steps
		.map((s) => `${s.index}. ${s.description}`)
		.join("\n");

	const sections = [
		task,
		"",
		"--- Execution Plan ---",
		planStr,
		"",
		`Complexity: ${plan.complexity}`,
		plan.requiresNewFiles ? "Note: This task requires creating new files." : "",
	];

	if (plan.testSuggestion) {
		sections.push("");
		sections.push(`Testing: ${plan.testSuggestion}`);
	}

	if (plan.dependencyHints && plan.dependencyHints.length > 0) {
		sections.push("");
		sections.push("--- Dependency Info ---");
		for (const hint of plan.dependencyHints) {
			sections.push(`  ${hint}`);
		}
		sections.push("Make sure changes don't break these importing files.");
	}

	return sections.filter(Boolean).join("\n");
}

// ─── Dependency Scanning ─────────────────────────────────────────────────────

/**
 * Scan for files that import/use the files mentioned in the task.
 * Returns dependency hints for the coding agent.
 */
export function scanDependencyHints(task: string, workingDirectory: string, isGitRepo: boolean): string[] {
	if (!isGitRepo) return [];

	const hints: string[] = [];
	try {
		const filePattern = task.match(/[\w-]+\.(ts|tsx|js|jsx|py|rs|go)/g);
		if (!filePattern || filePattern.length === 0) return [];

		for (const file of filePattern.slice(0, 3)) {
			const stem = file.replace(/\.\w+$/, "");
			try {
				const result = safeExecSync(
					`git grep -l "from.*['\\"./]${stem}['\\".]\\|import.*${stem}\\|require.*${stem}" -- "*.ts" "*.tsx" "*.js" "*.jsx" 2>/dev/null | head -10`,
					{ cwd: workingDirectory, encoding: "utf-8", timeout: 5_000, stdio: ["pipe", "pipe", "pipe"] },
				).trim();

				if (result) {
					const importers = result.split("\n").filter(Boolean);
					if (importers.length > 0) {
						hints.push(`${file} is imported by: ${importers.join(", ")}`);
					}
				}
			} catch { /* grep returned non-zero — no matches */ }
		}
	} catch {
		// Non-fatal
	}
	return hints;
}

// ─── Summary Formatting ──────────────────────────────────────────────────────

/** Format a plan as a human-readable summary. */
export function formatPlanSummary(plan: TaskPlan): string {
	const lines = [
		`Plan for: ${plan.task}`,
		`Complexity: ${plan.complexity}`,
		`Steps: ${plan.steps.length}`,
		"",
		...plan.steps.map((s) => `  ${s.index}. ${s.description}`),
	];
	return lines.join("\n");
}
