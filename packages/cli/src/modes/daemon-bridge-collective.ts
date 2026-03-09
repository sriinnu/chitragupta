/**
 * @chitragupta/cli — Daemon bridge RPC wrappers for Sabha, Akasha, Buddhi, Nidra, and engine services.
 */

import { daemonCall, getBridgeMode, getDaemonHealthSnapshot } from "./daemon-bridge-core.js";
import type { MeshStatusSnapshot } from "../mesh-observability.js";

type SabhaParticipantInput = {
	id: string;
	role: string;
	expertise: number;
	credibility: number;
	clientId?: string;
	targetClientId?: string;
};

type SabhaSyllogismInput = {
	pratijna: string;
	hetu: string;
	udaharana: string;
	upanaya: string;
	nigamana: string;
};

export async function listActiveSabhasViaDaemon(): Promise<Array<Record<string, unknown>>> {
	return (await daemonCall<{ sabhas: Array<Record<string, unknown>> }>("sabha.list_active")).sabhas;
}

export async function getSabhaViaDaemon(
	id: string,
): Promise<{ sabha: Record<string, unknown>; explanation: string | null } | null> {
	try {
		return await daemonCall("sabha.get", { id });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes("not found")) return null;
		throw err;
	}
}

export async function askSabhaViaDaemon(params: {
	topic: string;
	convener?: string;
	participants?: SabhaParticipantInput[];
	targetClientIds?: string[];
}): Promise<{
	sabha: Record<string, unknown>;
	question: string;
	targets: string[];
	targetClientIds: string[];
	notificationsSent: number;
}> {
	return daemonCall("sabha.ask", params);
}

export async function submitSabhaPerspectiveViaDaemon(params: {
	id: string;
	participantId: string;
	summary: string;
	reasoning?: string;
	position?: "support" | "oppose" | "abstain" | "observe";
	recommendedAction?: string;
	evidence?: Array<{ label?: string; detail?: string; source?: string }>;
	metadata?: Record<string, unknown>;
	targetClientIds?: string[];
}): Promise<{
	sabha: Record<string, unknown>;
	perspective: Record<string, unknown>;
	notificationsSent?: number;
}> {
	return daemonCall("sabha.submit_perspective", params);
}

export async function deliberateSabhaViaDaemon(params: {
	id?: string;
	topic?: string;
	convener?: string;
	participants?: SabhaParticipantInput[];
	proposerId?: string;
	syllogism?: SabhaSyllogismInput;
	votes?: Array<{
		participantId: string;
		position: "support" | "oppose" | "abstain";
		reasoning: string;
	}>;
	challenges?: Array<{
		challengerId: string;
		targetStep: keyof SabhaSyllogismInput;
		challenge: string;
	}>;
	responses?: Array<{
		recordIndex: number;
		response: string;
	}>;
	conclude?: boolean;
	targetClientIds?: string[];
}): Promise<{
	sabha: Record<string, unknown>;
	explanation: string | null;
	notificationsSent?: number;
}> {
	return daemonCall("sabha.deliberate", params);
}

export async function voteSabhaViaDaemon(params: {
	id: string;
	participantId: string;
	position: "support" | "oppose" | "abstain";
	reasoning: string;
	conclude?: boolean;
	targetClientIds?: string[];
}): Promise<{
	sabha: Record<string, unknown>;
	explanation: string | null;
	notificationsSent?: number;
}> {
	return daemonCall("sabha.vote", params);
}

export async function challengeSabhaViaDaemon(params: {
	id: string;
	challengerId: string;
	targetStep: keyof SabhaSyllogismInput;
	challenge: string;
	targetClientIds?: string[];
}): Promise<{ sabha: Record<string, unknown>; notificationsSent?: number }> {
	return daemonCall("sabha.challenge", params);
}

export async function respondSabhaViaDaemon(params: {
	id: string;
	recordIndex: number;
	response: string;
	targetClientIds?: string[];
}): Promise<{ sabha: Record<string, unknown>; notificationsSent?: number }> {
	return daemonCall("sabha.respond", params);
}

export async function recordSabhaViaDaemon(params: {
	id: string;
	sessionId: string;
	project: string;
	category?: string;
	confidence?: number;
}): Promise<{ decision: Record<string, unknown>; sabha: Record<string, unknown> }> {
	return daemonCall("sabha.record", params);
}

export async function escalateSabhaViaDaemon(params: {
	id: string;
	reason: string;
	targetClientIds?: string[];
}): Promise<{ sabha: Record<string, unknown>; notificationsSent?: number }> {
	return daemonCall("sabha.escalate", params);
}

export async function queryAkashaViaDaemon(
	topic: string,
	opts?: { type?: string; limit?: number },
): Promise<Array<Record<string, unknown>>> {
	return (await daemonCall<{ traces: Array<Record<string, unknown>> }>("akasha.query", {
		topic,
		type: opts?.type,
		limit: opts?.limit ?? 20,
	})).traces;
}

export async function strongestAkashaViaDaemon(limit = 20): Promise<Array<Record<string, unknown>>> {
	return (await daemonCall<{ traces: Array<Record<string, unknown>> }>("akasha.strongest", { limit })).traces;
}

