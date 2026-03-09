import type { CollaborationDeps, FindingLike, ServerLike } from "./collaboration-types.js";
import {
	collaborationFailure,
	collaborationUnavailable,
} from "./collaboration-route-helpers.js";

export function mountLokapalaCollaborationRoutes(
	server: ServerLike,
	deps: CollaborationDeps,
): void {
	server.route("GET", "/api/lokapala/guardians", async () => {
		const lokapala = deps.getLokapala();
		if (!lokapala) return collaborationUnavailable("Lokapala guardians");

		try {
			const allStats = lokapala.stats();
			const guardians = Object.entries(allStats).map(([domain, stats]) => ({
				domain,
				scansCompleted: stats.scansCompleted,
				findingsTotal: stats.findingsTotal,
				findingsBySeverity: stats.findingsBySeverity,
				autoFixesApplied: stats.autoFixesApplied,
				lastScanAt: stats.lastScanAt,
				avgScanDurationMs: stats.avgScanDurationMs,
			}));
			return { status: 200, body: { guardians, count: guardians.length } };
		} catch (err) {
			return collaborationFailure(err);
		}
	});

	server.route("GET", "/api/lokapala/violations", async (req) => {
		const lokapala = deps.getLokapala();
		if (!lokapala) return collaborationUnavailable("Lokapala guardians");

		try {
			const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
			const domain = req.query.domain;
			const severity = req.query.severity;

			let findings: FindingLike[];
			if (domain) {
				findings = lokapala.findingsByDomain(domain);
			} else if (severity === "critical") {
				findings = lokapala.criticalFindings();
			} else {
				findings = lokapala.allFindings(limit);
			}

			if (domain && severity) findings = findings.filter(f => f.severity === severity);
			if (findings.length > limit) findings = findings.slice(0, limit);

			return { status: 200, body: { violations: findings, count: findings.length } };
		} catch (err) {
			return collaborationFailure(err);
		}
	});

	server.route("GET", "/api/lokapala/stats", async () => {
		const lokapala = deps.getLokapala();
		if (!lokapala) return collaborationUnavailable("Lokapala guardians");

		try {
			const allStats = lokapala.stats();
			const criticalCount = lokapala.criticalFindings().length;
			const totalFindings = lokapala.allFindings().length;
			return {
				status: 200,
				body: {
					domains: allStats,
					summary: {
						totalFindings,
						criticalFindings: criticalCount,
						guardianCount: Object.keys(allStats).length,
					},
				},
			};
		} catch (err) {
			return collaborationFailure(err);
		}
	});
}
