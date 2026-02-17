/**
 * @chitragupta/smriti — Session Compaction Orchestrator.
 *
 * When a session ends, the compactor:
 *   1. Extracts signals: identity, projects, tasks, flow
 *   2. Builds a raw affinity matrix from signal counts
 *   3. Runs Sinkhorn-Knopp -> doubly stochastic mixing matrix
 *   4. Computes token budgets per stream
 *   5. Updates each stream .md file
 *   6. Writes the session as a compressed delta (NOT full transcript)
 *   7. Saves the mixing matrix for auditing
 *
 * Key principle: Sessions are compressed deltas, not full transcripts.
 * Only key points, decisions, artifacts, and tags survive compaction.
 */

import fs from "fs";
import path from "path";
import { getChitraguptaHome } from "@chitragupta/core";
import type {
  Session,
  StreamSignals,
  CompactionResult,
  SessionDelta,
} from "./types.js";
import { StreamManager, STREAM_ORDER } from "./streams.js";
import {
  buildAffinityMatrix,
  sinkhornKnopp,
  computeTokenBudgets,
} from "./sinkhorn-knopp.js";
import { RecallEngine } from "./recall.js";
import {
  OLLAMA_ENDPOINT,
  keywordExtractSignals,
  llmExtractSignals,
  extractDelta,
  writeDeltaMarkdown,
} from "./compactor-signals.js";

// ─── Compaction Storage ──────────────────────────────────────────────────────

function getCompactionDir(): string {
  return path.join(getChitraguptaHome(), "smriti", "compaction");
}

function getDeltaDir(): string {
  return path.join(getChitraguptaHome(), "smriti", "deltas");
}

// ─── Stream Update Logic ─────────────────────────────────────────────────────

function updateIdentityStream(streamManager: StreamManager, signals: StreamSignals): void {
  if (signals.identity.length === 0) return;
  const entry = signals.identity.map((s) => `- ${s}`).join("\n");
  streamManager.append("identity", entry);
}

function updateProjectsStream(streamManager: StreamManager, signals: StreamSignals, session: Session): void {
  if (signals.projects.length === 0) return;
  const parts: string[] = [];
  parts.push(`### Session: ${session.meta.title}`);
  parts.push("");
  for (const s of signals.projects) { parts.push(`- ${s}`); }
  streamManager.append("projects", parts.join("\n"));
}

function updateTasksStream(streamManager: StreamManager, signals: StreamSignals): void {
  if (signals.tasks.length === 0) return;

  const parts: string[] = [];
  const newTasks: string[] = [];
  const completed: string[] = [];
  const blocked: string[] = [];

  for (const s of signals.tasks) {
    if (/done|completed?|finished|resolved|closed|fixed|shipped/i.test(s)) {
      completed.push(s);
    } else if (/blocked|blocker|waiting|pending|depends/i.test(s)) {
      blocked.push(s);
    } else {
      newTasks.push(s);
    }
  }

  if (newTasks.length > 0) {
    parts.push("**New:**");
    for (const t of newTasks) { parts.push(`- [ ] ${t}`); }
  }
  if (completed.length > 0) {
    parts.push("**Completed:**");
    for (const t of completed) { parts.push(`- [x] ${t}`); }
  }
  if (blocked.length > 0) {
    parts.push("**Blocked:**");
    for (const t of blocked) { parts.push(`- [!] ${t}`); }
  }

  if (parts.length > 0) {
    streamManager.append("tasks", parts.join("\n"));
  }
}

function updateFlowStream(
  streamManager: StreamManager,
  signals: StreamSignals,
  session: Session,
  deviceId: string,
): void {
  const parts: string[] = [];

  parts.push(`## Current Context`);
  parts.push("");
  parts.push(`- Session: ${session.meta.title}`);
  parts.push(`- Project: ${session.meta.project}`);
  parts.push(`- Agent: ${session.meta.agent}`);
  parts.push(`- Model: ${session.meta.model}`);
  parts.push("");

  if (signals.flow.length > 0) {
    parts.push("## Active Threads");
    parts.push("");
    for (const s of signals.flow) { parts.push(`- ${s}`); }
    parts.push("");
  }

  const questions: string[] = [];
  for (const turn of session.turns) {
    if (turn.role === "user") {
      const qMatches = turn.content.match(/[^.!]*\?/g);
      if (qMatches) {
        for (const q of qMatches.slice(0, 5)) { questions.push(q.trim()); }
      }
    }
  }

  if (questions.length > 0) {
    parts.push("## Recent Questions");
    parts.push("");
    for (const q of questions.slice(0, 10)) { parts.push(`- ${q}`); }
  }

  streamManager.write("flow", parts.join("\n"), deviceId);
}

