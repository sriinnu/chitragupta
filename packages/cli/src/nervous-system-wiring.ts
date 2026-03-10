/**
 * @chitragupta/cli — Nervous System Wiring.
 *
 * Connects subsystems that exist but don't talk to each other.
 * Each function wires one neural pathway — called from createServerAgent.
 *
 * Wire 2: Skill gap → Akasha deposit + Vidya gap tracking
 * Wire 4: Learning persistence path
 * Wire 5b: Triguna → TrigunaActuator → Kaala + Samiti
 * Wire 6b: Transcendence → system prompt enrichment
 * Wire 7: Buddhi → decision recording on agent events
 * Wire 9: Vasana → system prompt behavioral hints
 */

import { createLogger } from "@chitragupta/core";
import type { AgentConfig } from "@chitragupta/anina";
import { DatabaseManager } from "@chitragupta/smriti";
import { AsyncLocalStorage } from "node:async_hooks";
import path from "path";
import { allowLocalRuntimeFallback } from "./runtime-daemon-proxies.js";
import { packContextWithFallback } from "./context-packing.js";

const log = createLogger("cli:nervous-system");

type AkashaTraceMetadata = Record<string, unknown>;
type DurableAkashaRef = {
	leave?: (
		agentId: string,
		type: string,
		topic: string,
		content: string,
		metadata?: AkashaTraceMetadata,
	) => unknown | Promise<unknown>;
	restore?: (db: unknown) => void;
	persist?: (db: unknown) => void;
};

function isPromiseLike(value: unknown): value is Promise<unknown> {
	return typeof value === "object" && value !== null && typeof (value as Promise<unknown>).then === "function";
}

export interface ServeSessionScope {
	getSessionId(): string | undefined;
	runWithSession<T>(sessionId: string, fn: () => Promise<T>): Promise<T>;
}

export function createServeSessionScope(): ServeSessionScope {
	const storage = new AsyncLocalStorage<{ sessionId: string }>();
	return {
		getSessionId: () => storage.getStore()?.sessionId,
		runWithSession: <T>(sessionId: string, fn: () => Promise<T>) =>
			storage.run({ sessionId }, fn),
	};
}

/**
 * Leave a trace through the real AkashaField API when available.
 * Returns false when the target does not expose a compatible `leave()` method.
 */
export function leaveAkashaTrace(
	akasha: unknown,
	params: {
		agentId: string;
		type: string;
		topic: string;
		content: string;
		metadata?: AkashaTraceMetadata;
	},
): boolean {
	const ak = akasha as DurableAkashaRef | undefined;
	if (!ak || typeof ak.leave !== "function") return false;
	const result = ak.leave(params.agentId, params.type, params.topic, params.content, params.metadata);
	if (isPromiseLike(result)) {
		void result.catch(() => { /* best-effort */ });
		return true;
	}
	persistAkashaField(akasha);
	return true;
}

/**
 * Persist an AkashaField to SQLite when the concrete object exposes `persist()`.
 * Returns false when the field is not durable or the DB is unavailable.
 */
export function persistAkashaField(akasha: unknown): boolean {
	const ak = akasha as DurableAkashaRef | undefined;
	if (!ak || typeof ak.persist !== "function") return false;
	try {
		const db = DatabaseManager.instance().get("agent");
		ak.persist(db);
		return true;
	} catch {
		return false;
	}
}

/**
 * Restore an AkashaField from SQLite when the concrete object exposes `restore()`.
 */
export async function wireAkashaDurability(akasha: unknown): Promise<boolean> {
	const ak = akasha as DurableAkashaRef | undefined;
	if (!ak || typeof ak.restore !== "function") return false;
	try {
		const db = DatabaseManager.instance().get("agent");
		ak.restore(db);
		return true;
	} catch {
		return false;
	}
}

// ─── Wire 2: Skill Gap Recorder ─────────────────────────────────────────────

/**
 * Create an onSkillGap callback that deposits failed tool names into Akasha
 * and notifies VidyaOrchestrator for gap tracking.
 */
export function wireSkillGapRecorder(
	akasha: unknown,
	vidyaOrchestrator: unknown,
): (toolName: string) => void {
	const vo = vidyaOrchestrator as { recordGap?: (name: string) => void } | undefined;

	return (toolName: string) => {
		try {
			leaveAkashaTrace(akasha, {
				agentId: "skill-gap-recorder",
				type: "warning",
				topic: "skill-gap",
				content: `Tool not found or failed: ${toolName}`,
				metadata: { toolName },
			});
		} catch { /* best-effort */ }
		try {
			vo?.recordGap?.(toolName);
		} catch { /* best-effort */ }
		log.debug("skill-gap recorded", { toolName });
	};
}

// ─── Wire 4: Learning Persistence ───────────────────────────────────────────

/** Resolve the learning persistence path for the project. */
export function resolveLearningPersistPath(projectPath: string): string {
	return path.join(projectPath, ".chitragupta", "learning-state.json");
}

