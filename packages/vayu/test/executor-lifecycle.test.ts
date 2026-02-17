import { describe, it, expect, vi } from "vitest";
import {
	resolveInput,
	evaluateCondition,
	executeAction,
	type ExecutorState,
} from "../src/executor-lifecycle.js";
import type {
	StepInput,
	StepCondition,
	StepAction,
	StepExecution,
	WorkflowExecution,
	WorkflowStep,
	Workflow,
} from "../src/types.js";

function makeExecutorState(overrides: Partial<ExecutorState> = {}): ExecutorState {
	const steps = new Map<string, StepExecution>();
	return {
		execution: {
			workflowId: "wf-1",
			executionId: "exec-1",
			status: "running",
			startTime: Date.now(),
			steps,
			context: {},
		},
		workflow: {
			id: "wf-1",
			name: "Test Workflow",
			description: "test",
			version: "1.0",
			steps: [],
		},
		cancelled: false,
		paused: false,
		approvalCallbacks: new Map(),
		activeTimeouts: new Set(),
		...overrides,
	};
}

describe("resolveInput", () => {
	it("should resolve literal inputs", () => {
		const input: StepInput = { source: "literal", value: "hello" };
		const state = makeExecutorState();
		expect(resolveInput(input, state)).toBe("hello");
	});

	it("should resolve literal inputs with complex values", () => {
		const input: StepInput = { source: "literal", value: { nested: true } };
		const state = makeExecutorState();
		expect(resolveInput(input, state)).toEqual({ nested: true });
	});

	it("should resolve step output via path", () => {
		const state = makeExecutorState();
		state.execution.steps.set("prev-step", {
			stepId: "prev-step",
			status: "completed",
			output: { data: { value: 42 } },
			retryCount: 0,
		});

		const input: StepInput = { source: "step", stepId: "prev-step", path: "data.value" };
		expect(resolveInput(input, state)).toBe(42);
	});

	it("should return undefined for incomplete step references", () => {
		const state = makeExecutorState();
		state.execution.steps.set("running-step", {
			stepId: "running-step",
			status: "running",
			retryCount: 0,
		});

		const input: StepInput = { source: "step", stepId: "running-step", path: "data" };
		expect(resolveInput(input, state)).toBeUndefined();
	});

	it("should resolve env variables", () => {
		const state = makeExecutorState();
		const input: StepInput = { source: "env", variable: "HOME" };
		const result = resolveInput(input, state);
		expect(typeof result).toBe("string");
	});

	it("should resolve context values", () => {
		const state = makeExecutorState();
		state.execution.context["myKey"] = "myValue";

		const input: StepInput = { source: "context", key: "myKey" };
		expect(resolveInput(input, state)).toBe("myValue");
	});

	it("should resolve expression inputs", () => {
		const state = makeExecutorState();
		state.execution.context["x"] = 10;

		const input: StepInput = { source: "expression", expr: "context.x + 5" };
		expect(resolveInput(input, state)).toBe(15);
	});

	it("should return undefined for unknown source types", () => {
		const state = makeExecutorState();
		const input = { source: "unknown" } as unknown as StepInput;
		expect(resolveInput(input, state)).toBeUndefined();
	});
});

