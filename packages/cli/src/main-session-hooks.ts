import fs from "fs";
import path from "path";

import { getChitraguptaHome, createLogger } from "@chitragupta/core";
import { Agent } from "@chitragupta/anina";
import {
	listSessions,
	loadSession,
} from "@chitragupta/smriti/session-store";
import type { Session } from "@chitragupta/smriti/types";
import type { TuriyaRouter } from "@chitragupta/swara";

import {
	runConsolidationViaDaemon,
} from "./modes/daemon-bridge.js";
import { allowLocalRuntimeFallback } from "./runtime-daemon-proxies.js";
import type { TuiWiringResult } from "./main-tui-wiring.js";

const log = createLogger("cli:main-session");

export async function runPostSessionHooks(
	turiyaRouter: TuriyaRouter | undefined,
	projectPath: string,
): Promise<void> {
	if (turiyaRouter) {
		try {
			const turiyaStatePath = path.join(getChitraguptaHome(), "turiya-state.json");
			fs.writeFileSync(turiyaStatePath, JSON.stringify(turiyaRouter.serialize()), "utf8");
			const stats = turiyaRouter.getStats();
			if (stats.totalRequests > 0) {
				log.info("Turiya state saved", { requests: stats.totalRequests, savings: `${stats.savingsPercent.toFixed(1)}%` });
			}
		} catch {
			// best-effort
		}
	}

	const CONSOLIDATION_TIMEOUT_MS = 5_000;
	try {
		const consolidationWork = async () => {
			try {
				const result = await runConsolidationViaDaemon(projectPath, 5);
				if (result.newRulesCount > 0) {
					process.stderr.write(`\n  \u2726 Samskaara: Learned ${result.newRulesCount} new rule${result.newRulesCount > 1 ? "s" : ""} from this session.\n`);
				}
				return;
			} catch {
				if (!allowLocalRuntimeFallback()) return;
			}

			const { ConsolidationEngine } = await import("@chitragupta/smriti");
			const consolidator = new ConsolidationEngine();
			consolidator.load();
			const recentMetas = listSessions(projectPath).slice(0, 5);
			const recentSessions: Session[] = [];
			for (const meta of recentMetas) {
				try {
					const session = loadSession(meta.id, projectPath);
					if (session) recentSessions.push(session);
				} catch {
					// skip
				}
			}
			if (recentSessions.length > 0) {
				const result = consolidator.consolidate(recentSessions);
				consolidator.decayRules();
				consolidator.pruneRules();
				consolidator.save();
				if (result.newRules.length > 0) {
					process.stderr.write(`\n  \u2726 Samskaara: Learned ${result.newRules.length} new rule${result.newRules.length > 1 ? "s" : ""} from this session.\n`);
				}
			}
		};
		await Promise.race([consolidationWork(), new Promise<void>((resolve) => setTimeout(resolve, CONSOLIDATION_TIMEOUT_MS))]);
	} catch {
		// best-effort
	}

	triggerSwapnaConsolidation(projectPath);
}

export function triggerSwapnaConsolidation(projectPath: string): void {
	const timer = setTimeout(() => {
		(async () => {
			try {
				const { SwapnaConsolidation } = await import("@chitragupta/smriti");
				const swapna = new SwapnaConsolidation({ project: projectPath });
				const result = await swapna.run();
				log.info("Swapna consolidation complete", {
					cycleId: result.cycleId,
					durationMs: Math.round(result.totalDurationMs),
					vasanas: result.phases.crystallize.vasanasCreated,
					vidhis: result.phases.proceduralize.vidhisCreated,
				});
			} catch (err) {
				log.debug("Swapna consolidation failed (best-effort)", {
					error: err instanceof Error ? err.message : String(err),
				});
			}
		})();
	}, 0);
	timer.unref();
}

export function buildShutdownFn(
	agent: Agent,
	wiring: TuiWiringResult,
): () => Promise<void> {
	return async () => {
		for (const fn of wiring.mcpSkillWatcherCleanups) {
			try {
				fn();
			} catch {
				// best-effort
			}
		}
		if (wiring.nidraDaemon) {
			try {
				await wiring.nidraDaemon.stop();
			} catch {
				// best-effort
			}
		}
		if (wiring.rtaEngine) {
			try {
				const { DatabaseManager } = await import("@chitragupta/smriti");
				wiring.rtaEngine.persistAuditLog(DatabaseManager.instance().get("agent"));
			} catch {
				// best-effort
			}
		}
		try {
			agent.dispose();
		} catch {
			// best-effort
		}
		wiring.sandeshaRouter?.destroy();
		wiring.commHubDestroy?.();
		wiring.actorSystemShutdown?.();
		wiring.kaala?.dispose();
		wiring.messageBus?.destroy();
		if (wiring.mcpShutdown) await wiring.mcpShutdown();
	};
}
