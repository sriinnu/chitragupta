/**
 * @chitragupta/vayu — Workflow persistence.
 *
 * Save and load workflow definitions and execution history
 * to/from the Chitragupta home directory (~/.chitragupta/workflows/).
 */

import fs from "fs";
import path from "path";
import { getChitraguptaHome } from "@chitragupta/core";
import type { Workflow, WorkflowExecution, StepExecution } from "./types.js";

// ─── Paths ──────────────────────────────────────────────────────────────────

function getWorkflowsDir(): string {
	return path.join(getChitraguptaHome(), "workflows");
}

function getHistoryDir(): string {
	return path.join(getChitraguptaHome(), "workflows", "history");
}

function ensureDir(dir: string): void {
	fs.mkdirSync(dir, { recursive: true });
}

// ─── Serialization Helpers ──────────────────────────────────────────────────

/**
 * Convert a WorkflowExecution to a JSON-safe format.
 * Maps are converted to plain objects.
 */
function serializeExecution(execution: WorkflowExecution): Record<string, unknown> {
	const steps: Record<string, StepExecution> = {};
	for (const [id, step] of execution.steps) {
		steps[id] = step;
	}

	return {
		workflowId: execution.workflowId,
		executionId: execution.executionId,
		status: execution.status,
		startTime: execution.startTime,
		endTime: execution.endTime,
		steps,
		context: execution.context,
	};
}

/**
 * Convert a JSON-parsed execution back to a WorkflowExecution with proper Maps.
 */
function deserializeExecution(data: Record<string, unknown>): WorkflowExecution {
	const stepsObj = data.steps as Record<string, StepExecution>;
	const steps = new Map<string, StepExecution>();
	for (const [id, step] of Object.entries(stepsObj)) {
		steps.set(id, step);
	}

	return {
		workflowId: data.workflowId as string,
		executionId: data.executionId as string,
		status: data.status as WorkflowExecution["status"],
		startTime: data.startTime as number,
		endTime: data.endTime as number | undefined,
		steps,
		context: (data.context as Record<string, unknown>) ?? {},
	};
}

// ─── ID Validation ──────────────────────────────────────────────────────────

/** Validate that an ID is safe for use as a filename (no path traversal). */
function validateId(id: string): void {
	if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
		throw new Error(`Invalid ID: must be alphanumeric, hyphens, or underscores`);
	}
}

// ─── Workflow CRUD ──────────────────────────────────────────────────────────

/**
 * Save a workflow definition to disk as JSON.
 *
 * @param workflow - The workflow to save. Uses `workflow.id` as the filename.
 */
export function saveWorkflow(workflow: Workflow): void {
	validateId(workflow.id);
	const dir = getWorkflowsDir();
	ensureDir(dir);

	const filePath = path.join(dir, `${workflow.id}.json`);
	fs.writeFileSync(filePath, JSON.stringify(workflow, null, "\t"), "utf-8");
}

/**
 * Load a workflow definition by ID.
 *
 * @param id - The workflow ID (without `.json` extension).
 * @returns The loaded Workflow, or `undefined` if not found or corrupted.
 */
export function loadWorkflow(id: string): Workflow | undefined {
	validateId(id);
	const filePath = path.join(getWorkflowsDir(), `${id}.json`);
	try {
		if (fs.existsSync(filePath)) {
			const raw = fs.readFileSync(filePath, "utf-8");
			return JSON.parse(raw) as Workflow;
		}
	} catch (err) {
		process.stderr.write(`[vayu] failed to load workflow ${id}: ${err instanceof Error ? err.message : err}\n`);
	}
	return undefined;
}

/**
 * List all saved workflow definitions.
 *
 * @returns Array of Workflow objects from `~/.chitragupta/workflows/`.
 */
export function listWorkflows(): Workflow[] {
	const dir = getWorkflowsDir();
	if (!fs.existsSync(dir)) return [];

	const workflows: Workflow[] = [];
	const files = fs.readdirSync(dir);

	for (const file of files) {
		if (!file.endsWith(".json")) continue;
		// Skip the history directory
		const filePath = path.join(dir, file);
		const stat = fs.statSync(filePath);
		if (stat.isDirectory()) continue;

		try {
			const raw = fs.readFileSync(filePath, "utf-8");
			workflows.push(JSON.parse(raw) as Workflow);
		} catch (err) {
			process.stderr.write(`[vayu] skipping corrupted workflow file ${file}: ${err instanceof Error ? err.message : err}\n`);
		}
	}

	return workflows;
}

