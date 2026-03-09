import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseManager } from "@chitragupta/smriti/db/database";
import { _resetDbInit, getAgentDb } from "../src/session-db.js";
import {
	predictNextStates,
	queryDetectedPatterns,
	recordHealOutcome,
	recordObservationBatch,
	upsertDetectedPattern,
	upsertPreference,
} from "../src/session-db-c8.js";

describe("session-db C8 helpers", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-session-db-c8-"));
		process.env.CHITRAGUPTA_HOME = tmpDir;
		DatabaseManager.reset();
		_resetDbInit();
	});

	afterEach(() => {
		DatabaseManager.reset();
		_resetDbInit();
		delete process.env.CHITRAGUPTA_HOME;
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("records observation batches and updates markov transitions", () => {
		const batch = recordObservationBatch([
			{ type: "tool_usage", sessionId: "s1", tool: "read_file", currentFile: "a.ts", success: true },
			{ type: "tool_usage", sessionId: "s1", tool: "edit_file", currentFile: "a.ts", success: true },
			{ type: "preference", key: "style.indent", value: "2", confidence: 0.8, frequency: 2 },
		]);

		expect(batch.accepted).toBe(3);

		const db = getAgentDb();
		const transition = db.prepare(
			"SELECT count FROM markov_transitions WHERE from_state = ? AND to_state = ?",
		).get("read_file:a.ts", "edit_file:a.ts") as { count?: number } | undefined;
		expect(transition?.count).toBe(1);

		const preference = db.prepare(
			"SELECT value, frequency FROM preferences WHERE key = ?",
		).get("style.indent") as { value?: string; frequency?: number } | undefined;
		expect(preference?.value).toBe("2");
		expect(preference?.frequency).toBe(2);
	});

	it("upserts and queries detected patterns", () => {
		const recorded = upsertDetectedPattern({
			type: "style_preference",
			pattern: { key: "naming", value: "camelCase" },
			confidence: 0.92,
		});
		expect(recorded.recorded).toBe(true);

		const patterns = queryDetectedPatterns({ type: "style_preference", minConfidence: 0.8, limit: 5 });
		expect(patterns.length).toBe(1);
		expect(patterns[0]?.type).toBe("style_preference");
		expect(patterns[0]?.confidence).toBe(0.92);
		expect(patterns[0]?.pattern).toEqual({ key: "naming", value: "camelCase" });
	});

	it("predicts next actions from markov transitions", () => {
		recordObservationBatch([
			{ type: "tool_usage", sessionId: "s2", tool: "read_file", currentFile: "main.ts", success: true },
			{ type: "tool_usage", sessionId: "s2", tool: "edit_file", currentFile: "main.ts", success: true },
			{ type: "tool_usage", sessionId: "s2", tool: "run_tests", currentFile: "main.ts", success: true },
		]);

		const predictions = predictNextStates({
			currentTool: "edit_file",
			currentFile: "main.ts",
			limit: 3,
		});

		expect(predictions.length).toBe(1);
		expect(predictions[0]?.action).toContain("run_tests");
		expect(predictions[0]?.confidence).toBeGreaterThan(0);
	});

	it("records heal outcomes and explicit preference updates", () => {
		const healed = recordHealOutcome({
			anomalyType: "loop_detected",
			actionTaken: "abort",
			outcome: "success",
			sessionId: "s3",
		});
		expect(healed).toBe(true);

		const stored = upsertPreference("provider.default", "openai", { confidence: 0.7, frequency: 1 });
		expect(stored).toBe(true);

		const db = getAgentDb();
		const healRow = db.prepare(
			"SELECT outcome FROM heal_outcomes WHERE anomaly_type = ? ORDER BY id DESC LIMIT 1",
		).get("loop_detected") as { outcome?: string } | undefined;
		expect(healRow?.outcome).toBe("success");
	});
});