// ─── SessionCompactor ────────────────────────────────────────────────────────

/**
 * Orchestrates session compaction into the 4 memory streams.
 */
export class SessionCompactor {
  private streamManager: StreamManager;
  private recallEngine: RecallEngine;

  constructor() {
    this.streamManager = new StreamManager();
    this.recallEngine = new RecallEngine();
  }

  /**
   * Compact a session into the memory streams.
   */
  async compact(session: Session, deviceId?: string): Promise<CompactionResult> {
    const device = deviceId ?? "default";

    const signals = await this.extractSignals(session);
    const affinityMatrix = buildAffinityMatrix(signals);
    const { result: mixingMatrix, converged } = sinkhornKnopp(affinityMatrix);

    const currentTokens = this.streamManager.getAllTokenCounts(device);
    const totalCurrentTokens = Object.values(currentTokens).reduce((a, b) => a + b, 0);
    const newContentTokens = signals.identity.length * 50
      + signals.projects.length * 100
      + signals.tasks.length * 50
      + signals.flow.length * 30;
    const totalBudget = Math.max(totalCurrentTokens + newContentTokens, 4000);
    const tokenBudgets = computeTokenBudgets(mixingMatrix, totalBudget);

    updateIdentityStream(this.streamManager, signals);
    updateProjectsStream(this.streamManager, signals, session);
    updateTasksStream(this.streamManager, signals);
    updateFlowStream(this.streamManager, signals, session, device);

    for (let i = 0; i < STREAM_ORDER.length; i++) {
      const streamType = STREAM_ORDER[i];
      const budget = tokenBudgets[i];
      if (streamType === "flow") {
        this.streamManager.enforcePreservation(streamType, budget, device);
      } else {
        this.streamManager.enforcePreservation(streamType, budget);
      }
    }

    const delta = extractDelta(session, signals);
    this.saveDelta(delta);
    this.saveMixingMatrix(session.meta.id, mixingMatrix, signals);
    await this.recallEngine.indexSession(session);

    for (const streamType of STREAM_ORDER) {
      if (streamType === "flow") {
        const content = this.streamManager.readContent("flow", device);
        if (content) {
          await this.recallEngine.indexStream("flow", content, device);
        }
      } else {
        const signalList = signals[streamType];
        if (signalList.length > 0) {
          const content = this.streamManager.readContent(streamType);
          if (content) {
            await this.recallEngine.indexStream(streamType, content);
          }
        }
      }
    }

    return {
      sessionId: session.meta.id,
      timestamp: new Date().toISOString(),
      mixingMatrix,
      tokenBudgets,
      signalCounts: {
        identity: signals.identity.length,
        projects: signals.projects.length,
        tasks: signals.tasks.length,
        flow: signals.flow.length,
      },
      delta,
      converged,
    };
  }

  /**
   * Extract signals from a session.
   */
  async extractSignals(session: Session): Promise<StreamSignals> {
    let ollamaAvailable = false;
    try {
      const response = await fetch(`${OLLAMA_ENDPOINT}/api/version`, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });
      ollamaAvailable = response.ok;
    } catch {
      ollamaAvailable = false;
    }

    if (ollamaAvailable) {
      return llmExtractSignals(session);
    }

    return keywordExtractSignals(session);
  }

  // ─── Persistence ─────────────────────────────────────────────────

  private saveDelta(delta: SessionDelta): void {
    try {
      const dir = getDeltaDir();
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `${delta.sessionId}.md`);
      const markdown = writeDeltaMarkdown(delta);
      fs.writeFileSync(filePath, markdown, "utf-8");
    } catch {
      // Delta save is non-fatal
    }
  }

  private saveMixingMatrix(
    sessionId: string,
    mixingMatrix: number[][],
    signals: StreamSignals,
  ): void {
    try {
      const dir = getCompactionDir();
      fs.mkdirSync(dir, { recursive: true });

      const data = {
        sessionId,
        timestamp: new Date().toISOString(),
        streams: STREAM_ORDER,
        mixingMatrix,
        signalCounts: {
          identity: signals.identity.length,
          projects: signals.projects.length,
          tasks: signals.tasks.length,
          flow: signals.flow.length,
        },
        signals: {
          identity: signals.identity.slice(0, 10),
          projects: signals.projects.slice(0, 10),
          tasks: signals.tasks.slice(0, 10),
          flow: signals.flow.slice(0, 10),
        },
      };

      const filePath = path.join(dir, `${sessionId}.json`);
      fs.writeFileSync(filePath, JSON.stringify(data, null, "\t"), "utf-8");
    } catch {
      // Compaction audit save is non-fatal
    }
  }
}
