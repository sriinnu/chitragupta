/**
 * @chitragupta/prana — Executor lifecycle utilities.
 *
 * Input resolution, condition evaluation, and step action execution
 * used by the WorkflowExecutor.
 */

import { resolvePath, safeEval } from "./executor-expr.js";
import { executeAction } from "./executor-actions.js";
export { executeAction } from "./executor-actions.js";
import type {
  Workflow, WorkflowExecution, WorkflowEvent, WorkflowStep,
  StepExecution, StepAction, StepInput, StepCondition,
} from "./types.js";

export interface ExecutorState {
  execution: WorkflowExecution;
  workflow: Workflow;
  onEvent?: (event: WorkflowEvent) => void;
  cancelled: boolean;
  paused: boolean;
  pausePromise?: Promise<void>;
  pauseResolve?: () => void;
  approvalCallbacks: Map<string, (approved: boolean) => void>;
  activeTimeouts: Set<ReturnType<typeof setTimeout>>;
  /** Optional agent for executing prompt actions. */
  agent?: { prompt(message: string): Promise<unknown> };
  /** Optional tool executor for executing tool actions. */
  toolExecutor?: { execute(name: string, args: Record<string, unknown>, ctx: unknown): Promise<unknown> };
  /** Optional workflow executor for delegating subworkflow actions. */
  workflowExecutor?: { execute(workflowId: string): Promise<unknown> };
}

export const activeExecutions = new Map<string, ExecutorState>();

/**
 * Allowlist of environment variables safe for workflow expressions.
 * All other vars (API keys, secrets, tokens) are filtered out.
 */
const ALLOWED_WORKFLOW_ENV_VARS = new Set([
	"NODE_ENV",
	"HOME",
	"USER",
	"SHELL",
	"LANG",
	"TZ",
	"PATH",
	"PWD",
	"HOSTNAME",
	"TERM",
]);

/**
 * Resolve a StepInput to its actual value.
 */
export function resolveInput(
  input: StepInput,
  state: ExecutorState,
): unknown {
  switch (input.source) {
    case "literal":
      return input.value;

    case "step": {
      const stepExec = state.execution.steps.get(input.stepId);
      if (!stepExec || stepExec.status !== "completed") {
        return undefined;
      }
      return resolvePath(stepExec.output, input.path);
    }

    case "env":
      if (!ALLOWED_WORKFLOW_ENV_VARS.has(input.variable)) return undefined;
      return process.env[input.variable];

    case "context":
      return state.execution.context[input.key];

    case "expression": {
      const steps: Record<string, unknown> = {};
      for (const [id, exec] of state.execution.steps) {
        steps[id] = {
          output: exec.output,
          status: exec.status,
          error: exec.error,
        };
      }
      const safeEnv: Record<string, string | undefined> = {};
      for (const k of ALLOWED_WORKFLOW_ENV_VARS) {
        safeEnv[k] = process.env[k];
      }
      return safeEval(input.expr, {
        steps,
        context: state.execution.context,
        env: safeEnv,
      });
    }

    default:
      return undefined;
  }
}

/**
 * Evaluate a step condition to a boolean.
 */
export function evaluateCondition(
  condition: StepCondition,
  state: ExecutorState,
): boolean {
  switch (condition.type) {
    case "equals": {
      const left = resolveInput(condition.left, state);
      const right = resolveInput(condition.right, state);
      return left === right;
    }

    case "contains": {
      const input = resolveInput(condition.input, state);
      if (typeof input === "string") {
        return input.includes(condition.value);
      }
      if (Array.isArray(input)) {
        return input.includes(condition.value);
      }
      return false;
    }

    case "exists": {
      const input = resolveInput(condition.input, state);
      return input !== undefined && input !== null;
    }

    case "not":
      return !evaluateCondition(condition.condition, state);

    case "and":
      return condition.conditions.every((c) => evaluateCondition(c, state));

    case "or":
      return condition.conditions.some((c) => evaluateCondition(c, state));

    case "expression": {
      const steps: Record<string, unknown> = {};
      for (const [id, exec] of state.execution.steps) {
        steps[id] = {
          output: exec.output,
          status: exec.status,
          error: exec.error,
        };
      }
      const safeEnv: Record<string, string | undefined> = {};
      for (const k of ALLOWED_WORKFLOW_ENV_VARS) {
        safeEnv[k] = process.env[k];
      }
      const result = safeEval(condition.expr, {
        steps,
        context: state.execution.context,
        env: safeEnv,
      });
      return Boolean(result);
    }

    default:
      return true;
  }
}

