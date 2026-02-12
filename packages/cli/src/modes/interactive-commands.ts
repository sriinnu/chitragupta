/**
 * @chitragupta/cli — Interactive mode slash command handling.
 *
 * Handles all slash commands: /help, /model, /thinking, /compact,
 * /memory, /clear, /status, /agents, /delegate, /code, /review,
 * /debug, /research, /refactor, /docs, /cost, /diff, /mcp,
 * /branch, /tree, /vasana, /nidra, /vidhi, /pratyabhijna,
 * /turiya, /health, /rta, /buddhi, /samiti, /sabha, /lokapala,
 * /akasha, /kartavya, /kala, /atman, /workflow, /quit.
 */

import type { Agent, AgentMessage } from "@chitragupta/anina";
import type { ThinkingLevel } from "@chitragupta/core";
import {
  bold,
  dim,
  gray,
  green,
  cyan,
  yellow,
  red,
  magenta,
  clearScreen,
} from "@chitragupta/ui/ansi";
import type { SessionStats } from "./interactive-render.js";

// ─── Slash command registry for tab completion ──────────────────────────────

export const SLASH_COMMANDS: Array<{ name: string; description: string }> = [
  { name: "/help", description: "Show this help" },
  { name: "/model", description: "Switch model" },
  { name: "/thinking", description: "Set thinking level" },
  { name: "/compact", description: "Compact conversation context" },
  { name: "/memory", description: "Show project memory (or /memory search <query>)" },
  { name: "/clear", description: "Clear conversation" },
  { name: "/status", description: "Show session stats" },
  { name: "/agents", description: "Show agent tree" },
  { name: "/delegate", description: "Spawn a sub-agent with a task" },
  { name: "/cost", description: "Show cost breakdown" },
  { name: "/code", description: "Spawn a coding agent for a task" },
  { name: "/review", description: "Spawn a review agent on files or changes" },
  { name: "/debug", description: "Spawn a debug agent to investigate errors" },
  { name: "/research", description: "Spawn a research agent for codebase questions" },
  { name: "/refactor", description: "Spawn a refactor agent for code transformations" },
  { name: "/docs", description: "Spawn a docs agent for documentation tasks" },
  { name: "/diff", description: "Show recent file changes" },
  { name: "/mcp", description: "Show MCP server status" },
  { name: "/branch", description: "Branch the current session" },
  { name: "/tree", description: "Show session tree" },
  { name: "/skill", description: "Import/export/convert skills (Setu porter)" },
  { name: "/skills", description: "Skill security pipeline (pending/approve/reject/scan/learn)" },
  { name: "/learn", description: "Learn a new skill autonomously (Shiksha)" },
  { name: "/chetana", description: "Show consciousness/cognitive state" },
  { name: "/vidya", description: "Show Vidya skill ecosystem dashboard" },
  { name: "/stats", description: "Show codebase power stats" },
  { name: "/power", description: "Alias for /stats" },
  { name: "/vasana", description: "List or inspect crystallized tendencies" },
  { name: "/nidra", description: "Nidra daemon status (sleep cycle)" },
  { name: "/vidhi", description: "List or inspect learned procedures" },
  { name: "/pratyabhijna", description: "Show self-recognition identity narrative" },
  { name: "/turiya", description: "Show Turiya model routing stats" },
  { name: "/health", description: "Show Triguna health status (sattva/rajas/tamas)" },
  { name: "/rta", description: "Show Rta invariant rules and audit log" },
  { name: "/buddhi", description: "Show decisions with Nyaya reasoning" },
  { name: "/samiti", description: "Show Samiti ambient channel dashboard" },
  { name: "/sabha", description: "Show Sabha deliberation protocol status" },
  { name: "/lokapala", description: "Show Lokapala guardian agent status" },
  { name: "/akasha", description: "Show Akasha shared knowledge field" },
  { name: "/kartavya", description: "Show Kartavya auto-execution pipeline" },
  { name: "/kala", description: "Show Kala Chakra temporal awareness" },
  { name: "/atman", description: "Show complete agent soul report" },
  { name: "/workflow", description: "Vayu DAG workflows (list/run/show/history)" },
  { name: "/quit", description: "Exit Chitragupta" },
];

// ─── Thinking levels for cycling ────────────────────────────────────────────

export const THINKING_LEVELS: ThinkingLevel[] = ["none", "low", "medium", "high"];

// ─── Tab completion ─────────────────────────────────────────────────────────

export function completeSlashCommand(
  inputBuffer: string,
  stdout: NodeJS.WriteStream,
  renderPrompt: () => void,
): { newBuffer: string; newCursorPos: number } | null {
  if (!inputBuffer.startsWith("/")) return null;

  const prefix = inputBuffer.toLowerCase();
  const matches = SLASH_COMMANDS.filter((c) => c.name.startsWith(prefix));

  if (matches.length === 1) {
    // Exact single match -- complete it
    const newBuffer = matches[0].name + " ";
    renderPrompt();
    return { newBuffer, newCursorPos: newBuffer.length };
  } else if (matches.length > 1) {
    // Multiple matches -- show them
    stdout.write("\n");
    for (const m of matches) {
      stdout.write("  " + cyan(m.name) + "  " + dim(m.description) + "\n");
    }

    // Find common prefix among matches
    let common = matches[0].name;
    for (let i = 1; i < matches.length; i++) {
      while (!matches[i].name.startsWith(common)) {
        common = common.slice(0, -1);
      }
    }
    if (common.length > inputBuffer.length) {
      return { newBuffer: common, newCursorPos: common.length };
    }
  }

  return null;
}

// ─── Chetana display helpers ────────────────────────────────────────────────

/** Render a mini horizontal bar for affect dimensions. */
function renderMiniBar(
  value: number, min: number, max: number, width: number,
  negColor: (s: string) => string, posColor: (s: string) => string,
): string {
  const range = max - min;
  const normalized = Math.max(0, Math.min(1, (value - min) / range));
  const filled = Math.round(normalized * width);
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(width - filled);
  return normalized >= 0.5 ? posColor(bar) : negColor(bar);
}

/** Render a simple progress bar. */
function renderProgressBar(value: number, width: number): string {
  const clamped = Math.max(0, Math.min(1, value));
  const filled = Math.round(clamped * width);
  return green("\u2588".repeat(filled)) + dim("\u2591".repeat(width - filled));
}

// ─── Duration / age helpers ─────────────────────────────────────────────────

/** Format a millisecond duration as a human-readable string (e.g. "2h 15m"). */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

/** Format a timestamp as "Xm ago" relative age. */
function formatAge(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 1000) return "just now";
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return `${Math.floor(delta / 86_400_000)}d`;
}

// ─── Slash command handler ──────────────────────────────────────────────────

export interface SlashCommandContext {
  agent: Agent;
  stdout: NodeJS.WriteStream;
  stats: SessionStats;
  currentModel: string;
  currentThinking: ThinkingLevel;
  cleanup: () => void;
  onModelChange?: (model: string) => void;
  onThinkingChange?: (level: ThinkingLevel) => void;
  /** VidyaOrchestrator for /vidya command (duck-typed to avoid hard dep). */
  vidyaOrchestrator?: {
    getEcosystemStats(): Record<string, unknown>;
    getSkillReport(name?: string): unknown;
    promoteSkill(name: string, reviewer?: string): boolean;
    deprecateSkill(name: string, reason?: string): boolean;
    evaluateLifecycles(): Record<string, unknown>;
  };
  /** Project path for /stats and other commands that need to scan the codebase. */
  projectPath?: string;
  /** NidraDaemon instance for /nidra command (duck-typed to avoid hard dep). */
  nidraDaemon?: {
    snapshot(): {
      state: string;
      lastStateChange: number;
      lastHeartbeat: number;
      lastConsolidationStart?: number;
      lastConsolidationEnd?: number;
      consolidationPhase?: string;
      consolidationProgress: number;
      uptime: number;
    };
    wake(): void;
  };
}

export interface SlashCommandResult {
  handled: boolean;
  newModel?: string;
  newThinking?: ThinkingLevel;
  /** When true, the user requested to exit the session. */
  exit?: boolean;
}

