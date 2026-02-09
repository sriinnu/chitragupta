import { describe, it, expect } from "vitest";
import { parseSessionMarkdown, writeSessionMarkdown, writeTurnMarkdown } from "@chitragupta/smriti";
import type { Session, SessionMeta, SessionTurn } from "@chitragupta/smriti";

const sampleMeta: SessionMeta = {
  id: "s-test-001",
  title: "Test Session",
  created: "2025-01-15T10:00:00.000Z",
  updated: "2025-01-15T10:30:00.000Z",
  agent: "chitragupta",
  model: "claude-sonnet-4-5-20250929",
  project: "/home/user/myproject",
  parent: null,
  branch: null,
  tags: ["test", "demo"],
  totalCost: 0.0523,
  totalTokens: 1500,
};

const sampleTurns: SessionTurn[] = [
  {
    turnNumber: 1,
    role: "user",
    content: "Hello, how are you?",
  },
  {
    turnNumber: 2,
    role: "assistant",
    content: "I'm doing well! How can I help you today?",
    agent: "chitragupta",
    model: "claude-sonnet-4-5-20250929",
  },
];

const sampleSession: Session = {
  meta: sampleMeta,
  turns: sampleTurns,
};

describe("parseSessionMarkdown", () => {
  it("should parse a simple session with frontmatter and turns", () => {
    const md = `---
id: s-test-001
title: "Test Session"
created: 2025-01-15T10:00:00.000Z
updated: 2025-01-15T10:30:00.000Z
agent: chitragupta
model: claude-sonnet-4-5-20250929
project: /home/user/myproject
parent: null
branch: null
tags:
  - test
  - demo
totalCost: 0.0523
totalTokens: 1500
---

## Turn 1 — user

Hello, how are you?

## Turn 2 — assistant (agent: chitragupta, model: claude-sonnet-4-5-20250929)

I'm doing well! How can I help you today?`;

    const session = parseSessionMarkdown(md);

    expect(session.meta.id).toBe("s-test-001");
    expect(session.meta.title).toBe("Test Session");
    expect(session.meta.agent).toBe("chitragupta");
    expect(session.meta.project).toBe("/home/user/myproject");
    expect(session.meta.parent).toBeNull();
    expect(session.meta.branch).toBeNull();
    expect(session.meta.tags).toEqual(["test", "demo"]);
    expect(session.meta.totalCost).toBeCloseTo(0.0523, 4);
    expect(session.meta.totalTokens).toBe(1500);

    expect(session.turns).toHaveLength(2);
    expect(session.turns[0].role).toBe("user");
    expect(session.turns[0].content).toBe("Hello, how are you?");
    expect(session.turns[1].role).toBe("assistant");
    expect(session.turns[1].agent).toBe("chitragupta");
    expect(session.turns[1].model).toBe("claude-sonnet-4-5-20250929");
  });

  it("should parse a session with tool calls", () => {
    const md = `---
id: s-test-002
title: Tool Session
created: 2025-01-15T10:00:00.000Z
updated: 2025-01-15T10:30:00.000Z
agent: chitragupta
model: claude-sonnet-4-5-20250929
project: /test
parent: null
branch: null
tags: []
totalCost: 0
totalTokens: 0
---

## Turn 1 — user

Read the file

## Turn 2 — assistant

Let me read that file for you.

### Tool: read_file

**Input:**
\`\`\`json
{"path": "/foo/bar.ts"}
\`\`\`

<details>
<summary>Result</summary>

\`\`\`
export function hello() {}
\`\`\`

</details>`;

    const session = parseSessionMarkdown(md);

    expect(session.turns).toHaveLength(2);
    const assistantTurn = session.turns[1];
    expect(assistantTurn.content).toBe("Let me read that file for you.");
    expect(assistantTurn.toolCalls).toHaveLength(1);
    expect(assistantTurn.toolCalls![0].name).toBe("read_file");
    expect(assistantTurn.toolCalls![0].input).toContain("/foo/bar.ts");
    expect(assistantTurn.toolCalls![0].result).toContain("export function hello()");
    expect(assistantTurn.toolCalls![0].isError).toBeUndefined();
  });

  it("should parse tool calls with error results", () => {
    const md = `---
id: s-test-003
title: Error Session
created: 2025-01-15T10:00:00.000Z
updated: 2025-01-15T10:30:00.000Z
agent: chitragupta
model: test
project: /test
parent: null
branch: null
tags: []
totalCost: 0
totalTokens: 0
---

## Turn 1 — assistant

Trying to run something.

### Tool: run_command

**Input:**
\`\`\`json
{"command": "rm -rf /"}
\`\`\`

<details>
<summary>Error</summary>

\`\`\`
Permission denied
\`\`\`

</details>`;

    const session = parseSessionMarkdown(md);
    expect(session.turns[0].toolCalls![0].isError).toBe(true);
    expect(session.turns[0].toolCalls![0].result).toContain("Permission denied");
  });

  it("should throw on empty input", () => {
    expect(() => parseSessionMarkdown("")).toThrow("Cannot parse empty");
  });

  it("should throw on missing frontmatter", () => {
    expect(() => parseSessionMarkdown("No frontmatter here")).toThrow("missing YAML frontmatter");
  });

  it("should parse inline array tags", () => {
    const md = `---
id: inline-tags
title: Inline
created: 2025-01-01T00:00:00.000Z
updated: 2025-01-01T00:00:00.000Z
agent: chitragupta
model: test
project: /test
parent: null
branch: null
tags: [typescript, react]
totalCost: 0
totalTokens: 0
---`;

    const session = parseSessionMarkdown(md);
    expect(session.meta.tags).toEqual(["typescript", "react"]);
  });

  it("should parse empty tags array", () => {
    const md = `---
id: empty-tags
title: Empty
created: 2025-01-01T00:00:00.000Z
updated: 2025-01-01T00:00:00.000Z
agent: chitragupta
model: test
project: /test
parent: null
branch: null
tags: []
totalCost: 0
totalTokens: 0
---`;

    const session = parseSessionMarkdown(md);
    expect(session.meta.tags).toEqual([]);
  });

  it("should handle sessions with no turns", () => {
    const md = `---
id: no-turns
title: Empty session
created: 2025-01-01T00:00:00.000Z
updated: 2025-01-01T00:00:00.000Z
agent: chitragupta
model: test
project: /test
parent: null
branch: null
tags: []
totalCost: 0
totalTokens: 0
---`;

    const session = parseSessionMarkdown(md);
    expect(session.turns).toHaveLength(0);
  });
});

