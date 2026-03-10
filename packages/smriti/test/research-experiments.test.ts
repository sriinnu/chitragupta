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
			gitBranch: "main",
			gitHeadCommit: "0123456789abcdef0123456789abcdef01234567",
			gitDirtyBefore: false,
			gitDirtyAfter: true,
			record: { experimentKey: "exp-key-nested-b", delta: -0.01 },
		});

		expect(second.id).toBe(first.id);
		expect(second.experimentKey).toBe("exp-key-top");

		const experiments = listResearchExperiments({ projectPath: "/repo/project", limit: 10 });
		expect(experiments).toHaveLength(1);
		expect(experiments[0]?.decision).toBe("discard");
		expect(experiments[0]?.experimentKey).toBe("exp-key-top");
		expect(experiments[0]?.gitBranch).toBe("main");
		expect(experiments[0]?.gitHeadCommit).toBe("0123456789abcdef0123456789abcdef01234567");
		expect(experiments[0]?.gitDirtyBefore).toBe(false);
		expect(experiments[0]?.gitDirtyAfter).toBe(true);
	});

	it("normalizes git provenance strings before persistence", () => {
		const stored = upsertResearchExperiment({
			projectPath: "/repo/project",
			experimentKey: "exp-key-git-normalize",
			topic: "git provenance cleanup",
			metricName: "val_bpb",
			objective: "minimize",
			decision: "keep",
			gitBranch: "  main  ",
			gitHeadCommit: "   ",
			record: { experimentKey: "nested" },
		});

		expect(stored.gitBranch).toBe("main");
		expect(stored.gitHeadCommit).toBeNull();

		const experiments = listResearchExperiments({ projectPath: "/repo/project", limit: 10 });
		expect(experiments[0]?.gitBranch).toBe("main");
		expect(experiments[0]?.gitHeadCommit).toBeNull();
	});

	it("preserves existing git provenance when a later upsert omits it", () => {
		const first = upsertResearchExperiment({
			projectPath: "/repo/project",
			experimentKey: "exp-key-git-preserve",
			topic: "git provenance preserve",
			metricName: "val_bpb",
			objective: "minimize",
			decision: "keep",
			gitBranch: "feature/research",
			gitHeadCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			gitDirtyBefore: true,
			gitDirtyAfter: false,
			record: { experimentKey: "nested-a" },
		});
		const second = upsertResearchExperiment({
			projectPath: "/repo/project",
			experimentKey: "exp-key-git-preserve",
			topic: "git provenance preserve",
			metricName: "val_bpb",
			objective: "minimize",
			decision: "discard",
			record: { experimentKey: "nested-b" },
		});

		expect(second.id).toBe(first.id);
		expect(second.gitBranch).toBe("feature/research");
		expect(second.gitHeadCommit).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
		expect(second.gitDirtyBefore).toBe(true);
		expect(second.gitDirtyAfter).toBe(false);

		const experiments = listResearchExperiments({ projectPath: "/repo/project", limit: 10 });
		expect(experiments[0]?.gitBranch).toBe("feature/research");
		expect(experiments[0]?.gitHeadCommit).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
		expect(experiments[0]?.gitDirtyBefore).toBe(true);
		expect(experiments[0]?.gitDirtyAfter).toBe(false);
	});

	it("clears existing git provenance when a later upsert explicitly sets null", () => {
		upsertResearchExperiment({
			projectPath: "/repo/project",
			experimentKey: "exp-key-git-clear",
			topic: "git provenance clear",
			metricName: "val_bpb",
			objective: "minimize",
			decision: "keep",
			gitBranch: "feature/research",
			gitHeadCommit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			gitDirtyBefore: true,
			gitDirtyAfter: false,
			record: { experimentKey: "nested-a" },
		});
		const cleared = upsertResearchExperiment({
			projectPath: "/repo/project",
			experimentKey: "exp-key-git-clear",
			topic: "git provenance clear",
			metricName: "val_bpb",
			objective: "minimize",
			decision: "discard",
			gitBranch: null,
			gitHeadCommit: null,
			gitDirtyBefore: null,
			gitDirtyAfter: null,
			record: { experimentKey: "nested-b" },
		});

		expect(cleared.gitBranch).toBeNull();
		expect(cleared.gitHeadCommit).toBeNull();
		expect(cleared.gitDirtyBefore).toBeNull();
		expect(cleared.gitDirtyAfter).toBeNull();

		const experiments = listResearchExperiments({ projectPath: "/repo/project", limit: 10 });
		expect(experiments[0]?.gitBranch).toBeNull();
		expect(experiments[0]?.gitHeadCommit).toBeNull();
		expect(experiments[0]?.gitDirtyBefore).toBeNull();
		expect(experiments[0]?.gitDirtyAfter).toBeNull();
	});
});
