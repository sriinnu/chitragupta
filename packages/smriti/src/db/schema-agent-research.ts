import type { AgentDbLike } from "./schema-agent-c8.js";

type RowName = { name: string };

function hasPrepare(db: AgentDbLike): db is AgentDbLike & { prepare(sql: string): { all(): RowName[] } } {
	return typeof (db as { prepare?: unknown }).prepare === "function";
}

function tableColumns(db: AgentDbLike, table: string): Set<string> {
	if (!hasPrepare(db)) return new Set<string>();
	const rows = db.prepare(`PRAGMA table_info(${table})`).all();
	return new Set(rows.map((row) => row.name));
}

/**
 * Later advanced-agent migrations: research ledger, route metadata, loop summaries, and semantic epochs.
 */
export function applyAgentResearchMigrations(db: AgentDbLike, currentVersion: number): void {
	if (currentVersion < 17) {
		db.exec(`
			CREATE TABLE IF NOT EXISTS research_experiments (
				id                    TEXT PRIMARY KEY,
				project               TEXT NOT NULL,
				experiment_key        TEXT,
				attempt_key           TEXT,
				budget_ms             INTEGER,
				session_id            TEXT,
				parent_session_id     TEXT,
				session_lineage_key   TEXT,
				topic                 TEXT NOT NULL,
				attempt_number        INTEGER,
				metric_name           TEXT NOT NULL,
				objective             TEXT NOT NULL,
				baseline_metric       REAL,
				observed_metric       REAL,
				delta                 REAL,
				status                TEXT,
				error_message         TEXT,
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
			CREATE INDEX IF NOT EXISTS idx_research_experiments_attempt
				ON research_experiments(attempt_key);
			CREATE INDEX IF NOT EXISTS idx_research_experiments_session
				ON research_experiments(session_id, updated_at DESC);
			CREATE INDEX IF NOT EXISTS idx_research_experiments_decision
				ON research_experiments(decision, updated_at DESC);
		`);
	}

	if (currentVersion < 18) {
		const names = tableColumns(db, "research_experiments");
		if (!names.has("experiment_key")) db.exec("ALTER TABLE research_experiments ADD COLUMN experiment_key TEXT;");
		if (!names.has("budget_ms")) db.exec("ALTER TABLE research_experiments ADD COLUMN budget_ms INTEGER;");
		if (!names.has("sabha_id")) db.exec("ALTER TABLE research_experiments ADD COLUMN sabha_id TEXT;");
		db.exec(`
			CREATE INDEX IF NOT EXISTS idx_research_experiments_key
				ON research_experiments(experiment_key);
		`);
		const rows = (db as any).prepare(`
			SELECT id, record_json, experiment_key, budget_ms, sabha_id
			FROM research_experiments
			WHERE experiment_key IS NULL OR budget_ms IS NULL OR sabha_id IS NULL
		`).all() as Array<{ id: string; record_json: string | null; experiment_key: string | null; budget_ms: number | null; sabha_id: string | null }>;
		if (rows.length > 0) {
			const update = (db as any).prepare(`
				UPDATE research_experiments
				SET experiment_key = ?,
					budget_ms = ?,
					sabha_id = ?
				WHERE id = ?
			`);
			const tx = (db as any).transaction((pendingRows: typeof rows) => {
				for (const row of pendingRows) {
					let parsed: Record<string, unknown> = {};
					try { parsed = row.record_json ? JSON.parse(row.record_json) as Record<string, unknown> : {}; } catch {}
					const experimentKey = row.experiment_key ?? (typeof parsed.experimentKey === "string" && parsed.experimentKey.trim() ? parsed.experimentKey.trim() : null);
					const budgetMs = row.budget_ms ?? (typeof parsed.budgetMs === "number" && Number.isFinite(parsed.budgetMs) ? parsed.budgetMs : null);
					const sabhaId = row.sabha_id ?? (typeof parsed.sabhaId === "string" && parsed.sabhaId.trim() ? parsed.sabhaId.trim() : null);
					update.run(experimentKey, budgetMs, sabhaId, row.id);
				}
			});
			tx(rows);
		}
	}

	if (currentVersion < 19) {
		const names = tableColumns(db, "research_experiments");
		if (!names.has("git_branch")) db.exec("ALTER TABLE research_experiments ADD COLUMN git_branch TEXT;");
		if (!names.has("git_head_commit")) db.exec("ALTER TABLE research_experiments ADD COLUMN git_head_commit TEXT;");
		if (!names.has("git_dirty_before")) db.exec("ALTER TABLE research_experiments ADD COLUMN git_dirty_before INTEGER;");
		if (!names.has("git_dirty_after")) db.exec("ALTER TABLE research_experiments ADD COLUMN git_dirty_after INTEGER;");
		const rows = (db as any).prepare(`
			SELECT id, record_json, git_branch, git_head_commit, git_dirty_before, git_dirty_after
			FROM research_experiments
		`).all();
		if (rows.length > 0) {
			const update = (db as any).prepare(`
				UPDATE research_experiments
				SET git_branch = ?, git_head_commit = ?, git_dirty_before = ?, git_dirty_after = ?
				WHERE id = ?
			`);
			const tx = (db as any).transaction((pendingRows: typeof rows) => {
				for (const row of pendingRows) {
					let parsed: Record<string, unknown> = {};
					try { parsed = row.record_json ? JSON.parse(row.record_json) as Record<string, unknown> : {}; } catch {}
					const run = parsed.run && typeof parsed.run === "object" ? parsed.run as Record<string, unknown> : {};
					const gitBranch = typeof row.git_branch === "string" && row.git_branch.trim() ? row.git_branch.trim() : typeof run.gitBranch === "string" && run.gitBranch.trim() ? run.gitBranch.trim() : null;
					const gitHeadCommit = typeof row.git_head_commit === "string" && row.git_head_commit.trim() ? row.git_head_commit.trim() : typeof run.gitHeadCommit === "string" && run.gitHeadCommit.trim() ? run.gitHeadCommit.trim() : null;
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

	if (currentVersion < 20) {
		const names = tableColumns(db, "research_experiments");
		if (!names.has("loop_key")) db.exec("ALTER TABLE research_experiments ADD COLUMN loop_key TEXT;");
		if (!names.has("round_number")) db.exec("ALTER TABLE research_experiments ADD COLUMN round_number INTEGER;");
		if (!names.has("total_rounds")) db.exec("ALTER TABLE research_experiments ADD COLUMN total_rounds INTEGER;");
		if (!names.has("planner_route_class")) db.exec("ALTER TABLE research_experiments ADD COLUMN planner_route_class TEXT;");
		if (!names.has("planner_selected_capability_id")) db.exec("ALTER TABLE research_experiments ADD COLUMN planner_selected_capability_id TEXT;");
		if (!names.has("planner_selected_model_id")) db.exec("ALTER TABLE research_experiments ADD COLUMN planner_selected_model_id TEXT;");
		if (!names.has("planner_selected_provider_id")) db.exec("ALTER TABLE research_experiments ADD COLUMN planner_selected_provider_id TEXT;");
		db.exec(`
			CREATE INDEX IF NOT EXISTS idx_research_experiments_loop
				ON research_experiments(loop_key, round_number);
		`);
		const rows = (db as any).prepare(`
			SELECT id, record_json, loop_key, round_number, total_rounds, planner_route_class, planner_selected_capability_id, planner_selected_model_id, planner_selected_provider_id
			FROM research_experiments
			WHERE loop_key IS NULL OR round_number IS NULL OR total_rounds IS NULL OR planner_route_class IS NULL OR planner_selected_capability_id IS NULL OR planner_selected_model_id IS NULL OR planner_selected_provider_id IS NULL
		`).all();
		if (rows.length > 0) {
			const update = (db as any).prepare(`
				UPDATE research_experiments
				SET loop_key = ?, round_number = ?, total_rounds = ?, planner_route_class = ?, planner_selected_capability_id = ?, planner_selected_model_id = ?, planner_selected_provider_id = ?
				WHERE id = ?
			`);
			const tx = (db as any).transaction((pendingRows: typeof rows) => {
				for (const row of pendingRows) {
					let parsed: Record<string, unknown> = {};
					try { parsed = row.record_json ? JSON.parse(row.record_json) as Record<string, unknown> : {}; } catch {}
					const plannerRoute = parsed.plannerRoute && typeof parsed.plannerRoute === "object" ? parsed.plannerRoute as Record<string, unknown> : {};
					const plannerBinding = plannerRoute.executionBinding && typeof plannerRoute.executionBinding === "object" ? plannerRoute.executionBinding as Record<string, unknown> : {};
					update.run(
						row.loop_key ?? (typeof parsed.loopKey === "string" && parsed.loopKey.trim() ? parsed.loopKey.trim() : null),
						row.round_number ?? (typeof parsed.roundNumber === "number" && Number.isFinite(parsed.roundNumber) ? parsed.roundNumber : null),
						row.total_rounds ?? (typeof parsed.totalRounds === "number" && Number.isFinite(parsed.totalRounds) ? parsed.totalRounds : null),
						row.planner_route_class ?? (typeof plannerRoute.routeClass === "string" && plannerRoute.routeClass.trim() ? plannerRoute.routeClass.trim() : null),
						row.planner_selected_capability_id ?? (typeof plannerRoute.selectedCapabilityId === "string" && plannerRoute.selectedCapabilityId.trim() ? plannerRoute.selectedCapabilityId.trim() : null),
						row.planner_selected_model_id ?? (typeof plannerBinding.selectedModelId === "string" && plannerBinding.selectedModelId.trim() ? plannerBinding.selectedModelId.trim() : null),
						row.planner_selected_provider_id ?? (typeof plannerBinding.selectedProviderId === "string" && plannerBinding.selectedProviderId.trim() ? plannerBinding.selectedProviderId.trim() : null),
						row.id,
					);
				}
			});
			tx(rows);
		}
	}

	if (currentVersion < 21) {
		const names = tableColumns(db, "remote_semantic_sync");
		if (names.size > 0 && !names.has("embedding_epoch")) {
			db.exec("ALTER TABLE remote_semantic_sync ADD COLUMN embedding_epoch TEXT;");
		}
	}

	if (currentVersion < 22) {
		const names = tableColumns(db, "research_experiments");
		if (names.size > 0) {
			if (!names.has("attempt_key")) db.exec("ALTER TABLE research_experiments ADD COLUMN attempt_key TEXT;");
			if (!names.has("attempt_number")) db.exec("ALTER TABLE research_experiments ADD COLUMN attempt_number INTEGER;");
			if (!names.has("status")) db.exec("ALTER TABLE research_experiments ADD COLUMN status TEXT;");
			if (!names.has("error_message")) db.exec("ALTER TABLE research_experiments ADD COLUMN error_message TEXT;");
			db.exec(`
				CREATE INDEX IF NOT EXISTS idx_research_experiments_attempt
					ON research_experiments(attempt_key);
			`);
			const rows = (db as any).prepare(`
				SELECT id, record_json, experiment_key, attempt_key, attempt_number, status, error_message
				FROM research_experiments
				WHERE attempt_key IS NULL OR status IS NULL
			`).all();
			if (rows.length > 0) {
				const update = (db as any).prepare(`
					UPDATE research_experiments
					SET attempt_key = ?, attempt_number = ?, status = ?, error_message = ?
					WHERE id = ?
				`);
				const tx = (db as any).transaction((pendingRows: typeof rows) => {
					for (const row of pendingRows) {
						let parsed: Record<string, unknown> = {};
						try { parsed = row.record_json ? JSON.parse(row.record_json) as Record<string, unknown> : {}; } catch {}
						const experimentKey = typeof row.experiment_key === "string" && row.experiment_key.trim()
							? row.experiment_key.trim()
							: typeof parsed.experimentKey === "string" && parsed.experimentKey.trim()
								? parsed.experimentKey.trim()
								: null;
						const attemptNumber = row.attempt_number ?? (typeof parsed.attemptNumber === "number" && Number.isFinite(parsed.attemptNumber) ? parsed.attemptNumber : null);
						update.run(
							row.attempt_key ?? (attemptNumber !== null && experimentKey ? `${experimentKey}#attempt:${attemptNumber}` : null),
							attemptNumber,
							row.status ?? (typeof parsed.status === "string" && parsed.status.trim() ? parsed.status.trim() : "completed"),
							row.error_message ?? (typeof parsed.errorMessage === "string" && parsed.errorMessage.trim() ? parsed.errorMessage.trim() : null),
							row.id,
						);
					}
				});
				tx(rows);
			}
		}
	}

	if (currentVersion < 23) {
		db.exec(`
			CREATE TABLE IF NOT EXISTS research_loop_summaries (
				id                            TEXT PRIMARY KEY,
				project                       TEXT NOT NULL,
				loop_key                      TEXT,
				session_id                    TEXT,
				parent_session_id             TEXT,
				session_lineage_key           TEXT,
				sabha_id                      TEXT,
				council_verdict               TEXT,
				topic                         TEXT NOT NULL,
				hypothesis                    TEXT,
				rounds_requested              INTEGER NOT NULL,
				rounds_completed              INTEGER NOT NULL,
				stop_reason                   TEXT NOT NULL,
				best_metric                   REAL,
				best_round_number             INTEGER,
				no_improvement_streak         INTEGER,
				total_duration_ms             INTEGER,
				total_budget_ms               INTEGER,
				kept_rounds                   INTEGER,
				reverted_rounds               INTEGER,
				planner_route_class           TEXT,
				planner_selected_capability_id TEXT,
				planner_selected_model_id     TEXT,
				planner_selected_provider_id  TEXT,
				execution_route_class         TEXT,
				selected_capability_id        TEXT,
				selected_model_id             TEXT,
				selected_provider_id          TEXT,
				summary_json                  TEXT NOT NULL,
				created_at                    INTEGER NOT NULL,
				updated_at                    INTEGER NOT NULL
			);

			CREATE INDEX IF NOT EXISTS idx_research_loop_summaries_project
				ON research_loop_summaries(project, updated_at DESC);
			CREATE INDEX IF NOT EXISTS idx_research_loop_summaries_loop
				ON research_loop_summaries(loop_key, updated_at DESC);
			CREATE INDEX IF NOT EXISTS idx_research_loop_summaries_session
				ON research_loop_summaries(session_id, updated_at DESC);
		`);
	}

	if (currentVersion < 24) {
		db.exec(`
			CREATE TABLE IF NOT EXISTS semantic_runtime_state (
				name       TEXT PRIMARY KEY,
				value_json TEXT NOT NULL,
				updated_at INTEGER NOT NULL
			);
		`);
	}
}