describe("writeSessionMarkdown", () => {
  it("should produce valid markdown with frontmatter", () => {
    const md = writeSessionMarkdown(sampleSession);

    expect(md).toContain("---");
    expect(md).toContain("id: s-test-001");
    expect(md).toContain('title: "Test Session"');
    expect(md).toContain("agent: chitragupta");
    expect(md).toContain("project: /home/user/myproject");
    expect(md).toContain("parent: null");
    expect(md).toContain("  - test");
    expect(md).toContain("  - demo");
    expect(md).toContain("totalCost: 0.0523");
    expect(md).toContain("totalTokens: 1500");
  });

  it("should write turn sections with correct headings", () => {
    const md = writeSessionMarkdown(sampleSession);

    expect(md).toContain("## Turn 1 — user");
    expect(md).toContain("## Turn 2 — assistant (agent: chitragupta, model: claude-sonnet-4-5-20250929)");
    expect(md).toContain("Hello, how are you?");
    expect(md).toContain("I'm doing well! How can I help you today?");
  });

  it("should write tool calls with collapsible details", () => {
    const session: Session = {
      meta: { ...sampleMeta, id: "tool-session" },
      turns: [
        {
          turnNumber: 1,
          role: "assistant",
          content: "Reading file...",
          toolCalls: [
            {
              name: "read_file",
              input: '{"path": "/test.ts"}',
              result: "export const x = 1;",
            },
          ],
        },
      ],
    };

    const md = writeSessionMarkdown(session);
    expect(md).toContain("### Tool: read_file");
    expect(md).toContain("**Input:**");
    expect(md).toContain('{"path": "/test.ts"}');
    expect(md).toContain("<details>");
    expect(md).toContain("<summary>Result</summary>");
    expect(md).toContain("export const x = 1;");
    expect(md).toContain("</details>");
  });

  it("should write error tool calls with Error summary", () => {
    const session: Session = {
      meta: { ...sampleMeta, id: "error-session" },
      turns: [
        {
          turnNumber: 1,
          role: "assistant",
          content: "Trying...",
          toolCalls: [
            {
              name: "run",
              input: "{}",
              result: "ENOENT",
              isError: true,
            },
          ],
        },
      ],
    };

    const md = writeSessionMarkdown(session);
    expect(md).toContain("<summary>Error</summary>");
  });

  it("should include a footer with session metadata", () => {
    const md = writeSessionMarkdown(sampleSession);
    expect(md).toContain(`*Session ${sampleMeta.id}`);
    expect(md).toContain(sampleMeta.agent);
    expect(md).toContain("$0.0523");
    expect(md).toContain("1500");
  });

  it("should write empty tags as []", () => {
    const session: Session = {
      meta: { ...sampleMeta, tags: [] },
      turns: [],
    };
    const md = writeSessionMarkdown(session);
    expect(md).toContain("tags: []");
  });
});

