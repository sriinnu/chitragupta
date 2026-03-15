import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listQueuedResearchRefinementScopes = vi.fn(() => []);
const countQueuedResearchRefinementScopes = vi.fn(() => 0);
const clearQueuedResearchRefinementScope = vi.fn(() => undefined);
const deferQueuedResearchRefinementScope = vi.fn(() => undefined);
const repairSelectiveReembedding = vi.fn(async (request?: { levels?: string[] }) => ({
	plan: { candidateCount: request?.levels?.includes("daily") ? 2 : 1 },
	reembedded: 1,
	remoteSynced: 0,
	qualityDeferred: 0,
}));
const repairSelectiveReembeddingForResearchScopes = vi.fn(async () => ({
	label: "2026-03-14",
	candidates: 1,
	reembedded: 1,
	remoteSynced: 0,
	qualityDeferred: 0,
	scopes: [],
}));

vi.mock("@chitragupta/smriti", () => ({
	countQueuedResearchRefinementScopes,
	listQueuedResearchRefinementScopes,
	clearQueuedResearchRefinementScope,
	deferQueuedResearchRefinementScope,
	repairSelectiveReembedding,
}));

vi.mock("../src/chitragupta-daemon-semantic.js", () => ({
	repairSelectiveReembeddingForResearchScopes,
}));

