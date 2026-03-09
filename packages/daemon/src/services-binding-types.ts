import crypto from "node:crypto";
import { DatabaseManager } from "@chitragupta/smriti/db/database";
import { initAgentSchema } from "@chitragupta/smriti/db/schema";
import type { RpcInvocationContext, RpcRouter } from "./rpc-router.js";
import { normalizeParams } from "./services-helpers.js";

export type AgentDb = ReturnType<DatabaseManager["get"]>;

export interface BindingNotification {
	method: string;
	params: Record<string, unknown>;
	targetClientIds?: string[];
}

interface ToolUsageEvent {
	type: "tool_usage";
	sessionId: string;
	tool: string;
	argsHash?: string;
	file?: string;
	durationMs?: number;
	success?: boolean;
	timestamp: number;
}

interface ErrorResolutionEvent {
	type: "error_resolution";
	sessionId: string;
	tool: string;
	errorMsg?: string;
	resolution?: string;
	timestamp: number;
}

interface EditPatternEvent {
	type: "edit_pattern";
	sessionId: string;
	files: string[];
	editType?: string;
	coEdited?: string[];
	timestamp: number;
}

interface UserCorrectionEvent {
	type: "user_correction";
	sessionId: string;
	originalText?: string;
	correctedText?: string;
	context?: string;
	timestamp: number;
}

export interface PreferenceEvent {
	type: "preference";
	key: string;
	value: string;
	confidence: number;
	frequency: number;
	source?: string;
	timestamp: number;
}

export type ObservationEvent =
	| ToolUsageEvent
	| ErrorResolutionEvent
	| EditPatternEvent
	| UserCorrectionEvent
	| PreferenceEvent;

function normalizeType(value: unknown): string {
	const normalized = String(value ?? "")
		.trim()
		.toLowerCase()
		.replace(/^observe\./, "")
		.replace(/[.\-]/g, "_");

	switch (normalized) {
		case "toolusage":
		case "tool_usage":
			return "tool_usage";
		case "error_resolutions":
		case "error_resolution":
			return "error_resolution";
		case "edit_patterns":
		case "edit_pattern":
			return "edit_pattern";
		case "user_corrections":
		case "user_correction":
			return "user_correction";
		case "preferences":
		case "preference_update":
		case "preference":
			return "preference";
		default:
			return normalized;
	}
}

function normalizeTimestamp(value: unknown): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : Date.now();
}

export function hashText(text: string): string {
	return crypto.createHash("sha1").update(text).digest("hex").slice(0, 20);
}

function parseStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
}

export function buildState(tool: string, file?: string): string {
	const normalizedFile = file?.trim();
	return `${tool.trim()}:${normalizedFile && normalizedFile.length > 0 ? normalizedFile : "*"}`;
}

export function parseState(state: string): { tool: string; file?: string } {
	const [tool, ...rest] = state.split(":");
	const file = rest.join(":");
	return { tool, file: file && file !== "*" ? file : undefined };
}

export function clamp(value: number, min = 0, max = 1): number {
	return Math.max(min, Math.min(max, value));
}

export function parseJsonArray(value: unknown): string[] {
	if (typeof value !== "string" || !value.trim()) return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed.map((entry) => String(entry ?? "")).filter(Boolean) : [];
	} catch {
		return [];
	}
}

export function getAgentDb(): AgentDb {
	const dbm = DatabaseManager.instance();
	initAgentSchema(dbm);
	return dbm.get("agent");
}

export function emitNotifications(
	router: RpcRouter,
	notifications: BindingNotification[],
	targetClientIds?: string[],
): number {
	let sent = 0;
	const dedupe = new Set<string>();
	for (const notification of notifications) {
		const key = JSON.stringify({
			method: notification.method,
			params: notification.params,
			targetClientIds: notification.targetClientIds ?? targetClientIds ?? [],
		});
		if (dedupe.has(key)) continue;
		dedupe.add(key);
		sent += router.notify(
			notification.method,
			notification.params,
			notification.targetClientIds ?? targetClientIds,
		);
	}
	return sent;
}

export function resolveClientId(
	params: Record<string, unknown>,
	context?: RpcInvocationContext,
): string | undefined {
	if (context?.clientId) return context.clientId;
	const candidate = typeof params.clientId === "string"
		? params.clientId
		: typeof params.client_id === "string"
			? params.client_id
			: undefined;
	return candidate?.trim() || undefined;
}

