import type { DatabaseManager } from "./database.js";
import { applyAgentC8Migrations } from "./schema-agent-c8.js";
import { applyAgentResearchMigrations } from "./schema-agent-research.js";

type AgentDb = ReturnType<DatabaseManager["get"]>;

/** Apply the advanced agent-side schema migrations that sit beyond the base session/memory schema. */
export function applyAdvancedAgentMigrations(db: AgentDb, currentVersion: number): void {
	applyAgentC8Migrations(db, currentVersion);
	applyAgentResearchMigrations(db, currentVersion);
}
