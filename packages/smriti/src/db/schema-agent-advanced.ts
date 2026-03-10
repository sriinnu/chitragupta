import type { DatabaseManager } from "./database.js";

type AgentDb = ReturnType<DatabaseManager["get"]>;

export function applyAdvancedAgentMigrations(db: AgentDb, currentVersion: number): void {
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

			-- ─── Patterns ───────────────────────────────────────────────────────
			CREATE TABLE IF NOT EXISTS detected_patterns (
				id          INTEGER PRIMARY KEY AUTOINCREMENT,
				type        TEXT NOT NULL,
				pattern     TEXT NOT NULL,
				confidence  REAL NOT NULL,
				occurrences INTEGER NOT NULL DEFAULT 1,
				first_seen  INTEGER,
				last_seen   INTEGER
			);

			-- ─── Markov model ──────────────────────────────────────────────────
			CREATE TABLE IF NOT EXISTS markov_transitions (
				from_state  TEXT NOT NULL,
				to_state    TEXT NOT NULL,
				count       INTEGER NOT NULL DEFAULT 1,
				PRIMARY KEY (from_state, to_state)
			);

			-- ─── Heal outcomes ────────────────────────────────────────────────
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

	if (currentVersion < 17) {
		db.exec(`
			CREATE TABLE IF NOT EXISTS research_experiments (
				id                    TEXT PRIMARY KEY,
				project               TEXT NOT NULL,
				experiment_key        TEXT,
				budget_ms             INTEGER,
				session_id            TEXT,
				parent_session_id     TEXT,
				session_lineage_key   TEXT,
				topic                 TEXT NOT NULL,
				metric_name           TEXT NOT NULL,
				objective             TEXT NOT NULL,
				baseline_metric       REAL,
				observed_metric       REAL,
				delta                 REAL,
				decision              TEXT NOT NULL,
				sabha_id              TEXT,
				council_verdict       TEXT,
				route_class           TEXT,
				execution_route_class TEXT,
				selected_capability_id TEXT,
				selected_model_id     TEXT,
				selected_provider_id  TEXT,
				packed_context        TEXT,
				packed_runtime        TEXT,
				packed_source         TEXT,
				record_json           TEXT NOT NULL,
				created_at            INTEGER NOT NULL,
				updated_at            INTEGER NOT NULL
			);

			CREATE INDEX IF NOT EXISTS idx_research_experiments_project
				ON research_experiments(project, updated_at DESC);
			CREATE INDEX IF NOT EXISTS idx_research_experiments_key
				ON research_experiments(experiment_key);
			CREATE INDEX IF NOT EXISTS idx_research_experiments_session
				ON research_experiments(session_id, updated_at DESC);
			CREATE INDEX IF NOT EXISTS idx_research_experiments_decision
				ON research_experiments(decision, updated_at DESC);
		`);
	}

		if (currentVersion < 18) {
		const cols = db.prepare("PRAGMA table_info(research_experiments)").all() as Array<{ name: string }>;
		const names = new Set(cols.map((row) => row.name));
		if (!names.has("experiment_key")) {
			db.exec("ALTER TABLE research_experiments ADD COLUMN experiment_key TEXT;");
		}
		if (!names.has("budget_ms")) {
			db.exec("ALTER TABLE research_experiments ADD COLUMN budget_ms INTEGER;");
		}
		if (!names.has("sabha_id")) {
			db.exec("ALTER TABLE research_experiments ADD COLUMN sabha_id TEXT;");
		}
		db.exec(`
			CREATE INDEX IF NOT EXISTS idx_research_experiments_key
				ON research_experiments(experiment_key);
		`);
		const rows = db.prepare(`
			SELECT id, record_json, experiment_key, budget_ms, sabha_id
			FROM research_experiments
			WHERE experiment_key IS NULL OR budget_ms IS NULL OR sabha_id IS NULL
		`).all() as Array<{
			id: string;
			record_json: string | null;
			experiment_key: string | null;
			budget_ms: number | null;
			sabha_id: string | null;
		}>;
		if (rows.length > 0) {
			const update = db.prepare(`
				UPDATE research_experiments
				SET experiment_key = ?,
					budget_ms = ?,
					sabha_id = ?
				WHERE id = ?
			`);
			const tx = db.transaction((pendingRows: typeof rows) => {
				for (const row of pendingRows) {
					let parsed: Record<string, unknown> = {};
					try {
						parsed = row.record_json ? JSON.parse(row.record_json) as Record<string, unknown> : {};
					} catch {
						parsed = {};
					}
					const experimentKey = row.experiment_key
						?? (typeof parsed.experimentKey === "string" && parsed.experimentKey.trim()
							? parsed.experimentKey.trim()
							: null);
					const budgetMs = row.budget_ms
						?? (typeof parsed.budgetMs === "number" && Number.isFinite(parsed.budgetMs)
							? parsed.budgetMs
							: null);
					const sabhaId = row.sabha_id
						?? (typeof parsed.sabhaId === "string" && parsed.sabhaId.trim()
							? parsed.sabhaId.trim()
							: null);
					update.run(experimentKey, budgetMs, sabhaId, row.id);
				}
			});
			tx(rows);
			}
		}

		if (currentVersion < 19) {
			const cols = db.prepare("PRAGMA table_info(research_experiments)").all() as Array<{ name: string }>;
			const names = new Set(cols.map((row) => row.name));
			if (!names.has("git_branch")) {
				db.exec("ALTER TABLE research_experiments ADD COLUMN git_branch TEXT;");
			}
			if (!names.has("git_head_commit")) {
				db.exec("ALTER TABLE research_experiments ADD COLUMN git_head_commit TEXT;");
			}
			if (!names.has("git_dirty_before")) {
				db.exec("ALTER TABLE research_experiments ADD COLUMN git_dirty_before INTEGER;");
			}
			if (!names.has("git_dirty_after")) {
				db.exec("ALTER TABLE research_experiments ADD COLUMN git_dirty_after INTEGER;");
			}
			const rows = db.prepare(`
				SELECT id, record_json, git_branch, git_head_commit, git_dirty_before, git_dirty_after
				FROM research_experiments
			`).all() as Array<{
				id: string;
				record_json: string | null;
				git_branch: string | null;
				git_head_commit: string | null;
				git_dirty_before: number | null;
				git_dirty_after: number | null;
			}>;
			if (rows.length > 0) {
				const update = db.prepare(`
					UPDATE research_experiments
					SET git_branch = ?,
						git_head_commit = ?,
						git_dirty_before = ?,
						git_dirty_after = ?
					WHERE id = ?
				`);
				const tx = db.transaction((pendingRows: typeof rows) => {
					for (const row of pendingRows) {
						let parsed: Record<string, unknown> = {};
						try {
							parsed = row.record_json ? JSON.parse(row.record_json) as Record<string, unknown> : {};
						} catch {
							parsed = {};
						}
						const run = parsed.run && typeof parsed.run === "object" ? parsed.run as Record<string, unknown> : {};
						const gitBranch = typeof row.git_branch === "string" && row.git_branch.trim()
							? row.git_branch.trim()
							: typeof run.gitBranch === "string" && run.gitBranch.trim()
								? run.gitBranch.trim()
								: null;
						const gitHeadCommit = typeof row.git_head_commit === "string" && row.git_head_commit.trim()
							? row.git_head_commit.trim()
							: typeof run.gitHeadCommit === "string" && run.gitHeadCommit.trim()
								? run.gitHeadCommit.trim()
								: null;
						update.run(
							gitBranch,
							gitHeadCommit,
							row.git_dirty_before ?? (typeof run.gitDirtyBefore === "boolean" ? (run.gitDirtyBefore ? 1 : 0) : null),
							row.git_dirty_after ?? (typeof run.gitDirtyAfter === "boolean" ? (run.gitDirtyAfter ? 1 : 0) : null),
							row.id,
						);
					}
				});
				tx(rows);
			}
		}
	}