export async function handleSlashCommand(
  input: string,
  ctx: SlashCommandContext,
): Promise<SlashCommandResult> {
  const { agent, stdout, stats } = ctx;
  const parts = input.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case "/help": {
      stdout.write("\n" + bold("Interactive Commands") + "\n\n");
      stdout.write("  " + cyan("/model <name>") + "        Switch model\n");
      stdout.write("  " + cyan("/thinking <level>") + "    Set thinking (none|low|medium|high)\n");
      stdout.write("  " + cyan("/compact") + "             Compact conversation context\n");
      stdout.write("  " + cyan("/memory") + "              Show project memory\n");
      stdout.write("  " + cyan("/memory search <q>") + "   Search memory (Anveshana multi-round)\n");
      stdout.write("  " + cyan("/clear") + "               Clear conversation\n");
      stdout.write("  " + cyan("/status") + "              Show session stats\n");
      stdout.write("  " + cyan("/agents") + "              Show the agent tree\n");
      stdout.write("  " + cyan("/delegate <p> <task>") + " Spawn a sub-agent\n");
      stdout.write("  " + cyan("/cost") + "                Show cost breakdown\n");
      stdout.write("  " + cyan("/code <task>") + "         Spawn a focused coding agent\n");
      stdout.write("  " + cyan("/review [files...]") + "   Spawn a review agent on files/changes\n");
      stdout.write("  " + cyan("/debug <error>") + "       Spawn a debug agent to investigate\n");
      stdout.write("  " + cyan("/research <question>") + " Research the codebase\n");
      stdout.write("  " + cyan("/refactor <desc>") + "     Refactor code (--plan, --rename)\n");
      stdout.write("  " + cyan("/docs [task]") + "         Generate/update documentation\n");
      stdout.write("  " + cyan("/diff") + "                Show recent file changes\n");
      stdout.write("  " + cyan("/mcp") + "                 Show MCP server status\n");
      stdout.write("  " + cyan("/branch") + "              Branch the current session\n");
      stdout.write("  " + cyan("/tree") + "                Show session tree\n");
      stdout.write("  " + cyan("/skill <sub> <file>") + "  Import/export/convert skills (Setu)\n");
      stdout.write("  " + cyan("/skills <sub>") + "        Skill security (pending/approve/reject/scan)\n");
      stdout.write("  " + cyan("/chetana") + "             Show consciousness/cognitive state\n");
      stdout.write("  " + cyan("/vidya") + "               Show Vidya skill ecosystem dashboard\n");
      stdout.write("  " + cyan("/stats") + "               Show codebase power stats\n");
      stdout.write("  " + cyan("/vasana") + "              List crystallized tendencies\n");
      stdout.write("  " + cyan("/nidra") + "               Show sleep cycle daemon status\n");
      stdout.write("  " + cyan("/vidhi") + "               List learned procedures\n");
      stdout.write("  " + cyan("/pratyabhijna") + "        Show self-recognition narrative\n");
      stdout.write("  " + cyan("/turiya [routing]") + "    Show model routing stats (Turiya)\n");
      stdout.write("  " + cyan("/health") + "              Show Triguna health (sattva/rajas/tamas)\n");
      stdout.write("  " + cyan("/rta [audit]") + "         Show Rta invariant rules or audit log\n");
      stdout.write("  " + cyan("/buddhi [explain <id>]") + "Show decisions with Nyaya reasoning\n");
      stdout.write("  " + cyan("/samiti") + "               Samiti ambient channels dashboard\n");
      stdout.write("  " + cyan("/sabha") + "               Sabha deliberation protocol status\n");
      stdout.write("  " + cyan("/lokapala") + "            Lokapala guardian agent status\n");
      stdout.write("  " + cyan("/akasha") + "              Akasha shared knowledge field\n");
      stdout.write("  " + cyan("/kartavya") + "            Kartavya auto-execution pipeline\n");
      stdout.write("  " + cyan("/kala") + "                Kala Chakra temporal awareness\n");
      stdout.write("  " + cyan("/atman") + "               Complete agent soul report\n");
      stdout.write("  " + cyan("/workflow [sub]") + "      Vayu DAG workflows (list/show/run/history)\n");
      stdout.write("  " + cyan("/quit") + "                Exit Chitragupta\n");
      stdout.write("  " + cyan("/help") + "                Show this help\n");
      stdout.write("\n");
      stdout.write("  " + dim("Keyboard shortcuts:") + "\n");
      stdout.write("  " + dim("Ctrl+C") + "               Clear input (twice to quit)\n");
      stdout.write("  " + dim("Escape") + "               Abort current operation\n");
      stdout.write("  " + dim("Ctrl+L") + "               Model selector\n");
      stdout.write("  " + dim("Shift+Tab") + "            Cycle thinking level\n");
      stdout.write("  " + dim("Tab") + "                  Complete slash command\n");
      stdout.write("  " + dim("Enter") + "                Send message\n");
      stdout.write("\n");
      return { handled: true };
    }

    case "/model": {
      const modelId = parts[1];
      if (!modelId) {
        stdout.write(yellow("\n  Usage: /model <model-id>\n\n"));
        return { handled: true };
      }
      agent.setModel(modelId);
      stdout.write(green(`\n  Model switched to ${bold(modelId)}\n\n`));
      ctx.onModelChange?.(modelId);
      return { handled: true, newModel: modelId };
    }

    case "/thinking": {
      const level = parts[1] as ThinkingLevel | undefined;
      if (!level || !THINKING_LEVELS.includes(level)) {
        stdout.write(
          yellow(`\n  Usage: /thinking <${THINKING_LEVELS.join("|")}>\n`) +
          dim(`  Current: ${ctx.currentThinking}\n\n`),
        );
        return { handled: true };
      }
      agent.setThinkingLevel(level);
      stdout.write(green(`\n  Thinking level set to ${bold(level)}\n\n`));
      ctx.onThinkingChange?.(level);
      return { handled: true, newThinking: level };
    }

    case "/compact": {
      stdout.write(dim("\n  Compacting conversation context...\n"));
      const ctxManager = agent.getContextManager();
      if (ctxManager?.compact) {
        const state = agent.getState();
        const compacted = ctxManager.compact(state);
        agent.replaceState(compacted);
        const oldCount = state.messages.length;
        const newCount = compacted.messages.length;
        stdout.write(
          green(`  Compacted: ${oldCount} messages -> ${newCount} messages\n\n`),
        );
      } else {
        stdout.write(yellow("  Compaction not available.\n\n"));
      }
      return { handled: true };
    }

    case "/memory": {
      const subCmd = parts[1];
      const searchQuery = parts.slice(2).join(" ");

      if (subCmd === "search" && searchQuery) {
        // ─── Anveshana: multi-round retrieval for memory search ──────
        try {
          const { HybridSearchEngine } = await import("@chitragupta/smriti");
          const { AnveshanaEngine } = await import("@chitragupta/smriti");

          const hybridSearch = new HybridSearchEngine({
            project: process.cwd(),
          });
          const anveshana = new AnveshanaEngine(hybridSearch, {
            maxSubQueries: 4,
            maxRounds: 3,
            adaptiveTermination: true,
          });

          const results = await anveshana.search(searchQuery);
          const searchStats = anveshana.getLastSearchStats();

          stdout.write("\n" + bold("Memory Search (Anveshana)") + gray(` for "${searchQuery}"`) + "\n");
          if (searchStats) {
            stdout.write(dim(`  ${searchStats.totalRounds} round(s), ${searchStats.subQueriesGenerated} sub-queries, ${results.length} result(s)`) + "\n");
          }
          stdout.write("\n");

          if (results.length === 0) {
            stdout.write(yellow("  No results found.\n"));
          } else {
            for (let i = 0; i < Math.min(results.length, 10); i++) {
              const r = results[i];
              stdout.write(`  ${cyan(`${i + 1}.`)} ${bold(r.title)} ${dim(`(score: ${r.score.toFixed(3)})`)}\n`);
              const snippet = r.content.length > 120 ? r.content.slice(0, 120) + "..." : r.content;
              stdout.write(`     ${snippet}\n`);
              if (r.foundBy.length > 1) {
                stdout.write(dim(`     Found by: ${r.foundBy.join(", ")}`) + "\n");
              }
            }
          }
          stdout.write("\n");
        } catch {
          // Fallback to basic search if Anveshana/HybridSearch not available
          const { search: searchMemory } = await import("../commands/memory.js");
          await searchMemory(searchQuery);
        }
        return { handled: true };
      }

      // Default: show project memory
      const { show: showMemory } = await import("../commands/memory.js");
      if (subCmd === "search" && !searchQuery) {
        stdout.write(yellow("\n  Usage: /memory search <query>\n\n"));
      } else {
        await showMemory();
      }
      return { handled: true };
    }

    case "/clear": {
      agent.clearMessages();
      stats.totalCost = 0;
      stats.totalInputTokens = 0;
      stats.totalOutputTokens = 0;
      stats.contextPercent = 0;
      stats.turnCount = 0;
      stdout.write(clearScreen());
      stdout.write(green("  Conversation cleared.\n\n"));
      return { handled: true };
    }

    case "/status": {
      stdout.write("\n" + bold("Session Status") + "\n\n");
      stdout.write(`  Model: ${cyan(ctx.currentModel)}\n`);
      stdout.write(`  Thinking: ${cyan(ctx.currentThinking)}\n`);
      stdout.write(`  Turns: ${stats.turnCount}\n`);
      stdout.write(`  Total cost: $${stats.totalCost.toFixed(4)}\n`);
      stdout.write(`  Input tokens: ${stats.totalInputTokens}\n`);
      stdout.write(`  Output tokens: ${stats.totalOutputTokens}\n`);
      stdout.write(`  Context usage: ~${Math.round(stats.contextPercent)}%\n`);
      stdout.write(`  Messages in history: ${agent.getMessages().length}\n`);
      stdout.write("\n");
      return { handled: true };
    }

    case "/agents": {
      stdout.write("\n" + bold("Agent Tree") + "\n\n");
      const tree = agent.renderTree();
      for (const treeLine of tree.split("\n")) {
        stdout.write("  " + treeLine + "\n");
      }
      stdout.write("\n");
      return { handled: true };
    }

    case "/delegate": {
      const purpose = parts[1];
      const taskMsg = parts.slice(2).join(" ");
      if (!purpose || !taskMsg) {
        stdout.write(
          yellow("\n  Usage: /delegate <purpose> <task message>\n") +
          dim("  Example: /delegate code-reviewer Review the last 3 files I edited\n\n"),
        );
        return { handled: true };
      }

      stdout.write(dim(`\n  Spawning sub-agent "${purpose}"...\n`));
      try {
        const result = await agent.delegate({ purpose }, taskMsg);
        const responseText = result.response.content
          .filter((p) => p.type === "text")
          .map((p) => (p as { type: "text"; text: string }).text)
          .join("");

        stdout.write("\n" + bold(magenta(`  Sub-agent: ${purpose}`)) + "\n\n");
        stdout.write("  " + responseText.replace(/\n/g, "\n  ") + "\n");
        if (result.cost) {
          stdout.write(dim(`\n  Cost: $${result.cost.total.toFixed(4)}`) + "\n");
        }
        stdout.write("\n");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stdout.write(red(`  Error: ${msg}\n\n`));
      }
      return { handled: true };
    }

    case "/cost": {
      stdout.write("\n" + bold("Cost Breakdown") + "\n\n");
      stdout.write(`  Total cost:     ${cyan("$" + stats.totalCost.toFixed(6))}\n`);
      stdout.write(`  Input tokens:   ${stats.totalInputTokens}\n`);
      stdout.write(`  Output tokens:  ${stats.totalOutputTokens}\n`);
      stdout.write(`  Total tokens:   ${stats.totalInputTokens + stats.totalOutputTokens}\n`);
      stdout.write(`  Turns:          ${stats.turnCount}\n`);
      if (stats.turnCount > 0) {
        stdout.write(`  Avg cost/turn:  $${(stats.totalCost / stats.turnCount).toFixed(6)}\n`);
      }
      stdout.write("\n");
      return { handled: true };
    }

    case "/code": {
      const rest = parts.slice(1).join(" ").trim();

      // Parse flags: --plan, --no-branch, --no-commit, --no-review
      let codeTask = "";
      let codeMode: "full" | "execute" | "plan-only" = "full";
      let codeBranch: boolean | undefined;
      let codeCommit: boolean | undefined;
      let codeReview: boolean | undefined;

      if (rest) {
        const codeParts = rest.split(/\s+/);
        const taskParts: string[] = [];
        for (let ci = 0; ci < codeParts.length; ci++) {
          if (codeParts[ci] === "--plan") codeMode = "plan-only";
          else if (codeParts[ci] === "--execute") codeMode = "execute";
          else if (codeParts[ci] === "--no-branch") codeBranch = false;
          else if (codeParts[ci] === "--no-commit") codeCommit = false;
          else if (codeParts[ci] === "--no-review") codeReview = false;
          else taskParts.push(codeParts[ci]);
        }
        codeTask = taskParts.join(" ");
      }

      if (!codeTask) {
        stdout.write(yellow("\n  Usage: /code <task description> [--plan] [--no-branch] [--no-commit] [--no-review]\n"));
        stdout.write(dim("  Runs the full coding pipeline: Plan → Branch → Execute → Validate → Review → Commit\n"));
        stdout.write(dim("  Shows token usage, tool usage, cost breakdown, and timing.\n\n"));
        return { handled: true };
      }

      stdout.write(dim(`\n  ═══ Coding Agent (Kartru) ═══════════════════\n`));
      stdout.write(dim(`  Task: ${codeTask}\n`));
      stdout.write(dim(`  Mode: ${codeMode}\n`));

      try {
        const { setupFromAgent, createCodingOrchestrator } = await import("../coding-setup.js");

        const projectPath = ctx.projectPath ?? process.cwd();

        const setup = await setupFromAgent(agent, projectPath);
        if (!setup) {
          stdout.write(red("  Error: No provider available. Set a provider first.\n\n"));
          return { handled: true };
        }

        // Progress streaming to TUI
        const onProgress = (progress: { phase: string; message: string; elapsedMs: number }) => {
          const mark = progress.phase === "error" ? red("✗") : progress.phase === "done" ? green("✓") : yellow("⧖");
          const ms = progress.elapsedMs < 1000 ? `${progress.elapsedMs}ms` : `${(progress.elapsedMs / 1000).toFixed(1)}s`;
          stdout.write(`  ${mark} ${bold(progress.phase.padEnd(12))} ${dim(ms.padStart(8))}\n`);
        };

        const orchestrator = await createCodingOrchestrator({
          setup,
          projectPath,
          mode: codeMode,
          modelId: agent.getState().model,
          createBranch: codeBranch,
          autoCommit: codeCommit,
          selfReview: codeReview,
          onProgress,
        });

        stdout.write("\n");
        const result = await orchestrator.run(codeTask);

        // ── Stats from result (computed by orchestrator) ──
        const { stats } = result;
        const totalCost = stats.totalCost;
        const totalToolCalls = stats.totalToolCalls;
        const toolCallMap = new Map(Object.entries(stats.toolCalls));
        const turns = stats.turns;

        // ── Render result ──
        stdout.write("\n");
        const status = result.success ? green("✓ Success") : red("✗ Failed");
        const complexity = result.plan?.complexity ?? "unknown";
        stdout.write(`  Status: ${status} | Complexity: ${complexity}\n`);

        // Plan
        if (result.plan && result.plan.steps.length > 0) {
          stdout.write(dim("\n  ── Plan ──\n"));
          for (const step of result.plan.steps) {
            const mark = step.completed ? green("✓") : gray("○");
            stdout.write(`  ${step.index}. [${mark}] ${step.description}\n`);
          }
        }

        // Files
        if (result.filesModified.length > 0 || result.filesCreated.length > 0) {
          stdout.write(dim("\n  ── Files ──\n"));
          if (result.filesModified.length > 0) stdout.write(`  ${yellow("Modified:")} ${result.filesModified.join(", ")}\n`);
          if (result.filesCreated.length > 0) stdout.write(`  ${green("Created:")}  ${result.filesCreated.join(", ")}\n`);
        }

        // Git
        if (result.git.featureBranch || result.git.commits.length > 0) {
          stdout.write(dim("\n  ── Git ──\n"));
          if (result.git.featureBranch) stdout.write(`  Branch:  ${cyan(result.git.featureBranch)}\n`);
          if (result.git.commits.length > 0) stdout.write(`  Commits: ${dim(result.git.commits.join(", "))}\n`);
        }

        // Validation
        stdout.write(dim("\n  ── Validation ──\n"));
        stdout.write(`  Result: ${result.validationPassed ? green("✓ passed") : red("✗ failed")}\n`);

        // Review
        if (result.reviewIssues.length > 0) {
          stdout.write(dim("\n  ── Review ──\n"));
          stdout.write(`  ${result.reviewIssues.length} issue(s) found\n`);
          for (const issue of result.reviewIssues.slice(0, 10)) {
            const sev = issue.severity === "error" ? red(issue.severity) : yellow(issue.severity);
            stdout.write(`    ${sev} ${issue.file}${issue.line ? `:${issue.line}` : ""} — ${issue.message}\n`);
          }
        }

        // Diff preview
        if (result.diffPreview) {
          stdout.write(dim("\n  ── Diff Preview ──\n"));
          const diffLines = result.diffPreview.split("\n");
          const show = diffLines.length > 30 ? diffLines.slice(0, 30) : diffLines;
          for (const line of show) {
            if (line.startsWith("+") && !line.startsWith("+++")) stdout.write(`  ${green(line)}\n`);
            else if (line.startsWith("-") && !line.startsWith("---")) stdout.write(`  ${red(line)}\n`);
            else if (line.startsWith("@@")) stdout.write(`  ${cyan(line)}\n`);
            else stdout.write(`  ${dim(line)}\n`);
          }
          if (diffLines.length > 30) {
            stdout.write(dim(`  ... (${diffLines.length - 30} more lines)\n`));
          }
        }

        // ── Token/Tool Usage Stats ──
        if (totalToolCalls > 0 || totalCost > 0) {
          stdout.write(dim("\n  ══ Tool Usage ═════════════════════════\n"));
          const sorted = [...toolCallMap.entries()].sort((a, b) => b[1] - a[1]);
          for (const [name, count] of sorted) {
            const pct = totalToolCalls > 0 ? ((count / totalToolCalls) * 100).toFixed(1) : "0.0";
            stdout.write(`  ${magenta("▸")} ${dim(name.padEnd(10))}${String(count).padStart(4)} calls  ${gray(`(${pct}%)`.padStart(8))}\n`);
          }
          stdout.write(dim("  ─────────────────────────────────\n"));
          stdout.write(`  ${bold("Total:")}  ${totalToolCalls} calls | ${turns} turns\n`);
        }

        if (totalCost > 0) {
          stdout.write(dim("\n  ══ Cost ══════════════════════════════\n"));
          stdout.write(`  ${yellow(`$${totalCost.toFixed(4)}`)}\n`);
        }

        // Phase timings
        if (result.phaseTimings && result.phaseTimings.length > 0) {
          stdout.write(dim("\n  ── Phase Timings ──\n"));
          for (const pt of result.phaseTimings) {
            const dur = pt.durationMs < 1000 ? `${pt.durationMs}ms` : `${(pt.durationMs / 1000).toFixed(1)}s`;
            stdout.write(`  ${dim(pt.phase.padEnd(12))} ${dur}\n`);
          }
        }

        // Diff stats
        if (result.diffStats) {
          stdout.write(`  ${green(`+${result.diffStats.insertions}`)} ${red(`-${result.diffStats.deletions}`)} in ${result.diffStats.filesChanged} file(s)\n`);
        }

        // Errors
        if (result.errors && result.errors.length > 0) {
          stdout.write(dim("\n  ── Errors ──\n"));
          for (const err of result.errors) {
            stdout.write(`  ${red(`[${err.phase}]`)} ${err.message}${err.recoverable ? dim(" (recovered)") : ""}\n`);
          }
        }

        // Total timing
        const elapsed = result.elapsedMs < 1000 ? `${result.elapsedMs}ms` : result.elapsedMs < 60000 ? `${(result.elapsedMs / 1000).toFixed(1)}s` : `${Math.floor(result.elapsedMs / 60000)}m ${((result.elapsedMs % 60000) / 1000).toFixed(0)}s`;
        stdout.write(`\n  ${bold(dim(`⏱ ${elapsed}`))}\n`);
        stdout.write("\n");
      } catch (err) {
        stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
      }
      return { handled: true };
    }

    case "/review": {
      const rest = parts.slice(1).join(" ").trim();
      stdout.write(dim("\n  Spawning Parikshaka review agent...\n"));
      try {
        const { ReviewAgent } = await import("@chitragupta/anina");
        const reviewer = new ReviewAgent({
          workingDirectory: process.cwd(),
        });

        let result;
        if (rest) {
          // Review specific files
          const files = rest.split(/\s+/);
          result = await reviewer.reviewFiles(files);
        } else {
          // Review uncommitted changes
          result = await reviewer.reviewChanges();
        }

        stdout.write("\n");
        stdout.write(`  Review Score: ${cyan(String(result.overallScore) + "/10")}\n`);
        stdout.write(dim(`  Files reviewed: ${result.filesReviewed.join(", ") || "none"}\n`));

        if (result.issues.length > 0) {
          stdout.write(`\n  Issues (${result.issues.length}):\n`);
          for (const issue of result.issues) {
            const loc = issue.line ? `${issue.file}:${issue.line}` : issue.file;
            const sev = issue.severity.toUpperCase();
            const sevColor = sev === "ERROR" ? red : sev === "WARNING" ? yellow : dim;
            stdout.write(`    ${sevColor(`[${sev}]`)} ${bold(issue.category)}: ${loc} — ${issue.message}\n`);
            if (issue.suggestion) {
              stdout.write(dim(`      → ${issue.suggestion}\n`));
            }
          }
        }

        stdout.write(`\n  ${bold("Summary:")} ${result.summary}\n`);
        stdout.write("\n");
      } catch (err) {
        stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
      }
      return { handled: true };
    }

    case "/debug": {
      const rest = parts.slice(1).join(" ").trim();
      if (!rest) {
        stdout.write(yellow("\n  Usage: /debug <error message or bug description>\n"));
        stdout.write(dim("  /debug --test <test command>  (investigate a failing test)\n\n"));
        return { handled: true };
      }

      stdout.write(dim("\n  Spawning Anveshi debug agent...\n"));
      try {
        const { DebugAgent } = await import("@chitragupta/anina");
        const debugger_ = new DebugAgent({
          workingDirectory: process.cwd(),
          autoFix: false,
        });

        let result;
        if (rest.startsWith("--test ")) {
          const testCmd = rest.slice(7).trim();
          result = await debugger_.investigateTest(testCmd);
        } else {
          result = await debugger_.investigate({ error: rest });
        }

        stdout.write("\n");
        stdout.write(`  ${bold("Root Cause:")} ${result.rootCause}\n`);
        if (result.bugLocation) {
          stdout.write(dim(`  Location: ${result.bugLocation.file}:${result.bugLocation.line}\n`));
        }
        stdout.write(dim(`  Confidence: ${(result.confidence * 100).toFixed(0)}%\n`));
        stdout.write(dim(`  Files investigated: ${result.filesInvestigated.join(", ")}\n`));
        stdout.write(`\n  ${bold("Proposed Fix:")} ${result.proposedFix}\n`);
        if (result.fixApplied) {
          stdout.write(dim(`  Fix applied: yes (validation: ${result.validationPassed ? green("passed") : red("failed")})\n`));
        }
        stdout.write("\n");
      } catch (err) {
        stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
      }
      return { handled: true };
    }

    case "/research": {
      const rest = parts.slice(1).join(" ").trim();
      if (!rest) {
        stdout.write(yellow("\n  Usage: /research <question about the codebase>\n"));
        stdout.write(dim("  Examples:\n"));
        stdout.write(dim("    /research how does the auth flow work?\n"));
        stdout.write(dim("    /research what patterns does the router use?\n\n"));
        return { handled: true };
      }

      stdout.write(dim("\n  Spawning Shodhaka research agent...\n"));
      try {
        const { ResearchAgent } = await import("@chitragupta/anina");
        const researcher = new ResearchAgent({
          workingDirectory: process.cwd(),
        });

        const result = await researcher.research({ question: rest });

        stdout.write("\n");
        stdout.write("  " + result.answer.replace(/\n/g, "\n  ") + "\n");

        if (result.codeReferences.length > 0) {
          stdout.write("\n  " + bold("References:") + "\n");
          for (const ref of result.codeReferences.slice(0, 10)) {
            const loc = ref.line ? `${ref.file}:${ref.line}` : ref.file;
            stdout.write(`    ${cyan(loc)}\n`);
            if (ref.snippet) {
              stdout.write(dim(`      ${ref.snippet.slice(0, 100)}\n`));
            }
          }
        }

        if (result.relatedTopics.length > 0) {
          stdout.write(dim(`\n  Related: ${result.relatedTopics.join(", ")}\n`));
        }
        stdout.write(dim(`  Confidence: ${(result.confidence * 100).toFixed(0)}%\n`));
        stdout.write("\n");
      } catch (err) {
        stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
      }
      return { handled: true };
    }

    case "/refactor": {
      const rest = parts.slice(1).join(" ").trim();
      if (!rest) {
        stdout.write(yellow("\n  Usage: /refactor <what to refactor>\n"));
        stdout.write(dim("  /refactor --plan <what>          (plan only, don't execute)\n"));
        stdout.write(dim("  /refactor --rename <old> <new>   (rename symbol)\n\n"));
        return { handled: true };
      }

      stdout.write(dim("\n  Spawning Parikartru refactor agent...\n"));
      try {
        const { RefactorAgent } = await import("@chitragupta/anina");
        const refactorer = new RefactorAgent({
          workingDirectory: process.cwd(),
          validatePerFile: true,
        });

        if (rest.startsWith("--plan ")) {
          const plan = await refactorer.plan(rest.slice(7).trim());
          stdout.write("\n");
          stdout.write(`  ${bold("Type:")} ${plan.type}\n`);
          stdout.write(`  ${bold("Description:")} ${plan.description}\n`);
          stdout.write(dim(`  Files affected: ${plan.filesAffected.join(", ")}\n`));
          stdout.write(dim(`  Estimated changes: ${plan.estimatedChanges}\n`));
          if (plan.risks.length > 0) {
            stdout.write(yellow(`  Risks: ${plan.risks.join("; ")}\n`));
          }
        } else if (rest.startsWith("--rename ")) {
          const renameParts = rest.slice(9).trim().split(/\s+/);
          if (renameParts.length < 2) {
            stdout.write(yellow("  Usage: /refactor --rename <oldName> <newName>\n\n"));
            return { handled: true };
          }
          const result = await refactorer.rename(renameParts[0], renameParts[1]);
          stdout.write("\n");
          stdout.write(result.success ? green("  Rename completed\n") : red("  Rename failed\n"));
          stdout.write(dim(`  Modified: ${result.filesModified.join(", ")}\n`));
          stdout.write(dim(`  Validation: ${result.validationPassed ? "passed" : "failed"}\n`));
          if (result.rollbackCommand) {
            stdout.write(dim(`  Rollback: ${result.rollbackCommand}\n`));
          }
        } else {
          const result = await refactorer.execute(rest);
          stdout.write("\n");
          stdout.write(result.success ? green("  Refactoring completed\n") : red("  Refactoring failed\n"));
          stdout.write(dim(`  Modified: ${result.filesModified.join(", ")}\n`));
          stdout.write(dim(`  Validation: ${result.validationPassed ? "passed" : "failed"}\n`));
          stdout.write(dim(`  Summary: ${result.summary}\n`));
          if (result.rollbackCommand) {
            stdout.write(dim(`  Rollback: ${result.rollbackCommand}\n`));
          }
        }
        stdout.write("\n");
      } catch (err) {
        stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
      }
      return { handled: true };
    }

    case "/docs": {
      const rest = parts.slice(1).join(" ").trim();
      if (!rest) {
        stdout.write(yellow("\n  Usage: /docs <task>\n"));
        stdout.write(dim("  /docs readme [path]            Generate/update README\n"));
        stdout.write(dim("  /docs jsdoc <file>             Add JSDoc to exported symbols\n"));
        stdout.write(dim("  /docs changelog [ref]          Generate changelog since ref\n"));
        stdout.write(dim("  /docs architecture [path]      Document architecture\n"));
        stdout.write(dim("  /docs <custom task>            Any documentation task\n\n"));
        return { handled: true };
      }

      stdout.write(dim("\n  Spawning Lekhaka docs agent...\n"));
      try {
        const { DocsAgent } = await import("@chitragupta/anina");
        const docsAgent = new DocsAgent({
          workingDirectory: process.cwd(),
        });

        let result;
        if (rest.startsWith("readme")) {
          const target = rest.slice(6).trim() || process.cwd();
          result = await docsAgent.readme(target);
        } else if (rest.startsWith("jsdoc ")) {
          result = await docsAgent.jsdoc(rest.slice(6).trim());
        } else if (rest.startsWith("changelog")) {
          const ref = rest.slice(9).trim() || undefined;
          result = await docsAgent.changelog(ref);
        } else if (rest.startsWith("architecture")) {
          const target = rest.slice(12).trim() || process.cwd();
          result = await docsAgent.architecture(target);
        } else {
          result = await docsAgent.write(rest);
        }

        stdout.write("\n");
        if (result.filesModified.length > 0) {
          stdout.write(dim(`  Modified: ${result.filesModified.join(", ")}\n`));
        }
        if (result.filesCreated.length > 0) {
          stdout.write(dim(`  Created: ${result.filesCreated.join(", ")}\n`));
        }
        stdout.write(dim(`  Words written: ${result.wordCount}\n`));
        stdout.write(dim(`  Summary: ${result.summary}\n`));
        stdout.write("\n");
      } catch (err) {
        stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
      }
      return { handled: true };
    }

    case "/diff": {
      stdout.write("\n" + bold("Recent File Changes") + "\n\n");

      const messages = agent.getMessages();
      let changeCount = 0;
      for (const msg of messages) {
        for (const part of msg.content) {
          if (part.type === "tool_call") {
            const toolCall = part as { type: "tool_call"; name: string; arguments: string };
            if (toolCall.name === "write" || toolCall.name === "edit") {
              try {
                const toolArgs = JSON.parse(toolCall.arguments);
                const filePath = (toolArgs.path || toolArgs.file_path || "unknown") as string;
                const action = toolCall.name === "write" ? "wrote" : "edited";
                stdout.write(`  ${yellow(action)}: ${filePath}\n`);
                changeCount++;
              } catch {
                // Skip unparseable args
              }
            }
          }
        }
      }

      if (changeCount === 0) {
        stdout.write(dim("  No file changes in this session.\n"));
      }
      stdout.write("\n");
      return { handled: true };
    }

    case "/mcp": {
      stdout.write("\n" + bold("MCP Servers") + "\n\n");

      try {
        const { getMCPRegistry } = await import("../mcp-loader.js");
        const registry = getMCPRegistry();

        if (!registry) {
          stdout.write(dim("  No MCP servers initialized.\n"));
          stdout.write(gray("  Configure servers in ~/.chitragupta/mcp.json or .chitragupta/mcp.json\n"));
        } else {
          const servers = registry.listServers();

          if (servers.length === 0) {
            stdout.write(dim("  No MCP servers registered.\n"));
          } else {
            for (const server of servers) {
              const stateColor = server.state === "ready"
                ? green
                : server.state === "error"
                  ? red
                  : yellow;

              stdout.write(
                `  ${bold(server.config.name)} ${stateColor(`[${server.state}]`)}\n`,
              );
              stdout.write(
                `    ${dim("id:")} ${server.config.id}  ${dim("tools:")} ${server.tools.length}\n`,
              );

              if (server.lastError) {
                stdout.write(
                  `    ${red("error:")} ${server.lastError.message}\n`,
                );
              }
            }

            const totalTools = registry.getToolCount();
            stdout.write(
              "\n" + dim(`  Total: ${servers.length} server(s), ${totalTools} tool(s)`) + "\n",
            );
          }
        }
      } catch {
        stdout.write(dim("  MCP support not available.\n"));
      }

      stdout.write("\n");
      return { handled: true };
    }

    case "/branch": {
      stdout.write("\n" + bold("Branch Session") + "\n\n");
      try {
        const { branchSession } = await import("@chitragupta/smriti/branch");
        const agentState = agent.getState() as Record<string, unknown>;
        const sessionId = agentState.sessionId as string | undefined;
        if (!sessionId) {
          stdout.write(yellow("  No active session to branch.\n"));
        } else {
          const branchName = parts[1] || `branch-${Date.now()}`;
          const newSession = branchSession(sessionId, process.cwd(), branchName);
          stdout.write(green(`  Branched session: ${bold(newSession.meta.id)}\n`));
          stdout.write(dim(`  Name: ${branchName}\n`));
          stdout.write(dim(`  Parent: ${sessionId}\n`));
        }
      } catch {
        stdout.write(dim("  Session branching not available.\n"));
      }
      stdout.write("\n");
      return { handled: true };
    }

    case "/tree": {
      stdout.write("\n" + bold("Session Tree") + "\n\n");
      try {
        const { getSessionTree } = await import("@chitragupta/smriti/branch");
        const { SessionTree: SessionTreeComponent } = await import("@chitragupta/ui/components/session-tree");

        const smritiTree = getSessionTree(process.cwd());

        // Convert smriti SessionTreeNode → UI SessionTreeNode
        type UITreeNode = { id: string; title: string; date?: string; turnCount?: number; children?: UITreeNode[] };
        function convertNode(node: { session: { id: string; title: string; updated: string }; children: unknown[] }): UITreeNode {
          return {
            id: node.session.id,
            title: node.session.title,
            date: node.session.updated,
            children: (node.children as typeof node[]).map(convertNode),
          };
        }

        const uiNodes = [convertNode(smritiTree.root as any)];
        const treeComponent = new SessionTreeComponent(uiNodes);
        const cols = stdout.columns || 80;
        const rows = stdout.rows || 24;
        const rendered = treeComponent.render(cols - 4, rows - 6);
        for (const treeLine of rendered) {
          stdout.write("  " + treeLine + "\n");
        }
      } catch {
        stdout.write(dim("  Session tree not available.\n"));
      }
      stdout.write("\n");
      return { handled: true };
    }

    case "/skill": {
      const subCmd = parts[1];
      const rest = parts.slice(2).join(" ").trim();

      if (!subCmd) {
        stdout.write(yellow("\n  Usage: /skill <detect|import|export|convert> <file> [--format <fmt>] [--to <fmt>]\n"));
        stdout.write(dim("  Setu (bridge) — convert skills between vidhya, Claude, and Gemini formats.\n\n"));
        stdout.write(dim("  /skill detect <file>                    Detect skill file format\n"));
        stdout.write(dim("  /skill import <file>                    Import to vidhya format\n"));
        stdout.write(dim("  /skill export <file> --format claude     Export to Claude SKILL.md\n"));
        stdout.write(dim("  /skill convert <file> --to gemini        Convert to Gemini extension\n\n"));
        return { handled: true };
      }

      try {
        const { runSkillPorterCommand } = await import("../commands/skill-porter.js");
        const slashArgs = rest ? rest.split(/\s+/) : [];
        await runSkillPorterCommand(subCmd, slashArgs);
      } catch (err) {
        stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
      }
      return { handled: true };
    }

    case "/skills": {
      const subCmd = parts[1];
      const rest = parts.slice(2);

      try {
        const { runSkillsCommand } = await import("../commands/skills.js");
        await runSkillsCommand(subCmd, rest, stdout);
      } catch (err) {
        stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
      }
      return { handled: true };
    }

    case "/learn": {
      const query = parts.slice(1).join(" ");
      try {
        const { runSkillsCommand } = await import("../commands/skills.js");
        await runSkillsCommand("learn", [query], stdout);
      } catch (err) {
        stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
      }
      return { handled: true };
    }

    case "/vidya": {
      const subcommand = parts.slice(1).join(" ").trim() || undefined;
      try {
        const { runVidyaCommand } = await import("../commands/vidya.js");
        await runVidyaCommand(ctx.vidyaOrchestrator as any, subcommand, stdout);
      } catch (err) {
        stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
      }
      return { handled: true };
    }

    case "/chetana": {
      const chetana = agent.getChetana();
      if (!chetana) {
        stdout.write(yellow("\n  Chetana (consciousness layer) is not enabled.\n"));
        stdout.write(dim("  Enable it with: enableChetana: true in agent config.\n\n"));
        return { handled: true };
      }

      const report = chetana.getCognitiveReport();

      stdout.write("\n" + bold("\u091A\u0947\u0924\u0928\u093E \u2014 Consciousness Report") + "\n\n");

      // ─── Bhava (Affect) ───
      stdout.write("  " + bold(magenta("\u092D\u093E\u0935 Bhava")) + dim(" \u2014 Affect") + "\n");
      const ecgWidth = 30;
      const valenceBar = renderMiniBar(report.affect.valence, -1, 1, ecgWidth, red, green);
      const arousalBar = renderMiniBar(report.affect.arousal, 0, 1, ecgWidth, dim, yellow);
      const confidBar = renderMiniBar(report.affect.confidence, 0, 1, ecgWidth, red, green);
      const frustBar = renderMiniBar(report.affect.frustration, 0, 1, ecgWidth, green, red);
      stdout.write(`    Valence:     ${valenceBar} ${report.affect.valence >= 0 ? green(report.affect.valence.toFixed(2)) : red(report.affect.valence.toFixed(2))}\n`);
      stdout.write(`    Arousal:     ${arousalBar} ${yellow(report.affect.arousal.toFixed(2))}\n`);
      stdout.write(`    Confidence:  ${confidBar} ${report.affect.confidence >= 0.7 ? green(report.affect.confidence.toFixed(2)) : dim(report.affect.confidence.toFixed(2))}\n`);
      stdout.write(`    Frustration: ${frustBar} ${report.affect.frustration >= 0.7 ? red(report.affect.frustration.toFixed(2)) : dim(report.affect.frustration.toFixed(2))}\n`);
      stdout.write("\n");

      // ─── Dhyana (Attention) ───
      stdout.write("  " + bold(cyan("\u0927\u094D\u092F\u093E\u0928 Dhyana")) + dim(" \u2014 Attention") + "\n");
      if (report.topConcepts.length > 0) {
        stdout.write("    Focus: ");
        stdout.write(report.topConcepts.slice(0, 5).map((c: { concept: string; weight: number }) => cyan(c.concept) + dim(`(${c.weight.toFixed(1)})`)).join("  "));
        stdout.write("\n");
      }
      if (report.topTools.length > 0) {
        stdout.write("    Tools: ");
        stdout.write(report.topTools.slice(0, 5).map((t: { tool: string; weight: number }) => bold(t.tool) + dim(`(${t.weight.toFixed(1)})`)).join("  "));
        stdout.write("\n");
      }
      if (report.topConcepts.length === 0 && report.topTools.length === 0) {
        stdout.write(dim("    No attention data yet.\n"));
      }
      stdout.write("\n");

      // ─── Atma-Darshana (Self) ───
      stdout.write("  " + bold(green("\u0906\u0924\u094D\u092E\u0926\u0930\u094D\u0936\u0928 Atma")) + dim(" \u2014 Self-Model") + "\n");
      const cal = report.selfSummary.calibration;
      const calLabel = cal > 1.2 ? red("overconfident") : cal < 0.8 ? yellow("underconfident") : green("calibrated");
      stdout.write(`    Calibration: ${cal.toFixed(2)} (${calLabel})\n`);
      const vel = report.selfSummary.learningVelocity;
      stdout.write(`    Learning:    ${vel > 0 ? green("+" + vel.toFixed(3)) : vel < 0 ? red(vel.toFixed(3)) : dim("0.000")} /turn\n`);
      if (report.selfSummary.topTools.length > 0) {
        stdout.write("    Mastery:     ");
        stdout.write(report.selfSummary.topTools.slice(0, 3).map((t: { tool: string; mastery: { successRate: number } }) =>
          `${t.tool} ${t.mastery.successRate >= 0.8 ? green((t.mastery.successRate * 100).toFixed(0) + "%") : yellow((t.mastery.successRate * 100).toFixed(0) + "%")}`
        ).join("  "));
        stdout.write("\n");
      }
      if (report.selfSummary.limitations.length > 0) {
        stdout.write(dim(`    Limits: ${report.selfSummary.limitations.slice(0, 2).join("; ")}\n`));
      }
      stdout.write("\n");

      // ─── Sankalpa (Intentions) ───
      stdout.write("  " + bold(yellow("\u0938\u0902\u0915\u0932\u094D\u092A Sankalpa")) + dim(" \u2014 Intentions") + "\n");
      const activeGoals = report.intentions.filter((i: { status: string }) => i.status === "active" || i.status === "paused");
      if (activeGoals.length === 0) {
        stdout.write(dim("    No active goals.\n"));
      } else {
        for (const intent of activeGoals.slice(0, 5)) {
          const pct = Math.round(intent.progress * 100);
          const bar = renderProgressBar(intent.progress, 15);
          const statusColor = intent.status === "active" ? green : yellow;
          const prioColor = intent.priority === "critical" ? red : intent.priority === "high" ? yellow : dim;
          stdout.write(`    ${statusColor("\u25CF")} ${bar} ${dim(pct + "%")} ${prioColor(`[${intent.priority}]`)} ${intent.goal.slice(0, 50)}\n`);
          if (intent.staleTurns > 0) {
            stdout.write(dim(`      stale: ${intent.staleTurns} turns\n`));
          }
        }
      }
      const achieved = report.intentions.filter((i: { status: string }) => i.status === "achieved").length;
      if (achieved > 0) {
        stdout.write(dim(`    ${achieved} goal(s) achieved this session\n`));
      }
      stdout.write("\n");

      return { handled: true };
    }

    case "/vasana": {
      const subCmd = parts[1];
      const vasanaArg = parts.slice(2).join(" ").trim();

      try {
        const { VasanaEngine } = await import("@chitragupta/smriti");
        const engine = new VasanaEngine();
        engine.restore();
        const project = ctx.projectPath ?? process.cwd();

        if (subCmd === "inspect" && vasanaArg) {
          // /vasana inspect <id> — show details of a specific vasana
          const vasanas = engine.getVasanas(project, 200);
          const match = vasanas.find(
            (v: { id: string; tendency: string }) =>
              v.id === vasanaArg || v.tendency === vasanaArg
          );
          if (!match) {
            stdout.write(yellow(`\n  Vasana not found: ${vasanaArg}\n\n`));
          } else {
            stdout.write("\n" + bold("Vasana Detail") + "\n\n");
            stdout.write(`  ${bold("ID:")}          ${dim(match.id)}\n`);
            stdout.write(`  ${bold("Tendency:")}    ${cyan(match.tendency)}\n`);
            stdout.write(`  ${bold("Description:")} ${match.description}\n`);
            const valColor = match.valence === "positive" ? green : match.valence === "negative" ? red : dim;
            stdout.write(`  ${bold("Valence:")}     ${valColor(match.valence)}\n`);
            stdout.write(`  ${bold("Strength:")}    ${renderMiniBar(match.strength, 0, 1, 20, dim, green)} ${match.strength.toFixed(3)}\n`);
            stdout.write(`  ${bold("Stability:")}   ${renderMiniBar(match.stability, 0, 1, 20, red, green)} ${match.stability.toFixed(3)}\n`);
            stdout.write(`  ${bold("Accuracy:")}    ${match.predictiveAccuracy.toFixed(3)}\n`);
            stdout.write(`  ${bold("Reinforced:")}  ${match.reinforcementCount} times\n`);
            stdout.write(`  ${bold("Sources:")}     ${match.sourceSamskaras.length} samskara(s)\n`);
            if (match.lastActivated) {
              stdout.write(`  ${bold("Last active:")} ${new Date(match.lastActivated).toLocaleString()}\n`);
            }
            stdout.write("\n");
          }
        } else {
          // /vasana or /vasana list — show top vasanas
          const vasanas = engine.getVasanas(project, 15);

          stdout.write("\n" + bold("\u0935\u093E\u0938\u0928\u093E Vasanas") + dim(` \u2014 Crystallized Tendencies (${project.split("/").pop()})`) + "\n\n");

          if (vasanas.length === 0) {
            stdout.write(dim("  No vasanas crystallized yet. Run more sessions to build behavioral patterns.\n"));
          } else {
            for (const v of vasanas) {
              const valIcon = v.valence === "positive" ? green("\u25B2") : v.valence === "negative" ? red("\u25BC") : dim("\u25CF");
              const strengthBar = renderMiniBar(v.strength, 0, 1, 12, dim, green);
              stdout.write(
                `  ${valIcon} ${strengthBar} ${bold(v.tendency)} ` +
                `${dim(`str:${v.strength.toFixed(2)} stab:${v.stability.toFixed(2)}`)} ` +
                `${dim(`[${v.reinforcementCount}x]`)}\n`
              );
            }
          }
          stdout.write("\n");
          stdout.write(dim("  Use /vasana inspect <tendency> for details.\n\n"));
        }
      } catch (err) {
        stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
      }
      return { handled: true };
    }

    case "/nidra": {
      const subCmd = parts[1];

      try {
        const daemonInstance = ctx.nidraDaemon;

        if (!daemonInstance) {
          stdout.write(yellow("\n  Nidra daemon is not running.\n"));
          stdout.write(dim("  The daemon starts automatically with the agent.\n\n"));
          return { handled: true };
        }

        if (subCmd === "wake") {
          // /nidra wake — force wake
          daemonInstance.wake();
          stdout.write(green("\n  Nidra daemon forced to LISTENING state.\n\n"));
        } else if (subCmd === "history") {
          // /nidra history — show consolidation log
          const snap = daemonInstance.snapshot();
          stdout.write("\n" + bold("\u0928\u093F\u0926\u094D\u0930\u093E Nidra Consolidation History") + "\n\n");
          if (snap.lastConsolidationStart) {
            stdout.write(`  Last consolidation started: ${new Date(snap.lastConsolidationStart).toLocaleString()}\n`);
          } else {
            stdout.write(dim("  No consolidations have run yet.\n"));
          }
          if (snap.lastConsolidationEnd) {
            const durationMs = snap.lastConsolidationEnd - (snap.lastConsolidationStart ?? snap.lastConsolidationEnd);
            stdout.write(`  Last consolidation ended:   ${new Date(snap.lastConsolidationEnd).toLocaleString()}\n`);
            stdout.write(`  Duration:                   ${(durationMs / 1000).toFixed(1)}s\n`);
          }
          stdout.write("\n");
        } else {
          // /nidra or /nidra status — show current state
          const snap = daemonInstance.snapshot();
          const stateColor = snap.state === "LISTENING" ? green : snap.state === "DREAMING" ? yellow : cyan;

          stdout.write("\n" + bold("\u0928\u093F\u0926\u094D\u0930\u093E Nidra Daemon") + dim(" \u2014 Sleep Cycle Manager") + "\n\n");
          stdout.write(`  State:      ${stateColor(bold(snap.state))}\n`);
          stdout.write(`  Uptime:     ${formatDuration(snap.uptime)}\n`);
          stdout.write(`  Heartbeat:  ${dim(formatAge(snap.lastHeartbeat) + " ago")}\n`);

          if (snap.state === "DREAMING" && snap.consolidationPhase) {
            const pct = Math.round(snap.consolidationProgress * 100);
            const bar = renderProgressBar(snap.consolidationProgress, 20);
            stdout.write(`  Phase:      ${yellow(snap.consolidationPhase)} ${bar} ${dim(pct + "%")}\n`);
          }

          if (snap.lastConsolidationEnd) {
            stdout.write(`  Last dream: ${dim(formatAge(snap.lastConsolidationEnd) + " ago")}\n`);
          }
          stdout.write("\n");
          stdout.write(dim("  /nidra wake     Force back to LISTENING\n"));
          stdout.write(dim("  /nidra history  Show consolidation log\n\n"));
        }
      } catch (err) {
        stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
      }
      return { handled: true };
    }

    case "/vidhi": {
      const subCmd = parts[1];
      const vidhiArg = parts.slice(2).join(" ").trim();

      try {
        const { VidhiEngine } = await import("@chitragupta/smriti");
        const project = ctx.projectPath ?? process.cwd();
        const engine = new VidhiEngine({ project });

        if ((subCmd === "inspect" || subCmd === "show") && vidhiArg) {
          // /vidhi inspect <name> — show details
          const vidhis = engine.loadAll(project);
          const match = vidhis.find(
            (v: { id: string; name: string }) =>
              v.name === vidhiArg || v.id === vidhiArg
          );
          if (!match) {
            stdout.write(yellow(`\n  Vidhi not found: ${vidhiArg}\n\n`));
          } else {
            stdout.write("\n" + bold("Vidhi Detail") + "\n\n");
            stdout.write(`  ${bold("ID:")}           ${dim(match.id)}\n`);
            stdout.write(`  ${bold("Name:")}         ${cyan(match.name)}\n`);
            stdout.write(`  ${bold("Confidence:")}   ${match.confidence.toFixed(3)}\n`);
            stdout.write(`  ${bold("Success rate:")} ${(match.successRate * 100).toFixed(1)}% (${match.successCount}/${match.successCount + match.failureCount})\n`);
            stdout.write(`  ${bold("Learned from:")} ${match.learnedFrom.length} session(s)\n`);

            if (match.triggers.length > 0) {
              stdout.write(`  ${bold("Triggers:")}     ${match.triggers.slice(0, 5).join(", ")}\n`);
            }

            stdout.write(`\n  ${bold("Steps:")}\n`);
            for (const step of match.steps) {
              stdout.write(`    ${dim(`${step.index + 1}.`)} ${bold(step.toolName)} ${dim("\u2014")} ${step.description}\n`);
            }

            const paramNames = Object.keys(match.parameterSchema);
            if (paramNames.length > 0) {
              stdout.write(`\n  ${bold("Parameters:")}\n`);
              for (const pName of paramNames.slice(0, 8)) {
                const p = match.parameterSchema[pName] as { type?: string; required?: boolean; description?: string };
                stdout.write(`    ${cyan(pName)} ${dim(`(${p.type ?? "string"}${p.required ? ", required" : ""})`)}\n`);
              }
            }
            stdout.write("\n");
          }
        } else {
          // /vidhi or /vidhi list — list all procedures
          const vidhis = engine.getVidhis(project, 15);

          stdout.write("\n" + bold("\u0935\u093F\u0927\u093F Vidhi") + dim(` \u2014 Procedural Memory (${project.split("/").pop()})`) + "\n\n");

          if (vidhis.length === 0) {
            stdout.write(dim("  No procedures learned yet. Repeat tool sequences across sessions to discover patterns.\n"));
          } else {
            for (const v of vidhis) {
              const rate = (v.successRate * 100).toFixed(0);
              const rateColor = v.successRate >= 0.8 ? green : v.successRate >= 0.5 ? yellow : red;
              const steps = v.steps.map((s: { toolName: string }) => s.toolName).join(" \u2192 ");
              stdout.write(
                `  ${rateColor(rate + "%")} ${bold(v.name)} ` +
                `${dim(`conf:${v.confidence.toFixed(2)}`)} ` +
                `${dim(steps)}\n`
              );
              if (v.triggers.length > 0) {
                stdout.write(dim(`       triggers: ${v.triggers.slice(0, 3).join(", ")}`) + "\n");
              }
            }
          }
          stdout.write("\n");
          stdout.write(dim("  Use /vidhi inspect <name> for details.\n\n"));
        }
      } catch (err) {
        stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
      }
      return { handled: true };
    }

    case "/pratyabhijna": {
      try {
        const { Pratyabhijna } = await import("@chitragupta/anina");
        const { DatabaseManager } = await import("@chitragupta/smriti");

        const project = ctx.projectPath ?? process.cwd();
        const pratyabhijna = new Pratyabhijna();

        // Try to load the most recent context from the database
        const db = DatabaseManager.instance();
        const prevCtx = pratyabhijna.loadPrevious(project, db);

        stdout.write("\n" + bold("\u092A\u094D\u0930\u0924\u094D\u092F\u092D\u093F\u091C\u094D\u091E\u093E Pratyabhijna") + dim(" \u2014 Self-Recognition") + "\n\n");

        if (!prevCtx) {
          stdout.write(dim("  No identity context available yet.\n"));
          stdout.write(dim("  The agent builds self-recognition after accumulating vasanas and samskaras.\n\n"));
          return { handled: true };
        }

        // Narrative
        stdout.write("  " + bold("Identity Narrative:") + "\n");
        for (const line of prevCtx.identitySummary.split("\n")) {
          stdout.write("    " + line + "\n");
        }
        stdout.write("\n");

        // Tool mastery
        const tools = Object.entries(prevCtx.toolMastery)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5);
        if (tools.length > 0) {
          stdout.write("  " + bold("Tool Mastery:") + "\n");
          for (const [name, rate] of tools) {
            const pct = Math.round(rate * 100);
            const bar = renderMiniBar(rate, 0, 1, 15, red, green);
            stdout.write(`    ${bar} ${bold(name)} ${dim(pct + "%")}\n`);
          }
          stdout.write("\n");
        }

        // Cross-project insights
        if (prevCtx.crossProjectInsights.length > 0) {
          stdout.write("  " + bold("Cross-Project Insights:") + "\n");
          for (const insight of prevCtx.crossProjectInsights) {
            stdout.write(`    ${dim("\u2022")} ${insight}\n`);
          }
          stdout.write("\n");
        }

        stdout.write(dim(`  Warmup: ${prevCtx.warmupMs.toFixed(1)}ms  Session: ${prevCtx.sessionId.slice(0, 8)}\n\n`));
      } catch (err) {
        stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
      }
      return { handled: true };
    }

    // ─── Phase 2: Intelligence Layer Commands ──────────────────────────────

    case "/turiya": {
      const turiyaSubCmd = parts[1];

      try {
        const { TuriyaRouter } = await import("@chitragupta/swara");

        // Try to get a session-level TuriyaRouter instance from the agent
        // If unavailable, create a fresh one to show the structure
        const agentAny = ctx.agent as unknown as Record<string, unknown>;
        let router: InstanceType<typeof TuriyaRouter> | undefined;

        if (agentAny._turiyaRouter && agentAny._turiyaRouter instanceof TuriyaRouter) {
          router = agentAny._turiyaRouter;
        } else {
          router = new TuriyaRouter();
        }

        const stats = router.getStats();

        if (turiyaSubCmd === "routing-stats" || turiyaSubCmd === "routing") {
          // Detailed per-tier breakdown
          stdout.write("\n" + bold("तुरीय Turiya") + dim(" — Routing Statistics") + "\n\n");

          stdout.write("  " + bold("Per-Tier Breakdown:") + "\n");
          for (const tier of stats.tiers) {
            const callPct = stats.totalRequests > 0
              ? ((tier.calls / stats.totalRequests) * 100).toFixed(1)
              : "0.0";
            const avgReward = tier.averageReward.toFixed(3);
            const rewardColor = tier.averageReward >= 0.7 ? green
              : tier.averageReward >= 0.4 ? yellow : red;
            const bar = renderMiniBar(tier.averageReward, 0, 1, 15, red, green);

            stdout.write(
              `    ${bold(tier.tier.padEnd(8))} ` +
              `${cyan(String(tier.calls).padStart(4))} calls (${callPct}%)  ` +
              `${bar} ${rewardColor("avg:" + avgReward)}  ` +
              `${dim("$" + tier.totalCost.toFixed(4))}\n`
            );
          }

          stdout.write("\n");
          stdout.write("  " + bold("Cost Summary:") + "\n");
          stdout.write(`    Actual cost:   ${cyan("$" + stats.totalCost.toFixed(4))}\n`);
          stdout.write(`    Opus baseline: ${dim("$" + stats.opusBaselineCost.toFixed(4))}\n`);

          const savingsColor = stats.savingsPercent >= 50 ? green
            : stats.savingsPercent >= 20 ? yellow : red;
          stdout.write(`    Savings:       ${savingsColor("$" + stats.costSavings.toFixed(4) + " (" + stats.savingsPercent.toFixed(1) + "%)")}\n\n`);
        } else {
          // Default overview
          stdout.write("\n" + bold("तुरीय Turiya") + dim(" — Meta-Observer & Contextual Model Router") + "\n\n");

          stdout.write("  " + bold("Total Requests:") + " " + cyan(String(stats.totalRequests)) + "\n");

          // Show tier distribution as a compact summary
          const activeTiers = stats.tiers.filter(t => t.calls > 0);
          if (activeTiers.length > 0) {
            stdout.write("  " + bold("Distribution:") + "\n");
            for (const tier of activeTiers) {
              const pct = stats.totalRequests > 0
                ? (tier.calls / stats.totalRequests)
                : 0;
              const bar = renderProgressBar(pct, 20);
              stdout.write(`    ${tier.tier.padEnd(8)} ${bar} ${dim(String(tier.calls) + " calls")}\n`);
            }
          } else {
            stdout.write(dim("  No requests routed yet.\n"));
          }

          stdout.write("\n");

          // Cost savings
          const savingsColor = stats.savingsPercent >= 50 ? green
            : stats.savingsPercent >= 20 ? yellow : dim;
          stdout.write("  " + bold("Cost Savings:") + " " +
            savingsColor(stats.savingsPercent.toFixed(1) + "% vs always-opus") +
            dim(" ($" + stats.costSavings.toFixed(4) + " saved)") + "\n");
          stdout.write("\n");
          stdout.write(dim("  Use /turiya routing-stats for detailed per-tier breakdown.\n\n"));
        }
      } catch (err) {
        stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
      }
      return { handled: true };
    }

    case "/health": {
      try {
        const { Triguna } = await import("@chitragupta/anina");

        // Try to get the existing Triguna instance from the agent/chetana
        const agentAny = ctx.agent as unknown as Record<string, unknown>;
        let triguna: InstanceType<typeof Triguna> | undefined;

        // The ChetanaController may hold a Triguna instance
        const chetana = agentAny._chetana as Record<string, unknown> | undefined;
        if (chetana?.triguna && chetana.triguna instanceof Triguna) {
          triguna = chetana.triguna;
        }

        if (!triguna) {
          // Fall back: create a default one for display
          triguna = new Triguna();
        }

        const state = triguna.getState();
        const dominant = triguna.getDominant();
        const trend = triguna.getTrend();

        stdout.write("\n" + bold("त्रिगुण Triguna") + dim(" — System Health Monitor") + "\n\n");

        // Three guna bars
        const barWidth = 25;
        const sattvaBar = renderMiniBar(state.sattva, 0, 1, barWidth, dim, green);
        const rajasBar = renderMiniBar(state.rajas, 0, 1, barWidth, dim, yellow);
        const tamasBar = renderMiniBar(state.tamas, 0, 1, barWidth, dim, red);

        const trendArrow = (dir: string) =>
          dir === "rising" ? green("↑") : dir === "falling" ? red("↓") : dim("→");

        stdout.write(`  ${green("Sattva")}  ${sattvaBar} ${bold((state.sattva * 100).toFixed(1) + "%")} ${trendArrow(trend.sattva)}\n`);
        stdout.write(`  ${yellow("Rajas")}   ${rajasBar} ${bold((state.rajas * 100).toFixed(1) + "%")} ${trendArrow(trend.rajas)}\n`);
        stdout.write(`  ${red("Tamas")}   ${tamasBar} ${bold((state.tamas * 100).toFixed(1) + "%")} ${trendArrow(trend.tamas)}\n`);

        stdout.write("\n");

        // Behavioral mode
        const modeColor = dominant === "sattva" ? green
          : dominant === "rajas" ? yellow : red;
        const modeLabel = dominant === "sattva" ? "Harmonious — system is healthy and balanced"
          : dominant === "rajas" ? "Hyperactive — high throughput, elevated stress"
          : "Degraded — errors or stagnation detected";
        stdout.write("  " + bold("Mode:") + " " + modeColor(dominant) + dim(" — " + modeLabel) + "\n");

        // Recent trend summary
        const trendParts: string[] = [];
        if (trend.sattva !== "stable") trendParts.push(`sattva ${trend.sattva}`);
        if (trend.rajas !== "stable") trendParts.push(`rajas ${trend.rajas}`);
        if (trend.tamas !== "stable") trendParts.push(`tamas ${trend.tamas}`);
        if (trendParts.length > 0) {
          stdout.write("  " + bold("Trend:") + " " + dim(trendParts.join(", ")) + "\n");
        } else {
          stdout.write("  " + bold("Trend:") + " " + dim("All gunas stable") + "\n");
        }

        stdout.write("\n");
      } catch (err) {
        stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
      }
      return { handled: true };
    }

    case "/rta": {
      const rtaSubCmd = parts[1];

      try {
        const { RtaEngine } = await import("@chitragupta/dharma");
        const rta = new RtaEngine();

        if (rtaSubCmd === "audit") {
          // Show audit log
          const log = rta.getAuditLog(20);

          stdout.write("\n" + bold("ऋत Rta") + dim(" — Audit Log") + "\n\n");

          if (log.length === 0) {
            stdout.write(dim("  No audit entries yet. Rta checks are recorded when tools are invoked.\n\n"));
          } else {
            for (const entry of log) {
              const status = entry.allowed ? green("ALLOW") : red("BLOCK");
              const age = formatAge(entry.timestamp);
              stdout.write(
                `  ${status} ${bold(entry.ruleId.replace("rta:", ""))} ` +
                `${dim("tool:" + entry.toolName)} ` +
                `${dim(age + " ago")}` +
                (entry.reason ? `\n         ${dim(entry.reason)}` : "") +
                "\n"
              );
            }
            stdout.write("\n");
          }
        } else {
          // Default: show all rules
          const rules = rta.getRules();
          const auditLog = rta.getAuditLog();

          stdout.write("\n" + bold("ऋत Rta") + dim(" — Invariant Rules (Cosmic Order)") + "\n\n");

          for (const rule of rules) {
            // Count violations for this rule
            const violations = auditLog.filter(e => e.ruleId === rule.id && !e.allowed).length;
            const checks = auditLog.filter(e => e.ruleId === rule.id).length;

            const statusColor = violations > 0 ? yellow : green;
            const statusLabel = violations > 0
              ? `${violations} violation${violations > 1 ? "s" : ""}`
              : "clean";

            stdout.write(
              `  ${bold(rule.id.replace("rta:", "").toUpperCase().padEnd(26))} ` +
              `${statusColor(statusLabel.padEnd(14))} ` +
              `${dim(String(checks) + " checks")}\n`
            );
            stdout.write(`  ${dim(rule.description)}\n\n`);
          }

          stdout.write(dim("  Use /rta audit to see recent audit log entries.\n\n"));
        }
      } catch (err) {
        stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
      }
      return { handled: true };
    }

    case "/buddhi": {
      const buddhiSubCmd = parts[1];
      const buddhiArgs = parts.slice(2);

      try {
        const { Buddhi } = await import("@chitragupta/anina");
        const { DatabaseManager } = await import("@chitragupta/smriti");

        const buddhi = new Buddhi();
        const db = DatabaseManager.instance();
        const project = ctx.projectPath ?? process.cwd();

        if (buddhiSubCmd === "explain" && buddhiArgs.length > 0) {
          // Explain a specific decision
          const decisionId = buddhiArgs.join(" ");
          const explanation = buddhi.explainDecision(decisionId, db);

          stdout.write("\n" + bold("बुद्धि Buddhi") + dim(" — Decision Explanation") + "\n\n");

          if (!explanation) {
            stdout.write(red(`  Decision not found: ${decisionId}\n\n`));
          } else {
            // Render the Nyaya syllogism with colors
            const decision = buddhi.getDecision(decisionId, db);
            if (decision) {
              const confPct = Math.round(decision.confidence * 100);
              const confColor = decision.confidence >= 0.8 ? green
                : decision.confidence >= 0.5 ? yellow : red;

              stdout.write("  " + bold("Decision:") + " " + decision.description + "\n");
              stdout.write("  " + bold("Category:") + " " + cyan(decision.category) +
                " | " + bold("Confidence:") + " " + confColor(confPct + "%") + "\n\n");

              stdout.write("  " + bold("--- Nyaya Reasoning (Panchavayava) ---") + "\n");
              stdout.write("  " + cyan("1. Pratijña (Thesis):") + "     " + decision.reasoning.thesis + "\n");
              stdout.write("  " + cyan("2. Hetu (Reason):") + "         " + decision.reasoning.reason + "\n");
              stdout.write("  " + cyan("3. Udaharana (Example):") + "   " + decision.reasoning.example + "\n");
              stdout.write("  " + cyan("4. Upanaya (Application):") + " " + decision.reasoning.application + "\n");
              stdout.write("  " + cyan("5. Nigamana (Conclusion):") + " " + decision.reasoning.conclusion + "\n");

              if (decision.alternatives.length > 0) {
                stdout.write("\n  " + bold("Alternatives Considered:") + "\n");
                for (const alt of decision.alternatives) {
                  stdout.write(`    ${dim("•")} ${alt.description}: ${dim(alt.reason_rejected)}\n`);
                }
              }

              stdout.write("\n  " + bold("Outcome:") + " ");
              if (decision.outcome) {
                const outcomeColor = decision.outcome.success ? green : red;
                stdout.write(outcomeColor(decision.outcome.success ? "Success" : "Failure"));
                if (decision.outcome.feedback) {
                  stdout.write(" — " + dim(decision.outcome.feedback));
                }
              } else {
                stdout.write(dim("Pending"));
              }
              stdout.write("\n\n");
            }
          }
        } else {
          // Default: show recent decisions
          const decisions = buddhi.listDecisions({ project, limit: 10 }, db);

          stdout.write("\n" + bold("बुद्धि Buddhi") + dim(` — Recent Decisions (${project.split("/").pop()})`) + "\n\n");

          if (decisions.length === 0) {
            stdout.write(dim("  No decisions recorded yet. Buddhi logs agent decisions with formal Nyaya reasoning.\n\n"));
          } else {
            for (const d of decisions) {
              const confPct = Math.round(d.confidence * 100);
              const confColor = d.confidence >= 0.8 ? green
                : d.confidence >= 0.5 ? yellow : red;
              const age = formatAge(d.timestamp);

              const outcomeIcon = d.outcome
                ? (d.outcome.success ? green("✓") : red("✗"))
                : dim("○");

              stdout.write(
                `  ${outcomeIcon} ${confColor(confPct + "%")} ${bold(d.category.padEnd(16))} ` +
                `${d.description.slice(0, 50)}${d.description.length > 50 ? "…" : ""} ` +
                `${dim(age + " ago")}\n`
              );
              stdout.write(dim(`    id: ${d.id}\n`));
            }

            stdout.write("\n" + dim("  Use /buddhi explain <id> for full Nyaya reasoning.\n\n"));
          }
        }
      } catch (err) {
        stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
      }
      return { handled: true };
    }

    // ─── Phase 3: Samiti, Sabha, Lokapala, Akasha ─────────────────────────

    case "/samiti": {
      try {
        const { Samiti } = await import("@chitragupta/sutra");

        // Try to get an existing Samiti from the agent context, otherwise create fresh
        const agentAny = ctx.agent as unknown as Record<string, unknown>;
        let samiti: InstanceType<typeof Samiti> | undefined;

        if (agentAny._samiti && agentAny._samiti instanceof Samiti) {
          samiti = agentAny._samiti;
        } else if (agentAny.samiti && agentAny.samiti instanceof Samiti) {
          samiti = agentAny.samiti;
        }

        if (!samiti) {
          samiti = new Samiti();
        }

        const samitiStats = samiti.stats();
        const channels = samiti.listChannels();

        stdout.write("\n" + bold("\u0938\u093E\u092E\u0940\u0924\u093F Samiti") + dim(" \u2014 Ambient Communication Channels") + "\n\n");

        // Overview stats
        stdout.write("  " + bold("Channels:") + " " + cyan(String(samitiStats.channels)) +
          "  " + bold("Messages:") + " " + cyan(String(samitiStats.totalMessages)) +
          "  " + bold("Subscribers:") + " " + cyan(String(samitiStats.subscribers)) + "\n\n");

        if (channels.length === 0) {
          stdout.write(dim("  No channels active.\n"));
        } else {
          for (const ch of channels) {
            const msgCount = ch.messages.length;
            const subCount = ch.subscribers.size;
            const msgColor = msgCount > 0 ? yellow : dim;

            stdout.write(
              `  ${bold(ch.name.padEnd(18))} ` +
              `${msgColor(String(msgCount).padStart(3) + " msgs")}  ` +
              `${dim(String(subCount) + " subs")}  ` +
              `${dim(ch.description.slice(0, 45))}\n`
            );

            // Show most recent messages (up to 3)
            const recent = ch.messages.slice(-3);
            for (const msg of recent) {
              const sevColor = msg.severity === "critical" ? red
                : msg.severity === "warning" ? yellow : dim;
              const age = formatAge(msg.timestamp);
              stdout.write(
                `    ${sevColor("\u25CF")} ${dim(age + " ago")} ` +
                `${sevColor(`[${msg.severity}]`)} ${msg.content.slice(0, 60)}` +
                `${msg.content.length > 60 ? "..." : ""}\n`
              );
            }
          }
        }

        stdout.write("\n");
      } catch (err) {
        stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
      }
      return { handled: true };
    }

    case "/sabha": {
      try {
        const { SabhaEngine } = await import("@chitragupta/sutra");

        // Try to get an existing SabhaEngine from the agent context
        const agentAny = ctx.agent as unknown as Record<string, unknown>;
        let engine: InstanceType<typeof SabhaEngine> | undefined;

        if (agentAny._sabhaEngine && agentAny._sabhaEngine instanceof SabhaEngine) {
          engine = agentAny._sabhaEngine;
        } else if (agentAny.sabhaEngine && agentAny.sabhaEngine instanceof SabhaEngine) {
          engine = agentAny.sabhaEngine;
        }

        if (!engine) {
          engine = new SabhaEngine();
        }

        const active = engine.listActive();

        stdout.write("\n" + bold("\u0938\u092D\u093E Sabha") + dim(" \u2014 Multi-Agent Deliberation Protocol") + "\n\n");

        if (active.length === 0) {
          stdout.write(dim("  No active deliberations. Use Sabha when multi-agent consensus is needed.\n"));
        } else {
          stdout.write("  " + bold("Active Deliberations:") + " " + cyan(String(active.length)) + "\n\n");

          for (const s of active) {
            const statusColor = s.status === "voting" ? yellow
              : s.status === "deliberating" ? cyan
              : s.status === "convened" ? green : dim;
            const roundCount = s.rounds.length;
            const age = formatAge(s.createdAt);

            stdout.write(
              `  ${statusColor("\u25CF")} ${bold(s.topic.slice(0, 50))} ` +
              `${statusColor(`[${s.status}]`)} ` +
              `${dim(`${roundCount} round(s), ${s.participants.length} participants, ${age} ago`)}\n`
            );

            // Show latest round verdict if available
            if (roundCount > 0) {
              const latestRound = s.rounds[roundCount - 1];
              const challengeCount = latestRound.challenges.length;
              const voteCount = latestRound.votes.length;
              const verdictLabel = latestRound.verdict ?? "pending";
              const verdictColor = verdictLabel === "accepted" ? green
                : verdictLabel === "rejected" ? red
                : verdictLabel === "no-consensus" ? yellow : dim;

              stdout.write(
                `    Round ${latestRound.roundNumber}: ` +
                `${dim(`${voteCount} vote(s), ${challengeCount} challenge(s)`)} ` +
                `${verdictColor(verdictLabel)}\n`
              );
            }
          }
        }

        stdout.write("\n");
      } catch (err) {
        stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
      }
      return { handled: true };
    }

    case "/lokapala": {
      try {
        const { LokapalaController } = await import("@chitragupta/anina");

        // Try to get an existing LokapalaController from the agent context
        const agentAny = ctx.agent as unknown as Record<string, unknown>;
        let controller: InstanceType<typeof LokapalaController> | undefined;

        if (agentAny._lokapala && agentAny._lokapala instanceof LokapalaController) {
          controller = agentAny._lokapala;
        } else if (agentAny.lokapala && agentAny.lokapala instanceof LokapalaController) {
          controller = agentAny.lokapala;
        }

        if (!controller) {
          stdout.write(yellow("\n  Lokapala guardians are not active in this session.\n"));
          stdout.write(dim("  Guardians start automatically when the agent is configured with lokapala.\n\n"));
          return { handled: true };
        }

        const guardianStats = controller.stats();
        const recentFindings = controller.allFindings(15);
        const criticals = controller.criticalFindings();

        stdout.write("\n" + bold("\u0932\u094B\u0915\u092A\u093E\u0932 Lokapala") + dim(" \u2014 Guardian Agents") + "\n\n");

        // Guardian health overview
        const domains: Array<{ name: string; label: string; color: (s: string) => string }> = [
          { name: "security", label: "\u0930\u0915\u094D\u0937\u0915 Rakshaka", color: red },
          { name: "performance", label: "\u0917\u0924\u093F Gati", color: yellow },
          { name: "correctness", label: "\u0938\u0924\u094D\u092F Satya", color: cyan },
        ];

        for (const d of domains) {
          const s = guardianStats[d.name as keyof typeof guardianStats];
          const total = s.findingsTotal;
          const critCount = s.findingsBySeverity["critical"] ?? 0;
          const warnCount = s.findingsBySeverity["warning"] ?? 0;
          const infoCount = s.findingsBySeverity["info"] ?? 0;
          const lastScan = s.lastScanAt > 0 ? formatAge(s.lastScanAt) + " ago" : "never";

          stdout.write(
            `  ${d.color(bold(d.label))}\n` +
            `    Scans: ${cyan(String(s.scansCompleted))}  ` +
            `Findings: ${total > 0 ? yellow(String(total)) : dim("0")}  ` +
            `${critCount > 0 ? red("C:" + critCount) : dim("C:0")} ` +
            `${warnCount > 0 ? yellow("W:" + warnCount) : dim("W:0")} ` +
            `${dim("I:" + infoCount)}  ` +
            `Last: ${dim(lastScan)}\n`
          );
        }

        // Recent violations
        if (recentFindings.length > 0) {
          stdout.write("\n  " + bold("Recent Findings:") + "\n");
          for (const f of recentFindings.slice(0, 8)) {
            const sevColor = f.severity === "critical" ? red
              : f.severity === "warning" ? yellow : dim;
            const age = formatAge(f.timestamp);
            stdout.write(
              `    ${sevColor("\u25CF")} ${sevColor(`[${f.severity}]`)} ` +
              `${bold(f.domain)} ${f.title.slice(0, 45)} ` +
              `${dim(age + " ago")}\n`
            );
          }
        }

        if (criticals.length > 0) {
          stdout.write("\n  " + red(bold(`${criticals.length} critical finding(s) require attention!`)) + "\n");
        }

        stdout.write("\n");
      } catch (err) {
        stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
      }
      return { handled: true };
    }

    case "/akasha": {
      try {
        const { AkashaField } = await import("@chitragupta/smriti");

        // Try to get an existing AkashaField from the agent context
        const agentAny = ctx.agent as unknown as Record<string, unknown>;
        let field: InstanceType<typeof AkashaField> | undefined;

        if (agentAny._akasha && agentAny._akasha instanceof AkashaField) {
          field = agentAny._akasha;
        } else if (agentAny.akasha && agentAny.akasha instanceof AkashaField) {
          field = agentAny.akasha;
        }

        if (!field) {
          field = new AkashaField();
        }

        const akashaStats = field.stats();
        const strongest = field.strongest(5);

        stdout.write("\n" + bold("\u0906\u0915\u093E\u0936 Akasha") + dim(" \u2014 Shared Knowledge Field (Stigmergy)") + "\n\n");

        // Overview
        stdout.write("  " + bold("Total Traces:") + " " + cyan(String(akashaStats.totalTraces)) +
          "  " + bold("Active:") + " " + cyan(String(akashaStats.activeTraces)) +
          "  " + bold("Avg Strength:") + " " + dim(akashaStats.avgStrength.toFixed(3)) +
          "  " + bold("Reinforcements:") + " " + dim(String(akashaStats.totalReinforcements)) + "\n\n");

        // Trace counts by type
        const typeEntries = Object.entries(akashaStats.byType).filter(([, count]) => count > 0);
        if (typeEntries.length > 0) {
          stdout.write("  " + bold("By Type:") + " ");
          stdout.write(typeEntries.map(([type, count]) => {
            const typeColor = type === "warning" ? yellow
              : type === "solution" ? green
              : type === "correction" ? red : cyan;
            return typeColor(type) + dim(":" + count);
          }).join("  "));
          stdout.write("\n\n");
        }

        // Strongest traces
        if (strongest.length > 0) {
          stdout.write("  " + bold("Strongest Traces:") + "\n");
          for (const trace of strongest) {
            const strengthBar = renderMiniBar(trace.strength, 0, 1, 12, dim, green);
            const typeColor = trace.traceType === "warning" ? yellow
              : trace.traceType === "solution" ? green
              : trace.traceType === "correction" ? red : cyan;
            const age = formatAge(trace.createdAt);

            stdout.write(
              `    ${strengthBar} ${typeColor(`[${trace.traceType}]`)} ` +
              `${bold(trace.topic.slice(0, 35))} ` +
              `${dim(`str:${trace.strength.toFixed(2)} +${trace.reinforcements}`)} ` +
              `${dim(age + " ago")}\n`
            );
          }
        } else {
          stdout.write(dim("  No traces deposited yet. Agents leave traces as they solve problems.\n"));
        }

        if (akashaStats.strongestTopic) {
          stdout.write("\n  " + bold("Strongest Topic:") + " " + cyan(akashaStats.strongestTopic) + "\n");
        }

        stdout.write("\n");
      } catch (err) {
        stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
      }
      return { handled: true };
    }

    // ─── Phase 4: Kartavya, Kala Chakra ─────────────────────────────────────

    case "/kartavya": {
      try {
        const { KartavyaEngine } = await import("@chitragupta/niyanta");

        // Try to get an existing KartavyaEngine from the agent context
        const agentAny = ctx.agent as unknown as Record<string, unknown>;
        let engine: InstanceType<typeof KartavyaEngine> | undefined;

        if (agentAny._kartavya && agentAny._kartavya instanceof KartavyaEngine) {
          engine = agentAny._kartavya;
        } else if (agentAny.kartavya && agentAny.kartavya instanceof KartavyaEngine) {
          engine = agentAny.kartavya;
        }

        if (!engine) {
          engine = new KartavyaEngine();
        }

        const kartavyaStats = engine.stats();
        const activeKartavyas = engine.listActive();
        const pendingNiyamas = engine.getPendingNiyamas();

        stdout.write("\n" + bold("\u0915\u0930\u094D\u0924\u0935\u094D\u092F Kartavya") + dim(" \u2014 Auto-Execution Pipeline") + "\n\n");

        // Overview
        stdout.write("  " + bold("Total:") + " " + cyan(String(kartavyaStats.total)) +
          "  " + bold("Active:") + " " + green(String(kartavyaStats.active)) +
          "  " + bold("Paused:") + " " + yellow(String(kartavyaStats.paused)) +
          "  " + bold("Pending Niyamas:") + " " + cyan(String(kartavyaStats.proposed)) + "\n");

        const rateColor = kartavyaStats.successRate >= 0.8 ? green
          : kartavyaStats.successRate >= 0.5 ? yellow : red;
        stdout.write("  " + bold("Success Rate:") + " " + rateColor((kartavyaStats.successRate * 100).toFixed(1) + "%") +
          "  " + bold("Executions/hr:") + " " + dim(String(kartavyaStats.executionsThisHour)) + "\n\n");

        // Pending niyama proposals
        if (pendingNiyamas.length > 0) {
          stdout.write("  " + bold(yellow("Pending Proposals (Niyama):")) + "\n");
          for (const p of pendingNiyamas.slice(0, 5)) {
            const age = formatAge(p.createdAt);
            stdout.write(
              `    ${yellow("\u25CB")} ${bold(p.name)} ` +
              `${dim(`conf:${p.confidence.toFixed(2)} trigger:${p.proposedTrigger.type}`)} ` +
              `${dim(age + " ago")}\n`
            );
          }
          stdout.write("\n");
        }

        // Active kartavyas
        if (activeKartavyas.length > 0) {
          stdout.write("  " + bold("Active Duties:") + "\n");
          for (const k of activeKartavyas.slice(0, 8)) {
            const totalExec = k.successCount + k.failureCount;
            const rate = totalExec > 0 ? (k.successCount / totalExec * 100).toFixed(0) : "--";
            const rateCol = totalExec > 0 && k.successCount / totalExec >= 0.8 ? green : yellow;
            const lastExec = k.lastExecuted ? formatAge(k.lastExecuted) + " ago" : "never";

            stdout.write(
              `    ${green("\u25CF")} ${bold(k.name)} ` +
              `${dim(`[${k.trigger.type}]`)} ` +
              `${rateCol(rate + "%")} ` +
              `${dim(`(${totalExec} exec)`)} ` +
              `${dim("last: " + lastExec)}\n`
            );
          }
        } else {
          stdout.write(dim("  No active kartavyas. Promote vasanas through the niyama pipeline.\n"));
        }

        stdout.write("\n");
      } catch (err) {
        stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
      }
      return { handled: true };
    }

    case "/kala": {
      try {
        const { KalaChakra, TEMPORAL_SCALES } = await import("@chitragupta/smriti");

        // Try to get an existing KalaChakra from the agent context
        const agentAny = ctx.agent as unknown as Record<string, unknown>;
        let kala: InstanceType<typeof KalaChakra> | undefined;

        if (agentAny._kalaChakra && agentAny._kalaChakra instanceof KalaChakra) {
          kala = agentAny._kalaChakra;
        } else if (agentAny.kalaChakra && agentAny.kalaChakra instanceof KalaChakra) {
          kala = agentAny.kalaChakra;
        }

        if (!kala) {
          kala = new KalaChakra();
        }

        const decayRates = kala.decayRates;
        const scaleWeights = kala.scaleWeights;

        stdout.write("\n" + bold("\u0915\u093E\u0932 \u091A\u0915\u094D\u0930 Kala Chakra") + dim(" \u2014 Multi-Scale Temporal Awareness") + "\n\n");

        // Display scales with their weights and decay half-lives
        stdout.write("  " + bold("Scale".padEnd(10)) + " " +
          bold("Weight".padEnd(8)) + " " +
          bold("Half-Life".padEnd(12)) + " " +
          bold("Relevance Now".padEnd(14)) + "\n");
        stdout.write("  " + dim("\u2500".repeat(50)) + "\n");

        for (const scale of TEMPORAL_SCALES) {
          const weight = scaleWeights[scale];
          const halfLife = decayRates[scale];
          const halfLifeStr = formatDuration(halfLife);
          const weightBar = renderMiniBar(weight, 0, 0.3, 10, dim, cyan);

          // Test relevance at a few sample time distances
          const now = Date.now();
          const relevance1h = kala.relevanceScore(now - 3_600_000, now);
          const dominantNow = kala.dominantScale(0);

          stdout.write(
            `  ${scale === dominantNow ? cyan(bold(scale.padEnd(10))) : dim(scale.padEnd(10))} ` +
            `${weightBar} ${dim(weight.toFixed(2).padStart(5))} ` +
            `${dim(halfLifeStr.padEnd(12))}` + "\n"
          );
        }

        stdout.write("\n");

        // Show temporal relevance at sample distances
        stdout.write("  " + bold("Relevance Decay Samples:") + "\n");
        const sampleDistances = [
          { label: "5 min ago", ms: 300_000 },
          { label: "1 hour ago", ms: 3_600_000 },
          { label: "1 day ago", ms: 86_400_000 },
          { label: "1 week ago", ms: 7 * 86_400_000 },
          { label: "1 month ago", ms: 30 * 86_400_000 },
          { label: "1 year ago", ms: 365 * 86_400_000 },
        ];

        const now = Date.now();
        for (const sample of sampleDistances) {
          const rel = kala.relevanceScore(now - sample.ms, now);
          const boosted = kala.boostScore(1.0, now - sample.ms, now);
          const relBar = renderMiniBar(rel, 0, 1, 15, red, green);
          const dominant = kala.dominantScale(sample.ms);

          stdout.write(
            `    ${dim(sample.label.padEnd(14))} ${relBar} ${dim(rel.toFixed(3))} ` +
            `${dim("boost:" + boosted.toFixed(3))} ` +
            `${dim("[" + dominant + "]")}\n`
          );
        }

        stdout.write("\n");
      } catch (err) {
        stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
      }
      return { handled: true };
    }

    // ─── Phase 5.2: Atman — Complete Soul Report ────────────────────────────

    case "/atman": {
      stdout.write("\n");
      stdout.write(bold(magenta("  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550")) + "\n");
      stdout.write(bold(magenta("  \u0906\u0924\u094D\u092E\u0928\u094D Atman \u2014 The Soul of the Agent")) + "\n");
      stdout.write(bold(magenta("  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550")) + "\n\n");

      // ─── 1. Identity ──────────────────────────────────────────────────
      {
        const agentAny = ctx.agent as unknown as Record<string, unknown>;
        const profile = (agentAny.profile ?? agentAny._profile ?? {}) as Record<string, unknown>;
        const agentName = (profile.name ?? "chitragupta") as string;
        const sessionId = ((agentAny.sessionId ?? agentAny._sessionId ?? "") as string).slice(0, 12) || dim("none");
        const uptime = agentAny._startedAt
          ? formatDuration(Date.now() - (agentAny._startedAt as number))
          : dim("unknown");

        stdout.write("  " + bold(cyan("1. Identity")) + "\n");
        stdout.write(`    Agent:    ${bold(agentName)}\n`);
        stdout.write(`    Model:    ${cyan(ctx.currentModel)}\n`);
        stdout.write(`    Thinking: ${cyan(ctx.currentThinking)}\n`);
        stdout.write(`    Session:  ${dim(String(sessionId))}\n`);
        stdout.write(`    Uptime:   ${dim(String(uptime))}\n`);
        stdout.write(`    Turns:    ${dim(String(stats.turnCount))}\n`);
        stdout.write("\n");
      }

      // ─── 2. Consciousness (Chetana) ──────────────────────────────────
      try {
        const chetana = ctx.agent.getChetana();
        if (chetana) {
          const report = chetana.getCognitiveReport();
          stdout.write("  " + bold(magenta("2. \u091A\u0947\u0924\u0928\u093E Consciousness")) + "\n");

          // Bhava (Affect) — compact
          const v = report.affect.valence;
          const a = report.affect.arousal;
          const c = report.affect.confidence;
          const f = report.affect.frustration;
          stdout.write(`    Bhava:    val:${v >= 0 ? green(v.toFixed(2)) : red(v.toFixed(2))} ` +
            `aro:${yellow(a.toFixed(2))} conf:${c >= 0.7 ? green(c.toFixed(2)) : dim(c.toFixed(2))} ` +
            `frust:${f >= 0.5 ? red(f.toFixed(2)) : dim(f.toFixed(2))}\n`);

          // Dhyana (Attention) — top concepts
          if (report.topConcepts.length > 0) {
            stdout.write(`    Dhyana:   ${report.topConcepts.slice(0, 4).map((tc: { concept: string; weight: number }) =>
              cyan(tc.concept) + dim("(" + tc.weight.toFixed(1) + ")")
            ).join(" ")}\n`);
          }

          // Sankalpa (Goals) — active count
          const activeGoals = report.intentions.filter((i: { status: string }) => i.status === "active");
          const achievedGoals = report.intentions.filter((i: { status: string }) => i.status === "achieved");
          stdout.write(`    Sankalpa: ${green(String(activeGoals.length) + " active")} ` +
            `${dim(achievedGoals.length + " achieved")}\n`);

          stdout.write("\n");
        }
      } catch {
        // Chetana not available — skip silently
      }

      // ─── 3. Self-Model (Atma-Darshana) ───────────────────────────────
      try {
        const chetana = ctx.agent.getChetana();
        if (chetana) {
          const report = chetana.getCognitiveReport();
          stdout.write("  " + bold(green("3. \u0906\u0924\u094D\u092E\u0926\u0930\u094D\u0936\u0928 Self-Model")) + "\n");

          const cal = report.selfSummary.calibration;
          const calLabel = cal > 1.2 ? red("overconfident") : cal < 0.8 ? yellow("underconfident") : green("calibrated");
          stdout.write(`    Calibration: ${cal.toFixed(2)} (${calLabel})\n`);

          if (report.selfSummary.topTools.length > 0) {
            stdout.write("    Top Tools: ");
            stdout.write(report.selfSummary.topTools.slice(0, 4).map((t: { tool: string; mastery: { successRate: number } }) => {
              const rate = t.mastery.successRate;
              const rateColor = rate >= 0.8 ? green : rate >= 0.5 ? yellow : red;
              return `${t.tool} ${rateColor((rate * 100).toFixed(0) + "%")}`;
            }).join("  "));
            stdout.write("\n");
          }

          stdout.write("\n");
        }
      } catch {
        // Self-model not available — skip silently
      }

      // ─── 4. Health (Triguna) ──────────────────────────────────────────
      try {
        const { Triguna } = await import("@chitragupta/anina");
        const agentAny = ctx.agent as unknown as Record<string, unknown>;
        let triguna: InstanceType<typeof Triguna> | undefined;

        const chetanaObj = agentAny._chetana as Record<string, unknown> | undefined;
        if (chetanaObj?.triguna && chetanaObj.triguna instanceof Triguna) {
          triguna = chetanaObj.triguna;
        }

        if (triguna) {
          const state = triguna.getState();
          const dominant = triguna.getDominant();
          const domColor = dominant === "sattva" ? green : dominant === "rajas" ? yellow : red;

          stdout.write("  " + bold(yellow("4. \u0924\u094D\u0930\u093F\u0917\u0941\u0923 Health")) + "\n");
          stdout.write(`    ${green("Sattva")}: ${(state.sattva * 100).toFixed(0)}%  ` +
            `${yellow("Rajas")}: ${(state.rajas * 100).toFixed(0)}%  ` +
            `${red("Tamas")}: ${(state.tamas * 100).toFixed(0)}%  ` +
            `Mode: ${domColor(dominant)}\n`);
          stdout.write("\n");
        }
      } catch {
        // Triguna not available — skip silently
      }

      // ─── 5. Memory Stats ─────────────────────────────────────────────
      try {
        stdout.write("  " + bold(cyan("5. Memory")) + "\n");
        stdout.write(`    Sessions this run:  ${dim(String(stats.turnCount) + " turns")}\n`);
        stdout.write(`    Tokens consumed:    ${dim(String(stats.totalInputTokens + stats.totalOutputTokens))}\n`);
        stdout.write(`    Total cost:         ${dim("$" + stats.totalCost.toFixed(4))}\n`);

        // Try to get Akasha stats
        try {
          const { AkashaField } = await import("@chitragupta/smriti");
          const agentAny = ctx.agent as unknown as Record<string, unknown>;
          let akasha: InstanceType<typeof AkashaField> | undefined;
          if (agentAny._akasha && agentAny._akasha instanceof AkashaField) {
            akasha = agentAny._akasha;
          }
          if (akasha) {
            const akStats = akasha.stats();
            stdout.write(`    Akasha traces:      ${dim(String(akStats.totalTraces) + " (" + akStats.activeTraces + " active)")}\n`);
          }
        } catch {
          // skip
        }

        stdout.write("\n");
      } catch {
        // skip
      }

      // ─── 6. Guardians (Lokapala) ─────────────────────────────────────
      try {
        const { LokapalaController } = await import("@chitragupta/anina");
        const agentAny = ctx.agent as unknown as Record<string, unknown>;
        let lokapala: InstanceType<typeof LokapalaController> | undefined;

        if (agentAny._lokapala && agentAny._lokapala instanceof LokapalaController) {
          lokapala = agentAny._lokapala;
        }

        if (lokapala) {
          const gStats = lokapala.stats();
          const criticals = lokapala.criticalFindings();
          const totalFindings = gStats.security.findingsTotal + gStats.performance.findingsTotal + gStats.correctness.findingsTotal;

          stdout.write("  " + bold(red("6. \u0932\u094B\u0915\u092A\u093E\u0932 Guardians")) + "\n");
          stdout.write(`    Security:    ${dim(gStats.security.scansCompleted + " scans, " + gStats.security.findingsTotal + " findings")}\n`);
          stdout.write(`    Performance: ${dim(gStats.performance.scansCompleted + " scans, " + gStats.performance.findingsTotal + " findings")}\n`);
          stdout.write(`    Correctness: ${dim(gStats.correctness.scansCompleted + " scans, " + gStats.correctness.findingsTotal + " findings")}\n`);
          if (criticals.length > 0) {
            stdout.write(`    ${red(bold(criticals.length + " CRITICAL finding(s)!"))}\n`);
          } else {
            stdout.write(`    ${green("All clear")} ${dim("(" + totalFindings + " total findings)")}\n`);
          }
          stdout.write("\n");
        }
      } catch {
        // skip
      }

      // ─── 7. Tendencies (Vasana) ──────────────────────────────────────
      try {
        const { VasanaEngine } = await import("@chitragupta/smriti");
        const engine = new VasanaEngine();
        engine.restore();
        const project = ctx.projectPath ?? process.cwd();
        const vasanas = engine.getVasanas(project, 5);

        if (vasanas.length > 0) {
          stdout.write("  " + bold(yellow("7. \u0935\u093E\u0938\u0928\u093E Tendencies")) + "\n");
          for (const v of vasanas) {
            const valIcon = v.valence === "positive" ? green("\u25B2") : v.valence === "negative" ? red("\u25BC") : dim("\u25CF");
            stdout.write(
              `    ${valIcon} ${bold(v.tendency)} ` +
              `${dim(`str:${v.strength.toFixed(2)} stab:${v.stability.toFixed(2)} [${v.reinforcementCount}x]`)}\n`
            );
          }
          stdout.write("\n");
        }
      } catch {
        // skip
      }

      // ─── 8. Skills ───────────────────────────────────────────────────
      try {
        if (ctx.vidyaOrchestrator) {
          const ecosystemStats = ctx.vidyaOrchestrator.getEcosystemStats() as Record<string, unknown>;
          stdout.write("  " + bold(cyan("8. Skills")) + "\n");
          const totalSkills = ecosystemStats.totalSkills ?? ecosystemStats.total ?? 0;
          stdout.write(`    Total: ${dim(String(totalSkills))}\n`);
          stdout.write("\n");
        }
      } catch {
        // skip
      }

      // ─── 9. Channels (Samiti) ────────────────────────────────────────
      try {
        const { Samiti } = await import("@chitragupta/sutra");
        const agentAny = ctx.agent as unknown as Record<string, unknown>;
        let samiti: InstanceType<typeof Samiti> | undefined;

        if (agentAny._samiti && agentAny._samiti instanceof Samiti) {
          samiti = agentAny._samiti;
        }

        if (samiti) {
          const samitiStats = samiti.stats();
          stdout.write("  " + bold(green("9. \u0938\u093E\u092E\u0940\u0924\u093F Channels")) + "\n");
          stdout.write(`    Channels: ${dim(String(samitiStats.channels))}  ` +
            `Messages: ${dim(String(samitiStats.totalMessages))}  ` +
            `Subscribers: ${dim(String(samitiStats.subscribers))}\n`);
          stdout.write("\n");
        }
      } catch {
        // skip
      }

      // ─── 10. Temporal (Kala Chakra) ──────────────────────────────────
      try {
        const { KalaChakra } = await import("@chitragupta/smriti");
        const agentAny = ctx.agent as unknown as Record<string, unknown>;
        let kala: InstanceType<typeof KalaChakra> | undefined;

        if (agentAny._kalaChakra && agentAny._kalaChakra instanceof KalaChakra) {
          kala = agentAny._kalaChakra;
        }

        if (kala) {
          const now = Date.now();
          const rel5m = kala.relevanceScore(now - 300_000, now);
          const rel1d = kala.relevanceScore(now - 86_400_000, now);
          const rel1w = kala.relevanceScore(now - 7 * 86_400_000, now);

          stdout.write("  " + bold(magenta("10. \u0915\u093E\u0932 \u091A\u0915\u094D\u0930 Temporal")) + "\n");
          stdout.write(`    Relevance: 5m=${green(rel5m.toFixed(3))} 1d=${yellow(rel1d.toFixed(3))} 1w=${dim(rel1w.toFixed(3))}\n`);
          stdout.write("\n");
        }
      } catch {
        // skip
      }

      stdout.write(bold(magenta("  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550")) + "\n\n");

      return { handled: true };
    }

    // ─── Phase 5.5: Vayu DAG Workflows ──────────────────────────────────────

    case "/workflow": {
      const subCmd = parts[1];
      const workflowArg = parts.slice(2).join(" ").trim() || parts[1];

      try {
        if (!subCmd || subCmd === "list") {
          // /workflow or /workflow list — show available workflows
          const { listChitraguptaWorkflows, listWorkflows: listSavedWorkflows } = await import("@chitragupta/vayu");

          const builtIn = listChitraguptaWorkflows();
          const saved = listSavedWorkflows();

          stdout.write("\n" + bold("वायु Vayu") + dim(" — DAG Workflows") + "\n\n");

          if (builtIn.length > 0) {
            stdout.write("  " + bold("Built-in Workflows:") + "\n");
            for (const wf of builtIn) {
              stdout.write(
                `    ${cyan(wf.id.padEnd(18))} ${dim(String(wf.stepCount) + " steps")}  ${wf.description.slice(0, 50)}${wf.description.length > 50 ? "..." : ""}\n`
              );
            }
            stdout.write("\n");
          }

          if (saved.length > 0) {
            stdout.write("  " + bold("Custom Workflows:") + "\n");
            for (const wf of saved) {
              stdout.write(
                `    ${cyan(wf.id.padEnd(18))} ${dim(String(wf.steps.length) + " steps")}  ${wf.description.slice(0, 50)}${wf.description.length > 50 ? "..." : ""}\n`
              );
            }
            stdout.write("\n");
          }

          if (builtIn.length === 0 && saved.length === 0) {
            stdout.write(dim("  No workflows available.\n\n"));
          }

          stdout.write(dim("  /workflow show <name>    ASCII DAG visualization\n"));
          stdout.write(dim("  /workflow run <name>     Execute a workflow\n"));
          stdout.write(dim("  /workflow history        Recent execution history\n\n"));

        } else if (subCmd === "show") {
          // /workflow show <name> — render DAG visualization
          const name = parts[2];
          if (!name) {
            stdout.write(yellow("\n  Usage: /workflow show <name>\n\n"));
            return { handled: true };
          }

          const {
            getChitraguptaWorkflow,
            loadWorkflow,
            renderDAG,
          } = await import("@chitragupta/vayu");

          const workflow = getChitraguptaWorkflow(name) ?? loadWorkflow(name);
          if (!workflow) {
            stdout.write(red(`\n  Workflow not found: ${name}\n\n`));
            return { handled: true };
          }

          stdout.write("\n");
          const dagViz = renderDAG(workflow);
          for (const line of dagViz.split("\n")) {
            stdout.write("  " + line + "\n");
          }
          stdout.write("\n");

        } else if (subCmd === "run") {
          // /workflow run <name> — execute a workflow
          const name = parts[2];
          if (!name) {
            stdout.write(yellow("\n  Usage: /workflow run <name>\n\n"));
            return { handled: true };
          }

          const {
            getChitraguptaWorkflow,
            loadWorkflow,
            WorkflowExecutor,
            renderDAG,
            saveExecution,
          } = await import("@chitragupta/vayu");

          const workflow = getChitraguptaWorkflow(name) ?? loadWorkflow(name);
          if (!workflow) {
            stdout.write(red(`\n  Workflow not found: ${name}\n\n`));
            return { handled: true };
          }

          stdout.write(dim(`\n  Executing workflow: ${bold(workflow.name)}...\n\n`));

          const executor = new WorkflowExecutor();
          const execution = await executor.execute(workflow, (event) => {
            if (event.type === "step:start") {
              const se = event as { stepId: string; stepName: string };
              stdout.write(dim(`    [start] `) + cyan(se.stepName) + "\n");
            } else if (event.type === "step:done") {
              const se = event as { stepId: string; status: string };
              const statusColor = se.status === "completed" ? green : se.status === "failed" ? red : yellow;
              stdout.write(dim(`    [done]  `) + statusColor(se.status) + dim(` (${se.stepId})`) + "\n");
            } else if (event.type === "step:error") {
              const se = event as { stepId: string; error: string };
              stdout.write(dim(`    [error] `) + red(se.error.slice(0, 80)) + "\n");
            } else if (event.type === "step:skip") {
              const se = event as { stepId: string; reason: string };
              stdout.write(dim(`    [skip]  ${se.stepId}: ${se.reason}`) + "\n");
            }
          });

          // Save execution history
          try {
            saveExecution(execution);
          } catch {
            // Non-fatal
          }

          stdout.write("\n");

          // Render final DAG with status
          const finalViz = renderDAG(workflow, execution);
          for (const line of finalViz.split("\n")) {
            stdout.write("  " + line + "\n");
          }
          stdout.write("\n");

        } else if (subCmd === "history") {
          // /workflow history — recent execution history
          const {
            listChitraguptaWorkflows,
            listWorkflows: listSavedWorkflows,
            listExecutions,
          } = await import("@chitragupta/vayu");

          const builtInIds = listChitraguptaWorkflows().map((w) => w.id);
          const savedIds = listSavedWorkflows().map((w) => w.id);
          const allIds = new Set([...builtInIds, ...savedIds]);

          interface HistoryEntry {
            executionId: string;
            workflowId: string;
            status: string;
            startTime: number;
            endTime?: number;
          }

          const allExecutions: HistoryEntry[] = [];
          for (const wfId of allIds) {
            const execs = listExecutions(wfId);
            for (const exec of execs) {
              allExecutions.push({
                executionId: exec.executionId,
                workflowId: exec.workflowId,
                status: exec.status,
                startTime: exec.startTime,
                endTime: exec.endTime,
              });
            }
          }

          allExecutions.sort((a, b) => b.startTime - a.startTime);
          const limited = allExecutions.slice(0, 15);

          stdout.write("\n" + bold("Workflow Execution History") + "\n\n");

          if (limited.length === 0) {
            stdout.write(dim("  No executions recorded yet.\n"));
          } else {
            for (const exec of limited) {
              const statusColor = exec.status === "completed" ? green
                : exec.status === "failed" ? red
                : exec.status === "cancelled" ? dim : yellow;
              const durationStr = exec.endTime
                ? formatDuration(exec.endTime - exec.startTime)
                : "running...";
              const age = formatAge(exec.startTime);

              stdout.write(
                `  ${statusColor(exec.status.padEnd(10))} ${bold(exec.workflowId.padEnd(18))} ` +
                `${dim(durationStr.padEnd(10))} ${dim(age + " ago")}  ` +
                `${dim(exec.executionId.slice(0, 8))}\n`
              );
            }
          }

          stdout.write("\n");

        } else {
          // Unknown subcommand — treat as a workflow name for show
          const name = subCmd;
          const {
            getChitraguptaWorkflow,
            loadWorkflow,
            renderDAG,
          } = await import("@chitragupta/vayu");

          const workflow = getChitraguptaWorkflow(name) ?? loadWorkflow(name);
          if (workflow) {
            stdout.write("\n");
            const dagViz = renderDAG(workflow);
            for (const line of dagViz.split("\n")) {
              stdout.write("  " + line + "\n");
            }
            stdout.write("\n");
          } else {
            stdout.write(yellow(`\n  Unknown workflow subcommand or name: ${subCmd}\n`));
            stdout.write(dim("  Usage: /workflow [list|show|run|history] [name]\n\n"));
          }
        }
      } catch (err) {
        stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
      }
      return { handled: true };
    }

    case "/stats":
    case "/power": {
      try {
        const { renderStatsCommand } = await import("../commands/stats.js");
        await renderStatsCommand(stdout, ctx.projectPath);
      } catch (err) {
        stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
      }
      return { handled: true };
    }

    case "/quit":
    case "/exit":
    case "/q": {
      stdout.write(dim("\n  Goodbye.\n\n"));
      ctx.cleanup();
      return { handled: true, exit: true };
    }

    default: {
      stdout.write(
        yellow(`\n  Unknown command: ${cmd}\n`) +
        gray("  Type /help for available commands.\n\n"),
      );
      return { handled: true };
    }
  }
}
