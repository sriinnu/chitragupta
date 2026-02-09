import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildSystemPrompt, buildWelcomeMessage } from "../src/personality.js";
import type { SystemPromptOptions } from "../src/personality.js";
import type { ProjectInfo } from "../src/project-detector.js";

/** Minimal mock of AgentProfile for testing. */
function mockProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: "chitragupta",
    name: "Chitragupta",
    personality: "You are a helpful coding assistant.",
    expertise: ["typescript", "testing"],
    preferredModel: "claude-sonnet-4-5-20250929",
    ...overrides,
  } as any;
}

describe("buildSystemPrompt", () => {
  it("should include the profile personality", () => {
    const prompt = buildSystemPrompt({
      profile: mockProfile(),
    });

    expect(prompt).toContain("You are a helpful coding assistant.");
  });

  it("should include expertise areas", () => {
    const prompt = buildSystemPrompt({
      profile: mockProfile({ expertise: ["typescript", "rust", "devops"] }),
    });

    expect(prompt).toContain("typescript");
    expect(prompt).toContain("rust");
    expect(prompt).toContain("devops");
    expect(prompt).toContain("expertise");
  });

  it("should not include expertise when empty", () => {
    const prompt = buildSystemPrompt({
      profile: mockProfile({ expertise: [] }),
    });

    expect(prompt).not.toContain("Your areas of expertise");
  });

  it("should include project context when project is known", () => {
    const project: ProjectInfo = {
      type: "typescript",
      name: "my-app",
      framework: "next.js",
      packageManager: "pnpm",
      path: "/home/user/my-app",
    };

    const prompt = buildSystemPrompt({
      profile: mockProfile(),
      project,
    });

    expect(prompt).toContain("typescript");
    expect(prompt).toContain("my-app");
    expect(prompt).toContain("next.js");
    expect(prompt).toContain("pnpm");
    expect(prompt).toContain("Project Context");
  });

  it("should not include project context when type is 'unknown'", () => {
    const project: ProjectInfo = {
      type: "unknown",
      path: "/tmp",
    };

    const prompt = buildSystemPrompt({
      profile: mockProfile(),
      project,
    });

    expect(prompt).not.toContain("Project Context");
  });

  it("should use system override when provided", () => {
    const prompt = buildSystemPrompt({
      profile: mockProfile(),
      contextFiles: {
        systemOverride: "You are a custom agent with special instructions.",
      },
    });

    // System override replaces personality
    expect(prompt).toContain("You are a custom agent with special instructions.");
    expect(prompt).not.toContain("You are a helpful coding assistant.");
  });

  it("should include project instructions from CHITRAGUPTA.md", () => {
    const prompt = buildSystemPrompt({
      profile: mockProfile(),
      contextFiles: {
        projectInstructions: "Always use functional programming patterns.",
      },
    });

    expect(prompt).toContain("Project Instructions");
    expect(prompt).toContain("Always use functional programming patterns.");
  });

  it("should include append instructions", () => {
    const prompt = buildSystemPrompt({
      profile: mockProfile(),
      contextFiles: {
        appendInstructions: "Never use var, always use const or let.",
      },
    });

    expect(prompt).toContain("Never use var, always use const or let.");
  });

  it("should include memory context", () => {
    const prompt = buildSystemPrompt({
      profile: mockProfile(),
      memoryContext: "The user prefers tabs over spaces.",
    });

    expect(prompt).toContain("Project Memory");
    expect(prompt).toContain("The user prefers tabs over spaces.");
  });

  it("should not include memory when empty", () => {
    const prompt = buildSystemPrompt({
      profile: mockProfile(),
      memoryContext: "",
    });

    expect(prompt).not.toContain("Project Memory");
  });

  it("should include tool descriptions", () => {
    const tools = [
      {
        definition: {
          name: "read_file",
          description: "Read a file from disk",
          inputSchema: {},
        },
        execute: vi.fn(),
      },
      {
        definition: {
          name: "write_file",
          description: "Write content to a file",
          inputSchema: {},
        },
        execute: vi.fn(),
      },
    ] as any;

    const prompt = buildSystemPrompt({
      profile: mockProfile(),
      tools,
    });

    expect(prompt).toContain("Available Tools");
    expect(prompt).toContain("read_file");
    expect(prompt).toContain("write_file");
    expect(prompt).toContain("Read a file from disk");
  });

  it("should include environment info", () => {
    const prompt = buildSystemPrompt({
      profile: mockProfile(),
    });

    expect(prompt).toContain("Environment");
    expect(prompt).toContain("Working directory");
    expect(prompt).toContain("Platform");
    expect(prompt).toContain("Date");
  });
});

describe("buildWelcomeMessage", () => {
  it("should include the agent name", () => {
    const msg = buildWelcomeMessage(mockProfile());
    expect(msg).toContain("Chitragupta");
    expect(msg).toContain("ready");
  });

  it("should include project info when available", () => {
    const project: ProjectInfo = {
      type: "typescript",
      name: "my-app",
      framework: "next.js",
      path: "/home/user/my-app",
    };

    const msg = buildWelcomeMessage(mockProfile(), project);
    expect(msg).toContain("next.js");
    expect(msg).toContain("my-app");
    expect(msg).toContain("Project");
  });

  it("should not include project section when type is 'unknown'", () => {
    const project: ProjectInfo = {
      type: "unknown",
      path: "/tmp",
    };

    const msg = buildWelcomeMessage(mockProfile(), project);
    expect(msg).not.toContain("Project:");
  });

  it("should include help hint", () => {
    const msg = buildWelcomeMessage(mockProfile());
    expect(msg).toContain("/help");
  });

  it("should include project type without framework", () => {
    const project: ProjectInfo = {
      type: "python",
      path: "/home/user/py-project",
    };

    const msg = buildWelcomeMessage(mockProfile(), project);
    expect(msg).toContain("python");
  });
});
