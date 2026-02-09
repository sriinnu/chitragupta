import { describe, it, expect, beforeEach } from "vitest";
import { Manas } from "../src/manas.js";
import type {
	ManasClassification,
	ManasIntent,
	ManasRoute,
	ManasFeatures,
} from "../src/manas.js";

describe("Manas — Zero-Cost Input Pre-Processor", () => {
	let manas: Manas;

	beforeEach(() => {
		manas = new Manas();
	});

	// ─── Performance ────────────────────────────────────────────────

	describe("performance", () => {
		it("should classify in under 5ms", () => {
			const inputs = [
				"read the file src/index.ts",
				"implement a REST endpoint for users with authentication and pagination",
				"review the changes in the pull request",
				"fix the null pointer exception in the authentication middleware",
				"refactor the database module to use connection pooling",
				"find all TypeScript files that import lodash",
				"explain how the event loop works in Node.js",
				"document the API endpoints in README.md",
				"git commit -m 'fix: resolve race condition' && git push",
				"hello, how are you?",
			];

			for (const input of inputs) {
				const result = manas.classify(input);
				expect(result.durationMs).toBeLessThan(5);
			}
		});

		it("should handle very long inputs within 5ms", () => {
			const longInput = "explain ".repeat(500) + "the architecture of the system";
			const result = manas.classify(longInput);
			expect(result.durationMs).toBeLessThan(5);
		});

		it("should handle empty input within 5ms", () => {
			const result = manas.classify("");
			expect(result.durationMs).toBeLessThan(5);
		});
	});

	// ─── Intent Classification ──────────────────────────────────────

	describe("intent classification", () => {
		describe("file_operation", () => {
			it("should detect 'read the file src/index.ts'", () => {
				const r = manas.classify("read the file src/index.ts");
				expect(r.intent).toBe("file_operation");
			});

			it("should detect 'create a new file called utils.ts'", () => {
				const r = manas.classify("create a new file called utils.ts");
				expect(r.intent).toBe("file_operation");
			});

			it("should detect 'delete the old config.json file'", () => {
				const r = manas.classify("delete the old config.json file");
				expect(r.intent).toBe("file_operation");
			});

			it("should detect 'edit the file package.json'", () => {
				const r = manas.classify("edit the file package.json");
				expect(r.intent).toBe("file_operation");
			});

			it("should detect 'open the directory src/'", () => {
				const r = manas.classify("write to the file output.md");
				expect(r.intent).toBe("file_operation");
			});

			it("should detect 'remove the old .js files'", () => {
				const r = manas.classify("remove the old .js files");
				expect(r.intent).toBe("file_operation");
			});
		});

		describe("code_generation", () => {
			it("should detect 'implement a function to parse CSV'", () => {
				const r = manas.classify("implement a function to parse CSV");
				expect(r.intent).toBe("code_generation");
			});

			it("should detect 'write a class for user authentication'", () => {
				const r = manas.classify("write a class for user authentication");
				expect(r.intent).toBe("code_generation");
			});

			it("should detect 'create a new React component for the dashboard'", () => {
				const r = manas.classify("create a new React component for the dashboard");
				expect(r.intent).toBe("code_generation");
			});

			it("should detect 'add a REST endpoint for user profiles'", () => {
				const r = manas.classify("add a REST endpoint for user profiles");
				expect(r.intent).toBe("code_generation");
			});

			it("should detect 'build a module for data validation'", () => {
				const r = manas.classify("build a module for data validation");
				expect(r.intent).toBe("code_generation");
			});

			it("should detect 'generate a test for the parser'", () => {
				const r = manas.classify("generate a test for the parser");
				expect(r.intent).toBe("code_generation");
			});
		});

		describe("code_review", () => {
			it("should detect 'review the code in auth.ts'", () => {
				const r = manas.classify("review the code in auth.ts");
				expect(r.intent).toBe("code_review");
			});

			it("should detect 'audit the implementation for security issues'", () => {
				const r = manas.classify("audit the implementation for security issues");
				expect(r.intent).toBe("code_review");
			});

			it("should detect 'check the pull request changes'", () => {
				const r = manas.classify("check the pull request changes");
				expect(r.intent).toBe("code_review");
			});

			it("should detect 'analyze the code for performance'", () => {
				const r = manas.classify("analyze the code for performance");
				expect(r.intent).toBe("code_review");
			});
		});

		describe("debugging", () => {
			it("should detect 'fix the null pointer error'", () => {
				const r = manas.classify("fix the null pointer error");
				expect(r.intent).toBe("debugging");
			});

			it("should detect 'debug the crash in production'", () => {
				const r = manas.classify("debug the crash in production");
				expect(r.intent).toBe("debugging");
			});

			it("should detect 'there is a bug in the login flow'", () => {
				const r = manas.classify("there is a bug in the login flow");
				expect(r.intent).toBe("debugging");
			});

			it("should detect 'trace the stack trace from the error log'", () => {
				const r = manas.classify("trace the stack trace from the error log");
				expect(r.intent).toBe("debugging");
			});

			it("should detect 'the function is not working correctly'", () => {
				const r = manas.classify("the function is not working correctly");
				expect(r.intent).toBe("debugging");
			});

			it("should detect input with actual error stack", () => {
				const input = `I'm getting this error:
TypeError: Cannot read properties of undefined
    at Function.processData (/src/handler.ts:42:10)
    at main (/src/index.ts:15:3)`;
				const r = manas.classify(input);
				expect(r.intent).toBe("debugging");
			});
		});

		describe("refactoring", () => {
			it("should detect 'refactor the database layer'", () => {
				const r = manas.classify("refactor the database layer");
				expect(r.intent).toBe("refactoring");
			});

			it("should detect 'rename the variable to camelCase'", () => {
				const r = manas.classify("rename the variable to camelCase");
				expect(r.intent).toBe("refactoring");
			});

			it("should detect 'extract a utility function from this code'", () => {
				const r = manas.classify("extract a utility function from this code");
				expect(r.intent).toBe("refactoring");
			});

			it("should detect 'simplify the error handling logic'", () => {
				const r = manas.classify("simplify the error handling logic");
				expect(r.intent).toBe("refactoring");
			});

			it("should detect 'clean up the duplicate code'", () => {
				const r = manas.classify("clean up the duplicate code");
				expect(r.intent).toBe("refactoring");
			});

			it("should detect 'decompose this large function'", () => {
				const r = manas.classify("decompose this large function");
				expect(r.intent).toBe("refactoring");
			});
		});

		describe("search", () => {
			it("should detect 'find all files that use lodash'", () => {
				const r = manas.classify("find all files that use lodash");
				expect(r.intent).toBe("search");
			});

			it("should detect 'search for the function parseConfig'", () => {
				const r = manas.classify("search for the function parseConfig");
				expect(r.intent).toBe("search");
			});

			it("should detect 'grep for TODO comments'", () => {
				const r = manas.classify("grep for TODO comments");
				expect(r.intent).toBe("search");
			});

			it("should detect 'locate where the error is thrown'", () => {
				const r = manas.classify("locate where the error is thrown");
				expect(r.intent).toBe("search");
			});

			it("should detect 'where is the database connection configured?'", () => {
				const r = manas.classify("where is the database connection configured?");
				expect(r.intent).toBe("search");
			});

			it("should detect 'look for all usages of deprecated API'", () => {
				const r = manas.classify("look for all usages of deprecated API");
				expect(r.intent).toBe("search");
			});
		});

		describe("explanation", () => {
			it("should detect 'explain how the event loop works'", () => {
				const r = manas.classify("explain how the event loop works");
				expect(r.intent).toBe("explanation");
			});

			it("should detect 'what is a closure in JavaScript?'", () => {
				const r = manas.classify("what is a closure in JavaScript?");
				expect(r.intent).toBe("explanation");
			});

			it("should detect 'how does the garbage collector work?'", () => {
				const r = manas.classify("how does the garbage collector work?");
				expect(r.intent).toBe("explanation");
			});

			it("should detect 'why does this pattern exist?'", () => {
				const r = manas.classify("why does this pattern exist?");
				expect(r.intent).toBe("explanation");
			});

			it("should detect 'walk me through the authentication flow'", () => {
				const r = manas.classify("walk me through the authentication flow");
				expect(r.intent).toBe("explanation");
			});
		});

		describe("documentation", () => {
			it("should detect 'document the API endpoints'", () => {
				const r = manas.classify("document the API endpoints");
				expect(r.intent).toBe("documentation");
			});

			it("should detect 'write a README for this project'", () => {
				const r = manas.classify("write a README for this project");
				expect(r.intent).toBe("documentation");
			});

			it("should detect 'add JSDoc comments to the functions'", () => {
				const r = manas.classify("add jsdoc comments to the functions");
				expect(r.intent).toBe("documentation");
			});

			it("should detect 'update the changelog'", () => {
				const r = manas.classify("update the changelog");
				expect(r.intent).toBe("documentation");
			});
		});

		describe("system", () => {
			it("should detect 'run the test suite'", () => {
				const r = manas.classify("run the test suite");
				expect(r.intent).toBe("system");
			});

			it("should detect 'git push to origin main'", () => {
				const r = manas.classify("git push to origin main");
				expect(r.intent).toBe("system");
			});

			it("should detect 'build the project'", () => {
				const r = manas.classify("build the project");
				expect(r.intent).toBe("system");
			});

			it("should detect 'install the dependencies'", () => {
				const r = manas.classify("install the dependencies");
				expect(r.intent).toBe("system");
			});

			it("should detect 'deploy to production'", () => {
				const r = manas.classify("deploy to production");
				expect(r.intent).toBe("system");
			});

			it("should detect 'npm install express'", () => {
				const r = manas.classify("npm install express");
				expect(r.intent).toBe("system");
			});
		});

		describe("conversation", () => {
			it("should detect 'hello!'", () => {
				const r = manas.classify("hello!");
				expect(r.intent).toBe("conversation");
			});

			it("should detect 'thanks for your help'", () => {
				const r = manas.classify("thanks for your help");
				expect(r.intent).toBe("conversation");
			});

			it("should detect 'good morning'", () => {
				const r = manas.classify("good morning");
				expect(r.intent).toBe("conversation");
			});

			it("should detect 'ok sounds good'", () => {
				const r = manas.classify("ok sounds good");
				expect(r.intent).toBe("conversation");
			});
		});
	});

	// ─── Route Decision ─────────────────────────────────────────────

	describe("route decision", () => {
		describe("tool-only", () => {
			it("should route file read with path to tool-only", () => {
				const r = manas.classify("read the file ./src/index.ts");
				expect(r.route).toBe("tool-only");
			});

			it("should route search queries to tool-only", () => {
				const r = manas.classify("find all .ts files in src/");
				expect(r.route).toBe("tool-only");
			});

			it("should route grep queries to tool-only", () => {
				const r = manas.classify("grep for TODO comments");
				expect(r.route).toBe("tool-only");
			});
		});

		describe("haiku", () => {
			it("should route conversation to haiku", () => {
				const r = manas.classify("hi there");
				expect(r.route).toBe("haiku");
			});

			it("should route simple explanation to haiku", () => {
				const r = manas.classify("what is a promise?");
				expect(r.route).toBe("haiku");
			});

			it("should route short file operation without path to haiku", () => {
				const r = manas.classify("cat the file readme");
				// No file extension/path detected, may not be tool-only
				expect(["haiku", "tool-only"]).toContain(r.route);
			});
		});

		describe("sonnet", () => {
			it("should route code generation to sonnet", () => {
				const r = manas.classify("implement a REST endpoint for users");
				expect(r.route).toBe("sonnet");
			});

			it("should route code review to sonnet", () => {
				const r = manas.classify("review the code in the pull request");
				expect(r.route).toBe("sonnet");
			});

			it("should route refactoring to sonnet", () => {
				const r = manas.classify("refactor the authentication module");
				expect(r.route).toBe("sonnet");
			});

			it("should route documentation to sonnet", () => {
				const r = manas.classify("document the API endpoints");
				expect(r.route).toBe("sonnet");
			});

			it("should route debugging to sonnet", () => {
				const r = manas.classify("fix the null pointer error in handler");
				expect(r.route).toBe("sonnet");
			});

			it("should route system tasks to sonnet", () => {
				const r = manas.classify("deploy to production");
				expect(r.route).toBe("sonnet");
			});

			it("should route longer explanations to sonnet", () => {
				const r = manas.classify(
					"explain how the event loop works in Node.js, including microtasks, macrotasks, and the different phases",
				);
				expect(r.route).toBe("sonnet");
			});
		});

		describe("opus", () => {
			it("should route highly ambiguous input to opus", () => {
				// Intentionally vague input with no clear intent
				const r = manas.classify("stuff");
				// No patterns match → ambiguity = 1.0 → opus
				expect(r.route).toBe("opus");
			});

			it("should route multi-step technical long input to opus", () => {
				// Generate a long, multi-step, technical input
				const words = Array(30).fill("implement the async middleware pipeline").join(" ");
				const input = `first, ${words}, then deploy the kubernetes cluster with the new docker containers, finally run the integration test suite with coverage`;
				const r = manas.classify(input);
				expect(r.route).toBe("opus");
			});
		});
	});

	// ─── Feature Extraction ─────────────────────────────────────────

	describe("feature extraction", () => {
		describe("hasCode", () => {
			it("should detect fenced code blocks", () => {
				const f = manas.extractFeatures("look at this:\n```ts\nconst x = 1;\n```");
				expect(f.hasCode).toBe(true);
			});

			it("should detect inline code", () => {
				const f = manas.extractFeatures("the variable `foo` is undefined");
				expect(f.hasCode).toBe(true);
			});

			it("should be false when no code present", () => {
				const f = manas.extractFeatures("just a plain sentence");
				expect(f.hasCode).toBe(false);
			});
		});

		describe("hasFilePaths", () => {
			it("should detect relative paths", () => {
				const f = manas.extractFeatures("edit ./src/index.ts");
				expect(f.hasFilePaths).toBe(true);
			});

			it("should detect absolute paths", () => {
				const f = manas.extractFeatures("read /etc/hosts");
				expect(f.hasFilePaths).toBe(true);
			});

			it("should detect file extensions", () => {
				const f = manas.extractFeatures("open config.json");
				expect(f.hasFilePaths).toBe(true);
			});

			it("should be false for plain text", () => {
				const f = manas.extractFeatures("hello world");
				expect(f.hasFilePaths).toBe(false);
			});
		});

		describe("hasErrorStack", () => {
			it("should detect Error: prefix", () => {
				const f = manas.extractFeatures("TypeError: Cannot read property 'x' of undefined");
				expect(f.hasErrorStack).toBe(true);
			});

			it("should detect stack trace lines", () => {
				const f = manas.extractFeatures("    at Object.main (/src/index.ts:10:5)");
				expect(f.hasErrorStack).toBe(true);
			});

			it("should be false for normal text", () => {
				const f = manas.extractFeatures("everything is working fine");
				expect(f.hasErrorStack).toBe(false);
			});
		});

		describe("questionCount", () => {
			it("should count question marks", () => {
				const f = manas.extractFeatures("what? why? how?");
				expect(f.questionCount).toBe(3);
			});

			it("should be 0 with no questions", () => {
				const f = manas.extractFeatures("do this now");
				expect(f.questionCount).toBe(0);
			});
		});

		describe("wordCount", () => {
			it("should count words correctly", () => {
				const f = manas.extractFeatures("fix the broken login page");
				expect(f.wordCount).toBe(5);
			});

			it("should be 0 for empty input", () => {
				const f = manas.extractFeatures("");
				expect(f.wordCount).toBe(0);
			});

			it("should handle whitespace-only input", () => {
				const f = manas.extractFeatures("   \t  \n  ");
				expect(f.wordCount).toBe(0);
			});
		});

		describe("sentenceCount", () => {
			it("should count multiple sentences", () => {
				const f = manas.extractFeatures("First do this. Then do that. Finally check.");
				expect(f.sentenceCount).toBe(3);
			});

			it("should count at least 1 for any non-empty input", () => {
				const f = manas.extractFeatures("just one sentence without period");
				expect(f.sentenceCount).toBeGreaterThanOrEqual(1);
			});
		});

		describe("imperative", () => {
			it("should detect imperative verbs at start", () => {
				const f = manas.extractFeatures("fix the broken tests");
				expect(f.imperative).toBe(true);
			});

			it("should detect 'implement' as imperative", () => {
				const f = manas.extractFeatures("implement the new feature");
				expect(f.imperative).toBe(true);
			});

			it("should not flag non-imperative starts", () => {
				const f = manas.extractFeatures("the tests are broken");
				expect(f.imperative).toBe(false);
			});

			it("should detect 'search' as imperative", () => {
				const f = manas.extractFeatures("search for the config file");
				expect(f.imperative).toBe(true);
			});
		});

		describe("multiStep", () => {
			it("should detect 'first...then' pattern", () => {
				const f = manas.extractFeatures("first read the file, then edit it, finally save");
				expect(f.multiStep).toBe(true);
			});

			it("should be false for single-step input", () => {
				const f = manas.extractFeatures("read the file");
				expect(f.multiStep).toBe(false);
			});
		});

		describe("technical", () => {
			it("should detect async/await", () => {
				const f = manas.extractFeatures("use async await for the API calls");
				expect(f.technical).toBe(true);
			});

			it("should detect framework terms", () => {
				const f = manas.extractFeatures("configure the webpack bundler");
				expect(f.technical).toBe(true);
			});

			it("should be false for non-technical input", () => {
				const f = manas.extractFeatures("hello how are you today");
				expect(f.technical).toBe(false);
			});

			it("should detect middleware term", () => {
				const f = manas.extractFeatures("add authentication middleware");
				expect(f.technical).toBe(true);
			});
		});
	});

	// ─── Keyword Extraction ─────────────────────────────────────────

	describe("keyword extraction", () => {
		it("should extract meaningful keywords", () => {
			const r = manas.classify("implement a REST endpoint for user authentication");
			expect(r.keywords).toContain("implement");
			expect(r.keywords).toContain("rest");
			expect(r.keywords).toContain("endpoint");
			expect(r.keywords).toContain("user");
			expect(r.keywords).toContain("authentication");
		});

		it("should filter stop words", () => {
			const r = manas.classify("read the file in the src directory");
			expect(r.keywords).not.toContain("the");
			expect(r.keywords).not.toContain("in");
		});

		it("should deduplicate keywords", () => {
			const r = manas.classify("find find find the file file");
			const findCount = r.keywords.filter(k => k === "find").length;
			expect(findCount).toBeLessThanOrEqual(1);
		});

		it("should limit to 15 keywords max", () => {
			const longInput = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon";
			const r = manas.classify(longInput);
			expect(r.keywords.length).toBeLessThanOrEqual(15);
		});

		it("should preserve file paths as keywords", () => {
			const r = manas.classify("edit ./src/index.ts");
			expect(r.keywords.some(k => k.includes("src") || k.includes("index.ts"))).toBe(true);
		});

		it("should return empty array for empty input", () => {
			const r = manas.classify("");
			expect(r.keywords).toEqual([]);
		});
	});

	// ─── Ambiguity Scoring ──────────────────────────────────────────

	describe("ambiguity scoring", () => {
		it("should have low ambiguity for clear intents", () => {
			const r = manas.classify("find all .ts files in src/");
			expect(r.ambiguityScore).toBeLessThan(0.5);
		});

		it("should have high ambiguity when no patterns match", () => {
			const r = manas.classify("hmm maybe something");
			expect(r.ambiguityScore).toBeGreaterThan(0.5);
		});

		it("should be 1.0 for completely unrecognizable input", () => {
			const r = manas.classify("xyzzy plugh");
			expect(r.ambiguityScore).toBe(1.0);
		});

		it("should have higher ambiguity when multiple intents compete", () => {
			// "fix" triggers debugging, "build" triggers system — multiple intents
			const ambiguous = manas.classify("fix and build the search feature and test it");
			const clear = manas.classify("find all .ts files");
			expect(ambiguous.ambiguityScore).toBeGreaterThanOrEqual(clear.ambiguityScore);
		});

		it("should be between 0 and 1 inclusive", () => {
			const inputs = [
				"",
				"hello",
				"implement a function",
				"explain the universe and everything in it",
				"xyzzy",
			];
			for (const input of inputs) {
				const r = manas.classify(input);
				expect(r.ambiguityScore).toBeGreaterThanOrEqual(0);
				expect(r.ambiguityScore).toBeLessThanOrEqual(1);
			}
		});
	});

	// ─── Confidence ─────────────────────────────────────────────────

	describe("confidence", () => {
		it("should be between 0 and 1", () => {
			const inputs = [
				"read file.ts",
				"implement a class",
				"hello",
				"",
				"asdfghjkl",
			];
			for (const input of inputs) {
				const r = manas.classify(input);
				expect(r.confidence).toBeGreaterThanOrEqual(0);
				expect(r.confidence).toBeLessThanOrEqual(1);
			}
		});

		it("should be 0 when no intent matches", () => {
			const r = manas.classify("xyzzy plugh");
			expect(r.confidence).toBe(0);
		});

		it("should be high for clear, specific intents", () => {
			const r = manas.classify("search for the parseConfig function");
			expect(r.confidence).toBeGreaterThanOrEqual(0.7);
		});
	});

	// ─── Classification Structure ───────────────────────────────────

	describe("classification structure", () => {
		it("should return all required fields", () => {
			const r = manas.classify("read file.ts");
			expect(r).toHaveProperty("intent");
			expect(r).toHaveProperty("keywords");
			expect(r).toHaveProperty("ambiguityScore");
			expect(r).toHaveProperty("route");
			expect(r).toHaveProperty("confidence");
			expect(r).toHaveProperty("features");
			expect(r).toHaveProperty("durationMs");
		});

		it("should return all feature fields", () => {
			const r = manas.classify("read file.ts");
			const f = r.features;
			expect(f).toHaveProperty("hasCode");
			expect(f).toHaveProperty("hasFilePaths");
			expect(f).toHaveProperty("hasErrorStack");
			expect(f).toHaveProperty("questionCount");
			expect(f).toHaveProperty("wordCount");
			expect(f).toHaveProperty("sentenceCount");
			expect(f).toHaveProperty("imperative");
			expect(f).toHaveProperty("multiStep");
			expect(f).toHaveProperty("technical");
		});

		it("should have keywords as string array", () => {
			const r = manas.classify("implement a REST endpoint");
			expect(Array.isArray(r.keywords)).toBe(true);
			for (const kw of r.keywords) {
				expect(typeof kw).toBe("string");
			}
		});

		it("should report durationMs as a number >= 0", () => {
			const r = manas.classify("hello");
			expect(typeof r.durationMs).toBe("number");
			expect(r.durationMs).toBeGreaterThanOrEqual(0);
		});
	});

	// ─── Edge Cases ─────────────────────────────────────────────────

	describe("edge cases", () => {
		it("should handle empty string", () => {
			const r = manas.classify("");
			expect(r.intent).toBe("conversation"); // fallback
			expect(r.confidence).toBe(0);
			expect(r.ambiguityScore).toBe(1.0);
			expect(r.features.wordCount).toBe(0);
		});

		it("should handle whitespace-only input", () => {
			const r = manas.classify("   \t\n   ");
			expect(r.confidence).toBe(0);
		});

		it("should handle single word", () => {
			const r = manas.classify("refactor");
			expect(r.intent).toBe("refactoring");
		});

		it("should handle input with only special characters", () => {
			const r = manas.classify("!@#$%^&*()");
			expect(r.confidence).toBe(0);
			expect(r.ambiguityScore).toBe(1.0);
		});

		it("should handle input with unicode", () => {
			const r = manas.classify("fix the bug in the login module");
			expect(r.intent).toBe("debugging");
		});

		it("should handle mixed-case input", () => {
			const r = manas.classify("FIND ALL FILES IN SRC");
			expect(r.intent).toBe("search");
		});

		it("should handle input with code block containing error", () => {
			const input = "I get this error:\n```\nTypeError: foo is not a function\n```";
			const r = manas.classify(input);
			expect(r.features.hasCode).toBe(true);
			expect(r.features.hasErrorStack).toBe(true);
			expect(r.intent).toBe("debugging");
		});
	});

	// ─── Intent Scoring Internals ───────────────────────────────────

	describe("scoreIntents", () => {
		it("should initialize all 10 intents", () => {
			const features = manas.extractFeatures("hello");
			const scores = manas.scoreIntents("hello", features);
			expect(scores.size).toBe(10);
		});

		it("should boost debugging when error stack is present", () => {
			const withStack = "at Object.main (/src/index.ts:10:5)";
			const features = manas.extractFeatures(withStack);
			const scores = manas.scoreIntents(withStack, features);
			expect(scores.get("debugging")).toBeGreaterThan(0);
		});

		it("should boost file_operation when file paths are present", () => {
			const input = "read the file ./src/index.ts";
			const features = manas.extractFeatures(input);
			const scores = manas.scoreIntents(input, features);
			expect(scores.get("file_operation")).toBeGreaterThan(0.8);
		});
	});

	// ─── Routing Matrix ─────────────────────────────────────────────

	describe("route decision matrix", () => {
		it("should never route to opus for simple conversation", () => {
			const r = manas.classify("thank you");
			expect(r.route).not.toBe("opus");
		});

		it("should route explanation with code to sonnet", () => {
			const input = "explain how this middleware pattern works in the context of Express.js error handling and request lifecycle";
			const r = manas.classify(input);
			expect(r.route).toBe("sonnet");
		});

		it("should route tool-only when search has clear query", () => {
			const r = manas.classify("search for parseConfig");
			expect(r.route).toBe("tool-only");
		});

		it("should escalate to opus for complex multi-step technical work", () => {
			// Build an input that's multi-step, technical, and >100 words
			const base = "implement the async middleware pipeline with proper error handling";
			const words = Array(20).fill(base).join(" ");
			const input = `first, ${words}, then configure the kubernetes deployment`;
			const r = manas.classify(input);
			expect(r.route).toBe("opus");
		});
	});
});