describe("evaluateCondition", () => {
	it("should evaluate equals condition", () => {
		const state = makeExecutorState();
		const condition: StepCondition = {
			type: "equals",
			left: { source: "literal", value: "hello" },
			right: { source: "literal", value: "hello" },
		};
		expect(evaluateCondition(condition, state)).toBe(true);
	});

	it("should evaluate equals condition as false for different values", () => {
		const state = makeExecutorState();
		const condition: StepCondition = {
			type: "equals",
			left: { source: "literal", value: "hello" },
			right: { source: "literal", value: "world" },
		};
		expect(evaluateCondition(condition, state)).toBe(false);
	});

	it("should evaluate contains condition for strings", () => {
		const state = makeExecutorState();
		const condition: StepCondition = {
			type: "contains",
			input: { source: "literal", value: "hello world" },
			value: "world",
		};
		expect(evaluateCondition(condition, state)).toBe(true);
	});

	it("should evaluate contains condition for arrays", () => {
		const state = makeExecutorState();
		const condition: StepCondition = {
			type: "contains",
			input: { source: "literal", value: ["a", "b", "c"] },
			value: "b",
		};
		expect(evaluateCondition(condition, state)).toBe(true);
	});

	it("should evaluate contains as false when not found", () => {
		const state = makeExecutorState();
		const condition: StepCondition = {
			type: "contains",
			input: { source: "literal", value: "hello" },
			value: "missing",
		};
		expect(evaluateCondition(condition, state)).toBe(false);
	});

	it("should evaluate exists condition", () => {
		const state = makeExecutorState();
		state.execution.context["present"] = "yes";

		const exists: StepCondition = {
			type: "exists",
			input: { source: "context", key: "present" },
		};
		expect(evaluateCondition(exists, state)).toBe(true);

		const missing: StepCondition = {
			type: "exists",
			input: { source: "context", key: "absent" },
		};
		expect(evaluateCondition(missing, state)).toBe(false);
	});

	it("should evaluate not condition", () => {
		const state = makeExecutorState();
		const condition: StepCondition = {
			type: "not",
			condition: {
				type: "equals",
				left: { source: "literal", value: 1 },
				right: { source: "literal", value: 2 },
			},
		};
		expect(evaluateCondition(condition, state)).toBe(true);
	});

	it("should evaluate and condition", () => {
		const state = makeExecutorState();
		const allTrue: StepCondition = {
			type: "and",
			conditions: [
				{ type: "equals", left: { source: "literal", value: 1 }, right: { source: "literal", value: 1 } },
				{ type: "equals", left: { source: "literal", value: 2 }, right: { source: "literal", value: 2 } },
			],
		};
		expect(evaluateCondition(allTrue, state)).toBe(true);

		const oneFalse: StepCondition = {
			type: "and",
			conditions: [
				{ type: "equals", left: { source: "literal", value: 1 }, right: { source: "literal", value: 1 } },
				{ type: "equals", left: { source: "literal", value: 1 }, right: { source: "literal", value: 2 } },
			],
		};
		expect(evaluateCondition(oneFalse, state)).toBe(false);
	});

	it("should evaluate or condition", () => {
		const state = makeExecutorState();
		const oneTrue: StepCondition = {
			type: "or",
			conditions: [
				{ type: "equals", left: { source: "literal", value: 1 }, right: { source: "literal", value: 2 } },
				{ type: "equals", left: { source: "literal", value: 1 }, right: { source: "literal", value: 1 } },
			],
		};
		expect(evaluateCondition(oneTrue, state)).toBe(true);

		const allFalse: StepCondition = {
			type: "or",
			conditions: [
				{ type: "equals", left: { source: "literal", value: 1 }, right: { source: "literal", value: 2 } },
				{ type: "equals", left: { source: "literal", value: 3 }, right: { source: "literal", value: 4 } },
			],
		};
		expect(evaluateCondition(allFalse, state)).toBe(false);
	});

	it("should evaluate expression conditions", () => {
		const state = makeExecutorState();
		state.execution.context["score"] = 85;

		const condition: StepCondition = {
			type: "expression",
			expr: "context.score > 80",
		};
		expect(evaluateCondition(condition, state)).toBe(true);
	});
});

describe("safeEval (tested via expression resolution)", () => {
	it("should evaluate arithmetic expressions", () => {
		const state = makeExecutorState();
		const input: StepInput = { source: "expression", expr: "2 + 3 * 4" };
		expect(resolveInput(input, state)).toBe(14);
	});

	it("should evaluate comparison expressions", () => {
		const state = makeExecutorState();
		state.execution.context["val"] = 10;

		const input: StepInput = { source: "expression", expr: "context.val >= 10" };
		expect(resolveInput(input, state)).toBe(true);
	});

	it("should evaluate ternary expressions", () => {
		const state = makeExecutorState();
		state.execution.context["flag"] = true;

		const input: StepInput = { source: "expression", expr: 'context.flag ? "yes" : "no"' };
		expect(resolveInput(input, state)).toBe("yes");
	});

	it("should handle string literals", () => {
		const state = makeExecutorState();
		const input: StepInput = { source: "expression", expr: '"hello" + " " + "world"' };
		expect(resolveInput(input, state)).toBe("hello world");
	});

	it("should handle boolean literals", () => {
		const state = makeExecutorState();
		const input: StepInput = { source: "expression", expr: "true && false" };
		expect(resolveInput(input, state)).toBe(false);
	});

	it("should handle null and undefined", () => {
		const state = makeExecutorState();
		const nullInput: StepInput = { source: "expression", expr: "null" };
		expect(resolveInput(nullInput, state)).toBeNull();

		const undefInput: StepInput = { source: "expression", expr: "undefined" };
		expect(resolveInput(undefInput, state)).toBeUndefined();
	});

	it("should safely handle property access on scope objects", () => {
		const state = makeExecutorState();
		state.execution.steps.set("step1", {
			stepId: "step1",
			status: "completed",
			output: { result: "hello" },
			retryCount: 0,
		});

		const input: StepInput = { source: "expression", expr: "steps.step1.output.result" };
		expect(resolveInput(input, state)).toBe("hello");
	});

	it("should return undefined for forbidden keywords (graceful failure)", () => {
		const state = makeExecutorState();
		// Keywords like 'new', 'function', etc. should be rejected
		const input: StepInput = { source: "expression", expr: "new Date()" };
		// safeEval catches errors and returns undefined
		expect(resolveInput(input, state)).toBeUndefined();
	});

	it("should reject function calls (graceful failure)", () => {
		const state = makeExecutorState();
		const input: StepInput = { source: "expression", expr: "console.log('hi')" };
		expect(resolveInput(input, state)).toBeUndefined();
	});

	it("should reject assignment operators", () => {
		const state = makeExecutorState();
		const input: StepInput = { source: "expression", expr: "x = 5" };
		expect(resolveInput(input, state)).toBeUndefined();
	});
});

