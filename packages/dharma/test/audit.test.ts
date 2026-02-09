import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";

// Mock @chitragupta/core before importing
vi.mock("@chitragupta/core", () => ({
  getChitraguptaHome: () => "/tmp/mock-chitragupta-home",
}));

import { AuditLogger } from "../src/audit.js";
import type { AuditEntry, PolicyAction, PolicyVerdict } from "../src/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: Date.now(),
    sessionId: "sess-1",
    agentId: "agent-1",
    action: { type: "file_read", filePath: "/tmp/project/src/main.ts" },
    verdicts: [{ status: "allow", ruleId: "test-rule", reason: "Allowed" }],
    finalDecision: "allow",
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("AuditLogger", () => {
  const testAuditDir = path.join("/tmp", `chitragupta-audit-test-${Date.now()}`);
  let logger: AuditLogger;

  beforeEach(() => {
    logger = new AuditLogger(testAuditDir);
  });

  afterEach(() => {
    // Clean up test directory
    try {
      fs.rmSync(testAuditDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // ─── Writing ──────────────────────────────────────────────────────────

  describe("write()", () => {
    it("should create audit directory and write a JSONL entry", () => {
      const entry = makeEntry();
      logger.write(entry);

      const auditPath = path.join(testAuditDir, "audit.jsonl");
      expect(fs.existsSync(auditPath)).toBe(true);

      const content = fs.readFileSync(auditPath, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(1);

      const parsed = JSON.parse(lines[0]);
      expect(parsed.sessionId).toBe("sess-1");
      expect(parsed.agentId).toBe("agent-1");
    });

    it("should append multiple entries to the same file", () => {
      logger.write(makeEntry({ sessionId: "s1" }));
      logger.write(makeEntry({ sessionId: "s2" }));
      logger.write(makeEntry({ sessionId: "s3" }));

      const auditPath = path.join(testAuditDir, "audit.jsonl");
      const content = fs.readFileSync(auditPath, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(3);
    });

    it("should write entries in valid JSON format", () => {
      const entry = makeEntry({
        action: { type: "shell_exec", command: 'echo "hello world"' },
        verdicts: [
          { status: "deny", ruleId: "rule-1", reason: "blocked" },
          { status: "warn", ruleId: "rule-2", reason: "suspicious" },
        ],
        finalDecision: "deny",
      });

      logger.write(entry);

      const auditPath = path.join(testAuditDir, "audit.jsonl");
      const content = fs.readFileSync(auditPath, "utf-8");
      const parsed = JSON.parse(content.trim());
      expect(parsed.finalDecision).toBe("deny");
      expect(parsed.verdicts).toHaveLength(2);
    });
  });

  // ─── Batch Writing ────────────────────────────────────────────────────

  describe("writeBatch()", () => {
    it("should write multiple entries at once", () => {
      const entries = [
        makeEntry({ sessionId: "s1" }),
        makeEntry({ sessionId: "s2" }),
        makeEntry({ sessionId: "s3" }),
      ];

      logger.writeBatch(entries);

      const auditPath = path.join(testAuditDir, "audit.jsonl");
      const content = fs.readFileSync(auditPath, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(3);
    });

    it("should do nothing for empty batch", () => {
      logger.writeBatch([]);
      const auditPath = path.join(testAuditDir, "audit.jsonl");
      expect(fs.existsSync(auditPath)).toBe(false);
    });
  });

  // ─── Querying ─────────────────────────────────────────────────────────

  describe("query()", () => {
    beforeEach(() => {
      const now = Date.now();
      const entries: AuditEntry[] = [
        makeEntry({ timestamp: now - 5000, sessionId: "s1", agentId: "agent-a", finalDecision: "allow", action: { type: "file_read" } }),
        makeEntry({ timestamp: now - 3000, sessionId: "s1", agentId: "agent-a", finalDecision: "deny", action: { type: "shell_exec", command: "rm -rf /" } }),
        makeEntry({ timestamp: now - 1000, sessionId: "s2", agentId: "agent-b", finalDecision: "warn", action: { type: "llm_call" } }),
        makeEntry({ timestamp: now, sessionId: "s2", agentId: "agent-b", finalDecision: "allow", action: { type: "file_write", filePath: "/tmp/test.ts" } }),
      ];
      logger.writeBatch(entries);
    });

    it("should return all entries with no filters", () => {
      const results = logger.query();
      expect(results).toHaveLength(4);
    });

    it("should filter by sessionId", () => {
      const results = logger.query({ sessionId: "s1" });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.sessionId === "s1")).toBe(true);
    });

    it("should filter by agentId", () => {
      const results = logger.query({ agentId: "agent-b" });
      expect(results).toHaveLength(2);
    });

    it("should filter by actionType", () => {
      const results = logger.query({ actionType: "file_read" });
      expect(results).toHaveLength(1);
    });

    it("should filter by decision", () => {
      const results = logger.query({ decision: "deny" });
      expect(results).toHaveLength(1);
      expect(results[0].finalDecision).toBe("deny");
    });

    it("should filter by time range", () => {
      const now = Date.now();
      const results = logger.query({
        startTime: now - 4000,
        endTime: now - 500,
      });
      // Should include entries at now-3000 and now-1000
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it("should return empty array when no file exists", () => {
      const freshLogger = new AuditLogger(path.join("/tmp", `nonexistent-${Date.now()}`));
      const results = freshLogger.query();
      expect(results).toEqual([]);
    });
  });

  // ─── Summary ──────────────────────────────────────────────────────────

  describe("summary()", () => {
    it("should return a human-readable summary for a session", () => {
      const now = Date.now();
      logger.writeBatch([
        makeEntry({ timestamp: now - 2000, sessionId: "s1", finalDecision: "allow", action: { type: "file_read" } }),
        makeEntry({
          timestamp: now - 1000,
          sessionId: "s1",
          finalDecision: "deny",
          action: { type: "shell_exec", command: "rm -rf /" },
          verdicts: [{ status: "deny", ruleId: "security.no-destructive-commands", reason: "Blocked" }],
        }),
        makeEntry({ timestamp: now, sessionId: "s1", finalDecision: "allow", action: { type: "file_write", filePath: "/tmp/test.ts" } }),
      ]);

      const summary = logger.summary("s1");
      expect(summary).toContain("Audit Summary for Session: s1");
      expect(summary).toContain("Total evaluations: 3");
      expect(summary).toContain("Allowed: 2");
      expect(summary).toContain("Denied:  1");
      expect(summary).toContain("Actions by type:");
      expect(summary).toContain("Denied actions:");
    });

    it("should return a message when no entries found for session", () => {
      const summary = logger.summary("nonexistent");
      expect(summary).toContain("No audit entries found");
    });
  });

  // ─── Export Report ────────────────────────────────────────────────────

  describe("exportReport()", () => {
    beforeEach(() => {
      logger.writeBatch([
        makeEntry({ finalDecision: "allow", action: { type: "file_read" } }),
        makeEntry({
          finalDecision: "deny",
          agentId: "agent-x",
          action: { type: "shell_exec", command: "rm -rf /" },
          verdicts: [{ status: "deny", ruleId: "r1", reason: "Blocked" }],
        }),
        makeEntry({
          finalDecision: "warn",
          action: { type: "llm_call" },
          verdicts: [{ status: "warn", ruleId: "r2", reason: "Budget warning" }],
        }),
      ]);
    });

    it("should export JSON format as valid JSON array", () => {
      const report = logger.exportReport("json");
      const parsed = JSON.parse(report);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(3);
    });

    it("should export markdown format with headers and summary table", () => {
      const report = logger.exportReport("markdown");
      expect(report).toContain("# Audit Report");
      expect(report).toContain("## Summary");
      expect(report).toContain("| Decision | Count |");
      expect(report).toContain("Allow");
      expect(report).toContain("Deny");
      expect(report).toContain("Warn");
    });

    it("should include denied actions section in markdown", () => {
      const report = logger.exportReport("markdown");
      expect(report).toContain("## Denied Actions");
      expect(report).toContain("agent-x");
    });

    it("should include warnings section in markdown", () => {
      const report = logger.exportReport("markdown");
      expect(report).toContain("## Warnings");
      expect(report).toContain("Budget warning");
    });

    it("should respect query filters in export", () => {
      const report = logger.exportReport("json", { decision: "deny" });
      const parsed = JSON.parse(report);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].finalDecision).toBe("deny");
    });
  });
});
