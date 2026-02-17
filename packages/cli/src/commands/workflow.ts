/**
 * @chitragupta/cli — Workflow commands.
 *
 * chitragupta workflow run <file>       — execute a workflow DAG
 * chitragupta workflow list              — list saved workflows
 * chitragupta workflow validate <file>   — validate a workflow definition
 * chitragupta workflow templates         — list built-in workflow templates
 *
 * Workflows are directed acyclic graphs of steps with dependencies,
 * parallel execution, conditions, retries, and timeouts.
 */

import fs from "fs";
import path from "path";
import {
	WorkflowExecutor,
	validateDAG,
	listWorkflows,
	loadWorkflow,
	renderDAG,
	CODE_REVIEW_WORKFLOW,
	REFACTOR_WORKFLOW,
	BUG_FIX_WORKFLOW,
	DEPLOY_WORKFLOW,
} from "@chitragupta/vayu";
import type { Workflow, WorkflowEvent } from "@chitragupta/vayu";
import {
	bold,
	green,
	red,
	yellow,
	cyan,
	dim,
	gray,
} from "@chitragupta/ui/ansi";

// ─── Built-in Templates ──────────────────────────────────────────────────────

const TEMPLATE_MAP: Record<string, Workflow> = {
	"code-review": CODE_REVIEW_WORKFLOW,
	"refactor": REFACTOR_WORKFLOW,
	"bug-fix": BUG_FIX_WORKFLOW,
	"deploy": DEPLOY_WORKFLOW,
};

// ─── Event Renderer ──────────────────────────────────────────────────────────

function renderWorkflowEvent(event: WorkflowEvent): void {
	switch (event.type) {
		case "workflow:start":
			process.stdout.write(green(`  [workflow:start] ${event.workflowId} (${event.executionId})\n`));
			break;
		case "workflow:done":
			process.stdout.write(
				(event.status === "completed" ? green : event.status === "failed" ? red : yellow)(
					`  [workflow:done] ${event.workflowId} — ${event.status}\n`,
				),
			);
			break;
		case "step:start":
			process.stdout.write(cyan(`  [step:start] ${event.stepName} (${event.stepId})\n`));
			break;
		case "step:done":
			process.stdout.write(
				(event.status === "completed" ? green : red)(`  [step:done] ${event.stepId} — ${event.status}\n`),
			);
			break;
		case "step:error":
			process.stdout.write(red(`  [step:error] ${event.stepId}: ${event.error} (retry ${event.retryCount})\n`));
			break;
		case "step:skip":
			process.stdout.write(dim(`  [step:skip] ${event.stepId}: ${event.reason}\n`));
			break;
		case "step:retry":
			process.stdout.write(yellow(`  [step:retry] ${event.stepId} attempt ${event.attempt}/${event.maxRetries}\n`));
			break;
		case "approval:required":
			process.stdout.write(yellow(`  [approval:required] ${event.stepId}: ${event.message}\n`));
			break;
		case "approval:received":
			process.stdout.write(dim(`  [approval:received] ${event.stepId}: ${event.approved ? "approved" : "denied"}\n`));
			break;
	}
}

// ─── Commands ────────────────────────────────────────────────────────────────

/**
 * Load a workflow from a JSON file path.
 */
function loadWorkflowFile(filePath: string): Workflow {
	const resolved = path.resolve(filePath);
	if (!fs.existsSync(resolved)) {
		throw new Error(`Workflow file not found: ${resolved}`);
	}
	const raw = fs.readFileSync(resolved, "utf-8");
	return JSON.parse(raw) as Workflow;
}

/**
 * Run a workflow from a file or built-in template name.
 */