export async function leaveAkashaViaDaemon(params: {
	agentId: string;
	type: string;
	topic: string;
	content: string;
	metadata?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
	return (await daemonCall<{ trace: Record<string, unknown> }>("akasha.leave", params)).trace;
}

export async function getAkashaStatsViaDaemon(): Promise<Record<string, unknown>> {
	return daemonCall("akasha.stats");
}

export async function recordBuddhiDecisionViaDaemon(
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	return (await daemonCall<{ decision: Record<string, unknown> }>("buddhi.record", params)).decision;
}

export async function listBuddhiDecisionsViaDaemon(
	opts?: { project?: string; category?: string; limit?: number },
): Promise<Array<Record<string, unknown>>> {
	return (await daemonCall<{ decisions: Array<Record<string, unknown>> }>("buddhi.list", opts ?? {})).decisions;
}

export async function getBuddhiDecisionViaDaemon(id: string): Promise<Record<string, unknown> | null> {
	return (await daemonCall<{ decision: Record<string, unknown> | null }>("buddhi.get", { id })).decision;
}

export async function explainBuddhiDecisionViaDaemon(id: string): Promise<string | null> {
	return (await daemonCall<{ explanation: string | null }>("buddhi.explain", { id })).explanation;
}

export async function touchNidraViaDaemon(): Promise<void> {
	await daemonCall("nidra.touch");
}

export async function notifyNidraSessionViaDaemon(sessionId: string): Promise<void> {
	await daemonCall("nidra.notify_session", { sessionId });
}

export async function wakeNidraViaDaemon(): Promise<void> {
	await daemonCall("nidra.wake");
}

export async function getNidraStatusViaDaemon(): Promise<Record<string, unknown>> {
	return daemonCall("nidra.status");
}

export async function listVidhisViaDaemon(
	project: string,
	limit = 10,
): Promise<Array<Record<string, unknown>>> {
	return (await daemonCall<{ vidhis: Array<Record<string, unknown>> }>("vidhi.list", { project, limit })).vidhis;
}

export async function matchVidhiViaDaemon(
	project: string,
	query: string,
): Promise<Record<string, unknown> | null> {
	return (await daemonCall<{ match: Record<string, unknown> | null }>("vidhi.match", { project, query })).match;
}

export async function runConsolidationViaDaemon(
	project: string,
	sessionCount = 10,
): Promise<{
	sessionsAnalyzed: number;
	newRulesCount: number;
	reinforcedRulesCount: number;
	weakenedRulesCount: number;
	patternsDetectedCount: number;
	newRulesPreview: string[];
	vidhisNewCount: number;
	vidhisReinforcedCount: number;
}> {
	return daemonCall("consolidation.run", { project, sessionCount });
}

export async function ping(): Promise<boolean> {
	try {
		const result = await daemonCall<{ pong: boolean }>("daemon.ping");
		return result.pong === true;
	} catch {
		return false;
	}
}

export async function health(): Promise<Record<string, unknown>> {
	const snapshot = getDaemonHealthSnapshot();
	try {
		const daemonHealth = await daemonCall<Record<string, unknown>>("daemon.health");
		return { ...daemonHealth, client: snapshot, mode: getBridgeMode() };
	} catch {
		return { status: "unreachable", client: snapshot, mode: getBridgeMode() };
	}
}

export async function getMeshStatusViaDaemon(): Promise<MeshStatusSnapshot> {
	return daemonCall("mesh.status");
}

export async function getMeshPeersViaDaemon(): Promise<MeshStatusSnapshot> {
	return daemonCall("mesh.peers");
}

export async function getMeshTopologyViaDaemon(): Promise<Record<string, unknown>> {
	return daemonCall("mesh.topology");
}

export async function getMeshGossipViaDaemon(): Promise<Record<string, unknown>> {
	return daemonCall("mesh.gossip");
}

export async function connectMeshPeerViaDaemon(endpoint: string): Promise<boolean> {
	const result = await daemonCall<{ connected: boolean }>("mesh.connect", { endpoint });
	return result.connected === true;
}

export async function spawnMeshActorViaDaemon(params: {
	actorId: string;
	capabilities?: string[];
	expertise?: string[];
}): Promise<{ actorId: string; capabilities: string[]; expertise: string[] }> {
	return daemonCall("mesh.spawn", params);
}

export async function sendMeshMessageViaDaemon(params: {
	from: string;
	to: string;
	payload: unknown;
	priority?: number;
}): Promise<{ delivered: boolean; from: string; to: string }> {
	return daemonCall("mesh.send", params);
}

export async function askMeshViaDaemon(params: {
	from: string;
	to: string;
	payload: unknown;
	timeout?: number;
}): Promise<Record<string, unknown>> {
	return daemonCall("mesh.ask", params);
}

export async function findMeshCapabilityViaDaemon(params: {
	capabilities: string[];
	strategy?: string;
	listAll?: boolean;
}): Promise<{
	capabilities: string[];
	peers: Array<Record<string, unknown>>;
	selected: Record<string, unknown> | null;
	strategy: string;
}> {
	return daemonCall("mesh.find_capability", params);
}
