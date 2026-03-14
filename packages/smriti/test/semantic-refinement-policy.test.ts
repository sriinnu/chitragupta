import { describe, expect, it } from "vitest";
import {
	buildQualityDebtRepairPolicy,
	buildImmediateResearchRefinementRequests,
	buildTemporalSelectiveReembeddingRequest,
} from "../src/semantic-refinement-policy.js";

describe("semantic refinement policy", () => {
	it("keeps higher periods freshness-led without research pressure", () => {
		expect(buildTemporalSelectiveReembeddingRequest({
			level: "monthly",
			date: "2026-03-13",
			researchSignalCount: 0,
		})).toEqual({
			periods: ["2026-03"],
			levels: ["monthly"],
			candidateLimit: 6,
			reasons: ["stale_epoch", "stale_remote_epoch"],
			minMdlScore: 0.6,
			minSourceSessionCount: 2,
			minPriorityScore: 1.9,
			resyncRemote: false,
		});
	});

	it("widens temporal repair when research pressure is present", () => {
		expect(buildTemporalSelectiveReembeddingRequest({
			level: "yearly",
			date: "2026-03-13",
			researchSignalCount: 2,
			projects: ["/repo/project"],
			periods: ["2026"],
		})).toEqual({
			projects: ["/repo/project"],
			periods: ["2026"],
			levels: ["yearly"],
			candidateLimit: 5,
			reasons: ["stale_epoch", "stale_remote_epoch", "low_mdl", "rejected_packed", "low_retention", "low_reduction"],
			minMdlScore: 0.6,
			minSourceSessionCount: 4,
			minPriorityScore: 1.85,
			resyncRemote: true,
		});
	});

	it("builds immediate research repair requests from the shared MDL policy", () => {
		const result = buildImmediateResearchRefinementRequests({
			projectPath: "/repo/project",
			date: "2026-03-13",
			elevatedSignal: true,
		});

		expect(result).toEqual({
			daily: {
				dates: ["2026-03-13"],
				levels: ["daily"],
				candidateLimit: 8,
				reasons: ["stale_epoch", "stale_remote_epoch", "low_mdl", "rejected_packed", "low_retention", "low_reduction"],
				minMdlScore: 0.4,
				minSourceSessionCount: 1,
				minPriorityScore: 1.1,
				resyncRemote: true,
			},
			project: {
				projects: ["/repo/project"],
				levels: ["monthly", "yearly"],
				periods: ["2026-03", "2026"],
				candidateLimit: 7,
				reasons: ["stale_epoch", "stale_remote_epoch", "low_mdl", "rejected_packed", "low_retention", "low_reduction"],
				minMdlScore: 0.55,
				minSourceSessionCount: 2,
				minPriorityScore: 1.6,
				resyncRemote: true,
			},
		});
	});

	it("lets persisted budget overrides widen or narrow temporal repair deterministically", () => {
		expect(buildTemporalSelectiveReembeddingRequest({
			level: "daily",
			date: "2026-03-13",
			researchSignalCount: 3,
			override: {
				dailyCandidateLimit: 20,
				dailyMinMdlScore: 0.42,
				dailyMinPriorityScore: 1.05,
				dailyMinSourceSessionCount: 2,
			},
		})).toEqual({
			dates: ["2026-03-13"],
			levels: ["daily"],
			candidateLimit: 20,
			reasons: ["stale_epoch", "stale_remote_epoch", "low_mdl", "rejected_packed", "low_retention", "low_reduction"],
			minMdlScore: 0.42,
			minSourceSessionCount: 2,
			minPriorityScore: 1.05,
			resyncRemote: true,
		});
	});

	it("derives one bounded same-epoch quality-debt policy from the active research budget", () => {
		expect(buildQualityDebtRepairPolicy({
			override: {
				dailyCandidateLimit: 11,
				projectCandidateLimit: 7,
				dailyMinMdlScore: 0.44,
				projectMinMdlScore: 0.58,
				dailyMinPriorityScore: 1.05,
				projectMinPriorityScore: 1.6,
				dailyMinSourceSessionCount: 1,
				projectMinSourceSessionCount: 2,
			},
			pressure: 5,
		})).toEqual({
			candidateLimit: 23,
			minMdlScore: 0.45,
			minSourceSessionCount: 1,
			minPriorityScore: 0.85,
		});
	});
});
