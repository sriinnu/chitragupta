/**
 * MCP Tools — Vidhya-Skills Pipeline.
 *
 * Tool factories for skill discovery, matching, learning, health scoring,
 * security scanning, and ecosystem stats. Exposes @chitragupta/vidhya-skills
 * to MCP clients so AI agents can introspect and extend their skill set.
 *
 * @module
 */
import type { McpToolHandler, McpToolResult } from "@chitragupta/tantra";
import { getSkillRegistry } from "./mcp-subsystems.js";
import { truncateOutput } from "./mcp-tools-core.js";

/** Duck-typed skill match result (avoids importing concrete types). */
interface DuckSkillMatch {
	skill: { name: string; description?: string; tags?: string[]; requirements?: unknown };
	score: number;
}

// ─── skills_find ─────────────────────────────────────────────────────────────

/** Create the `skills_find` tool — match skills to a query via TVM. */
export function createSkillsFindTool(): McpToolHandler {
	return {
		definition: {
			name: "skills_find",
			description:
				"Find skills matching a natural language query using Trait Vector Matching (TVM). " +
				"Zero-latency (<1ms), zero-LLM-call matching. Returns ranked results with " +
				"similarity scores, tag boosts, and capability matches.",
			inputSchema: {
				type: "object",
				properties: {
					query: { type: "string", description: "Natural language query (e.g., 'read a file', 'deploy to AWS')." },
					limit: { type: "number", description: "Maximum results. Default: 5." },
					tags: { type: "array", items: { type: "string" }, description: "Filter by tags." },
				},
				required: ["query"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const query = String(args.query ?? "");
			if (!query) return { content: [{ type: "text", text: "Error: query is required" }], isError: true };
			const limit = Math.min(20, Math.max(1, Number(args.limit ?? 5) || 5));

			try {
				const { matchSkills } = await import("@chitragupta/vidhya-skills");
				const registry = await getSkillRegistry();
				const allSkills = registry.getAll();

				if (allSkills.length === 0) {
					return { content: [{ type: "text", text: "No skills registered. Discover skills first or use skills_learn." }] };
				}

				const tags = Array.isArray(args.tags) ? (args.tags as string[]).map(String) : undefined;
				const matches = matchSkills({ text: query, tags }, allSkills as never[]) as unknown as DuckSkillMatch[];
				const top = matches.slice(0, limit);

				if (top.length === 0) {
					return { content: [{ type: "text", text: `No skills match query: "${query}"` }] };
				}

				const formatted = top.map((m, i) =>
					`[${i + 1}] ${m.skill.name} (score: ${m.score.toFixed(3)})\n` +
					`    ${m.skill.description ?? "(no description)"}\n` +
					`    Tags: [${(m.skill.tags ?? []).join(", ")}]`,
				).join("\n\n");

				return { content: [{ type: "text", text: `Skills matching "${query}" (${top.length}):\n\n${formatted}` }] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `skills_find failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── skills_list ─────────────────────────────────────────────────────────────

/** Create the `skills_list` tool — list registered skills. */
export function createSkillsListTool(): McpToolHandler {
	return {
		definition: {
			name: "skills_list",
			description:
				"List all registered skills, optionally filtered by tag, verb, or kula tier. " +
				"Shows skill name, description, tags, and capabilities.",
			inputSchema: {
				type: "object",
				properties: {
					tag: { type: "string", description: "Filter by tag (e.g., 'filesystem', 'cloud')." },
					verb: { type: "string", description: "Filter by verb (e.g., 'read', 'write', 'deploy')." },
					limit: { type: "number", description: "Maximum results. Default: 20." },
				},
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const limit = Math.min(100, Math.max(1, Number(args.limit ?? 20) || 20));

			try {
				const registry = await getSkillRegistry();
				let skills: Array<Record<string, unknown>>;

				if (args.tag) {
					skills = registry.getByTag(String(args.tag));
				} else if (args.verb) {
					skills = registry.getByVerb(String(args.verb));
				} else {
					skills = registry.getAll();
				}

				const limited = skills.slice(0, limit);
				if (limited.length === 0) {
					const filter = args.tag ? `tag="${args.tag}"` : args.verb ? `verb="${args.verb}"` : "";
					return { content: [{ type: "text", text: `No skills found${filter ? ` for ${filter}` : ""}. Registry has ${registry.size} total.` }] };
				}

				const lines = limited.map((s) =>
					`- ${s.name ?? "(unnamed)"}: ${s.description ?? "(no desc)"} [${((s.tags ?? []) as string[]).join(", ")}]`,
				);
				return { content: [{ type: "text", text: `Skills (${limited.length}/${registry.size}):\n\n${lines.join("\n")}` }] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `skills_list failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── skills_health ───────────────────────────────────────────────────────────

/** Create the `skills_health` tool — Pancha Kosha five-sheath health scoring. */
export function createSkillsHealthTool(): McpToolHandler {
	return {
		definition: {
			name: "skills_health",
			description:
				"Score a skill's health using the Pancha Kosha (five-sheath) model: " +
				"Annamaya (structural), Pranamaya (runtime requirements), Manomaya (docs), " +
				"Vijnanamaya (wisdom), Anandamaya (mastery). Returns [0-1] scores per sheath.",
			inputSchema: {
				type: "object",
				properties: {
					skillName: { type: "string", description: "Name of the skill to assess." },
				},
				required: ["skillName"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const skillName = String(args.skillName ?? "");
			if (!skillName) return { content: [{ type: "text", text: "Error: skillName is required" }], isError: true };

			try {
				const registry = await getSkillRegistry();
				const skill = registry.getByName(skillName);
				if (!skill) {
					return { content: [{ type: "text", text: `Skill "${skillName}" not found in registry.` }] };
				}

				const { buildPanchaKosha, INITIAL_ANANDAMAYA } = await import("@chitragupta/vidhya-skills");
				const scores = buildPanchaKosha(skill as never, INITIAL_ANANDAMAYA as never) as unknown as {
					annamaya: number; pranamaya: number; manomaya: number; vijnanamaya: number; anandamaya: number;
				};
				const composite = (scores.annamaya + scores.pranamaya + scores.manomaya + scores.vijnanamaya + scores.anandamaya) / 5;

				return { content: [{ type: "text", text:
					`Pancha Kosha — ${skillName}:\n` +
					`  Annamaya  (structural):  ${scores.annamaya.toFixed(2)}\n` +
					`  Pranamaya (runtime):     ${scores.pranamaya.toFixed(2)}\n` +
					`  Manomaya  (docs):        ${scores.manomaya.toFixed(2)}\n` +
					`  Vijnanamaya (wisdom):    ${scores.vijnanamaya.toFixed(2)}\n` +
					`  Anandamaya (mastery):    ${scores.anandamaya.toFixed(2)}\n` +
					`  Composite:              ${composite.toFixed(2)}`,
				}] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `skills_health failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── skills_learn ────────────────────────────────────────────────────────────

/** Create the `skills_learn` tool — trigger autonomous skill learning. */
export function createSkillsLearnTool(): McpToolHandler {
	return {
		definition: {
			name: "skills_learn",
			description:
				"Trigger the Shiksha (शिक्षा) autonomous skill learning pipeline. " +
				"Analyzes the task, sources solutions from 5 tiers (builtin → npm → github → " +
				"cloud → LLM), and generates a new skill manifest.",
			inputSchema: {
				type: "object",
				properties: {
					task: { type: "string", description: "Natural language task (e.g., 'deploy Docker container to AWS ECS')." },
				},
				required: ["task"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const task = String(args.task ?? "");
			if (!task) return { content: [{ type: "text", text: "Error: task is required" }], isError: true };

			try {
				const { analyzeTask, sourceSkill, buildSkill, DEFAULT_SHIKSHA_CONFIG } = await import("@chitragupta/vidhya-skills");
				const analysis = analyzeTask(task);
				const sources = await sourceSkill(analysis, DEFAULT_SHIKSHA_CONFIG);
				const skill = buildSkill(analysis, sources);

				const result = {
					analysis: {
						domain: analysis.domain,
						complexity: analysis.complexity,
						intents: analysis.intents?.map((i: { verb: string; object: string }) => `${i.verb} ${i.object}`) ?? [],
					},
					sourceTier: sources.tier,
					sourceImpl: sources.implementation,
					skill: skill ? {
						name: skill.manifest.name,
						description: skill.manifest.description,
						tags: skill.manifest.tags,
					} : null,
					status: skill ? "generated" : "no-sources-found",
				};

				return { content: [{ type: "text", text: truncateOutput(JSON.stringify(result, null, 2)) }] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `skills_learn failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── skills_scan ─────────────────────────────────────────────────────────────

/** Create the `skills_scan` tool — Suraksha security scan. */
export function createSkillsScanTool(): McpToolHandler {
	return {
		definition: {
			name: "skills_scan",
			description:
				"Run a Suraksha (सुरक्षा) security scan on skill content. Detects malicious " +
				"patterns, entropy anomalies, suspicious imports, and produces a risk verdict.",
			inputSchema: {
				type: "object",
				properties: {
					skillName: { type: "string", description: "Name of the skill to scan (must be in registry)." },
					content: { type: "string", description: "Raw skill.md content to scan (alternative to skillName)." },
				},
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			try {
				const { SurakshaScanner } = await import("@chitragupta/vidhya-skills");
				const scanner = new SurakshaScanner();
				let name = "inline";
				let content = args.content != null ? String(args.content) : "";

				if (args.skillName && !content) {
					const registry = await getSkillRegistry();
					const skill = registry.getByName(String(args.skillName));
					if (!skill) return { content: [{ type: "text", text: `Skill "${args.skillName}" not in registry.` }] };
					name = String(skill.name ?? args.skillName);
					content = JSON.stringify(skill);
				}

				if (!content) {
					return { content: [{ type: "text", text: "Error: provide skillName or content" }], isError: true };
				}

				const result = scanner.scan(name, content);
				const findings = result.findings as Array<{ threat: string; severity: string; pattern: string }>;
				const formatted = findings.length > 0
					? findings.map((f) => `  [${f.severity}] ${f.threat}: ${f.pattern}`).join("\n")
					: "  No threats detected.";

				return { content: [{ type: "text", text:
					`Suraksha Scan — ${name}:\n` +
					`  Verdict: ${result.verdict}\n` +
					`  Risk Score: ${result.riskScore.toFixed(3)}\n` +
					`  Findings (${findings.length}):\n${formatted}`,
				}] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `skills_scan failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── skills_ecosystem ────────────────────────────────────────────────────────

/** Create the `skills_ecosystem` tool — ecosystem-wide stats. */
export function createSkillsEcosystemTool(): McpToolHandler {
	return {
		definition: {
			name: "skills_ecosystem",
			description:
				"Get ecosystem-wide statistics: total skills, distribution by tag, " +
				"lifecycle stages, and available capabilities.",
			inputSchema: { type: "object", properties: {} },
		},
		async execute(): Promise<McpToolResult> {
			try {
				const registry = await getSkillRegistry();
				const all = registry.getAll();
				const tagCounts = new Map<string, number>();
				const capSet = new Set<string>();

				for (const skill of all) {
					for (const tag of (skill.tags ?? []) as string[]) {
						tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
					}
					for (const cap of ((skill.capabilities ?? []) as Array<{ name?: string } | string>)) {
						if (typeof cap === "string") capSet.add(cap);
						else if (typeof cap === "object" && cap.name) capSet.add(cap.name);
					}
				}

				const topTags = [...tagCounts.entries()]
					.sort((a, b) => b[1] - a[1]).slice(0, 15)
					.map(([tag, count]) => `  ${tag}: ${count}`);

				return { content: [{ type: "text", text:
					`Skill Ecosystem:\n` +
					`  Total skills: ${all.length}\n` +
					`  Unique capabilities: ${capSet.size}\n` +
					`  Unique tags: ${tagCounts.size}\n\n` +
					`Top Tags:\n${topTags.join("\n")}\n\n` +
					`Capabilities: [${[...capSet].sort().join(", ")}]`,
				}] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `skills_ecosystem failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── skills_recommend ────────────────────────────────────────────────────────

/** Create the `skills_recommend` tool — smart skill recommendation. */
export function createSkillsRecommendTool(): McpToolHandler {
	return {
		definition: {
			name: "skills_recommend",
			description:
				"Get a smart skill recommendation: matches skills to a task, checks requirements, " +
				"and suggests the best skill with readiness assessment. If no skill matches, " +
				"suggests using skills_learn to create one.",
			inputSchema: {
				type: "object",
				properties: {
					task: { type: "string", description: "The task you need a skill for." },
				},
				required: ["task"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const task = String(args.task ?? "");
			if (!task) return { content: [{ type: "text", text: "Error: task is required" }], isError: true };

			try {
				const { matchSkills } = await import("@chitragupta/vidhya-skills");
				const registry = await getSkillRegistry();
				const all = registry.getAll();

				if (all.length === 0) {
					return { content: [{ type: "text", text:
						`No skills registered. Use \`skills_learn\` with task: "${task}" to create one.`,
					}] };
				}

				const matches = matchSkills({ text: task }, all as never[]) as unknown as DuckSkillMatch[];
				if (matches.length === 0) {
					return { content: [{ type: "text", text: `No skills match "${task}". Use \`skills_learn\` to create one.` }] };
				}

				const best = matches[0];
				return { content: [{ type: "text", text:
					`Recommendation for "${task}":\n\n` +
					`  Skill: ${best.skill.name}\n` +
					`  Score: ${best.score.toFixed(3)}\n` +
					`  Description: ${best.skill.description ?? "(none)"}\n` +
					`  Tags: [${(best.skill.tags ?? []).join(", ")}]\n\n` +
					(matches.length > 1
						? `Also matched: ${matches.slice(1, 4).map((m) => `${m.skill.name} (${m.score.toFixed(3)})`).join(", ")}`
						: ""),
				}] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `skills_recommend failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}
