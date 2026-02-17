import { describe, it, expect } from "vitest";
import { extractSignals, classifyContent, extractSignalsFromTurns } from "../src/stream-extractor.js";
import type { SessionTurn, StreamType } from "../src/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTurn(overrides?: Partial<SessionTurn>): SessionTurn {
	return {
		turnNumber: 1,
		role: "user",
		content: "",
		...overrides,
	};
}

describe("stream-extractor", () => {

	// ── extractSignals: identity patterns ────────────────────────────────

	describe("extractSignals — identity", () => {
		it("detects 'i prefer' as identity", () => {
			const signals = extractSignals(makeTurn({ content: "I prefer tabs over spaces." }));
			expect(signals.identity.length).toBeGreaterThan(0);
			expect(signals.identity[0]).toContain("prefer");
		});

		it("detects 'my preference' as identity", () => {
			const signals = extractSignals(makeTurn({ content: "My preference is dark mode." }));
			expect(signals.identity.length).toBeGreaterThan(0);
		});

		it("detects 'don't use' as identity", () => {
			const signals = extractSignals(makeTurn({ content: "Don't use semicolons in my code." }));
			expect(signals.identity.length).toBeGreaterThan(0);
		});

		it("detects 'i'm a' as identity", () => {
			const signals = extractSignals(makeTurn({ content: "I'm a backend developer." }));
			expect(signals.identity.length).toBeGreaterThan(0);
		});

		it("detects 'tabs' keyword as identity", () => {
			const signals = extractSignals(makeTurn({ content: "Always use tabs for indentation." }));
			expect(signals.identity.length).toBeGreaterThan(0);
		});

		it("detects 'remember that' as identity", () => {
			const signals = extractSignals(makeTurn({ content: "Remember that I like TypeScript." }));
			expect(signals.identity.length).toBeGreaterThan(0);
		});

		it("detects 'my name is' as identity", () => {
			const signals = extractSignals(makeTurn({ content: "My name is Alice." }));
			expect(signals.identity.length).toBeGreaterThan(0);
		});

		it("detects 'i work at' as identity", () => {
			const signals = extractSignals(makeTurn({ content: "I work at Anthropic." }));
			expect(signals.identity.length).toBeGreaterThan(0);
		});
	});

	// ── extractSignals: project patterns ────────────────────────────────

	describe("extractSignals — projects", () => {
		it("detects 'decided to' as project", () => {
			const signals = extractSignals(makeTurn({ content: "We decided to use PostgreSQL." }));
			expect(signals.projects.length).toBeGreaterThan(0);
		});

		it("detects 'architecture' as project", () => {
			const signals = extractSignals(makeTurn({ content: "The architecture uses microservices." }));
			expect(signals.projects.length).toBeGreaterThan(0);
		});

		it("detects 'database' as project", () => {
			const signals = extractSignals(makeTurn({ content: "Set up the database schema." }));
			expect(signals.projects.length).toBeGreaterThan(0);
		});

		it("detects 'framework' as project", () => {
			const signals = extractSignals(makeTurn({ content: "We chose React as our framework." }));
			expect(signals.projects.length).toBeGreaterThan(0);
		});

		it("detects 'migration' as project", () => {
			const signals = extractSignals(makeTurn({ content: "Run the migration to update schema." }));
			expect(signals.projects.length).toBeGreaterThan(0);
		});

		it("detects 'deploy' as project", () => {
			const signals = extractSignals(makeTurn({ content: "Deploy the new service to staging." }));
			expect(signals.projects.length).toBeGreaterThan(0);
		});
	});

	// ── extractSignals: task patterns ────────────────────────────────────

	describe("extractSignals — tasks", () => {
		it("detects 'todo' as task", () => {
			const signals = extractSignals(makeTurn({ content: "TODO: fix the login page." }));
			expect(signals.tasks.length).toBeGreaterThan(0);
		});

		it("detects 'fix' / 'bug' as task", () => {
			const signals = extractSignals(makeTurn({ content: "Fix the bug in the parser." }));
			expect(signals.tasks.length).toBeGreaterThan(0);
		});

		it("detects 'blocked' as task", () => {
			const signals = extractSignals(makeTurn({ content: "I am blocked on the API key." }));
			expect(signals.tasks.length).toBeGreaterThan(0);
		});

		it("detects 'completed' as task", () => {
			const signals = extractSignals(makeTurn({ content: "Completed the unit tests." }));
			expect(signals.tasks.length).toBeGreaterThan(0);
		});

		it("detects 'test' as task", () => {
			const signals = extractSignals(makeTurn({ content: "Write a test for the new endpoint." }));
			expect(signals.tasks.length).toBeGreaterThan(0);
		});

		it("detects 'pr' as task", () => {
			const signals = extractSignals(makeTurn({ content: "Create a PR for the changes." }));
			expect(signals.tasks.length).toBeGreaterThan(0);
		});

		it("detects 'priority' as task", () => {
			const signals = extractSignals(makeTurn({ content: "This is a priority item for the sprint." }));
			expect(signals.tasks.length).toBeGreaterThan(0);
		});
	});

	// ── extractSignals: flow (unclassified) ─────────────────────────────

	describe("extractSignals — flow", () => {
		it("unclassified text goes to flow", () => {
			const signals = extractSignals(makeTurn({ content: "The weather is nice today." }));
			expect(signals.flow.length).toBeGreaterThan(0);
			expect(signals.identity).toEqual([]);
			expect(signals.projects).toEqual([]);
			expect(signals.tasks).toEqual([]);
		});

		it("skips very short sentences (< 5 chars)", () => {
			const signals = extractSignals(makeTurn({ content: "Ok." }));
			expect(signals.flow).toEqual([]);
			expect(signals.identity).toEqual([]);
		});
	});

	// ── extractSignals: tool calls ──────────────────────────────────────

	describe("extractSignals — tool calls", () => {
		it("tool calls are added to projects", () => {
			const signals = extractSignals(makeTurn({
				content: "Running tool.",
				toolCalls: [{ name: "read_file", input: '{"path":"/src/main.ts"}', result: "content" }],
			}));
			const toolSignal = signals.projects.find(p => p.includes("[tool:read_file]"));
			expect(toolSignal).toBeTruthy();
		});

		it("error tool calls are added to tasks", () => {
			const signals = extractSignals(makeTurn({
				content: "Failed.",
				toolCalls: [{ name: "bash", input: '{"cmd":"rm"}', result: "Permission denied", isError: true }],
			}));
			const errorSignal = signals.tasks.find(t => t.includes("[error:bash]"));
			expect(errorSignal).toBeTruthy();
		});
	});

	// ── extractSignals: code blocks ─────────────────────────────────────

	describe("extractSignals — code blocks", () => {
		it("replaces code blocks with [code block]", () => {
			const signals = extractSignals(makeTurn({
				content: "Here is some code:\n```js\nconsole.log('hi');\n```\nThat is all.",
			}));
			// The code block should be replaced, so no raw JS in signals
			const all = [...signals.identity, ...signals.projects, ...signals.tasks, ...signals.flow];
			const hasCodeBlock = all.some(s => s.includes("[code block]"));
			expect(hasCodeBlock).toBe(true);
		});
	});

	// ── classifyContent ─────────────────────────────────────────────────

	describe("classifyContent", () => {
		it("returns 'identity' for preference text", () => {
			expect(classifyContent("I prefer tabs and always use TypeScript.")).toBe("identity");
		});

		it("returns 'projects' for architecture text", () => {
			expect(classifyContent("The architecture uses a database with migration support.")).toBe("projects");
		});

		it("returns 'tasks' for todo text", () => {
			expect(classifyContent("TODO: fix the bug and write a test for the PR.")).toBe("tasks");
		});

		it("returns 'flow' for unclassified text", () => {
			expect(classifyContent("The sky is blue and the grass is green.")).toBe("flow");
		});

		it("returns dominant stream when multiple match", () => {
			// "fix bug test pr priority" should strongly match tasks
			const result = classifyContent("Fix the bug, write a test, create a PR, it is priority.");
			expect(result).toBe("tasks");
		});
	});

	// ── extractSignalsFromTurns ─────────────────────────────────────────

	describe("extractSignalsFromTurns", () => {
		it("returns empty signals for empty array", () => {
			const signals = extractSignalsFromTurns([]);
			expect(signals.identity).toEqual([]);
			expect(signals.projects).toEqual([]);
			expect(signals.tasks).toEqual([]);
			expect(signals.flow).toEqual([]);
		});

		it("merges signals from multiple turns", () => {
			const turns: SessionTurn[] = [
				makeTurn({ turnNumber: 1, content: "I prefer tabs." }),
				makeTurn({ turnNumber: 2, content: "TODO: fix the parser." }),
			];
			const signals = extractSignalsFromTurns(turns);
			expect(signals.identity.length).toBeGreaterThan(0);
			expect(signals.tasks.length).toBeGreaterThan(0);
		});

		it("accumulates all identity signals", () => {
			const turns: SessionTurn[] = [
				makeTurn({ turnNumber: 1, content: "I prefer tabs." }),
				makeTurn({ turnNumber: 2, content: "My preference is dark mode." }),
			];
			const signals = extractSignalsFromTurns(turns);
			expect(signals.identity.length).toBeGreaterThanOrEqual(2);
		});

		it("accumulates tool call signals across turns", () => {
			const turns: SessionTurn[] = [
				makeTurn({
					turnNumber: 1,
					role: "assistant",
					content: "Reading.",
					toolCalls: [{ name: "read_file", input: "/a", result: "ok" }],
				}),
				makeTurn({
					turnNumber: 2,
					role: "assistant",
					content: "Writing.",
					toolCalls: [{ name: "write_file", input: "/b", result: "ok" }],
				}),
			];
			const signals = extractSignalsFromTurns(turns);
			const toolSignals = signals.projects.filter(p => p.includes("[tool:"));
			expect(toolSignals.length).toBeGreaterThanOrEqual(2);
		});
	});
});
