/**
 * @chitragupta/vayu — Workflow executor.
 *
 * Executes workflow DAGs respecting dependencies, concurrency limits,
 * conditions, retries, timeouts, and failure strategies.
 */

import { randomUUID } from "crypto";
import { validateDAG } from "./dag.js";
import type {
  Workflow,
  WorkflowExecution,
  WorkflowEvent,
  WorkflowStep,
} from "./types.js";
import {
  type ExecutorState,
  activeExecutions,
  executeStep,
} from "./executor-lifecycle.js";

// ─── Workflow Executor ──────────────────────────────────────────────────────

/**
 * Executes workflow DAGs respecting dependencies, concurrency limits,
 * conditions, retries, timeouts, and failure strategies.
 *
 * @example
 * ```ts
 * const executor = new WorkflowExecutor();
 * const execution = await executor.execute(workflow, (event) => {
 *   console.log(event.type, event);
 * });
 * console.log("Final status:", execution.status);
 * ```
 */
export class WorkflowExecutor {
  /**
   * Execute a workflow, respecting the DAG dependency order,
   * concurrency limits, conditions, retries, and timeouts.
   *
   * @param workflow - The workflow definition to execute.
   * @param onEvent - Optional callback for workflow and step lifecycle events.
   * @returns The completed WorkflowExecution with step statuses and outputs.
   * @throws If the workflow DAG is invalid (cycles, missing refs, etc.).
   */
  async execute(
    workflow: Workflow,
    onEvent?: (event: WorkflowEvent) => void,
  ): Promise<WorkflowExecution> {
    // Validate DAG
    const validation = validateDAG(workflow.steps);
    if (!validation.valid) {
      throw new Error(`Invalid workflow DAG:\n${validation.errors.join("\n")}`);
    }

    const executionId = randomUUID();
    const execution: WorkflowExecution = {
      workflowId: workflow.id,
      executionId,
      status: "running",
      startTime: Date.now(),
      steps: new Map(),
      context: { ...(workflow.context ?? {}) },
    };

    // Initialize step executions
    for (const step of workflow.steps) {
      execution.steps.set(step.id, {
        stepId: step.id,
        status: "pending",
        retryCount: 0,
      });
    }

    const state: ExecutorState = {
      execution,
      workflow,
      onEvent,
      cancelled: false,
      paused: false,
      approvalCallbacks: new Map(),
      activeTimeouts: new Set(),
    };

    activeExecutions.set(executionId, state);

    onEvent?.({
      type: "workflow:start",
      workflowId: workflow.id,
      executionId,
    });

    try {
      await this.runDAG(state);

      // Determine final status
      const hasFailures = Array.from(execution.steps.values())
        .some((s) => s.status === "failed");

      if (state.cancelled) {
        execution.status = "cancelled";
      } else if (hasFailures) {
        execution.status = "failed";
      } else {
        execution.status = "completed";
      }
    } catch (err) {
      execution.status = "failed";

      // Cancel any remaining pending steps
      for (const [, stepExec] of execution.steps) {
        if (stepExec.status === "pending" || stepExec.status === "running") {
          stepExec.status = "cancelled";
          stepExec.endTime = Date.now();
        }
      }
    } finally {
      execution.endTime = Date.now();
      activeExecutions.delete(executionId);

      // Clean up any remaining timeouts
      for (const timeout of state.activeTimeouts) {
        clearTimeout(timeout);
      }
      state.activeTimeouts.clear();

      onEvent?.({
        type: "workflow:done",
        workflowId: workflow.id,
        executionId,
        status: execution.status,
      });
    }

    return execution;
  }

