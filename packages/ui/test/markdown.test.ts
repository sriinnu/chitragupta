import { describe, it, expect } from "vitest";
import { renderMarkdown, detectLanguage } from "../src/components/markdown.js";
import { stripAnsi } from "../src/ansi.js";

describe("renderMarkdown", () => {
  it("should render plain text as paragraph", () => {
    const result = renderMarkdown("Hello world", 80);
    const plain = stripAnsi(result);
    expect(plain).toContain("Hello world");
  });

  it("should render h1 headings", () => {
    const result = renderMarkdown("# My Title", 80);
    const plain = stripAnsi(result);
    expect(plain).toContain("My Title");
  });

  it("should render h2 headings", () => {
    const result = renderMarkdown("## Section", 80);
    const plain = stripAnsi(result);
    expect(plain).toContain("Section");
  });

  it("should render h3+ headings", () => {
    const result = renderMarkdown("### Subsection", 80);
    const plain = stripAnsi(result);
    expect(plain).toContain("Subsection");
  });

  it("should render bold text", () => {
    const result = renderMarkdown("This is **bold** text", 80);
    // Bold adds ANSI escape codes
    expect(result).toContain("bold");
    // Should contain the bold ANSI sequence
    expect(result).toContain("\x1b[1m");
  });

  it("should render italic text", () => {
    const result = renderMarkdown("This is *italic* text", 80);
    expect(result).toContain("\x1b[3m");
    expect(result).toContain("italic");
  });

  it("should render inline code", () => {
    const result = renderMarkdown("Use `console.log()` here", 80);
    const plain = stripAnsi(result);
    expect(plain).toContain("console.log()");
  });

  it("should render code blocks with syntax highlighting", () => {
    const md = "```typescript\nconst x = 1;\n```";
    const result = renderMarkdown(md, 80);
    const plain = stripAnsi(result);
    expect(plain).toContain("const x = 1;");
    expect(plain).toContain("typescript");
  });

  it("should render code blocks without language", () => {
    const md = "```\nsome code\n```";
    const result = renderMarkdown(md, 80);
    const plain = stripAnsi(result);
    expect(plain).toContain("some code");
  });

  it("should render unordered lists", () => {
    const md = "- item 1\n- item 2\n- item 3";
    const result = renderMarkdown(md, 80);
    const plain = stripAnsi(result);
    expect(plain).toContain("item 1");
    expect(plain).toContain("item 2");
    expect(plain).toContain("item 3");
  });

  it("should render ordered lists", () => {
    const md = "1. first\n2. second\n3. third";
    const result = renderMarkdown(md, 80);
    const plain = stripAnsi(result);
    expect(plain).toContain("first");
    expect(plain).toContain("second");
    expect(plain).toContain("third");
  });

  it("should render blockquotes", () => {
    const md = "> This is a quote";
    const result = renderMarkdown(md, 80);
    const plain = stripAnsi(result);
    expect(plain).toContain("This is a quote");
  });

  it("should render horizontal rules", () => {
    const md = "---";
    const result = renderMarkdown(md, 80);
    // Should contain horizontal line characters
    expect(result).toContain("\u2500");
  });

  it("should render links", () => {
    const md = "Check out [Chitragupta](https://example.com)";
    const result = renderMarkdown(md, 80);
    const plain = stripAnsi(result);
    expect(plain).toContain("Chitragupta");
    expect(plain).toContain("https://example.com");
  });

  it("should render tables", () => {
    const md = "| Name | Value |\n| --- | --- |\n| foo | 1 |\n| bar | 2 |";
    const result = renderMarkdown(md, 80);
    const plain = stripAnsi(result);
    expect(plain).toContain("Name");
    expect(plain).toContain("Value");
    expect(plain).toContain("foo");
    expect(plain).toContain("bar");
  });

  it("should handle empty input", () => {
    const result = renderMarkdown("", 80);
    expect(result).toBe("");
  });

  it("should handle very narrow width", () => {
    const result = renderMarkdown("Hello world, this is a long paragraph that should wrap.", 30);
    // Should not crash and should contain the text
    const plain = stripAnsi(result);
    expect(plain).toContain("Hello");
  });
});

describe("detectLanguage", () => {
  it("should detect TypeScript from interface keyword", () => {
    const code = "interface Foo {\n  bar: string;\n}";
    expect(detectLanguage(code)).toBe("typescript");
  });

  it("should detect TypeScript from const/let with types", () => {
    const code = 'const x: string = "hello";\nexport function foo(): void {}';
    expect(detectLanguage(code)).toBe("typescript");
  });

  it("should detect Python from def keyword", () => {
    const code = "def hello():\n    print('world')";
    expect(detectLanguage(code)).toBe("python");
  });

  it("should detect Python from from...import", () => {
    const code = "from os import path\nimport sys";
    expect(detectLanguage(code)).toBe("python");
  });

  it("should detect Rust from fn keyword", () => {
    const code = "fn main() {\n    println!(\"hello\");\n}";
    expect(detectLanguage(code)).toBe("rust");
  });

  it("should detect Go from func and package", () => {
    const code = 'package main\n\nfunc main() {\n    fmt.Println("hello")\n}';
    expect(detectLanguage(code)).toBe("go");
  });

  it("should detect Bash from fi/done keywords", () => {
    const code = "if [ -f /tmp/foo ]; then\n    echo found\nfi";
    expect(detectLanguage(code)).toBe("bash");
  });

  it("should detect JSON", () => {
    const code = '{"key": "value", "num": 42}';
    expect(detectLanguage(code)).toBe("json");
  });

  it("should detect HTML", () => {
    const code = "<!DOCTYPE html>\n<html><head></head><body></body></html>";
    expect(detectLanguage(code)).toBe("html");
  });

  it("should detect CSS", () => {
    const code = ".container {\n  display: flex;\n  margin: 10px;\n}";
    expect(detectLanguage(code)).toBe("css");
  });

  it("should detect from shebang", () => {
    expect(detectLanguage("#!/usr/bin/env python3\nprint('hi')")).toBe("python");
    expect(detectLanguage("#!/bin/bash\necho hello")).toBe("bash");
    expect(detectLanguage("#!/usr/bin/env node\nconsole.log()")).toBe("typescript");
  });

  it("should return empty string for unrecognizable code", () => {
    expect(detectLanguage("random gibberish 12345")).toBe("");
  });
});
