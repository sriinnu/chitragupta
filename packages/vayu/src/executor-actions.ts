/**
 * @chitragupta/vayu — Step action execution.
 *
 * Executes individual step actions: prompt, tool, shell, transform,
 * conditional, parallel, subworkflow, wait, and approval.
 * Extracted from executor-lifecycle.ts to keep file sizes under 450 LOC.
 */

import { execFile } from "child_process";
import type { WorkflowStep, StepAction, StepCondition } from "./types.js";
import type { ExecutorState } from "./executor-lifecycle.js";
import { safeEval } from "./executor-expr.js";
import { resolveInput, evaluateCondition } from "./executor-lifecycle.js";

/**
 * Execute a step's action and return the output.
 */
export async function executeAction(
  action: StepAction,
  step: WorkflowStep,
  state: ExecutorState,
): Promise<unknown> {
  switch (action.type) {
    case "prompt": {
      if (!state.agent) {
        return {
          type: "prompt_result",
          message: action.message,
          model: action.model,
          profile: action.profile,
          response: "No agent provided — prompt action requires an agent in the execution context",
        };
      }
      try {
        const response = await state.agent.prompt(action.message);
        return {
          type: "prompt_result",
          message: action.message,
          model: action.model,
          profile: action.profile,
          response,
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return {
          type: "prompt_result",
          message: action.message,
          model: action.model,
          profile: action.profile,
          response: `Prompt action failed: ${errMsg}`,
        };
      }
    }

    case "tool": {
      if (!state.toolExecutor) {
        return {
          type: "tool_result",
          tool: action.name,
          args: action.args,
          result: `No toolExecutor provided — tool action "${action.name}" requires a toolExecutor in the execution context`,
        };
      }
      try {
        const result = await state.toolExecutor.execute(
          action.name,
          action.args ?? {},
          { sessionId: state.execution.executionId, workingDirectory: process.cwd() },
        );
        return {
          type: "tool_result",
          tool: action.name,
          args: action.args,
          result,
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return {
          type: "tool_result",
          tool: action.name,
          args: action.args,
          result: `Tool action "${action.name}" failed: ${errMsg}`,
        };
      }
    }


    case "shell": {
      return new Promise<unknown>((resolve, reject) => {
        // Split command into executable and arguments to avoid shell injection.
        // For complex commands, provide shellArgs in the action.
        const parts = ("shellArgs" in action && Array.isArray((action as Record<string, unknown>).shellArgs))
          ? [action.command, ...((action as Record<string, unknown>).shellArgs as string[])]
          : action.command.split(/\s+/).filter(Boolean);
        const [cmd, ...args] = parts;
        if (!cmd) {
          reject(new Error("Shell action has empty command"));
          return;
        }
        const child = execFile(
          cmd,
          args,
          { cwd: action.cwd, timeout: step.timeout },
          (error, stdout, stderr) => {
            if (error) {
              reject(new Error(`Shell command failed: ${error.message}\nstderr: ${stderr}`));
            } else {
              resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 });
            }
          },
        );

        // Track for cancellation
        if (state.cancelled) {
          child.kill();
          reject(new Error("Step cancelled"));
        }
      });
    }
    case "transform": {
      const steps: Record<string, unknown> = {};
      for (const [id, exec] of state.execution.steps) {
        steps[id] = {
          output: exec.output,
          status: exec.status,
          error: exec.error,
        };
      }

      // Resolve step inputs
      const inputs: Record<string, unknown> = {};
      if (step.inputs) {
        for (const [name, input] of Object.entries(step.inputs)) {
          inputs[name] = resolveInput(input, state);
        }
      }

      return safeEval(action.fn, {
        steps,
        inputs,
        context: state.execution.context,
      });
    }

    case "conditional": {
      const result = evaluateCondition(action.if, state);
      if (result) {
        return { branch: "then", targetStep: action.then };
      }
      return { branch: "else", targetStep: action.else ?? null };
    }

    case "parallel": {
      // The parallel action itself is a marker; the executor handles
      // parallel execution through the DAG. Return the step list.
      return { type: "parallel", steps: action.steps };
    }

    case "subworkflow": {
      if (!state.workflowExecutor) {
        return {
          type: "subworkflow_result",
          workflowId: action.workflowId,
          result: `No workflowExecutor provided — subworkflow action "${action.workflowId}" requires a workflowExecutor in the execution context`,
        };
      }
      try {
        const result = await state.workflowExecutor.execute(action.workflowId);
        return {
          type: "subworkflow_result",
          workflowId: action.workflowId,
          result,
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return {
          type: "subworkflow_result",
          workflowId: action.workflowId,
          result: `Subworkflow "${action.workflowId}" failed: ${errMsg}`,
        };
      }
    }

    case "wait": {
      return new Promise<unknown>((resolve) => {
        const timeout = setTimeout(() => {
          state.activeTimeouts.delete(timeout);
          resolve({ type: "wait_complete", duration: action.duration });
        }, action.duration);
        state.activeTimeouts.add(timeout);
      });
    }

    case "approval": {
      state.onEvent?.({
        type: "approval:required",
        stepId: step.id,
        message: action.message,
      });

      return new Promise<unknown>((resolve, reject) => {
        state.approvalCallbacks.set(step.id, (approved: boolean) => {
          state.onEvent?.({
            type: "approval:received",
            stepId: step.id,
            approved,
          });

          if (approved) {
            resolve({ type: "approval", approved: true });
          } else {
            reject(new Error("Approval denied"));
          }
        });
      });
    }

    default:
      throw new Error(`Unknown action type: ${(action as StepAction).type}`);
  }
}
