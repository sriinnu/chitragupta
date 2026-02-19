/**
 * Tests for syntax highlighting — language detection, per-language
 * tokenizers, and the highlightCodeLine dispatch.
 */
import { describe, it, expect } from "vitest";
import {
	SYN,
	detectLanguage,
	highlightCodeLine,
} from "../src/components/syntax-highlight.js";
import type { Token } from "../src/components/syntax-highlight.js";
import { stripAnsi } from "../src/ansi.js";

// ─── SYN color constants ────────────────────────────────────────────────────

describe("SYN", () => {
	it("exports expected color keys", () => {
		expect(SYN.keyword).toContain("\x1b[");
		expect(SYN.string).toContain("\x1b[");
		expect(SYN.comment).toContain("\x1b[");
		expect(SYN.number).toContain("\x1b[");
		expect(SYN.operator).toContain("\x1b[");
		expect(SYN.type).toContain("\x1b[");
		expect(SYN.function).toContain("\x1b[");
		expect(SYN.base).toContain("\x1b[");
	});
});

// ─── detectLanguage() ────────────────────────────────────────────────────────

describe("detectLanguage", () => {
	describe("shebang detection", () => {
		it("detects python from shebang", () => {
			expect(detectLanguage("#!/usr/bin/env python3\nprint('hi')")).toBe("python");
		});

		it("detects bash from shebang", () => {
			expect(detectLanguage("#!/bin/bash\necho hello")).toBe("bash");
		});

		it("detects node/typescript from shebang", () => {
			expect(detectLanguage("#!/usr/bin/env node\nconsole.log('hi')")).toBe("typescript");
		});

		it("defaults to bash for unknown shebang", () => {
			expect(detectLanguage("#!/usr/bin/env something")).toBe("bash");
		});
	});

	describe("JSON detection", () => {
		it("detects valid JSON object", () => {
			expect(detectLanguage('{"key": "value"}')).toBe("json");
		});

		it("detects valid JSON array with key-value pairs", () => {
			expect(detectLanguage('[{"key": "value"}]')).toBe("json");
		});
	});

	describe("HTML detection", () => {
		it("detects DOCTYPE", () => {
			expect(detectLanguage("<!DOCTYPE html>\n<html>")).toBe("html");
		});

		it("detects html tag", () => {
			expect(detectLanguage("<html>\n<head></head>")).toBe("html");
		});

		it("detects xml declaration", () => {
			expect(detectLanguage('<?xml version="1.0"?>\n<root/>')).toBe("html");
		});
	});

	describe("keyword-based detection", () => {
		it("detects TypeScript from type annotations", () => {
			const code = `const x: string = "hello";\ninterface Foo { bar: number; }`;
			expect(detectLanguage(code)).toBe("typescript");
		});

		it("detects Python from def/self", () => {
			const code = `def greet(self):\n    return "hello"\n`;
			expect(detectLanguage(code)).toBe("python");
		});

		it("detects Rust from fn/let mut", () => {
			const code = `fn main() {\n    let mut x = 5;\n}`;
			expect(detectLanguage(code)).toBe("rust");
		});

		it("detects Go from func/package", () => {
			const code = `package main\nfunc main() {\n    fmt.Println("hi")\n}`;
			expect(detectLanguage(code)).toBe("go");
		});

		it("detects Bash from fi/done", () => {
			const code = `if [ -f file ]; then\n    echo "yes"\nfi`;
			expect(detectLanguage(code)).toBe("bash");
		});

		it("detects CSS from selectors and properties", () => {
			const code = `.container {\n    margin: 0;\n    padding: 10px;\n}`;
			expect(detectLanguage(code)).toBe("css");
		});
	});

	describe("edge cases", () => {
		it("returns empty string for unrecognizable code", () => {
			expect(detectLanguage("hello world")).toBe("");
		});

		it("handles empty input", () => {
			expect(detectLanguage("")).toBe("");
		});
	});
});

// ─── highlightCodeLine() ─────────────────────────────────────────────────────

