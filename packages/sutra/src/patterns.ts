/**
 * Common inter-agent communication patterns.
 *
 * These are higher-level abstractions built on top of the CommHub that
 * encode well-known distributed systems patterns adapted for agent trees.
 */

import type { CommHub } from "./hub.js";
import type { AgentEnvelope, SagaStep } from "./types.js";

/**
 * Fan-Out -- dispatch a message to multiple agents in parallel and collect responses.
 *
 * @param hub - The CommHub instance.
 * @param fromAgent - The originating agent ID.
 * @param topic - The topic for all fan-out messages.
 * @param payload - The payload to send to each target.
 * @param targetAgents - Array of agent IDs to send to.
 * @param timeout - Max wait time in ms per request (default 30000).
 * @returns A map of agentId to response payload for successful replies.
 */
export async function fanOut(
	hub: CommHub,
	fromAgent: string,
	topic: string,
	payload: unknown,
	targetAgents: string[],
	timeout = 30_000,
): Promise<Map<string, unknown>> {
	const collector = hub.createCollector<unknown>(targetAgents.length);

	const promises = targetAgents.map(async (agentId) => {
		try {
			const reply = await hub.request(agentId, topic, payload, fromAgent, timeout);
			hub.submitResult(collector.id, agentId, reply.payload);
		} catch (err) {
			hub.submitError(
				collector.id,
				agentId,
				err instanceof Error ? err : new Error(String(err)),
			);
		}
	});

	// Fire all requests in parallel
	await Promise.allSettled(promises);

	return collector.results;
}

/**
 * Pipeline -- chain agents sequentially, passing each stage's output as the next input.
 *
 * @param hub - The CommHub instance.
 * @param stages - Ordered array of `{ agentId, topic }` stages.
 * @param initialPayload - The payload to send to the first stage.
 * @param timeout - Max wait time in ms per stage (default 30000).
 * @returns The final stage's output payload.
 * @throws If any stage times out or fails.
 */
export async function pipeline(
	hub: CommHub,
	stages: Array<{ agentId: string; topic: string }>,
	initialPayload: unknown,
	timeout = 30_000,
): Promise<unknown> {
	let currentPayload = initialPayload;

	for (const stage of stages) {
		const reply = await hub.request(
			stage.agentId,
			stage.topic,
			currentPayload,
			"__pipeline__",
			timeout,
		);
		currentPayload = reply.payload;
	}

	return currentPayload;
}

/**
 * Map-Reduce -- distribute data to mappers in parallel, then aggregate in a reducer.
 *
 * Partitions `data` into roughly equal chunks across `mapAgents`, sends each
 * chunk with topic `__map__`, then sends all collected map results to
 * `reduceAgent` with topic `__reduce__` for aggregation.
 *
 * @param hub - The CommHub instance.
 * @param mapAgents - Array of agent IDs to act as mappers.
 * @param reduceAgent - Agent ID of the reducer.
 * @param data - The data array to partition and map.
 * @param timeout - Max wait time in ms for each phase (default 60000).
 * @returns The reducer's output payload.
 * @throws If the reduce stage times out or fails.
 */
export async function mapReduce(
	hub: CommHub,
	mapAgents: string[],
	reduceAgent: string,
	data: unknown[],
	timeout = 60_000,
): Promise<unknown> {
	// Partition data across map agents
	const chunks = partitionArray(data, mapAgents.length);

	// Map phase: fan out to all mappers
	const mapCollector = hub.createCollector<unknown>(mapAgents.length);

	const mapPromises = mapAgents.map(async (agentId, idx) => {
		try {
			const reply = await hub.request(
				agentId,
				"__map__",
				{ chunk: chunks[idx], index: idx },
				"__mapreduce__",
				timeout,
			);
			hub.submitResult(mapCollector.id, agentId, reply.payload);
		} catch (err) {
			hub.submitError(
				mapCollector.id,
				agentId,
				err instanceof Error ? err : new Error(String(err)),
			);
		}
	});

	await Promise.allSettled(mapPromises);

	const mapResults = await hub.waitForAll(mapCollector.id, timeout);

	// Reduce phase: send all map results to reducer
	const reduceReply = await hub.request(
		reduceAgent,
		"__reduce__",
		{ results: Array.from(mapResults.entries()) },
		"__mapreduce__",
		timeout,
	);

	return reduceReply.payload;
}

/**
 * Saga -- distributed transaction with compensating actions on failure.
 *
 * Executes steps in order. If any step fails, the compensating action for
 * every previously completed step is executed in reverse order (rollback).
 *
 * @param hub - The CommHub instance.
 * @param steps - Ordered array of saga steps, each with a forward action and a compensate action.
 * @param timeout - Max wait time in ms per step (default 30000).
 * @returns Resolves when all steps complete successfully.
 * @throws If any step fails. The error message includes compensation failure counts.
 */