export async function run(fileOrTemplate: string): Promise<void> {
	let workflow: Workflow;

	if (TEMPLATE_MAP[fileOrTemplate]) {
		workflow = TEMPLATE_MAP[fileOrTemplate];
		process.stdout.write(
			"\n" + bold(`Running template workflow: ${workflow.name}`) + "\n\n",
		);
	} else {
		try {
			workflow = loadWorkflowFile(fileOrTemplate);
		} catch (err) {
			process.stderr.write(
				red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n\n`),
			);
			process.exit(1);
			return;
		}
		process.stdout.write(
			"\n" + bold(`Running workflow: ${workflow.name}`) + "\n\n",
		);
	}

	process.stdout.write(
		dim(`  Steps: ${workflow.steps.length} | Timeout: ${workflow.timeout ?? "none"} | Max concurrency: ${workflow.maxConcurrency ?? "unlimited"}`) + "\n\n",
	);

	const executor = new WorkflowExecutor();

	try {
		const execution = await executor.execute(workflow, renderWorkflowEvent);

		process.stdout.write("\n" + bold("  Execution Summary") + "\n");
		process.stdout.write(`  Status: ${execution.status === "completed" ? green("completed") : red(execution.status)}\n`);
		process.stdout.write(`  Duration: ${execution.endTime ? ((execution.endTime - execution.startTime) / 1000).toFixed(2) + "s" : "unknown"}\n`);

		let completed = 0, failed = 0, skipped = 0;
		for (const [, step] of execution.steps) {
			if (step.status === "completed") completed++;
			else if (step.status === "failed") failed++;
			else if (step.status === "skipped") skipped++;
		}

		process.stdout.write(`  Steps: ${green(String(completed))} completed`);
		if (failed > 0) process.stdout.write(`, ${red(String(failed))} failed`);
		if (skipped > 0) process.stdout.write(`, ${dim(String(skipped))} skipped`);
		process.stdout.write("\n\n");

		if (execution.status === "failed") {
			process.exit(1);
		}
	} catch (err) {
		process.stderr.write(
			red(`\n  Workflow error: ${err instanceof Error ? err.message : String(err)}\n\n`),
		);
		process.exit(1);
	}
}

/**
 * List all saved workflows from ~/.chitragupta/workflows/.
 */
export async function list(): Promise<void> {
	const workflows = listWorkflows();

	process.stdout.write("\n" + bold("Saved Workflows") + "\n\n");

	if (workflows.length === 0) {
		process.stdout.write(gray("  No workflows saved.\n"));
		process.stdout.write(gray("  Use `chitragupta workflow run <file>` to execute a workflow.\n\n"));
		return;
	}

	for (const wf of workflows) {
		process.stdout.write(
			`  ${cyan(wf.id)}  ${dim("—")}  ${wf.name}\n` +
			`    ${dim(wf.description)}\n` +
			`    Steps: ${wf.steps.length} | Version: ${wf.version}\n\n`,
		);
	}
}

/**
 * Validate a workflow definition file.
 */
export async function validate(filePath: string): Promise<void> {
	let workflow: Workflow;
	try {
		workflow = loadWorkflowFile(filePath);
	} catch (err) {
		process.stderr.write(
			red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n\n`),
		);
		process.exit(1);
		return;
	}

	process.stdout.write(
		"\n" + bold(`Validating: ${workflow.name ?? workflow.id}`) + "\n\n",
	);

	const result = validateDAG(workflow.steps);

	if (result.valid) {
		process.stdout.write(green("  DAG is valid.\n"));
		process.stdout.write(`  Steps: ${workflow.steps.length}\n`);

		// Show the DAG visualization
		const dag = renderDAG(workflow);
		process.stdout.write("\n" + dim("  DAG structure:") + "\n");
		for (const line of dag.split("\n")) {
			process.stdout.write(`  ${line}\n`);
		}
		process.stdout.write("\n");
	} else {
		process.stdout.write(red("  DAG validation failed:\n\n"));
		for (const error of result.errors) {
			process.stdout.write(red(`    - ${error}\n`));
		}
		process.stdout.write("\n");
		process.exit(1);
	}
}

/**
 * List built-in workflow templates.
 */
export async function templates(): Promise<void> {
	process.stdout.write("\n" + bold("Workflow Templates") + "\n\n");

	for (const [name, wf] of Object.entries(TEMPLATE_MAP)) {
		process.stdout.write(
			`  ${cyan(name)}  ${dim("—")}  ${wf.name}\n` +
			`    ${dim(wf.description)}\n` +
			`    Steps: ${wf.steps.length}\n\n`,
		);
	}

	process.stdout.write(
		gray("  Usage: chitragupta workflow run <template-name>\n\n"),
	);
}

// ─── Router ──────────────────────────────────────────────────────────────────

/**
 * Route `chitragupta workflow <subcommand>` to the correct handler.
 */
export async function runWorkflowCommand(
	subcommand: string | undefined,
	rest: string[],
): Promise<void> {
	switch (subcommand) {
		case "run": {
			const target = rest[0];
			if (!target) {
				process.stderr.write(
					red("\n  Error: Workflow file or template name required.\n") +
					gray("  Usage: chitragupta workflow run <file.json | template-name>\n\n"),
				);
				process.exit(1);
			}
			await run(target);
			break;
		}

		case "list":
			await list();
			break;

		case "validate": {
			const target = rest[0];
			if (!target) {
				process.stderr.write(
					red("\n  Error: Workflow file required.\n") +
					gray("  Usage: chitragupta workflow validate <file.json>\n\n"),
				);
				process.exit(1);
			}
			await validate(target);
			break;
		}

		case "templates":
			await templates();
			break;

		default:
			process.stderr.write(
				"\nUsage: chitragupta workflow <run|list|validate|templates>\n\n" +
				"  " + cyan("run <file>") + "        Execute a workflow DAG\n" +
				"  " + cyan("list") + "              List saved workflows\n" +
				"  " + cyan("validate <file>") + "   Validate a workflow definition\n" +
				"  " + cyan("templates") + "         List built-in templates\n\n",
			);
			process.exit(1);
	}
}
