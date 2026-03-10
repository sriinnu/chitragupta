import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseManager } from "@chitragupta/smriti/db/database";
import { _resetDbInit } from "../src/session-db.js";
import { listResearchExperiments, upsertResearchExperiment } from "../src/research-experiments.js";

describe("research experiment ledger", () => {
	let tmpDir = "";

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-research-ledger-"));
		DatabaseManager.reset();
		DatabaseManager.instance(tmpDir);
		_resetDbInit();
	});

	afterEach(() => {
		_resetDbInit();
		DatabaseManager.reset();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("prefers the top-level experiment key for identity and storage", () => {
		const first = upsertResearchExperiment({
			projectPath: "/repo/project",
			experimentKey: "exp-key-top",
			topic: "optimizer sweep",
			metricName: "val_bpb",
			objective: "minimize",
			decision: "keep",
			record: { experimentKey: "exp-key-nested-a", delta: 0.01 },
		});
		const second = upsertResearchExperiment({
			projectPath: "/repo/project",
			experimentKey: "exp-key-top",
			topic: "optimizer sweep",
			metricName: "val_bpb",
			objective: "minimize",
			decision: "discard",
			record: { experimentKey: "exp-key-nested-b", delta: -0.01 },
		});

		expect(second.id).toBe(first.id);
		expect(second.experimentKey).toBe("exp-key-top");

		const experiments = listResearchExperiments({ projectPath: "/repo/project", limit: 10 });
		expect(experiments).toHaveLength(1);
		expect(experiments[0]?.decision).toBe("discard");
		expect(experiments[0]?.experimentKey).toBe("exp-key-top");
	});
});
