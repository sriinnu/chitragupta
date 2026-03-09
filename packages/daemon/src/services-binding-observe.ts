import type { RpcInvocationContext, RpcRouter } from "./rpc-router.js";
import { normalizeParams } from "./services-helpers.js";
import {
	detectErrorHotspot,
	predictFromState,
	updateSessionTransition,
	upsertPattern,
	upsertPreference,
} from "./services-binding-analytics.js";
import {
	buildState,
	clamp,
	emitNotifications,
	eventToRuntimeObservation,
	getAgentDb,
	hashText,
	normalizeObservationEvent,
	resolveClientId,
	targetClient,
	type ObservationEvent,
	type PreferenceEvent,
	type BindingNotification,
} from "./services-binding-types.js";

function registerObserveBatch(router: RpcRouter): void {
	router.register("observe.batch", async (rawParams, context) => {
		const params = normalizeParams(rawParams);
		const clientId = resolveClientId(params, context);
		const rawEvents = Array.isArray(params.events)
			? params.events
			: params.event
				? [params.event]
				: [];
		if (rawEvents.length === 0) throw new Error("Missing events");

		const events = rawEvents.map(normalizeObservationEvent).filter((event): event is ObservationEvent => event !== null);
		if (events.length === 0) throw new Error("No valid observation events");

		const db = getAgentDb();
		const notifications: BindingNotification[] = [];
		const lastStateBySession = new Map<string, string | null>();

		const tx = db.transaction((entries: ObservationEvent[]) => {
			for (const event of entries) {
				if (event.type === "tool_usage") {
					db.prepare(`
						INSERT INTO tool_usage (session_id, tool, args_hash, duration_ms, success, timestamp)
						VALUES (?, ?, ?, ?, ?, ?)
					`).run(
						event.sessionId,
						event.tool,
						event.argsHash ?? null,
						event.durationMs ?? null,
						event.success == null ? null : event.success ? 1 : 0,
						event.timestamp,
					);

					const currentState = buildState(event.tool, event.file);
					const { previousState, count } = updateSessionTransition(
						db,
						lastStateBySession,
						event.sessionId,
						currentState,
					);
					if (previousState && count) {
						const confidence = clamp(count / 10);
						if (count >= 3) {
							const next = event.tool;
							upsertPattern(db, "tool_sequence", { fromState: previousState, toState: currentState }, confidence, count, event.timestamp);
							if (confidence >= 0.7) {
								notifications.push({
									method: "pattern_detected",
									params: {
										type: "tool_sequence",
										pattern: [previousState.split(":")[0], next],
										confidence,
										occurrences: count,
									},
								});
							}
						}
					}

					if (event.success === false) {
						const anomaly = detectErrorHotspot(db, event.tool, event.timestamp);
						if (anomaly) notifications.push(anomaly);
					}

					const nextPredictions = predictFromState(db, event.tool, event.file);
					if (nextPredictions[0] && Number(nextPredictions[0].confidence) >= 0.8) {
						notifications.push({
							method: "prediction",
							params: { type: "next_action", predictions: [nextPredictions[0]] },
						});
					}
					continue;
				}

				if (event.type === "error_resolution") {
					db.prepare(`
						INSERT INTO error_resolutions (session_id, tool, error_msg, resolution, timestamp)
						VALUES (?, ?, ?, ?, ?)
					`).run(event.sessionId, event.tool, event.errorMsg ?? null, event.resolution ?? null, event.timestamp);
					continue;
				}

				if (event.type === "edit_pattern") {
					db.prepare(`
						INSERT INTO edit_patterns (session_id, files, edit_type, co_edited, timestamp)
						VALUES (?, ?, ?, ?, ?)
					`).run(
						event.sessionId,
						JSON.stringify(event.files),
						event.editType ?? null,
						JSON.stringify(event.coEdited ?? []),
						event.timestamp,
					);
					continue;
				}

				if (event.type === "user_correction") {
					db.prepare(`
						INSERT INTO user_corrections (session_id, original_hash, corrected_hash, context, timestamp)
						VALUES (?, ?, ?, ?, ?)
					`).run(
						event.sessionId,
						event.originalText ? hashText(event.originalText) : null,
						event.correctedText ? hashText(event.correctedText) : null,
						event.context ?? null,
						event.timestamp,
					);
					continue;
				}

				upsertPreference(db, event.key, event.value, event.confidence, event.frequency, event.timestamp);
				upsertPattern(db, "style_preference", { key: event.key, value: event.value }, event.confidence, event.frequency, event.timestamp);
				if (event.confidence >= 0.7) {
					notifications.push({
						method: "preference_update",
						params: {
							key: event.key,
							value: event.value,
							confidence: event.confidence,
							source: event.source ?? "observe.batch",
						},
					});
				}
			}
		});

		tx(events);
		let livePatterns: Array<Record<string, unknown>> = [];
		if (clientId) {
			const preferencePatch = Object.fromEntries(
				events
					.filter((event): event is PreferenceEvent => event.type === "preference")
					.map((event) => [event.key, event.value]),
			);
			if (Object.keys(preferencePatch).length > 0) {
				router.updateClientPreferences(clientId, preferencePatch);
			}
			const runtime = router.recordObservations(
				clientId,
				events.map((event) => eventToRuntimeObservation(event)),
			);
			livePatterns = runtime.patterns
				.filter((pattern) => pattern.count >= 2)
				.map((pattern) => ({
					key: pattern.key,
					type: pattern.type,
					entity: pattern.entity,
					confidence: clamp(pattern.count / 5),
					occurrences: pattern.count,
					lastSeenAt: pattern.lastSeenAt,
					sample: pattern.sample,
				}));
			if (livePatterns.length > 0) {
				for (const pattern of livePatterns) {
					notifications.push({
						method: "pattern_detected",
						params: {
							type: String(pattern.type ?? "runtime_pattern"),
							pattern: {
								key: pattern.key,
								entity: pattern.entity ?? null,
								sample: pattern.sample ?? "",
							},
							confidence: Number(pattern.confidence ?? 0),
							occurrences: Number(pattern.occurrences ?? 1),
						},
						targetClientIds: [clientId],
					});
				}
			}
		}

		return {
			accepted: events.length,
			clientId: clientId ?? null,
			livePatterns,
			notificationsSent: emitNotifications(router, notifications, targetClient(clientId)),
		};
	}, "Batch ingest observations for Takumi/daemon binding");
}

export { registerObserveBatch };