/**
 * Delete a saved workflow definition by ID.
 *
 * @param id - The workflow ID to delete.
 * @returns `true` if the file was deleted, `false` if not found.
 */
export function deleteWorkflow(id: string): boolean {
	validateId(id);
	const filePath = path.join(getWorkflowsDir(), `${id}.json`);
	try {
		if (fs.existsSync(filePath)) {
			fs.unlinkSync(filePath);
			return true;
		}
	} catch {
		// Non-fatal: file may have been deleted concurrently or permissions changed
		return false;
	}
	return false;
}

// ─── Execution History ──────────────────────────────────────────────────────

/**
 * Save a workflow execution to the history directory.
 *
 * @param execution - The execution to persist. Stored under the workflow's ID subdirectory.
 */
export function saveExecution(execution: WorkflowExecution): void {
	validateId(execution.workflowId);
	validateId(execution.executionId);
	const dir = path.join(getHistoryDir(), execution.workflowId);
	ensureDir(dir);

	const filePath = path.join(dir, `${execution.executionId}.json`);
	const data = serializeExecution(execution);
	fs.writeFileSync(filePath, JSON.stringify(data, null, "\t"), "utf-8");
}

/**
 * Load a workflow execution by its execution ID.
 *
 * Searches across all workflow history subdirectories under
 * `~/.chitragupta/workflows/history/` to find the matching execution file.
 * Deserializes the JSON back into a `WorkflowExecution` with proper `Map` types.
 *
 * @param executionId - The UUID of the execution to load (without `.json` extension).
 * @returns The deserialized `WorkflowExecution`, or `undefined` if not found or corrupted.
 *
 * @example
 * ```ts
 * const exec = loadExecution("a1b2c3d4-...");
 * if (exec) {
 *   console.log(`Status: ${exec.status}, steps: ${exec.steps.size}`);
 * }
 * ```
 */
export function loadExecution(executionId: string): WorkflowExecution | undefined {
	validateId(executionId);
	const historyDir = getHistoryDir();
	if (!fs.existsSync(historyDir)) return undefined;

	const workflowDirs = fs.readdirSync(historyDir);
	for (const wfDir of workflowDirs) {
		const dirPath = path.join(historyDir, wfDir);
		const stat = fs.statSync(dirPath);
		if (!stat.isDirectory()) continue;

		const filePath = path.join(dirPath, `${executionId}.json`);
		try {
			if (fs.existsSync(filePath)) {
				const raw = fs.readFileSync(filePath, "utf-8");
				return deserializeExecution(JSON.parse(raw));
			}
		} catch {
			// Skip corrupted files
		}
	}

	return undefined;
}

/**
 * List all execution records for a given workflow ID.
 *
 * Reads all JSON files from the workflow's history subdirectory
 * (`~/.chitragupta/workflows/history/<workflowId>/`) and deserializes them
 * into `WorkflowExecution` objects. Results are sorted by start time
 * with the most recent execution first. Corrupted files are silently skipped.
 *
 * @param workflowId - The workflow ID whose execution history to list.
 * @returns Array of `WorkflowExecution` objects sorted by `startTime` descending (newest first).
 *          Returns an empty array if no history directory exists or no executions are found.
 *
 * @example
 * ```ts
 * const history = listExecutions("cicd-pipeline");
 * for (const exec of history) {
 *   console.log(`${exec.executionId}: ${exec.status} (${new Date(exec.startTime).toISOString()})`);
 * }
 * ```
 */
export function listExecutions(workflowId: string): WorkflowExecution[] {
	validateId(workflowId);
	const dir = path.join(getHistoryDir(), workflowId);
	if (!fs.existsSync(dir)) return [];

	const executions: WorkflowExecution[] = [];
	const files = fs.readdirSync(dir);

	for (const file of files) {
		if (!file.endsWith(".json")) continue;

		try {
			const raw = fs.readFileSync(path.join(dir, file), "utf-8");
			executions.push(deserializeExecution(JSON.parse(raw)));
		} catch {
			// Skip corrupted files
		}
	}

	// Sort by start time, newest first
	executions.sort((a, b) => b.startTime - a.startTime);

	return executions;
}
