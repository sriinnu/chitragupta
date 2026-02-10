/**
 * @chitragupta/vayu — Fluent workflow builder API.
 *
 * Provides an ergonomic chainable interface for constructing
 * workflow DAGs programmatically.
 */

import type {
	Workflow,
	WorkflowStep,
	WorkflowTrigger,
	StepAction,
	StepCondition,
	StepInput,
	RetryConfig,
} from "./types.js";

// ─── Step Builder ───────────────────────────────────────────────────────────

/**
 * Builder for constructing a single workflow step with a fluent chainable API.
 * Call `.done()` to return to the parent WorkflowBuilder.
 *
 * @example
 * ```ts
 * builder.step("test", "Run Tests")
 *   .shell("npm test")
 *   .dependsOn("lint")
 *   .retry({ maxRetries: 2, delay: 1000 })
 *   .timeout(60000)
 *   .done()
 * ```
 */
export class StepBuilder {
	private readonly parent: WorkflowBuilder;
	private readonly step: WorkflowStep;

	/**
	 * @param parent - The parent WorkflowBuilder to return to on `.done()`.
	 * @param id - Unique step identifier.
	 * @param name - Human-readable step name.
	 */
	constructor(parent: WorkflowBuilder, id: string, name: string) {
		this.parent = parent;
		this.step = {
			id,
			name,
			action: { type: "shell", command: "" },
			dependsOn: [],
		};
	}

	/** Set action to send a prompt to an agent. */
	prompt(message: string, model?: string, profile?: string): this {
		this.step.action = { type: "prompt", message, model, profile };
		return this;
	}

	/** Set action to execute a tool. */
	tool(name: string, args: Record<string, unknown> = {}): this {
		this.step.action = { type: "tool", name, args };
		return this;
	}

	/** Set action to run a shell command. */
	shell(command: string, cwd?: string): this {
		this.step.action = { type: "shell", command, cwd };
		return this;
	}

	/** Set action to transform data. */
	transform(fn: string): this {
		this.step.action = { type: "transform", fn };
		return this;
	}

	/** Set action to a conditional branch. */
	conditional(condition: StepCondition, thenStep: string, elseStep?: string): this {
		this.step.action = { type: "conditional", if: condition, then: thenStep, else: elseStep };
		return this;
	}

	/** Set action to run a sub-workflow. */
	subworkflow(workflowId: string, inputs?: Record<string, StepInput>): this {
		this.step.action = { type: "subworkflow", workflowId, inputs };
		return this;
	}

	/** Set action to wait for a duration. */
	wait(duration: number): this {
		this.step.action = { type: "wait", duration };
		return this;
	}

	/** Set action to wait for user approval. */
	approval(message: string): this {
		this.step.action = { type: "approval", message };
		return this;
	}

	/** Declare dependencies — steps that must complete before this one. */
	dependsOn(...stepIds: string[]): this {
		this.step.dependsOn.push(...stepIds);
		return this;
	}

	/** Set a condition that must be true for this step to run. */
	condition(cond: StepCondition): this {
		this.step.condition = cond;
		return this;
	}

	/** Configure retry behavior. */
	retry(config: RetryConfig): this {
		this.step.retry = config;
		return this;
	}

	/** Set step timeout in milliseconds. */
	timeout(ms: number): this {
		this.step.timeout = ms;
		return this;
	}

	/** Add a named input from a source. */
	input(name: string, source: StepInput): this {
		if (!this.step.inputs) {
			this.step.inputs = {};
		}
		this.step.inputs[name] = source;
		return this;
	}

	/** Set failure handling strategy. */
	onFailure(strategy: "fail" | "continue" | "retry"): this {
		this.step.onFailure = strategy;
		return this;
	}

	/** Add tags for filtering/grouping. */
	tag(...tags: string[]): this {
		if (!this.step.tags) {
			this.step.tags = [];
		}
		this.step.tags.push(...tags);
		return this;
	}

	/** Return to the parent workflow builder. */
	done(): WorkflowBuilder {
		this.parent.addStep(this.step);
		return this.parent;
	}

	/** Get the built step (for internal use). */
	getStep(): WorkflowStep {
		return this.step;
	}
}

// ─── Workflow Builder ───────────────────────────────────────────────────────

/**
 * Fluent builder for constructing workflow DAGs programmatically.
 *
 * @example
 * ```ts
 * const workflow = new WorkflowBuilder("cicd", "CI/CD Pipeline")
 *   .describe("Full CI/CD pipeline")
 *   .step("lint", "Lint").shell("npm run lint").done()
 *   .step("test", "Test").shell("npm test").dependsOn("lint").done()
 *   .step("build", "Build").shell("npm run build").dependsOn("test").done()
 *   .build();
 * ```
 */
export class WorkflowBuilder {
	private readonly id: string;
	private readonly name: string;
	private description: string = "";
	private version: string = "1.0.0";
	private steps: WorkflowStep[] = [];
	private context: Record<string, unknown> = {};
	private timeout?: number;
	private maxConcurrency?: number;
	private triggers: WorkflowTrigger[] = [];

	constructor(id: string, name: string) {
		this.id = id;
		this.name = name;
	}

	/** Set workflow description. */
	describe(description: string): this {
		this.description = description;
		return this;
	}

	/** Set workflow version. */
	setVersion(version: string): this {
		this.version = version;
		return this;
	}

	/** Begin defining a new step. Returns a StepBuilder for chaining. */
	step(id: string, name: string): StepBuilder {
		return new StepBuilder(this, id, name);
	}

	/** Add a parallel execution group (shorthand). */
	parallel(id: string, name: string, stepIds: string[]): this {
		this.steps.push({
			id,
			name,
			action: { type: "parallel", steps: stepIds },
			dependsOn: [],
		});
		return this;
	}

	/** Add a pre-built step (used by StepBuilder.done()). */
	addStep(step: WorkflowStep): void {
		this.steps.push(step);
	}

	/** Set global workflow context. */
	setContext(ctx: Record<string, unknown>): this {
		this.context = ctx;
		return this;
	}

	/** Set global workflow timeout in ms. */
	setTimeout(ms: number): this {
		this.timeout = ms;
		return this;
	}

	/** Set max concurrent steps. */
	setConcurrency(max: number): this {
		this.maxConcurrency = max;
		return this;
	}

	/** Add a workflow trigger. */
	trigger(trigger: WorkflowTrigger): this {
		this.triggers.push(trigger);
		return this;
	}

	/**
	 * Build and return the final Workflow object.
	 *
	 * @returns A complete Workflow definition ready for execution or persistence.
	 */
	build(): Workflow {
		return {
			id: this.id,
			name: this.name,
			description: this.description,
			version: this.version,
			steps: [...this.steps],
			context: { ...this.context },
			timeout: this.timeout,
			maxConcurrency: this.maxConcurrency,
			triggers: this.triggers.length > 0 ? [...this.triggers] : undefined,
		};
	}
}
