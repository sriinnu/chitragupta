/**
 * @chitragupta/cli — Orchestrate command.
 *
 * chitragupta orchestrate <plan-file>  — run a multi-agent orchestration plan
 * chitragupta orchestrate presets       — list built-in plan presets
 *
 * Reads a JSON orchestration plan file and executes it through the
 * Niyanta orchestrator, streaming progress events to stdout.
 */

import fs from "fs";
import path from "path";
import {
	Orchestrator,
	CODE_REVIEW_PLAN,
	TDD_PLAN,
	REFACTOR_PLAN,
	BUG_HUNT_PLAN,
	DOCUMENTATION_PLAN,
} from "@chitragupta/niyanta";
import type { OrchestrationPlan, OrchestratorEvent } from "@chitragupta/niyanta";
import {
	bold,
	green,
	red,
	yellow,
	cyan,
	dim,
	gray,
} from "@chitragupta/ui/ansi";

// ─── Built-in Presets ────────────────────────────────────────────────────────

const PRESET_MAP: Record<string, OrchestrationPlan> = {
	"code-review": CODE_REVIEW_PLAN,
	"tdd": TDD_PLAN,
	"refactor": REFACTOR_PLAN,
	"bug-hunt": BUG_HUNT_PLAN,
	"documentation": DOCUMENTATION_PLAN,
};

// ─── Event Renderer ──────────────────────────────────────────────────────────

function renderEvent(event: OrchestratorEvent): void {
	switch (event.type) {
		case "plan:start":
			process.stdout.write(green(`\n  Plan started: ${event.planId}\n`));
			break;
		case "plan:complete":
			process.stdout.write(green(`\n  Plan completed. ${event.results.length} tasks finished.\n\n`));
			break;
		case "plan:failed":
			process.stdout.write(red(`\n  Plan failed: ${event.error}\n\n`));
			break;
		case "task:assigned":
			process.stdout.write(dim(`  [task:assigned] ${event.taskId} -> ${event.agentId}\n`));
			break;
		case "task:completed":
			process.stdout.write(green(`  [task:done] ${event.taskId} — ${event.result.success ? "success" : "failed"}\n`));
			break;
		case "task:failed":
			process.stdout.write(red(`  [task:failed] ${event.taskId}: ${event.error}\n`));
			break;
		case "task:retry":
			process.stdout.write(yellow(`  [task:retry] ${event.taskId} attempt #${event.attempt}\n`));
			break;
		case "agent:spawned":
			process.stdout.write(cyan(`  [agent:spawned] ${event.agentId} in slot ${event.agentSlot}\n`));
			break;
		case "agent:idle":
			process.stdout.write(dim(`  [agent:idle] ${event.agentId}\n`));
			break;
		case "agent:overloaded":
			process.stdout.write(yellow(`  [agent:overloaded] ${event.agentSlot} queue=${event.queueDepth}\n`));
			break;
		case "task:queued":
			process.stdout.write(dim(`  [task:queued] ${event.taskId} -> slot ${event.agentSlot}\n`));
			break;
		case "escalation":
			process.stdout.write(yellow(`  [escalation] ${event.taskId}: ${event.reason}\n`));
			break;
	}
}

// ─── Commands ────────────────────────────────────────────────────────────────

/**
 * Run an orchestration plan from a JSON file or a built-in preset name.
 */