export function targetClient(clientId?: string): string[] | undefined {
	return clientId ? [clientId] : undefined;
}

export function eventToRuntimeObservation(event: ObservationEvent): Record<string, unknown> {
	switch (event.type) {
		case "tool_usage":
			return {
				type: event.type,
				entity: event.tool,
				severity: event.success === false ? "error" : "info",
				summary: event.success === false ? `${event.tool} failed` : `${event.tool} used`,
				sessionId: event.sessionId,
				file: event.file,
				durationMs: event.durationMs,
				timestamp: event.timestamp,
			};
		case "error_resolution":
			return {
				type: event.type,
				entity: event.tool,
				severity: "info",
				summary: event.resolution ?? event.errorMsg ?? "error resolved",
				sessionId: event.sessionId,
				timestamp: event.timestamp,
			};
		case "edit_pattern":
			return {
				type: event.type,
				entity: event.editType ?? "edit",
				severity: "info",
				summary: event.files.join(", "),
				sessionId: event.sessionId,
				files: event.files,
				timestamp: event.timestamp,
			};
		case "user_correction":
			return {
				type: event.type,
				entity: event.sessionId,
				severity: "warning",
				summary: event.context ?? "user correction",
				sessionId: event.sessionId,
				timestamp: event.timestamp,
			};
		case "preference":
			return {
				type: event.type,
				entity: event.key,
				summary: `preference:${event.key}`,
				severity: event.confidence >= 0.7 ? "info" : "warning",
				key: event.key,
				value: event.value,
				confidence: event.confidence,
				timestamp: event.timestamp,
			};
	}
}

export function normalizeObservationEvent(raw: unknown): ObservationEvent | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const params = normalizeParams(raw as Record<string, unknown>);
	const type = normalizeType(params.type ?? params.eventType ?? params.method);
	const timestamp = normalizeTimestamp(params.timestamp);

	if (type === "tool_usage") {
		const tool = String(params.tool ?? "").trim();
		const sessionId = String(params.sessionId ?? "").trim();
		if (!tool || !sessionId) return null;
		let argsHash = typeof params.argsHash === "string" ? params.argsHash.trim() : "";
		if (!argsHash && params.args && typeof params.args === "object") {
			argsHash = hashText(JSON.stringify(params.args));
		}
		return {
			type,
			sessionId,
			tool,
			argsHash: argsHash || undefined,
			file: typeof params.currentFile === "string"
				? params.currentFile
				: typeof params.file === "string"
					? params.file
					: undefined,
			durationMs: Number.isFinite(Number(params.durationMs)) ? Number(params.durationMs) : undefined,
			success: typeof params.success === "boolean" ? params.success : undefined,
			timestamp,
		};
	}

	if (type === "error_resolution") {
		const tool = String(params.tool ?? "").trim();
		const sessionId = String(params.sessionId ?? "").trim();
		if (!tool || !sessionId) return null;
		return {
			type,
			sessionId,
			tool,
			errorMsg: typeof params.errorMsg === "string" ? params.errorMsg : undefined,
			resolution: typeof params.resolution === "string" ? params.resolution : undefined,
			timestamp,
		};
	}

	if (type === "edit_pattern") {
		const sessionId = String(params.sessionId ?? "").trim();
		const files = parseStringArray(params.files);
		if (!sessionId || files.length === 0) return null;
		const coEdited = parseStringArray(params.coEdited);
		return {
			type,
			sessionId,
			files,
			editType: typeof params.editType === "string" ? params.editType : undefined,
			coEdited: coEdited.length > 0 ? coEdited : undefined,
			timestamp,
		};
	}

	if (type === "user_correction") {
		const sessionId = String(params.sessionId ?? "").trim();
		if (!sessionId) return null;
		return {
			type,
			sessionId,
			originalText: typeof params.originalText === "string" ? params.originalText : undefined,
			correctedText: typeof params.correctedText === "string" ? params.correctedText : undefined,
			context: typeof params.context === "string" ? params.context : undefined,
			timestamp,
		};
	}

	if (type === "preference") {
		const key = String(params.key ?? "").trim();
		const value = String(params.value ?? "").trim();
		if (!key || !value) return null;
		return {
			type,
			key,
			value,
			confidence: clamp(Number(params.confidence ?? 0.7)),
			frequency: Math.max(1, Math.trunc(Number(params.frequency ?? 1))),
			source: typeof params.source === "string" ? params.source : undefined,
			timestamp,
		};
	}

	return null;
}