// ─── Wire 5b: Triguna → TrigunaActuator ─────────────────────────────────────

/**
 * Create a TrigunaActuator-backed onEvent handler for AgentConfig.
 *
 * Chetana creates its own internal Triguna and fires events through
 * the Agent's emit callback → AgentConfig.onEvent. We intercept
 * triguna:* events there and route to TrigunaActuator.
 *
 * Returns the actuator's handleEvent, or undefined if TrigunaActuator unavailable.
 */
export async function createTrigunaHandler(
	kaala: AgentConfig["kaala"],
	samiti: unknown,
): Promise<((event: string, data: unknown) => void) | undefined> {
	try {
		const { TrigunaActuator } = await import("@chitragupta/anina");
		const actuator = new TrigunaActuator(
			kaala as ConstructorParameters<typeof TrigunaActuator>[0],
			samiti as ConstructorParameters<typeof TrigunaActuator>[1],
		);
		log.info("Wire 5b: TrigunaActuator → Kaala + Samiti active");
		return actuator.handleEvent;
	} catch (err) {
		log.debug("TrigunaActuator unavailable", { error: err instanceof Error ? err.message : String(err) });
		return undefined;
	}
}

// ─── Wire 6b: Transcendence → System Prompt Enrichment ─────────────────────

/**
 * Enrich the system prompt with Transcendence pre-cached predictions.
 * Returns additional prompt text to append, or empty string.
 */
export async function enrichFromTranscendence(projectPath: string): Promise<string> {
	try {
		const { getLucyLiveContextViaDaemon } = await import("./modes/daemon-bridge.js");
		const result = await getLucyLiveContextViaDaemon(undefined, { limit: 5, project: projectPath });
		if (typeof result.predictionsBlock === "string" && result.predictionsBlock.trim()) {
			log.info("Wire 6b: Transcendence injected", { predictions: result.predictions.length, mode: "daemon-packed" });
			return result.predictionsBlock;
		}
		if (!Array.isArray(result.predictions) || result.predictions.length === 0) return "";
		const top = result.predictions.slice(0, 5);
		const lines = top.map(p =>
			`- ${p.entity} (confidence: ${(p.confidence * 100).toFixed(0)}%, source: ${p.source})`
		);
		log.info("Wire 6b: Transcendence injected", { predictions: top.length });
		return await buildPackedContextBlock(
			"Predicted Context (Transcendence pre-cache)",
			"These entities are likely relevant to upcoming work:",
			lines,
		);
	} catch {
		if (!allowLocalRuntimeFallback()) return "";
		try {
			const { getTranscendence } = await import("./modes/mcp-subsystems.js");
			const engine = await getTranscendence();
			const te = engine as { prefetch(): { predictions: Array<{ entity: string; confidence: number; source: string }> } };
			const result = te.prefetch();
			if (!result.predictions || result.predictions.length === 0) return "";

			const top = result.predictions.slice(0, 5);
			const lines = top.map(p =>
				`- ${p.entity} (confidence: ${(p.confidence * 100).toFixed(0)}%, source: ${p.source})`
			);
			log.info("Wire 6b: Transcendence injected", { predictions: top.length, mode: "fallback-local" });
			return await buildPackedContextBlock(
				"Predicted Context (Transcendence pre-cache)",
				"These entities are likely relevant to upcoming work:",
				lines,
			);
		} catch {
			return "";
		}
	}
}

/**
 * Wrap a prompt with live Lucy/Scarlett guidance for the current query.
 * Returns the original prompt when no live signal is available.
 */
export async function applyLucyLiveGuidance(
	prompt: string,
	query: string,
	projectPath?: string,
): Promise<string> {
	const guidance = await getLucyLiveGuidanceBlock(query, projectPath);
	if (!guidance) return prompt;
	return `${guidance}\n\n[User message]\n${prompt}`;
}

/**
 * Resolve the Lucy/Scarlett guidance block without wrapping a user prompt.
 * Useful for MCP and other tool surfaces that need the nervous-system signal
 * without mutating the caller's prompt structure.
 */
export async function getLucyLiveGuidanceBlock(
	query: string,
	projectPath?: string,
): Promise<string> {
	const trimmedQuery = query.trim();
	if (!trimmedQuery) return "";

	try {
		const { getLucyLiveContextViaDaemon } = await import("./modes/daemon-bridge.js");
		const live = await getLucyLiveContextViaDaemon(trimmedQuery, { limit: 3, project: projectPath });
		if (typeof live.guidanceBlock === "string" && live.guidanceBlock.trim()) {
			return live.guidanceBlock;
		}
		const lines: string[] = [];

		if (live.hit?.content) {
			lines.push(`- Relevant live context: ${live.hit.content}`);
		}

		if (Array.isArray(live.predictions) && live.predictions.length > 0) {
			for (const prediction of live.predictions.slice(0, 3)) {
				lines.push(
					`- Predicted entity: ${prediction.entity} ` +
					`(${(prediction.confidence * 100).toFixed(0)}%, ${prediction.source})`,
				);
			}
		}

		if (Array.isArray(live.liveSignals) && live.liveSignals.length > 0) {
			for (const signal of live.liveSignals.slice(0, 2)) {
				const entity = typeof signal.entity === "string" ? signal.entity : "system";
				const reason = typeof signal.reason === "string" ? signal.reason : "active regression signal";
				lines.push(`- Scarlett signal: ${entity} -> ${reason}`);
			}
		}

	if (lines.length === 0) return "";
		return await buildPackedContextBlock("Lucy live guidance", undefined, lines);
	} catch {
		return "";
	}
}