export async function run(planFileOrPreset: string): Promise<void> {
	let plan: OrchestrationPlan;

	// Check if it's a preset name
	if (PRESET_MAP[planFileOrPreset]) {
		plan = PRESET_MAP[planFileOrPreset];
		process.stdout.write(
			"\n" + bold(`Running preset plan: ${plan.name}`) + "\n",
		);
	} else {
		// Load from file
		const filePath = path.resolve(planFileOrPreset);
		if (!fs.existsSync(filePath)) {
			process.stderr.write(
				red(`\n  Error: Plan file not found: ${filePath}\n`) +
				gray("  Usage: chitragupta orchestrate <plan-file.json | preset-name>\n\n"),
			);
			process.exit(1);
		}

		try {
			const raw = fs.readFileSync(filePath, "utf-8");
			plan = JSON.parse(raw) as OrchestrationPlan;
		} catch (err) {
			process.stderr.write(
				red(`\n  Error: Failed to parse plan file: ${err instanceof Error ? err.message : String(err)}\n\n`),
			);
			process.exit(1);
			return; // TypeScript flow
		}

		process.stdout.write(
			"\n" + bold(`Running plan: ${plan.name ?? plan.id}`) + "\n",
		);
	}

	process.stdout.write(
		dim(`  Strategy: ${plan.strategy} | Agents: ${plan.agents.length} | Routing rules: ${plan.routing.length}`) + "\n\n",
	);

	const orchestrator = new Orchestrator(plan, renderEvent);

	try {
		await orchestrator.start();

		// Submit any tasks that are defined inline in the plan (if metadata includes tasks)
		const inlineTasks = (plan as unknown as Record<string, unknown>).tasks as Array<Record<string, unknown>> | undefined;
		if (inlineTasks && Array.isArray(inlineTasks)) {
			for (const task of inlineTasks) {
				orchestrator.submit(task as unknown as import("@chitragupta/niyanta").OrchestratorTask);
			}
		}

		// Wait a bit for tasks to process, then show stats
		await new Promise<void>((resolve) => setTimeout(resolve, 2000));

		const stats = orchestrator.getStats();
		process.stdout.write("\n" + bold("  Orchestrator Stats") + "\n");
		process.stdout.write(`  Total tasks: ${stats.totalTasks}\n`);
		process.stdout.write(`  Completed: ${green(String(stats.completedTasks))}\n`);
		process.stdout.write(`  Failed: ${stats.failedTasks > 0 ? red(String(stats.failedTasks)) : "0"}\n`);
		process.stdout.write(`  Active agents: ${stats.activeAgents}\n`);
		process.stdout.write(`  Total cost: $${stats.totalCost.toFixed(4)}\n\n`);

		await orchestrator.stop();
	} catch (err) {
		process.stderr.write(
			red(`\n  Orchestration error: ${err instanceof Error ? err.message : String(err)}\n\n`),
		);
		await orchestrator.stop();
		process.exit(1);
	}
}

/**
 * List available built-in orchestration plan presets.
 */
export async function presets(): Promise<void> {
	process.stdout.write("\n" + bold("Orchestration Presets") + "\n\n");

	for (const [name, plan] of Object.entries(PRESET_MAP)) {
		process.stdout.write(
			`  ${cyan(name)}  ${dim("—")}  ${plan.name}\n` +
			`    Strategy: ${plan.strategy} | Agents: ${plan.agents.length}\n`,
		);
		for (const agent of plan.agents) {
			process.stdout.write(
				dim(`    - ${agent.id} (${agent.role}) [${agent.capabilities.join(", ")}]\n`),
			);
		}
		process.stdout.write("\n");
	}

	process.stdout.write(
		gray("  Usage: chitragupta orchestrate <preset-name>\n") +
		gray("  Or:    chitragupta orchestrate <plan-file.json>\n\n"),
	);
}

/**
 * Route `chitragupta orchestrate <subcommand>` to the correct handler.
 */
export async function runOrchestrateCommand(
	subcommand: string | undefined,
	rest: string[],
): Promise<void> {
	if (subcommand === "presets" || subcommand === "list") {
		await presets();
		return;
	}

	const target = subcommand ?? rest[0];
	if (!target) {
		process.stderr.write(
			"\nUsage: chitragupta orchestrate <plan-file | preset-name>\n\n" +
			"  " + cyan("<plan-file.json>") + "  Run a custom orchestration plan\n" +
			"  " + cyan("<preset-name>") + "    Run a built-in preset\n" +
			"  " + cyan("presets") + "          List available presets\n\n",
		);
		process.exit(1);
	}

	await run(target);
}