describe("highlightCodeLine", () => {
	describe("TypeScript highlighting", () => {
		it("highlights keywords", () => {
			const result = highlightCodeLine("const x = 5;", "typescript");
			expect(result).toContain(SYN.keyword);
		});

		it("highlights strings", () => {
			const result = highlightCodeLine('const s = "hello";', "ts");
			expect(result).toContain(SYN.string);
		});

		it("highlights numbers", () => {
			const result = highlightCodeLine("const n = 42;", "js");
			expect(result).toContain(SYN.number);
		});

		it("highlights comments", () => {
			const result = highlightCodeLine("// this is a comment", "ts");
			expect(result).toContain(SYN.comment);
		});

		it("highlights type keywords", () => {
			const result = highlightCodeLine("const x: string = '';", "ts");
			expect(result).toContain(SYN.type);
		});

		it("preserves visible text after highlighting", () => {
			const result = highlightCodeLine("const x = 42;", "ts");
			expect(stripAnsi(result)).toContain("const x = 42;");
		});
	});

	describe("Python highlighting", () => {
		it("highlights def keyword", () => {
			const result = highlightCodeLine("def greet():", "python");
			expect(result).toContain(SYN.keyword);
		});

		it("highlights decorators", () => {
			const result = highlightCodeLine("@staticmethod", "py");
			expect(result).toContain(SYN.decorator);
		});

		it("highlights comments", () => {
			const result = highlightCodeLine("# a comment", "python");
			expect(result).toContain(SYN.comment);
		});
	});

	describe("Rust highlighting", () => {
		it("highlights fn keyword", () => {
			const result = highlightCodeLine("fn main() {}", "rust");
			expect(result).toContain(SYN.keyword);
		});

		it("highlights macros", () => {
			const result = highlightCodeLine('println!("hello");', "rs");
			expect(result).toContain(SYN.macro);
		});
	});

	describe("Go highlighting", () => {
		it("highlights func keyword", () => {
			const result = highlightCodeLine("func main() {}", "go");
			expect(result).toContain(SYN.keyword);
		});
	});

	describe("Bash highlighting", () => {
		it("highlights variables", () => {
			const result = highlightCodeLine("echo $HOME", "bash");
			expect(result).toContain(SYN.variable);
		});

		it("highlights keywords", () => {
			const result = highlightCodeLine("if [ -f file ]; then", "sh");
			expect(result).toContain(SYN.keyword);
		});
	});

	describe("JSON highlighting", () => {
		it("highlights keys", () => {
			const result = highlightCodeLine('"name": "value"', "json");
			expect(result).toContain(SYN.key);
		});

		it("highlights boolean literals", () => {
			const result = highlightCodeLine('"active": true', "json");
			expect(result).toContain(SYN.boolean);
		});

		it("highlights null", () => {
			const result = highlightCodeLine('"data": null', "json");
			expect(result).toContain(SYN.null);
		});
	});

	describe("CSS highlighting", () => {
		it("highlights properties", () => {
			const result = highlightCodeLine("  margin: 10px;", "css");
			expect(result).toContain(SYN.property);
		});

		it("highlights selectors", () => {
			const result = highlightCodeLine(".container {", "css");
			expect(result).toContain(SYN.selector);
		});
	});

	describe("HTML highlighting", () => {
		it("highlights tags", () => {
			const result = highlightCodeLine("<div>hello</div>", "html");
			expect(result).toContain(SYN.tag);
		});

		it("highlights attributes", () => {
			const result = highlightCodeLine('<div class="foo">', "html");
			expect(result).toContain(SYN.attribute);
		});
	});

	describe("generic/fallback highlighting", () => {
		it("falls back to generic for unknown language", () => {
			const result = highlightCodeLine("x = 42", "brainfuck");
			expect(result).toContain(SYN.number);
		});

		it("handles empty line", () => {
			const result = highlightCodeLine("", "ts");
			expect(stripAnsi(result)).toBe("");
		});
	});

	describe("language alias resolution", () => {
		it("jsx maps to typescript highlighter", () => {
			const result = highlightCodeLine("const x = 5;", "jsx");
			expect(result).toContain(SYN.keyword);
		});

		it("scss maps to css highlighter", () => {
			const result = highlightCodeLine(".foo { margin: 0; }", "scss");
			expect(result).toContain(SYN.selector);
		});

		it("golang maps to go highlighter", () => {
			const result = highlightCodeLine("func main() {}", "golang");
			expect(result).toContain(SYN.keyword);
		});

		it("zsh maps to bash highlighter", () => {
			const result = highlightCodeLine("echo $HOME", "zsh");
			expect(result).toContain(SYN.variable);
		});
	});
});
