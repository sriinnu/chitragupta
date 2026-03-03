import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { DatabaseManager } from "@chitragupta/smriti/db/database";
import { initAgentSchema } from "@chitragupta/smriti/db/schema";
import type { SvapnaConfig } from "../src/svapna-types.js";
import { svapnaExtractSamskaras } from "../src/svapna-samskara.js";

const PROJECT = "/test/svapna-samskara-project";

function config(overrides: Partial<SvapnaConfig> = {}): SvapnaConfig {
	return {
		maxSessionsPerCycle: 50,
		surpriseThreshold: 0.7,
		minPatternFrequency: 3,
		minSequenceLength: 2,
		minSuccessRate: 0.8,
		project: PROJECT,
		...overrides,
	};
}

describe("svapnaExtractSamskaras", () => {
	let tmpDir: string;
	let dbm: DatabaseManager;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "svapna-samskara-test-"));
		DatabaseManager.reset();
		dbm = DatabaseManager.instance(tmpDir);
		initAgentSchema(dbm);
	});

	afterEach(() => {
		DatabaseManager.reset();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function insertSession(id: string): void {
		const db = dbm.get("agent");
		const now = Date.now();
		db.prepare(
			`INSERT INTO sessions (id, project, title, created_at, updated_at, file_path)
			 VALUES (?, ?, ?, ?, ?, ?)`,
		).run(id, PROJECT, id, now, now, `sessions/${id}.md`);
	}

	function insertTurn(
		sessionId: string,
		turnNumber: number,
		role: "user" | "assistant",
		content: string,
		toolCalls: Array<Record<string, unknown>> | null = null,
	): void {
		const db = dbm.get("agent");
		db.prepare(
			`INSERT INTO turns (session_id, turn_number, role, content, tool_calls, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
		).run(
			sessionId,
			turnNumber,
			role,
			content,
			toolCalls ? JSON.stringify(toolCalls) : null,
			Date.now(),
		);
	}

	it("extracts tool-sequence samskaras and keeps counts stable across reruns", async () => {
		insertSession("s1");
		insertTurn("s1", 1, "assistant", "working", [
			{ name: "read", input: "{\"path\":\"a.ts\"}", result: "ok" },
			{ name: "edit", input: "{\"path\":\"a.ts\"}", result: "ok" },
		]);
		insertTurn("s1", 2, "assistant", "done", [
			{ name: "read", input: "{\"path\":\"b.ts\"}", result: "ok" },
			{ name: "edit", input: "{\"path\":\"b.ts\"}", result: "ok" },
		]);

		const first = await svapnaExtractSamskaras(dbm, config());
		expect(first.samskarasProcessed).toBeGreaterThanOrEqual(1);
		expect(first.sessionsProcessed).toBe(1);

		const db = dbm.get("agent");
		const row1 = db.prepare(
			`SELECT observation_count FROM samskaras
			 WHERE session_id = ? AND pattern_type = 'tool-sequence'`,
		).get("s1") as { observation_count: number };
		expect(row1.observation_count).toBe(2);

		const second = await svapnaExtractSamskaras(dbm, config());
		expect(second.samskarasProcessed).toBeGreaterThanOrEqual(1);

		const row2 = db.prepare(
			`SELECT observation_count FROM samskaras
			 WHERE session_id = ? AND pattern_type = 'tool-sequence'`,
		).get("s1") as { observation_count: number };
		expect(row2.observation_count).toBe(2);
	});

	it("extracts text-derived samskaras from user turns", async () => {
		insertSession("s2");
		insertTurn("s2", 1, "user", "We prefer pnpm and always use strict typing in this repo.");
		insertTurn("s2", 2, "user", "That is wrong, use absolute file refs instead.");

		const result = await svapnaExtractSamskaras(dbm, config());
		expect(result.samskarasProcessed).toBeGreaterThanOrEqual(2);

		const db = dbm.get("agent");
		const rows = db.prepare(
			`SELECT pattern_type FROM samskaras
			 WHERE session_id = ?
			 ORDER BY pattern_type ASC`,
		).all("s2") as Array<{ pattern_type: string }>;

		const types = rows.map((r) => r.pattern_type);
		expect(types).toContain("preference");
		expect(types).toContain("correction");
	});

	it("returns zero when no project sessions exist", async () => {
		const result = await svapnaExtractSamskaras(dbm, config());
		expect(result.samskarasProcessed).toBe(0);
		expect(result.sessionsProcessed).toBe(0);
	});
});