// ─── Wire 7: Buddhi Decision Recording ──────────────────────────────────────

/**
 * Wire Buddhi to record tool-selection decisions on agent events.
 * Returns an onEvent callback that the Agent config can consume.
 */
export function wireBuddhiRecorder(
	buddhi: unknown,
	database: unknown,
	projectPath: string,
	sessionIdResolver?: () => string | undefined,
): ((event: string, data: unknown) => void) | undefined {
	if (!buddhi) return undefined;

	const bud = buddhi as {
		recordDecision(params: {
			sessionId: string; project: string; category: string;
			description: string; reasoning: { thesis: string; reason: string; example: string; application: string; conclusion: string };
			confidence: number; alternatives?: Array<{ description: string; reason_rejected: string }>;
			metadata?: Record<string, unknown>;
		}, db?: unknown): unknown | Promise<unknown>;
	};
	const db = database;

	return (event: string, data: unknown) => {
		if (event !== "tool:done") return;
		try {
			const d = data as {
				name?: string;
				toolName?: string;
				result?: { isError?: boolean } | null;
				isError?: boolean;
				durationMs?: number;
			};
			const toolName = String(d.name ?? d.toolName ?? "");
			if (!toolName) return;
			const isError = Boolean(
				d.result && typeof d.result === "object"
					? d.result.isError
					: d.isError,
			);
			// Only record significant tool decisions (skip reads/globs)
			const significant = ["write", "edit", "bash", "coding_agent", "sabha_deliberate", "chitragupta_prompt"];
			if (!significant.some((s) => toolName.toLowerCase().includes(s))) return;

			const recordResult = bud.recordDecision({
				sessionId: sessionIdResolver?.() ?? "serve-agent",
				project: projectPath,
				category: "tool-selection",
				description: `Used ${toolName}${isError ? " (failed)" : ""}`,
				reasoning: {
					thesis: `Tool ${toolName} was selected for this step`,
					reason: "LLM chose this tool based on context",
					example: "Tool selection follows agent planning",
					application: `Applied to current task in ${projectPath}`,
					conclusion: isError ? "Tool execution failed" : "Tool executed successfully",
				},
				confidence: isError ? 0.3 : 0.8,
				metadata: {
					toolName,
					isError,
					durationMs: d.durationMs,
				},
			}, db);
			if (isPromiseLike(recordResult)) {
				void recordResult.catch((err) => {
					log.debug("Buddhi decision recording failed", {
						error: err instanceof Error ? err.message : String(err),
					});
				});
			}
		} catch { /* best-effort — Buddhi recording is non-critical */ }
	};
}

// ─── Wire 9: Vasana → System Prompt Behavioral Hints ────────────────────────

/**
 * Enrich the system prompt with Vasana behavioral tendencies.
 * Returns additional prompt text to append, or empty string.
 */
export async function enrichFromVasana(vasanaEngine: unknown, projectPath: string): Promise<string> {
	try {
		const ve = vasanaEngine as { getVasanas(project: string, topK?: number): Array<{ tendency: string; description: string; strength: number; valence: string }> };
		const vasanas = ve.getVasanas(projectPath, 5);
		if (!vasanas || vasanas.length === 0) return "";

		const lines = vasanas.map(v =>
			`- ${v.tendency}: ${v.description} (strength: ${(v.strength * 100).toFixed(0)}%, ${v.valence})`
		);
		log.info("Wire 9: Vasana behavioral hints injected", { count: vasanas.length });
		return await buildPackedContextBlock(
			"Behavioral Tendencies (Vasana)",
			"Learned patterns from past sessions:",
			lines,
		);
	} catch {
		return "";
	}
}

async function buildPackedContextBlock(
	title: string,
	intro: string | undefined,
	lines: string[],
): Promise<string> {
	if (lines.length === 0) return "";
	const combined = intro ? `${intro}\n${lines.join("\n")}` : lines.join("\n");
	const packed = await packContextWithFallback(combined);
	if (packed) {
		return `\n\n## ${title}\n[packed via ${packed.runtime} | savings=${packed.savings}% | original=${packed.originalLength}]\n${packed.packedText}`;
	}
	return `\n\n## ${title}\n${combined}`;
}