describe("chitragupta-daemon semantic queue", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("replays the persisted repair intent before falling back to scope reconstruction", async () => {
		listQueuedResearchRefinementScopes.mockReturnValueOnce([
			{
				id: "queue-1",
				scopeKey: "scope-1",
				label: "2026-03-14",
				projectPath: "/repo/project",
				sessionIds: ["sess-1"],
				sessionLineageKeys: ["lineage-1"],
				repairIntent: {
					daily: {
						dates: ["2026-03-14"],
						levels: ["daily"],
					},
					project: {
						projects: ["/repo/project"],
						levels: ["monthly", "yearly"],
						periods: ["2026-03", "2026"],
					},
				},
				attemptCount: 0,
				nextAttemptAt: 0,
				lastError: "semantic down",
				createdAt: 0,
				updatedAt: 0,
			},
		]);

		const { drainQueuedResearchRefinementScopes } = await import("../src/chitragupta-daemon-semantic-queue.js");
		const result = await drainQueuedResearchRefinementScopes({ label: "2026-03-14" });

		expect(repairSelectiveReembedding).toHaveBeenNthCalledWith(1, {
			dates: ["2026-03-14"],
			levels: ["daily"],
		});
		expect(repairSelectiveReembedding).toHaveBeenNthCalledWith(2, {
			projects: ["/repo/project"],
			levels: ["monthly", "yearly"],
			periods: ["2026-03", "2026"],
		});
		expect(repairSelectiveReembeddingForResearchScopes).not.toHaveBeenCalled();
		expect(clearQueuedResearchRefinementScope).toHaveBeenCalledWith("queue-1");
		expect(result).toEqual({
			drained: 1,
			repaired: 1,
			deferred: 0,
			remainingDue: 0,
			remoteSynced: 0,
			qualityDeferred: 0,
		});
	});

	it("falls back to project-scope reconstruction when no explicit intent was queued", async () => {
		listQueuedResearchRefinementScopes.mockReturnValueOnce([
			{
				id: "queue-2",
				scopeKey: "scope-2",
				label: "2026-03-14",
				projectPath: "/repo/project",
				sessionIds: ["sess-1"],
				sessionLineageKeys: ["lineage-1"],
				policyFingerprints: ["policy-a"],
				primaryObjectiveIds: ["metric-improvement"],
				primaryStopConditionIds: ["pareto-halt"],
				primaryStopConditionKinds: ["pareto-stagnation"],
				frontierBestScore: 0.78,
				repairIntent: null,
				attemptCount: 0,
				nextAttemptAt: 0,
				lastError: null,
				createdAt: 0,
				updatedAt: 0,
			},
		]);

		const { drainQueuedResearchRefinementScopes } = await import("../src/chitragupta-daemon-semantic-queue.js");
		await drainQueuedResearchRefinementScopes({ label: "2026-03-14" });

		expect(repairSelectiveReembedding).not.toHaveBeenCalled();
		expect(repairSelectiveReembeddingForResearchScopes).toHaveBeenCalledWith(
			"2026-03-14",
			[{
				projectPath: "/repo/project",
				sessionIds: ["sess-1"],
				sessionLineageKeys: ["lineage-1"],
				policyFingerprints: ["policy-a"],
				primaryObjectiveIds: ["metric-improvement"],
				primaryStopConditionIds: ["pareto-halt"],
				primaryStopConditionKinds: ["pareto-stagnation"],
				frontierBestScore: 0.78,
				refinementBudget: null,
				nidraBudget: null,
			}],
			);
	});

	it("keeps exact queued repair intent durable when a broader project scope already ran this cycle", async () => {
		listQueuedResearchRefinementScopes.mockReturnValueOnce([
			{
				id: "queue-3",
				scopeKey: "scope-3",
				label: "2026-03-14",
				projectPath: "/repo/project",
				sessionIds: ["sess-1"],
				sessionLineageKeys: ["lineage-1"],
				repairIntent: {
					daily: { dates: ["2026-03-14"], levels: ["daily"] },
				},
				parseError: null,
				attemptCount: 1,
				nextAttemptAt: 0,
				lastError: null,
				createdAt: 0,
				updatedAt: 0,
			},
		]);

		const { drainQueuedResearchRefinementScopes } = await import("../src/chitragupta-daemon-semantic-queue.js");
		const result = await drainQueuedResearchRefinementScopes({
			label: "2026-03-14",
			excludeScopes: [{
				projectPath: "/repo/project",
				sessionIds: ["sess-1"],
				sessionLineageKeys: ["lineage-1"],
			}],
		});

		expect(repairSelectiveReembedding).not.toHaveBeenCalled();
		expect(repairSelectiveReembeddingForResearchScopes).not.toHaveBeenCalled();
		expect(clearQueuedResearchRefinementScope).not.toHaveBeenCalled();
		expect(deferQueuedResearchRefinementScope).toHaveBeenCalledWith("queue-3", expect.objectContaining({
			lastError: "deferred:active-project-repair",
		}));
		expect(result).toEqual({
			drained: 0,
			repaired: 0,
			deferred: 1,
			remainingDue: 0,
			remoteSynced: 0,
			qualityDeferred: 0,
		});
	});

	it("keeps metadata-only queued rows when the active scope does not cover their optimizer signal", async () => {
		listQueuedResearchRefinementScopes.mockReturnValueOnce([
			{
				id: "queue-metadata",
				scopeKey: "scope-metadata",
				label: "2026-03-14",
				projectPath: "/repo/project",
				sessionIds: ["sess-1"],
				sessionLineageKeys: ["lineage-1"],
				policyFingerprints: ["policy-a"],
				primaryObjectiveIds: ["metric-improvement"],
				primaryStopConditionIds: ["pareto-halt"],
				primaryStopConditionKinds: ["pareto-stagnation"],
				frontierBestScore: 0.78,
				repairIntent: null,
				parseError: null,
				attemptCount: 1,
				nextAttemptAt: 0,
				lastError: null,
				createdAt: 0,
				updatedAt: 0,
			},
		]);

		const { drainQueuedResearchRefinementScopes } = await import("../src/chitragupta-daemon-semantic-queue.js");
		const result = await drainQueuedResearchRefinementScopes({
			label: "2026-03-14",
			excludeScopes: [{
				projectPath: "/repo/project",
				sessionIds: ["sess-1"],
				sessionLineageKeys: ["lineage-1"],
				policyFingerprints: [],
				primaryObjectiveIds: [],
				primaryStopConditionIds: [],
				primaryStopConditionKinds: [],
			}],
		});

		expect(clearQueuedResearchRefinementScope).not.toHaveBeenCalled();
		expect(deferQueuedResearchRefinementScope).toHaveBeenCalledWith("queue-metadata", expect.objectContaining({
			lastError: "deferred:active-project-repair",
		}));
		expect(result).toEqual({
			drained: 0,
			repaired: 0,
			deferred: 1,
			remainingDue: 0,
			remoteSynced: 0,
			qualityDeferred: 0,
		});
	});

	it("returns truthful due-backlog visibility when the remaining queue budget is zero", async () => {
		countQueuedResearchRefinementScopes.mockReturnValueOnce(2);
		const { drainQueuedResearchRefinementScopes } = await import("../src/chitragupta-daemon-semantic-queue.js");
		const result = await drainQueuedResearchRefinementScopes({ limit: 0 });

		expect(listQueuedResearchRefinementScopes).not.toHaveBeenCalled();
		expect(result).toEqual({
			drained: 0,
			repaired: 0,
			deferred: 0,
			remainingDue: 2,
			remoteSynced: 0,
			qualityDeferred: 0,
		});
	});

	it("still clears already-covered coarse queue rows when the replay budget is zero", async () => {
		countQueuedResearchRefinementScopes.mockReturnValueOnce(1);
		countQueuedResearchRefinementScopes.mockReturnValueOnce(0);
		listQueuedResearchRefinementScopes.mockReturnValueOnce([
			{
				id: "queue-covered",
				scopeKey: "scope-covered",
				label: "2026-03-14",
				projectPath: "/repo/project",
				sessionIds: ["sess-1"],
				sessionLineageKeys: ["lineage-1"],
				repairIntent: null,
				parseError: null,
				attemptCount: 0,
				nextAttemptAt: 0,
				lastError: null,
				createdAt: 0,
				updatedAt: 0,
			},
		]);

		const { drainQueuedResearchRefinementScopes } = await import("../src/chitragupta-daemon-semantic-queue.js");
		const result = await drainQueuedResearchRefinementScopes({
			limit: 0,
			excludeScopes: [{
				projectPath: "/repo/project",
				sessionIds: ["sess-1"],
				sessionLineageKeys: ["lineage-1"],
			}],
		});

		expect(clearQueuedResearchRefinementScope).toHaveBeenCalledWith("queue-covered");
		expect(repairSelectiveReembedding).not.toHaveBeenCalled();
		expect(repairSelectiveReembeddingForResearchScopes).not.toHaveBeenCalled();
		expect(result).toEqual({
			drained: 0,
			repaired: 0,
			deferred: 0,
			remainingDue: 0,
			remoteSynced: 0,
			qualityDeferred: 0,
		});
	});

	it("does not rewrite exact queued repair intent when the replay budget is zero", async () => {
		countQueuedResearchRefinementScopes.mockReturnValueOnce(1);
		countQueuedResearchRefinementScopes.mockReturnValueOnce(1);
		listQueuedResearchRefinementScopes.mockReturnValueOnce([
			{
				id: "queue-exact-intent",
				scopeKey: "scope-exact-intent",
				label: "2026-03-14",
				projectPath: "/repo/project",
				sessionIds: ["sess-1"],
				sessionLineageKeys: ["lineage-1"],
				repairIntent: {
					daily: { dates: ["2026-03-14"], levels: ["daily"] },
				},
				parseError: null,
				attemptCount: 2,
				nextAttemptAt: 0,
				lastError: null,
				createdAt: 0,
				updatedAt: 0,
			},
		]);

		const { drainQueuedResearchRefinementScopes } = await import("../src/chitragupta-daemon-semantic-queue.js");
		const result = await drainQueuedResearchRefinementScopes({
			limit: 0,
			label: "2026-03-14",
			excludeScopes: [{
				projectPath: "/repo/project",
				sessionIds: ["sess-1"],
				sessionLineageKeys: ["lineage-1"],
			}],
		});

		expect(clearQueuedResearchRefinementScope).not.toHaveBeenCalled();
		expect(deferQueuedResearchRefinementScope).not.toHaveBeenCalled();
		expect(repairSelectiveReembedding).not.toHaveBeenCalled();
		expect(repairSelectiveReembeddingForResearchScopes).not.toHaveBeenCalled();
		expect(result).toEqual({
			drained: 0,
			repaired: 0,
			deferred: 0,
			remainingDue: 1,
			remoteSynced: 0,
			qualityDeferred: 0,
		});
	});

	it("clears narrower coarse rows when a broader project scope already covered them", async () => {
		countQueuedResearchRefinementScopes.mockReturnValueOnce(1);
		countQueuedResearchRefinementScopes.mockReturnValueOnce(0);
		listQueuedResearchRefinementScopes.mockReturnValueOnce([
			{
				id: "queue-broader-covered",
				scopeKey: "scope-broader-covered",
				label: "2026-03-14",
				projectPath: "/repo/project",
				sessionIds: ["sess-1"],
				sessionLineageKeys: ["lineage-1"],
				repairIntent: null,
				parseError: null,
				attemptCount: 0,
				nextAttemptAt: 0,
				lastError: null,
				createdAt: 0,
				updatedAt: 0,
			},
		]);

		const { drainQueuedResearchRefinementScopes } = await import("../src/chitragupta-daemon-semantic-queue.js");
		const result = await drainQueuedResearchRefinementScopes({
			limit: 0,
			excludeScopes: [{
				projectPath: "/repo/project",
				sessionIds: ["sess-1", "sess-2"],
				sessionLineageKeys: ["lineage-1", "lineage-2"],
			}],
		});

		expect(clearQueuedResearchRefinementScope).toHaveBeenCalledWith("queue-broader-covered");
		expect(result.remainingDue).toBe(0);
	});

	it("does not clear narrower rows with exact repair intent when a broader scope already ran", async () => {
		countQueuedResearchRefinementScopes.mockReturnValueOnce(1);
		countQueuedResearchRefinementScopes.mockReturnValueOnce(1);
		listQueuedResearchRefinementScopes.mockReturnValueOnce([
			{
				id: "queue-broader-with-intent",
				scopeKey: "scope-broader-with-intent",
				label: "2026-03-14",
				projectPath: "/repo/project",
				sessionIds: ["sess-1"],
				sessionLineageKeys: ["lineage-1"],
				repairIntent: {
					daily: { dates: ["2026-03-14"], levels: ["daily"] },
				},
				parseError: null,
				attemptCount: 1,
				nextAttemptAt: 0,
				lastError: null,
				createdAt: 0,
				updatedAt: 0,
			},
		]);

		const { drainQueuedResearchRefinementScopes } = await import("../src/chitragupta-daemon-semantic-queue.js");
		const result = await drainQueuedResearchRefinementScopes({
			label: "2026-03-14",
			excludeScopes: [{
				projectPath: "/repo/project",
				sessionIds: ["sess-1", "sess-2"],
				sessionLineageKeys: ["lineage-1", "lineage-2"],
			}],
		});

		expect(clearQueuedResearchRefinementScope).not.toHaveBeenCalled();
		expect(deferQueuedResearchRefinementScope).toHaveBeenCalledWith(
			"queue-broader-with-intent",
			expect.objectContaining({
				lastError: "deferred:active-project-repair",
			}),
		);
		expect(result).toEqual({
			drained: 0,
			repaired: 0,
			deferred: 1,
			remainingDue: 1,
			remoteSynced: 0,
			qualityDeferred: 0,
		});
	});

	it("spends replay budget only on actionable rows after clearing covered queue entries", async () => {
		countQueuedResearchRefinementScopes.mockReturnValueOnce(2);
		countQueuedResearchRefinementScopes.mockReturnValueOnce(0);
		listQueuedResearchRefinementScopes.mockReturnValueOnce([
			{
				id: "queue-covered-first",
				scopeKey: "scope-covered-first",
				label: "2026-03-14",
				projectPath: "/repo/project",
				sessionIds: ["sess-1"],
				sessionLineageKeys: ["lineage-1"],
				repairIntent: null,
				parseError: null,
				attemptCount: 0,
				nextAttemptAt: 0,
				lastError: null,
				createdAt: 0,
				updatedAt: 0,
			},
			{
				id: "queue-actionable-second",
				scopeKey: "scope-actionable-second",
				label: "2026-03-14",
				projectPath: "/repo/project",
				sessionIds: ["sess-2"],
				sessionLineageKeys: ["lineage-2"],
				repairIntent: null,
				parseError: null,
				attemptCount: 0,
				nextAttemptAt: 0,
				lastError: null,
				createdAt: 0,
				updatedAt: 0,
			},
		]);

		const { drainQueuedResearchRefinementScopes } = await import("../src/chitragupta-daemon-semantic-queue.js");
		const result = await drainQueuedResearchRefinementScopes({
			label: "2026-03-14",
			limit: 1,
			excludeScopes: [{
				projectPath: "/repo/project",
				sessionIds: ["sess-1"],
				sessionLineageKeys: ["lineage-1"],
			}],
		});

		expect(clearQueuedResearchRefinementScope).toHaveBeenCalledWith("queue-covered-first");
		expect(repairSelectiveReembeddingForResearchScopes).toHaveBeenCalledWith("2026-03-14", [
			{
				projectPath: "/repo/project",
				sessionIds: ["sess-2"],
				sessionLineageKeys: ["lineage-2"],
				frontierBestScore: undefined,
				policyFingerprints: undefined,
				primaryObjectiveIds: undefined,
				primaryStopConditionIds: undefined,
				primaryStopConditionKinds: undefined,
				refinementBudget: null,
				nidraBudget: null,
			},
		]);
		expect(result).toEqual({
			drained: 1,
			repaired: 1,
			deferred: 0,
			remainingDue: 0,
			remoteSynced: 0,
			qualityDeferred: 0,
		});
	});

	it("defers malformed queued rows before broad-scope exclusion can clear them", async () => {
		listQueuedResearchRefinementScopes.mockReturnValueOnce([
			{
				id: "queue-4",
				scopeKey: "scope-4",
				label: "2026-03-14",
				projectPath: "/repo/project",
				sessionIds: ["sess-1"],
				sessionLineageKeys: ["lineage-1"],
				repairIntent: null,
				parseError: "invalid persisted repair intent",
				attemptCount: 0,
				nextAttemptAt: 0,
				lastError: null,
				createdAt: 0,
				updatedAt: 0,
			},
		]);

		const { drainQueuedResearchRefinementScopes } = await import("../src/chitragupta-daemon-semantic-queue.js");
		const result = await drainQueuedResearchRefinementScopes({
			label: "2026-03-14",
			excludeScopes: [{
				projectPath: "/repo/project",
				sessionIds: ["sess-1"],
				sessionLineageKeys: ["lineage-1"],
			}],
		});

		expect(clearQueuedResearchRefinementScope).not.toHaveBeenCalled();
		expect(deferQueuedResearchRefinementScope).toHaveBeenCalledWith("queue-4", expect.objectContaining({
			lastError: "parse-error:invalid persisted repair intent",
		}));
		expect(result).toEqual({
			drained: 0,
			repaired: 0,
			deferred: 1,
			remainingDue: 0,
			remoteSynced: 0,
			qualityDeferred: 0,
		});
	});
});