describe("writeTurnMarkdown", () => {
  it("should write a single turn as markdown", () => {
    const turn: SessionTurn = {
      turnNumber: 5,
      role: "user",
      content: "What is TypeScript?",
    };
    const md = writeTurnMarkdown(turn);
    expect(md).toContain("## Turn 5 — user");
    expect(md).toContain("What is TypeScript?");
  });
});

describe("roundtrip (write -> parse)", () => {
  it("should preserve session metadata through roundtrip", () => {
    const md = writeSessionMarkdown(sampleSession);
    const parsed = parseSessionMarkdown(md);

    expect(parsed.meta.id).toBe(sampleMeta.id);
    expect(parsed.meta.title).toBe(sampleMeta.title);
    expect(parsed.meta.agent).toBe(sampleMeta.agent);
    expect(parsed.meta.model).toBe(sampleMeta.model);
    expect(parsed.meta.project).toBe(sampleMeta.project);
    expect(parsed.meta.tags).toEqual(sampleMeta.tags);
    expect(parsed.meta.totalTokens).toBe(sampleMeta.totalTokens);
  });

  it("should preserve turn content through roundtrip", () => {
    const md = writeSessionMarkdown(sampleSession);
    const parsed = parseSessionMarkdown(md);

    expect(parsed.turns).toHaveLength(2);
    expect(parsed.turns[0].role).toBe("user");
    expect(parsed.turns[0].content).toBe("Hello, how are you?");
    expect(parsed.turns[1].role).toBe("assistant");
  });

  it("should preserve tool calls through roundtrip", () => {
    const session: Session = {
      meta: sampleMeta,
      turns: [
        {
          turnNumber: 1,
          role: "assistant",
          content: "Let me check.",
          toolCalls: [
            {
              name: "read_file",
              input: '{"path": "/test.ts"}',
              result: "const x = 1;",
            },
          ],
        },
      ],
    };

    const md = writeSessionMarkdown(session);
    const parsed = parseSessionMarkdown(md);

    expect(parsed.turns[0].toolCalls).toHaveLength(1);
    expect(parsed.turns[0].toolCalls![0].name).toBe("read_file");
    expect(parsed.turns[0].toolCalls![0].input).toContain("/test.ts");
    expect(parsed.turns[0].toolCalls![0].result).toContain("const x = 1;");
  });
});
