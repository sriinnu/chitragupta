export type AgentDbLike = {
	exec(sql: string): unknown;
};

/**
 * Early advanced-agent migrations: observation tables plus Nidra/Sabha state storage.
 */
export function applyAgentC8Migrations(db: AgentDbLike, currentVersion: number): void {
	if (currentVersion < 7) {
		db.exec(`
			-- ─── Observations ───────────────────────────────────────────────────
			CREATE TABLE IF NOT EXISTS tool_usage (
				id          INTEGER PRIMARY KEY AUTOINCREMENT,
				session_id  TEXT NOT NULL,
				tool        TEXT NOT NULL,
				args_hash   TEXT,
				duration_ms INTEGER,
				success     INTEGER,
				timestamp   INTEGER NOT NULL
			);

			CREATE TABLE IF NOT EXISTS error_resolutions (
				id          INTEGER PRIMARY KEY AUTOINCREMENT,
				session_id  TEXT NOT NULL,
				tool        TEXT NOT NULL,
				error_msg   TEXT,
				resolution  TEXT,
				timestamp   INTEGER NOT NULL
			);

			CREATE TABLE IF NOT EXISTS edit_patterns (
				id          INTEGER PRIMARY KEY AUTOINCREMENT,
				session_id  TEXT NOT NULL,
				files       TEXT NOT NULL,
				edit_type   TEXT,
				co_edited   TEXT,
				timestamp   INTEGER NOT NULL
			);

			CREATE TABLE IF NOT EXISTS user_corrections (
				id             INTEGER PRIMARY KEY AUTOINCREMENT,
				session_id     TEXT NOT NULL,
				original_hash  TEXT,
				corrected_hash TEXT,
				context        TEXT,
				timestamp      INTEGER NOT NULL
			);

			CREATE TABLE IF NOT EXISTS preferences (
				key         TEXT PRIMARY KEY,
				value       TEXT NOT NULL,
				confidence  REAL NOT NULL DEFAULT 0.5,
				frequency   INTEGER NOT NULL DEFAULT 1,
				updated_at  INTEGER NOT NULL
			);

			CREATE TABLE IF NOT EXISTS detected_patterns (
				id          INTEGER PRIMARY KEY AUTOINCREMENT,
				type        TEXT NOT NULL,
				pattern     TEXT NOT NULL,
				confidence  REAL NOT NULL,
				occurrences INTEGER NOT NULL DEFAULT 1,
				first_seen  INTEGER,
				last_seen   INTEGER
			);

			CREATE TABLE IF NOT EXISTS markov_transitions (
				from_state  TEXT NOT NULL,
				to_state    TEXT NOT NULL,
				count       INTEGER NOT NULL DEFAULT 1,
				PRIMARY KEY (from_state, to_state)
			);

			CREATE TABLE IF NOT EXISTS heal_outcomes (
				id           INTEGER PRIMARY KEY AUTOINCREMENT,
				anomaly_type TEXT NOT NULL,
				action_taken TEXT NOT NULL,
				outcome      TEXT NOT NULL CHECK(outcome IN ('success', 'partial', 'failed')),
				session_id   TEXT,
				timestamp    INTEGER NOT NULL
			);

			CREATE INDEX IF NOT EXISTS idx_tool_usage_session ON tool_usage(session_id);
			CREATE INDEX IF NOT EXISTS idx_tool_usage_tool ON tool_usage(tool);
			CREATE INDEX IF NOT EXISTS idx_tool_usage_timestamp ON tool_usage(timestamp DESC);
			CREATE INDEX IF NOT EXISTS idx_error_resolutions_session ON error_resolutions(session_id);
			CREATE INDEX IF NOT EXISTS idx_edit_patterns_session ON edit_patterns(session_id);
			CREATE INDEX IF NOT EXISTS idx_user_corrections_session ON user_corrections(session_id);
			CREATE INDEX IF NOT EXISTS idx_patterns_type ON detected_patterns(type);
			CREATE INDEX IF NOT EXISTS idx_patterns_confidence ON detected_patterns(confidence DESC);
			CREATE UNIQUE INDEX IF NOT EXISTS idx_patterns_type_pattern ON detected_patterns(type, pattern);
			CREATE INDEX IF NOT EXISTS idx_markov_from_state ON markov_transitions(from_state);
			CREATE INDEX IF NOT EXISTS idx_heal_anomaly ON heal_outcomes(anomaly_type);
			CREATE INDEX IF NOT EXISTS idx_heal_timestamp ON heal_outcomes(timestamp DESC);
		`);
	}

	if (currentVersion < 8) {
		db.exec(`
			ALTER TABLE nidra_state ADD COLUMN consecutive_idle_dream_cycles INTEGER NOT NULL DEFAULT 0;
			ALTER TABLE nidra_state ADD COLUMN sessions_processed_since_deep_sleep INTEGER NOT NULL DEFAULT 0;
			ALTER TABLE nidra_state ADD COLUMN pending_session_ids TEXT NOT NULL DEFAULT '[]';
		`);
	}

	if (currentVersion < 9) {
		db.exec(`
				CREATE TABLE IF NOT EXISTS remote_semantic_sync (
					target         TEXT NOT NULL,
					artifact_id    TEXT NOT NULL,
					level          TEXT NOT NULL,
					period         TEXT NOT NULL,
					project        TEXT,
					content_hash   TEXT NOT NULL,
					remote_id      TEXT,
					quality_hash   TEXT,
					last_synced_at INTEGER,
					last_error     TEXT,
					updated_at     INTEGER NOT NULL,
					PRIMARY KEY (target, artifact_id)
				);

			CREATE INDEX IF NOT EXISTS idx_remote_semantic_target ON remote_semantic_sync(target, updated_at DESC);
			CREATE INDEX IF NOT EXISTS idx_remote_semantic_project ON remote_semantic_sync(project, level, period);
		`);
	}

	if (currentVersion < 10) {
		db.exec(`
			CREATE TABLE IF NOT EXISTS sabha_state (
				id                   TEXT PRIMARY KEY,
				topic                TEXT NOT NULL,
				status               TEXT NOT NULL,
				convener             TEXT NOT NULL,
				sabha_json           TEXT NOT NULL,
				client_bindings_json TEXT NOT NULL DEFAULT '{}',
				perspectives_json    TEXT NOT NULL DEFAULT '[]',
				created_at           INTEGER NOT NULL,
				concluded_at         INTEGER,
				updated_at           INTEGER NOT NULL
			);

			CREATE INDEX IF NOT EXISTS idx_sabha_state_status ON sabha_state(status, updated_at DESC);
			CREATE INDEX IF NOT EXISTS idx_sabha_state_updated ON sabha_state(updated_at DESC);
		`);
	}

	if (currentVersion < 11) {
		db.exec(`
			ALTER TABLE nidra_state ADD COLUMN session_notifications_since_deep_sleep INTEGER NOT NULL DEFAULT 0;
		`);
	}

	if (currentVersion < 12) {
		db.exec(`
			ALTER TABLE sabha_state ADD COLUMN mesh_bindings_json TEXT NOT NULL DEFAULT '[]';
			ALTER TABLE sabha_state ADD COLUMN dispatch_log_json TEXT NOT NULL DEFAULT '[]';
		`);
	}

	if (currentVersion < 13) {
		db.exec(`
			ALTER TABLE sabha_state ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;

			CREATE TABLE IF NOT EXISTS sabha_event_log (
				sabha_id    TEXT NOT NULL,
				revision    INTEGER NOT NULL,
				event_type  TEXT NOT NULL,
				event_json  TEXT NOT NULL DEFAULT '{}',
				created_at  INTEGER NOT NULL,
				PRIMARY KEY (sabha_id, revision)
			);

			CREATE INDEX IF NOT EXISTS idx_sabha_event_log_sabha ON sabha_event_log(sabha_id, revision DESC);
			CREATE INDEX IF NOT EXISTS idx_sabha_event_log_created ON sabha_event_log(created_at DESC);

			UPDATE sabha_state
			SET revision = 1
			WHERE revision = 0;
		`);
	}

	if (currentVersion < 14) {
		db.exec(`
			ALTER TABLE sabha_event_log ADD COLUMN event_id TEXT NOT NULL DEFAULT '';
			ALTER TABLE sabha_event_log ADD COLUMN parent_revision INTEGER NOT NULL DEFAULT 0;

			UPDATE sabha_event_log
			SET event_id = sabha_id || ':' || revision
			WHERE event_id = '';

			UPDATE sabha_event_log
			SET parent_revision = CASE
				WHEN revision > 1 THEN revision - 1
				ELSE 0
			END
			WHERE parent_revision = 0;

			CREATE UNIQUE INDEX IF NOT EXISTS idx_sabha_event_log_event_id ON sabha_event_log(event_id);
		`);
	}

	if (currentVersion < 15) {
		db.exec(`
			ALTER TABLE nidra_state ADD COLUMN preserve_pending_sessions_on_listening INTEGER NOT NULL DEFAULT 0;
		`);
	}
}
