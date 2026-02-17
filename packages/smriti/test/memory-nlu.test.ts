import { describe, it, expect } from "vitest";
import { detectMemoryIntent, detectCategory } from "../src/memory-nlu.js";
import type { MemoryIntent } from "../src/memory-nlu.js";

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("detectMemoryIntent", () => {

	// ── Remember patterns ───────────────────────────────────────────────

	describe("remember action", () => {
		it("should detect 'remember that I like dark mode'", () => {
			const result = detectMemoryIntent("remember that I like dark mode");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("remember");
			expect(result!.content).toBe("I like dark mode");
		});

		it("should detect 'note that the API key is XYZ'", () => {
			const result = detectMemoryIntent("note that the API key is XYZ");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("remember");
			expect(result!.content).toBe("the API key is XYZ");
		});

		it("should detect 'remember that I prefer TypeScript'", () => {
			const result = detectMemoryIntent("remember that I prefer TypeScript");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("remember");
			expect(result!.content).toContain("TypeScript");
		});

		it("should detect 'keep in mind that I use Vim'", () => {
			const result = detectMemoryIntent("keep in mind that I use Vim");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("remember");
			expect(result!.content).toContain("I use Vim");
		});

		it("should detect 'please remember my timezone is PST'", () => {
			const result = detectMemoryIntent("please remember my timezone is PST");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("remember");
			expect(result!.content).toContain("timezone");
		});

		it("should detect 'don't forget that I need 2FA' (forget patterns checked first)", () => {
			// FORGET patterns are checked before REMEMBER patterns (higher priority — destructive action)
			// "don't forget" still matches \bforget\b in FORGET_PATTERNS[0]
			const result = detectMemoryIntent("don't forget that I need 2FA");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("forget");
		});

		it("should detect 'note: use port 3000 for dev'", () => {
			const result = detectMemoryIntent("note: use port 3000 for dev");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("remember");
			expect(result!.content).toContain("port 3000");
		});

		it("should detect 'I like dark mode' as remember (implicit preference)", () => {
			const result = detectMemoryIntent("I like dark mode");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("remember");
			// contentGroup 0 means full text
			expect(result!.content).toBeTruthy();
		});

		it("should detect 'I prefer tabs over spaces' as remember", () => {
			const result = detectMemoryIntent("I prefer tabs over spaces");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("remember");
		});

		it("should detect 'I always use ESLint' as remember", () => {
			const result = detectMemoryIntent("I always use ESLint");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("remember");
		});

		it("should detect 'I never use semicolons' as remember", () => {
			const result = detectMemoryIntent("I never use semicolons");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("remember");
		});

		it("should strip trailing punctuation from content", () => {
			const result = detectMemoryIntent("remember that I like pizza!");
			expect(result).not.toBeNull();
			expect(result!.content).not.toMatch(/[!?.]$/);
		});

		it("should normalize whitespace in content", () => {
			const result = detectMemoryIntent("remember that  I   like   pizza");
			expect(result).not.toBeNull();
			expect(result!.content).not.toContain("  ");
		});

		it("should auto-detect category for remember", () => {
			const result = detectMemoryIntent("remember that I prefer dark mode");
			expect(result).not.toBeNull();
			expect(result!.category).toBe("preference");
		});
	});

	// ── Forget patterns ─────────────────────────────────────────────────

	describe("forget action", () => {
		it("should detect 'forget about dark mode'", () => {
			const result = detectMemoryIntent("forget about dark mode");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("forget");
			// First FORGET pattern captures "about dark mode" (includes the preposition)
			expect(result!.query).toContain("dark mode");
		});

		it("should detect 'delete memory about XYZ'", () => {
			const result = detectMemoryIntent("delete memory about XYZ");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("forget");
			expect(result!.query).toBe("XYZ");
		});

		it("should detect 'forget that I like pizza'", () => {
			const result = detectMemoryIntent("forget that I like pizza");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("forget");
			expect(result!.query).toContain("pizza");
		});

		it("should detect 'remove the memory about old config'", () => {
			const result = detectMemoryIntent("remove the memory about old config");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("forget");
			expect(result!.query).toContain("old config");
		});

		it("should detect 'never mind about the pizza preference'", () => {
			const result = detectMemoryIntent("never mind about the pizza preference");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("forget");
			expect(result!.query).toContain("pizza");
		});

		it("should detect 'stop remembering my address'", () => {
			const result = detectMemoryIntent("stop remembering my address");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("forget");
			expect(result!.query).toContain("address");
		});
	});

	// ── Recall patterns ─────────────────────────────────────────────────

	describe("recall action", () => {
		it("should detect 'what do you remember about food' (list wins over recall)", () => {
			// LIST patterns are checked before RECALL patterns
			// "what do you remember" matches LIST_PATTERNS (bare form without "about ...")
			const result = detectMemoryIntent("what do you remember about food");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("list");
		});

		it("should detect 'recall what I said about TypeScript'", () => {
			const result = detectMemoryIntent("recall what I said about TypeScript");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("recall");
			expect(result!.query).toContain("TypeScript");
		});

		it("should detect 'what do you know about my preferences' (list wins via 'my preferences')", () => {
			// LIST_PATTERNS includes \bmy\s+preferences?\b which matches
			const result = detectMemoryIntent("what do you know about my preferences");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("list");
			expect(result!.category).toBe("preference");
		});

		it("should detect 'do you remember my favorite color'", () => {
			const result = detectMemoryIntent("do you remember my favorite color");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("recall");
			expect(result!.query).toContain("color");
		});

		it("should detect 'what is my timezone'", () => {
			const result = detectMemoryIntent("what is my timezone");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("recall");
			expect(result!.query).toContain("timezone");
		});

		it("should detect 'show me memories about coding'", () => {
			const result = detectMemoryIntent("show me memories about coding");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("recall");
			expect(result!.query).toContain("coding");
		});

		it("should detect 'what have you learned about my style' (list wins)", () => {
			// "what have you learned" matches LIST_PATTERNS before RECALL can be checked
			const result = detectMemoryIntent("what have you learned about my style");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("list");
		});
	});

	// ── List patterns ───────────────────────────────────────────────────

	describe("list action", () => {
		it("should detect 'list my preferences' with category", () => {
			const result = detectMemoryIntent("list my preferences");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("list");
			expect(result!.category).toBe("preference");
		});

		it("should detect 'show all memories' without category", () => {
			const result = detectMemoryIntent("show all memories");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("list");
			expect(result!.category).toBeUndefined();
		});

		it("should detect 'list my decisions' with category", () => {
			const result = detectMemoryIntent("list my decisions");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("list");
			expect(result!.category).toBe("decision");
		});

		it("should detect 'list my instructions' with category", () => {
			const result = detectMemoryIntent("list my instructions");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("list");
			expect(result!.category).toBe("instruction");
		});

		it("should detect 'list facts' with category", () => {
			const result = detectMemoryIntent("list facts");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("list");
			expect(result!.category).toBe("fact");
		});

		it("should detect 'show my preferences'", () => {
			const result = detectMemoryIntent("show my preferences");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("list");
			expect(result!.category).toBe("preference");
		});

		it("should detect 'what do you remember' as list", () => {
			const result = detectMemoryIntent("what do you remember");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("list");
		});

		it("should detect 'what have you learned' as list", () => {
			const result = detectMemoryIntent("what have you learned");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("list");
		});

		it("should detect 'list memories' without category", () => {
			const result = detectMemoryIntent("list memories");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("list");
			expect(result!.category).toBeUndefined();
		});
	});

	// ── No intent (null) ────────────────────────────────────────────────

	describe("no intent (returns null)", () => {
		it("should return null for 'hello how are you'", () => {
			expect(detectMemoryIntent("hello how are you")).toBeNull();
		});

		it("should return null for 'build me a function'", () => {
			expect(detectMemoryIntent("build me a function")).toBeNull();
		});

		it("should return null for empty string", () => {
			expect(detectMemoryIntent("")).toBeNull();
		});

		it("should return null for whitespace-only input", () => {
			expect(detectMemoryIntent("   ")).toBeNull();
		});

		it("should return null for 'what is TypeScript'", () => {
			expect(detectMemoryIntent("what is TypeScript")).toBeNull();
		});

		it("should return null for 'fix the bug in main.ts'", () => {
			expect(detectMemoryIntent("fix the bug in main.ts")).toBeNull();
		});

		it("should return null for 'deploy the application'", () => {
			expect(detectMemoryIntent("deploy the application")).toBeNull();
		});

		it("should return null for 'create a new component'", () => {
			expect(detectMemoryIntent("create a new component")).toBeNull();
		});
	});

	// ── Case insensitivity ──────────────────────────────────────────────

	describe("case insensitivity", () => {
		it("should detect 'REMEMBER THAT I like dark mode'", () => {
			const result = detectMemoryIntent("REMEMBER THAT I like dark mode");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("remember");
		});

		it("should detect 'Forget About my pizza pref'", () => {
			const result = detectMemoryIntent("Forget About my pizza pref");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("forget");
		});

		it("should detect 'What Do You Remember about food' as list (case insensitive)", () => {
			// Same as lowercase version — LIST pattern wins
			const result = detectMemoryIntent("What Do You Remember about food");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("list");
		});

		it("should detect 'LIST MY PREFERENCES'", () => {
			const result = detectMemoryIntent("LIST MY PREFERENCES");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("list");
			expect(result!.category).toBe("preference");
		});

		it("should detect 'Note That the server runs on port 8080'", () => {
			const result = detectMemoryIntent("Note That the server runs on port 8080");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("remember");
		});
	});

	// ── Priority: forget > list > recall > remember ─────────────────────

	describe("pattern priority", () => {
		it("should prioritize forget over remember for 'forget that I like pizza'", () => {
			const result = detectMemoryIntent("forget that I like pizza");
			expect(result).not.toBeNull();
			// "forget" should win even though "I like" could match remember
			expect(result!.action).toBe("forget");
		});
	});
});