export async function executeStep(
  step: WorkflowStep,
  state: ExecutorState,
): Promise<void> {
  const stepExec = state.execution.steps.get(step.id)!;

  // Check condition
  if (step.condition) {
    const shouldRun = evaluateCondition(step.condition, state);
    if (!shouldRun) {
      stepExec.status = "skipped";
      stepExec.endTime = Date.now();
      state.onEvent?.({
        type: "step:skip",
        stepId: step.id,
        reason: "Condition evaluated to false",
      });
      return;
    }
  }

  // Resolve inputs
  if (step.inputs) {
    for (const [name, input] of Object.entries(step.inputs)) {
      state.execution.context[`${step.id}.inputs.${name}`] = resolveInput(input, state);
    }
  }

  const maxRetries = step.retry?.maxRetries ?? (step.onFailure === "retry" ? 3 : 0);
  const retryDelay = step.retry?.delay ?? 1000;
  const retryBackoff = step.retry?.backoff ?? 1;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (state.cancelled) {
      stepExec.status = "cancelled";
      stepExec.endTime = Date.now();
      return;
    }

    // Wait if paused
    if (state.paused && state.pausePromise) {
      await state.pausePromise;
    }

    stepExec.status = "running";
    stepExec.startTime = Date.now();
    stepExec.retryCount = attempt;

    if (attempt > 0) {
      state.onEvent?.({
        type: "step:retry",
        stepId: step.id,
        attempt,
        maxRetries,
      });
    }

    state.onEvent?.({
      type: "step:start",
      stepId: step.id,
      stepName: step.name,
    });

    try {
      let result: unknown;

      if (step.timeout) {
        // Execute with timeout
        result = await Promise.race([
          executeAction(step.action, step, state),
          new Promise<never>((_, reject) => {
            const timeout = setTimeout(() => {
              state.activeTimeouts.delete(timeout);
              reject(new Error(`Step "${step.id}" timed out after ${step.timeout}ms`));
            }, step.timeout!);
            state.activeTimeouts.add(timeout);
          }),
        ]);
      } else {
        result = await executeAction(step.action, step, state);
      }

      stepExec.status = "completed";
      stepExec.output = result;
      stepExec.endTime = Date.now();
      stepExec.duration = stepExec.endTime - stepExec.startTime;

      // Store output in context for downstream steps
      state.execution.context[`${step.id}.output`] = result;

      state.onEvent?.({
        type: "step:done",
        stepId: step.id,
        status: "completed",
        output: result,
      });

      return; // Success — no more retries needed
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      state.onEvent?.({
        type: "step:error",
        stepId: step.id,
        error: errorMessage,
        retryCount: attempt,
      });

      if (attempt < maxRetries) {
        // Wait before retrying
        const delay = retryDelay * Math.pow(retryBackoff, attempt);
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            state.activeTimeouts.delete(timeout);
            resolve();
          }, delay);
          state.activeTimeouts.add(timeout);
        });
        continue;
      }

      // All retries exhausted
      stepExec.status = "failed";
      stepExec.error = errorMessage;
      stepExec.endTime = Date.now();
      stepExec.duration = stepExec.endTime - (stepExec.startTime ?? stepExec.endTime);

      state.onEvent?.({
        type: "step:done",
        stepId: step.id,
        status: "failed",
      });

      // Handle failure strategy
      const failureStrategy = step.onFailure ?? "fail";
      if (failureStrategy === "fail") {
        throw new Error(`Step "${step.id}" failed: ${errorMessage}`);
      }
      // "continue" — just return, the step is marked failed but workflow continues
      return;
    }
  }
}