  /**
   * Run the DAG using a ready-queue approach.
   * Steps are ready when all their dependencies are completed.
   */
  private async runDAG(state: ExecutorState): Promise<void> {
    const { workflow, execution } = state;
    const maxConcurrency = workflow.maxConcurrency ?? Infinity;

    // Build step lookup
    const stepMap = new Map<string, WorkflowStep>();
    for (const step of workflow.steps) {
      stepMap.set(step.id, step);
    }

    // Build dependents map: stepId -> steps that depend on it
    const dependents = new Map<string, Set<string>>();
    for (const step of workflow.steps) {
      if (!dependents.has(step.id)) {
        dependents.set(step.id, new Set());
      }
      for (const dep of step.dependsOn) {
        if (!dependents.has(dep)) {
          dependents.set(dep, new Set());
        }
        dependents.get(dep)!.add(step.id);
      }
    }

    // Track running promises
    const running = new Map<string, Promise<void>>();

    // Find initially ready steps
    const ready: string[] = [];
    for (const step of workflow.steps) {
      if (step.dependsOn.length === 0) {
        ready.push(step.id);
      }
    }

    // Global timeout
    let globalTimeout: ReturnType<typeof setTimeout> | undefined;
    let globalTimedOut = false;

    if (workflow.timeout) {
      globalTimeout = setTimeout(() => {
        globalTimedOut = true;
        state.cancelled = true;
      }, workflow.timeout);
      state.activeTimeouts.add(globalTimeout);
    }

    try {
      while (ready.length > 0 || running.size > 0) {
        if (state.cancelled || globalTimedOut) {
          // Cancel all running steps conceptually
          for (const [stepId] of running) {
            const stepExec = execution.steps.get(stepId);
            if (stepExec && stepExec.status === "running") {
              stepExec.status = "cancelled";
              stepExec.endTime = Date.now();
            }
          }
          break;
        }

        // Wait if paused
        if (state.paused && state.pausePromise) {
          await state.pausePromise;
        }

        // Launch ready steps up to concurrency limit
        while (ready.length > 0 && running.size < maxConcurrency) {
          const stepId = ready.shift()!;
          const step = stepMap.get(stepId)!;

          const promise = executeStep(step, state).then(() => {
            running.delete(stepId);

            // Check if any dependents are now ready
            const deps = dependents.get(stepId) ?? new Set();
            for (const depId of deps) {
              const depStep = stepMap.get(depId)!;
              const allDepsDone = depStep.dependsOn.every((d) => {
                const depExec = execution.steps.get(d);
                return depExec && (
                  depExec.status === "completed" ||
                  depExec.status === "skipped" ||
                  depExec.status === "failed"
                );
              });

              if (allDepsDone) {
                const depExec = execution.steps.get(depId);
                if (depExec && depExec.status === "pending") {
                  // Check if any dependency failed with "fail" strategy
                  const hasBlockingFailure = depStep.dependsOn.some((d) => {
                    const dExec = execution.steps.get(d);
                    const dStep = stepMap.get(d);
                    return dExec?.status === "failed" && (dStep?.onFailure ?? "fail") === "fail";
                  });

                  if (hasBlockingFailure) {
                    depExec.status = "cancelled";
                    depExec.endTime = Date.now();
                  } else {
                    ready.push(depId);
                  }
                }
              }
            }
          }).catch(() => {
            running.delete(stepId);

            // On failure, cancel downstream steps if strategy is "fail"
            const cancelDownstream = (fromId: string) => {
              const deps = dependents.get(fromId) ?? new Set();
              for (const depId of deps) {
                const depExec = execution.steps.get(depId);
                if (depExec && depExec.status === "pending") {
                  depExec.status = "cancelled";
                  depExec.endTime = Date.now();
                  cancelDownstream(depId);
                }
              }
            };
            cancelDownstream(stepId);
          });

          running.set(stepId, promise);
        }

        // Wait for at least one running step to complete
        if (running.size > 0) {
          await Promise.race(Array.from(running.values()));
        }
      }
    } finally {
      if (globalTimeout) {
        clearTimeout(globalTimeout);
        state.activeTimeouts.delete(globalTimeout);
      }
    }
  }

  /**
   * Cancel a running workflow execution. Clears all active timeouts.
   *
   * @param executionId - The execution ID to cancel.
   */
  cancel(executionId: string): void {
    const state = activeExecutions.get(executionId);
    if (!state) return;

    state.cancelled = true;

    // Clear all active timeouts
    for (const timeout of state.activeTimeouts) {
      clearTimeout(timeout);
    }
    state.activeTimeouts.clear();
  }

  /**
   * Pause a running workflow execution.
   * Steps that are already running will finish, but no new steps will start.
   *
   * @param executionId - The execution ID to pause.
   */
  pause(executionId: string): void {
    const state = activeExecutions.get(executionId);
    if (!state) return;

    state.paused = true;
    state.pausePromise = new Promise<void>((resolve) => {
      state.pauseResolve = resolve;
    });
  }

  /**
   * Resume a paused workflow execution. Allows new steps to start.
   *
   * @param executionId - The execution ID to resume.
   */
  resume(executionId: string): void {
    const state = activeExecutions.get(executionId);
    if (!state) return;

    state.paused = false;
    state.pauseResolve?.();
    state.pausePromise = undefined;
    state.pauseResolve = undefined;
  }

  /**
   * Approve or deny a step that is waiting for approval.
   *
   * @param executionId - The execution ID containing the approval step.
   * @param stepId - The step ID waiting for approval.
   * @param approved - Whether to approve (true) or deny (false) the step.
   */
  approve(executionId: string, stepId: string, approved: boolean): void {
    const state = activeExecutions.get(executionId);
    if (!state) return;

    const callback = state.approvalCallbacks.get(stepId);
    if (callback) {
      callback(approved);
      state.approvalCallbacks.delete(stepId);
    }
  }
}
