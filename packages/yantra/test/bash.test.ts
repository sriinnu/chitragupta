import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bashTool } from "../src/bash.js";
import type { ToolContext } from "../src/types.js";

// We do NOT mock child_process here -- we test the real tool with safe commands.
// For timeout and abort tests, we use lightweight commands.

const CTX: ToolContext = {
  sessionId: "s1",
  workingDirectory: "/tmp",
};

describe("bashTool", () => {
  it("should have the correct definition", () => {
    expect(bashTool.definition.name).toBe("bash");
    expect(bashTool.definition.inputSchema.required).toContain("command");
  });

  it("should return error when command is missing", async () => {
    const result = await bashTool.execute({}, CTX);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("'command' argument is required");
  });

  it("should execute a simple echo command", async () => {
    const result = await bashTool.execute({ command: "echo hello" }, CTX);
    expect(result.content).toContain("hello");
    expect(result.content).toContain("[Exit code: 0]");
    expect(result.isError).toBe(false);
  });

  it("should capture stderr in output", async () => {
    const result = await bashTool.execute({
      command: "echo error >&2",
    }, CTX);
    expect(result.content).toContain("error");
  });

  it("should report non-zero exit codes as errors", async () => {
    const result = await bashTool.execute({ command: "exit 1" }, CTX);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("[Exit code: 1]");
  });

  it("should respect the cwd argument", async () => {
    const result = await bashTool.execute({
      command: "pwd",
      cwd: "/tmp",
    }, CTX);
    expect(result.content).toContain("/tmp");
    expect(result.metadata?.cwd).toBe("/tmp");
  });

  it("should timeout and kill long-running commands", async () => {
    const result = await bashTool.execute({
      command: "sleep 60",
      timeout: 500, // 500ms timeout
    }, CTX);
    expect(result.content).toContain("timed out");
    expect(result.metadata?.timedOut).toBe(true);
  }, 10000);

  it("should handle invalid commands gracefully", async () => {
    const result = await bashTool.execute({
      command: "nonexistent_command_xyz_12345",
    }, CTX);
    // Should complete with non-zero exit code rather than crash
    expect(result.isError).toBe(true);
  });

  it("should handle abort signal", async () => {
    const abortController = new AbortController();
    const ctxWithSignal: ToolContext = {
      ...CTX,
      signal: abortController.signal,
    };
    // Start a long command and immediately abort
    const promise = bashTool.execute({ command: "sleep 60" }, ctxWithSignal);
    setTimeout(() => abortController.abort(), 100);
    const result = await promise;
    expect(result.content).toContain("aborted");
  }, 10000);
});