// ─── detectCategory ─────────────────────────────────────────────────────────

describe("detectCategory", () => {
	it("should detect 'I prefer dark mode' as preference", () => {
		expect(detectCategory("I prefer dark mode")).toBe("preference");
	});

	it("should detect 'I like pizza' as preference", () => {
		expect(detectCategory("I like pizza")).toBe("preference");
	});

	it("should detect 'I love TypeScript' as preference", () => {
		expect(detectCategory("I love TypeScript")).toBe("preference");
	});

	it("should detect 'I hate semicolons' as preference", () => {
		expect(detectCategory("I hate semicolons")).toBe("preference");
	});

	it("should detect 'I dislike tabs' as preference", () => {
		expect(detectCategory("I dislike tabs")).toBe("preference");
	});

	it("should detect 'I always use strict mode' as preference", () => {
		expect(detectCategory("I always use strict mode")).toBe("preference");
	});

	it("should detect 'I usually run tests first' as preference", () => {
		expect(detectCategory("I usually run tests first")).toBe("preference");
	});

	it("should detect 'I decided to use React' as decision", () => {
		expect(detectCategory("decided to use React")).toBe("decision");
	});

	it("should detect 'choosing TypeScript over JavaScript' as decision", () => {
		expect(detectCategory("choosing TypeScript over JavaScript")).toBe("decision");
	});

	it("should detect 'let's use Vitest' as decision", () => {
		expect(detectCategory("let's use Vitest")).toBe("decision");
	});

	it("should detect 'going with PostgreSQL' as decision", () => {
		expect(detectCategory("going with PostgreSQL")).toBe("decision");
	});

	it("should detect 'always do X before deploying' as preference (preference pattern matches first)", () => {
		// CATEGORY_PATTERNS: "always" matches preference (i\s+)?always before instruction's "always\s+do"
		expect(detectCategory("always do X before deploying")).toBe("preference");
	});

	it("should detect 'from now on use strict mode' as instruction", () => {
		expect(detectCategory("from now on use strict mode")).toBe("instruction");
	});

	it("should detect 'whenever you see errors, log them' as instruction", () => {
		expect(detectCategory("whenever you see errors, log them")).toBe("instruction");
	});

	it("should detect 'every time I push, run tests' as instruction", () => {
		expect(detectCategory("every time I push, run tests")).toBe("instruction");
	});

	it("should detect 'my name is John' as fact", () => {
		expect(detectCategory("my name is John")).toBe("fact");
	});

	it("should detect 'I am a software engineer' as fact", () => {
		expect(detectCategory("I am a software engineer")).toBe("fact");
	});

	it("should detect 'I live in San Francisco' as fact", () => {
		expect(detectCategory("I live in San Francisco")).toBe("fact");
	});

	it("should default to 'fact' for unrecognized content", () => {
		expect(detectCategory("random fact about the world")).toBe("fact");
	});

	it("should default to 'fact' for generic sentences", () => {
		expect(detectCategory("the sky is blue")).toBe("fact");
	});
});