export async function saga(
	hub: CommHub,
	steps: SagaStep[],
	timeout = 30_000,
): Promise<void> {
	const completed: SagaStep[] = [];

	for (const step of steps) {
		try {
			await hub.request(
				step.agentId,
				step.topic,
				step.payload,
				"__saga__",
				timeout,
			);
			completed.push(step);
		} catch (err) {
			// Compensate in reverse order
			const compensateErrors: Error[] = [];

			for (let i = completed.length - 1; i >= 0; i--) {
				const comp = completed[i].compensate;
				try {
					await hub.request(
						comp.agentId,
						comp.topic,
						comp.payload,
						"__saga_compensate__",
						timeout,
					);
				} catch (compErr) {
					compensateErrors.push(
						compErr instanceof Error ? compErr : new Error(String(compErr)),
					);
				}
			}

			const originalError = err instanceof Error ? err.message : String(err);
			const compDetail = compensateErrors.length > 0
				? ` (${compensateErrors.length} compensation error(s))`
				: "";

			throw new Error(
				`Saga failed at step "${step.topic}" for agent "${step.agentId}": ${originalError}${compDetail}`,
			);
		}
	}
}

/**
 * Leader Election -- bully algorithm among candidate agents.
 *
 * Higher-indexed candidates have higher priority. Each candidate broadcasts
 * an election message. If a higher-priority candidate responds, the lower
 * one yields. The highest non-yielding candidate wins.
 *
 * @param hub - The CommHub instance.
 * @param candidates - Array of agent IDs (index = priority; higher index = higher priority).
 * @param timeout - Max wait time in ms for message propagation (default 5000).
 * @returns The elected leader's agent ID.
 * @throws If candidates array is empty.
 */
export async function election(
	hub: CommHub,
	candidates: string[],
	timeout = 5_000,
): Promise<string> {
	if (candidates.length === 0) {
		throw new Error("Cannot run election with zero candidates.");
	}

	if (candidates.length === 1) {
		return candidates[0];
	}

	// Use index as priority — higher index = higher priority (bully algorithm)
	const electionTopic = `__election_${crypto.randomUUID()}__`;
	const responses = new Map<string, boolean>();

	// Set up listeners for all candidates
	const unsubscribers: Array<() => void> = [];

	for (const candidateId of candidates) {
		const unsub = hub.subscribe(candidateId, electionTopic, (envelope: AgentEnvelope) => {
			const senderIdx = candidates.indexOf(envelope.from);
			const myIdx = candidates.indexOf(candidateId);

			if (senderIdx > myIdx) {
				// Higher priority candidate exists — I yield
				responses.set(candidateId, false);
			}
		});
		unsubscribers.push(unsub);
	}

	// Each candidate broadcasts their candidacy
	for (const candidateId of candidates) {
		hub.broadcast(candidateId, electionTopic, { type: "election", candidateId });
	}

	// Wait for messages to propagate
	await new Promise<void>((resolve) => setTimeout(resolve, Math.min(timeout, 100)));

	// Cleanup subscriptions
	for (const unsub of unsubscribers) {
		unsub();
	}

	// The candidate with the highest index that hasn't yielded wins
	for (let i = candidates.length - 1; i >= 0; i--) {
		if (!responses.has(candidates[i]) || responses.get(candidates[i]) !== false) {
			return candidates[i];
		}
	}

	// Fallback: highest index always wins in bully algorithm
	return candidates[candidates.length - 1];
}

/**
 * Gossip -- epidemic-style information dissemination.
 *
 * An agent sends a message to a random subset of known peers on the topic.
 * Each receiver can then propagate further (application-level choice).
 * Peers are discovered from the message history on the given topic.
 *
 * @param hub - The CommHub instance.
 * @param agentId - The sending agent ID.
 * @param topic - The topic for gossip messages.
 * @param payload - The payload to send (a `__gossip: true` flag is added automatically).
 * @param fanoutFactor - Number of random peers to send to (default 3).
 */
export function gossip(
	hub: CommHub,
	agentId: string,
	topic: string,
	payload: unknown,
	fanoutFactor = 3,
): void {
	// Get all subscribers for the topic (except the sender)
	const messages = hub.getMessages("*", topic);
	const knownAgents = new Set<string>();

	// Discover agents from message history on this topic
	for (const msg of messages) {
		if (msg.from !== agentId) knownAgents.add(msg.from);
		if (msg.to !== agentId && msg.to !== "*") knownAgents.add(msg.to);
	}

	const peers = Array.from(knownAgents);

	// Select random subset
	const selected = shuffleArray(peers).slice(0, Math.min(fanoutFactor, peers.length));

	// Send to each selected peer
	for (const peer of selected) {
		hub.send({
			from: agentId,
			to: peer,
			topic,
			payload: { ...payload as Record<string, unknown>, __gossip: true },
			priority: "low",
		});
	}
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Partition an array into N roughly equal chunks.
 */
function partitionArray<T>(arr: T[], n: number): T[][] {
	const result: T[][] = [];
	const chunkSize = Math.ceil(arr.length / n);

	for (let i = 0; i < n; i++) {
		result.push(arr.slice(i * chunkSize, (i + 1) * chunkSize));
	}

	return result;
}

/**
 * Fisher-Yates shuffle (returns new array).
 */
function shuffleArray<T>(arr: T[]): T[] {
	const shuffled = [...arr];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}
	return shuffled;
}
