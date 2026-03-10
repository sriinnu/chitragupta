import type { LucyBridgeConfig } from "./lucy-bridge.js";

export interface LucyPlanPreview {
	transcendenceHit: { entity: string; source: string } | null;
	episodicHints: string[];
	akashaTraces: string[];
}

export async function collectLucyPlanPreview(
	task: string,
	projectPath: string,
	config: LucyBridgeConfig,
): Promise<LucyPlanPreview> {
	const transcendenceHit = config.noCache
		? null
		: await (async () => {
			try {
				const hit = config.queryTranscendence
					? await config.queryTranscendence(task, projectPath)
					: config.transcendenceEngine?.fuzzyLookup(task) ?? null;
				return hit ? { entity: hit.entity, source: hit.source } : null;
			} catch {
				return null;
			}
		})();

	const [episodicHints, akashaTraces] = await Promise.all([
		config.queryEpisodic
			? config.queryEpisodic(task, projectPath).catch(() => [])
			: Promise.resolve([] as string[]),
		config.queryAkasha
			? config.queryAkasha(task).catch(() => [])
			: Promise.resolve([] as string[]),
	]);

	return { transcendenceHit, episodicHints, akashaTraces };
}

export function buildPlanSteps(
	task: string,
	context: LucyPlanPreview,
): string[] {
	const steps = [
		`Inspect the code paths and tests touched by "${task}".`,
		"Make the minimum safe code changes needed to satisfy the task.",
		"Run focused verification and iterate only on failing paths.",
	];
	if (context.transcendenceHit) {
		steps[0] = `Inspect the code paths around ${context.transcendenceHit.entity} and the tests touched by "${task}".`;
	}
	if (context.akashaTraces.length > 0) {
		steps.splice(1, 0, "Use the existing Akasha guidance to preserve known patterns and avoid regressions.");
	}
	return steps;
}
