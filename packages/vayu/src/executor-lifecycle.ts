/**
 * @chitragupta/vayu — Executor lifecycle utilities.
 *
 * Input resolution, condition evaluation, and step action execution
 * used by the WorkflowExecutor.
 */

import { execFile } from "child_process";
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
 * Resolve a dot-path on an object (simple JSONPath).
 */
function resolvePath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Safely evaluate a simple expression with a given scope.
 *
 * Inspired by Panini's Ashtadhyayi (~4th century BCE) — the first formal
 * grammar ever composed. Just as Panini decomposed Sanskrit into precise
 * production rules (sutras), this parser decomposes expressions via
 * recursive descent, each precedence level a sutra unto itself.
 *
 * Replaces the previous `new Function()` implementation which allowed
 * arbitrary code injection. This parser supports only a safe subset:
 * literals, property access, arithmetic, comparison, logical, and ternary
 * operators. Function calls, assignments, and all other code execution
 * forms are explicitly rejected.
 */
function safeEval(expr: string, scope: Record<string, unknown>): unknown {
	// ── Lexer ──────────────────────────────────────────────────────────
	const enum Tk {
		Num, Str, Bool, Null, Undef, Ident,
		Plus, Minus, Star, Slash, Percent,
		Lt, Gt, LtEq, GtEq, EqEq, NotEq, EqEqEq, NotEqEq,
		And, Or, Bang,
		Question, Colon, Dot,
		LParen, RParen, LBrack, RBrack,
		Comma, Eof,
	}

	interface Token {
		type: Tk;
		value: string;
		start: number;
	}

	function tokenize(src: string): Token[] {
		const tokens: Token[] = [];
		let i = 0;

		while (i < src.length) {
			// Skip whitespace
			if (/\s/.test(src[i])) { i++; continue; }

			const start = i;

			// Numbers (integer and float, no leading dot)
			if (/[0-9]/.test(src[i]) || (src[i] === "." && i + 1 < src.length && /[0-9]/.test(src[i + 1]))) {
				while (i < src.length && /[0-9]/.test(src[i])) i++;
				if (i < src.length && src[i] === ".") {
					i++;
					while (i < src.length && /[0-9]/.test(src[i])) i++;
				}
				tokens.push({ type: Tk.Num, value: src.slice(start, i), start });
				continue;
			}

			// Strings
			if (src[i] === '"' || src[i] === "'") {
				const quote = src[i];
				i++;
				let s = "";
				while (i < src.length && src[i] !== quote) {
					if (src[i] === "\\") {
						i++;
						if (i >= src.length) break;
						const esc: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"' };
						s += esc[src[i]] ?? src[i];
					} else {
						s += src[i];
					}
					i++;
				}
				if (i < src.length) i++; // closing quote
				tokens.push({ type: Tk.Str, value: s, start });
				continue;
			}

			// Template literals — disallowed
			if (src[i] === "`") {
				throw new Error("Template literals are not allowed in expressions");
			}

			// Identifiers and keywords
			if (/[a-zA-Z_$]/.test(src[i])) {
				while (i < src.length && /[a-zA-Z0-9_$]/.test(src[i])) i++;
				const word = src.slice(start, i);

				// Disallowed keywords
				const forbidden = ["new", "delete", "typeof", "instanceof", "in", "void", "throw", "yield", "await", "class", "function", "var", "let", "const", "import", "export", "this"];
				if (forbidden.includes(word)) {
					throw new Error(`Keyword "${word}" is not allowed in expressions`);
				}

				if (word === "true" || word === "false") {
					tokens.push({ type: Tk.Bool, value: word, start });
				} else if (word === "null") {
					tokens.push({ type: Tk.Null, value: word, start });
				} else if (word === "undefined") {
					tokens.push({ type: Tk.Undef, value: word, start });
				} else {
					tokens.push({ type: Tk.Ident, value: word, start });
				}
				continue;
			}

			// Multi-character operators
			const two = src.slice(i, i + 3);
			if (two === "===" || two === "!==") {
				tokens.push({ type: two === "===" ? Tk.EqEqEq : Tk.NotEqEq, value: two, start });
				i += 3;
				continue;
			}

			const pair = src.slice(i, i + 2);
			if (pair === "==" || pair === "!=" || pair === "<=" || pair === ">=" || pair === "&&" || pair === "||") {
				const tkType: Record<string, Tk> = {
					"==": Tk.EqEq, "!=": Tk.NotEq,
					"<=": Tk.LtEq, ">=": Tk.GtEq,
					"&&": Tk.And, "||": Tk.Or,
				};
				tokens.push({ type: tkType[pair], value: pair, start });
				i += 2;
				continue;
			}

			// Reject assignment operators
			if (src[i] === "=" && i + 1 < src.length && src[i + 1] !== "=") {
				throw new Error("Assignment is not allowed in expressions");
			}

			// Single-character tokens
			const singles: Record<string, Tk> = {
				"+": Tk.Plus, "-": Tk.Minus, "*": Tk.Star, "/": Tk.Slash, "%": Tk.Percent,
				"<": Tk.Lt, ">": Tk.Gt, "!": Tk.Bang,
				"?": Tk.Question, ":": Tk.Colon, ".": Tk.Dot,
				"(": Tk.LParen, ")": Tk.RParen,
				"[": Tk.LBrack, "]": Tk.RBrack,
				",": Tk.Comma,
			};

			if (singles[src[i]] !== undefined) {
				tokens.push({ type: singles[src[i]], value: src[i], start });
				i++;
				continue;
			}

			// Reject regex literals (starting with /)
			if (src[i] === "/") {
				throw new Error("Regular expressions are not allowed in expressions");
			}

			throw new Error(`Unexpected character '${src[i]}' at position ${i}`);
		}

		tokens.push({ type: Tk.Eof, value: "", start: i });
		return tokens;
	}

	// ── Parser (recursive descent, Panini-style sutras) ────────────────
	let tokens: Token[];
	let pos: number;

	function peek(): Token { return tokens[pos]; }
	function advance(): Token { return tokens[pos++]; }
	function expect(type: Tk): Token {
		const t = advance();
		if (t.type !== type) {
			throw new Error(`Expected token type ${type}, got ${t.type} ("${t.value}") at position ${t.start}`);
		}
		return t;
	}
	function match(type: Tk): boolean {
		if (peek().type === type) { advance(); return true; }
		return false;
	}

	// Sutra 1: Ternary (lowest precedence)
	function parseTernary(): unknown {
		const cond = parseOr();
		if (match(Tk.Question)) {
			const consequent = parseTernary();
			expect(Tk.Colon);
			const alternate = parseTernary();
			return cond ? consequent : alternate;
		}
		return cond;
	}

	// Sutra 2: Logical OR
	function parseOr(): unknown {
		let left = parseAnd();
		while (peek().type === Tk.Or) {
			advance();
			const right = parseAnd();
			left = left || right;
		}
		return left;
	}

	// Sutra 3: Logical AND
	function parseAnd(): unknown {
		let left = parseEquality();
		while (peek().type === Tk.And) {
			advance();
			const right = parseEquality();
			left = left && right;
		}
		return left;
	}

	// Sutra 4: Equality (===, !==, ==, !=)
	function parseEquality(): unknown {
		let left = parseComparison();
		while (true) {
			const t = peek().type;
			if (t === Tk.EqEqEq) { advance(); left = left === parseComparison(); }
			else if (t === Tk.NotEqEq) { advance(); left = left !== parseComparison(); }
			else if (t === Tk.EqEq) { advance(); left = left == parseComparison(); }
			else if (t === Tk.NotEq) { advance(); left = left != parseComparison(); }
			else break;
		}
		return left;
	}

	// Sutra 5: Comparison (<, >, <=, >=)
	function parseComparison(): unknown {
		let left = parseAdditive();
		while (true) {
			const t = peek().type;
			if (t === Tk.Lt) { advance(); left = (left as number) < (parseAdditive() as number); }
			else if (t === Tk.Gt) { advance(); left = (left as number) > (parseAdditive() as number); }
			else if (t === Tk.LtEq) { advance(); left = (left as number) <= (parseAdditive() as number); }
			else if (t === Tk.GtEq) { advance(); left = (left as number) >= (parseAdditive() as number); }
			else break;
		}
		return left;
	}

	// Sutra 6: Addition / Subtraction
	function parseAdditive(): unknown {
		let left = parseMultiplicative();
		while (true) {
			const t = peek().type;
			if (t === Tk.Plus) { advance(); left = (left as number) + (parseMultiplicative() as number); }
			else if (t === Tk.Minus) { advance(); left = (left as number) - (parseMultiplicative() as number); }
			else break;
		}
		return left;
	}

	// Sutra 7: Multiplication / Division / Modulo
	function parseMultiplicative(): unknown {
		let left = parseUnary();
		while (true) {
			const t = peek().type;
			if (t === Tk.Star) { advance(); left = (left as number) * (parseUnary() as number); }
			else if (t === Tk.Slash) { advance(); left = (left as number) / (parseUnary() as number); }
			else if (t === Tk.Percent) { advance(); left = (left as number) % (parseUnary() as number); }
			else break;
		}
		return left;
	}

	// Sutra 8: Unary (!, -, +)
	function parseUnary(): unknown {
		if (peek().type === Tk.Bang) { advance(); return !parseUnary(); }
		if (peek().type === Tk.Minus) { advance(); return -(parseUnary() as number); }
		if (peek().type === Tk.Plus) { advance(); return +(parseUnary() as number); }
		return parsePostfix();
	}

	// Sutra 9: Property access (a.b, a[expr]) — rejects function calls
	function parsePostfix(): unknown {
		let obj = parsePrimary();
		while (true) {
			if (peek().type === Tk.Dot) {
				advance();
				const prop = expect(Tk.Ident);
				// Reject method calls: a.b()
				if (peek().type === Tk.LParen) {
					throw new Error("Function calls are not allowed in expressions");
				}
				if (obj == null) return undefined;
				obj = (obj as Record<string, unknown>)[prop.value];
			} else if (peek().type === Tk.LBrack) {
				advance();
				const key = parseTernary();
				expect(Tk.RBrack);
				// Reject method calls: a[key]()
				if (peek().type === Tk.LParen) {
					throw new Error("Function calls are not allowed in expressions");
				}
				if (obj == null) return undefined;
				obj = (obj as Record<string, unknown>)[key as string | number];
			} else if (peek().type === Tk.LParen) {
				// Direct function call: foo()
				throw new Error("Function calls are not allowed in expressions");
			} else {
				break;
			}
		}
		return obj;
	}

	// Sutra 10: Primary expressions (literals, identifiers, grouping)
	function parsePrimary(): unknown {
		const t = peek();

		switch (t.type) {
			case Tk.Num:
				advance();
				return Number(t.value);

			case Tk.Str:
				advance();
				return t.value;

			case Tk.Bool:
				advance();
				return t.value === "true";

			case Tk.Null:
				advance();
				return null;

			case Tk.Undef:
				advance();
				return undefined;

			case Tk.Ident: {
				advance();
				const name = t.value;
				if (!(name in scope)) return undefined;
				return scope[name];
			}

			case Tk.LParen: {
				advance();
				const inner = parseTernary();
				expect(Tk.RParen);
				return inner;
			}

			default:
				throw new Error(`Unexpected token "${t.value}" at position ${t.start}`);
		}
	}

	// ── Execute ────────────────────────────────────────────────────────
	try {
		tokens = tokenize(expr);
		pos = 0;

		// Handle empty expression
		if (tokens.length === 1 && tokens[0].type === Tk.Eof) {
			return undefined;
		}

		const result = parseTernary();

		// Ensure we consumed the entire expression
		if (peek().type !== Tk.Eof) {
			throw new Error(`Unexpected token "${peek().value}" at position ${peek().start}`);
		}

		return result;
	} catch {
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

/**
 * Execute a single step with retry, timeout, and error handling.
 */
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
