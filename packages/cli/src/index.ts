/**
 * @chitragupta/cli — Public API re-exports.
 *
 * The CLI package primarily serves as the `chitragupta` binary entry point.
 * These re-exports allow other packages to programmatically invoke
 * CLI functionality when needed.
 */

export { parseArgs, printHelp } from "./args.js";
export type { ParsedArgs } from "./args.js";
export { main } from "./main.js";
export { detectProject } from "./project-detector.js";
export type { ProjectInfo } from "./project-detector.js";
export { loadContextFiles, buildContextString } from "./context-files.js";
export type { ContextFiles } from "./context-files.js";
export { buildSystemPrompt, buildWelcomeMessage, buildFirstRunMessage } from "./personality.js";
export type { SystemPromptOptions } from "./personality.js";
export { runInteractiveMode } from "./modes/interactive.js";
export type { InteractiveModeOptions } from "./modes/interactive.js";
export { runPrintMode } from "./modes/print.js";
export type { PrintModeOptions } from "./modes/print.js";
export { ChitraguptaServer, createChitraguptaAPI } from "./http-server.js";
export type { ServerConfig, RouteHandler, ParsedRequest, RouteResponse } from "./http-server.js";
export { BudgetTracker } from "./budget-tracker.js";
export { JobQueue, QueueFullError } from "./job-queue.js";
export type { Job, JobEvent, JobStatus, JobQueueConfig, JobRunner, JobStats } from "./job-queue.js";
