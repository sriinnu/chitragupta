/**
 * @chitragupta/smriti -- Session migration.
 * Indexes existing .md session files into the SQLite database.
 * Safe to call multiple times (skips already-indexed sessions).
 */

import fs from "fs";
import path from "path";
import { parseSessionMarkdown } from "./markdown-parser.js";
import {
	getSessionsRoot,
	getProjectSessionDir,
	getAgentDb,
	sessionMetaToRow,
} from "./session-db.js";


/**
 * Migrate existing sessions into SQLite index.
 * Safe to call multiple times — skips already-indexed sessions.
 *
 * Call this on startup or first access to ensure SQLite has all sessions.
 */
export function migrateExistingSessions(project?: string): { migrated: number; skipped: number } {
	const db = getAgentDb();
	const sessionsRoot = getSessionsRoot();
	if (!fs.existsSync(sessionsRoot)) return { migrated: 0, skipped: 0 };

	let migrated = 0;
	let skipped = 0;

	const dirs = project
		? [getProjectSessionDir(project)]
		: fs.readdirSync(sessionsRoot, { withFileTypes: true })
				.filter((e) => e.isDirectory())
				.map((e) => path.join(sessionsRoot, e.name));

	const insertSession = db.prepare(`
		INSERT OR IGNORE INTO sessions (id, project, title, created_at, updated_at, turn_count, model, agent, cost, tokens, tags, file_path, parent_id, branch, metadata)
		VALUES (@id, @project, @title, @created_at, @updated_at, @turn_count, @model, @agent, @cost, @tokens, @tags, @file_path, @parent_id, @branch, @metadata)
	`);

	const insertTurn = db.prepare(`
		INSERT OR IGNORE INTO turns (session_id, turn_number, role, content, agent, model, tool_calls, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`);

	const insertFts = db.prepare(
		"INSERT INTO turns_fts (rowid, content) VALUES (?, ?)",
	);

	const migrateFile = (mdPath: string, relativePath: string) => {
		try {
			const content = fs.readFileSync(mdPath, "utf-8");
			const session = parseSessionMarkdown(content);

			// Check if already indexed
			const existing = db.prepare("SELECT id FROM sessions WHERE id = ?").get(session.meta.id);
			if (existing) {
				skipped++;
				return;
			}

			const row = sessionMetaToRow(session.meta, relativePath);
			row.turn_count = session.turns.length;
			insertSession.run(row);

			for (const turn of session.turns) {
				const result = insertTurn.run(
					session.meta.id,
					turn.turnNumber,
					turn.role,
					turn.content,
					turn.agent ?? null,
					turn.model ?? null,
					turn.toolCalls ? JSON.stringify(turn.toolCalls) : null,
					new Date(session.meta.created).getTime(),
				);
				if (result.changes > 0) {
					insertFts.run(result.lastInsertRowid, turn.content);
				}
			}

			migrated++;
		} catch {
			// Skip unparseable files
			skipped++;
		}
	};

	// Wrap in transaction for speed
	const runMigration = db.transaction(() => {
		for (const dir of dirs) {
			if (!fs.existsSync(dir)) continue;
			walkMdFiles(dir, sessionsRoot, migrateFile);
		}
	});

	runMigration();

	return { migrated, skipped };
}

/**
 * Walk directory recursively, calling callback for each .md file.
 */
function walkMdFiles(
	dir: string,
	sessionsRoot: string,
	callback: (fullPath: string, relativePath: string) => void,
): void {
	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walkMdFiles(fullPath, sessionsRoot, callback);
			} else if (entry.name.endsWith(".md")) {
				const relativePath = path.relative(path.dirname(sessionsRoot), fullPath);
				callback(fullPath, relativePath);
			}
		}
	} catch {
		// Skip inaccessible directories
	}
}