describe("executeAction", () => {
	it("should execute a prompt action with graceful degradation (no agent)", async () => {
		const state = makeExecutorState();
		const action: StepAction = { type: "prompt", message: "Hello AI" };
		const step: WorkflowStep = {
			id: "s1", name: "Test", action, dependsOn: [],
		};

		const result = await executeAction(action, step, state) as Record<string, unknown>;
		expect(result.type).toBe("prompt_result");
		expect(result.message).toBe("Hello AI");
	});

	it("should execute a tool action with graceful degradation (no executor)", async () => {
		const state = makeExecutorState();
		const action: StepAction = { type: "tool", name: "grep", args: { pattern: "hello" } };
		const step: WorkflowStep = {
			id: "s2", name: "Test", action, dependsOn: [],
		};

		const result = await executeAction(action, step, state) as Record<string, unknown>;
		expect(result.type).toBe("tool_result");
		expect(result.tool).toBe("grep");
	});

	it("should execute a transform action using safeEval", async () => {
		const state = makeExecutorState();
		state.execution.context["multiplier"] = 5;

		const action: StepAction = { type: "transform", fn: "context.multiplier * 10" };
		const step: WorkflowStep = {
			id: "s3", name: "Transform", action, dependsOn: [],
		};

		const result = await executeAction(action, step, state);
		expect(result).toBe(50);
	});

	it("should execute a conditional action", async () => {
		const state = makeExecutorState();
		const action: StepAction = {
			type: "conditional",
			if: {
				type: "equals",
				left: { source: "literal", value: 1 },
				right: { source: "literal", value: 1 },
			},
			then: "step-a",
			else: "step-b",
		};
		const step: WorkflowStep = {
			id: "s4", name: "Conditional", action, dependsOn: [],
		};

		const result = await executeAction(action, step, state) as Record<string, unknown>;
		expect(result.branch).toBe("then");
		expect(result.targetStep).toBe("step-a");
	});

	it("should return the else branch when condition is false", async () => {
		const state = makeExecutorState();
		const action: StepAction = {
			type: "conditional",
			if: {
				type: "equals",
				left: { source: "literal", value: 1 },
				right: { source: "literal", value: 2 },
			},
			then: "step-a",
			else: "step-b",
		};
		const step: WorkflowStep = {
			id: "s5", name: "Conditional", action, dependsOn: [],
		};

		const result = await executeAction(action, step, state) as Record<string, unknown>;
		expect(result.branch).toBe("else");
		expect(result.targetStep).toBe("step-b");
	});

	it("should execute a parallel action by returning step list", async () => {
		const state = makeExecutorState();
		const action: StepAction = {
			type: "parallel",
			steps: ["step-a", "step-b", "step-c"],
		};
		const step: WorkflowStep = {
			id: "s6", name: "Parallel", action, dependsOn: [],
		};

		const result = await executeAction(action, step, state) as Record<string, unknown>;
		expect(result.type).toBe("parallel");
		expect(result.steps).toEqual(["step-a", "step-b", "step-c"]);
	});

	it("should execute a wait action", async () => {
		const state = makeExecutorState();
		const action: StepAction = { type: "wait", duration: 10 };
		const step: WorkflowStep = {
			id: "s7", name: "Wait", action, dependsOn: [],
		};

		const result = await executeAction(action, step, state) as Record<string, unknown>;
		expect(result.type).toBe("wait_complete");
		expect(result.duration).toBe(10);
	});

	it("should execute a subworkflow action with graceful degradation", async () => {
		const state = makeExecutorState();
		const action: StepAction = { type: "subworkflow", workflowId: "sub-wf-1" };
		const step: WorkflowStep = {
			id: "s8", name: "Sub", action, dependsOn: [],
		};

		const result = await executeAction(action, step, state) as Record<string, unknown>;
		expect(result.type).toBe("subworkflow_result");
		expect(result.workflowId).toBe("sub-wf-1");
	});
});
