import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseManager } from "@chitragupta/smriti/db/database";
import { initAgentSchema } from "@chitragupta/smriti/db/schema";
import type { RpcNotification } from "../src/protocol.js";
import { RpcRouter } from "../src/rpc-router.js";
import { registerSessionMethods, registerTurnMethods } from "../src/services.js";
import {
	_setCompressionRuntimeForTests,
	registerCompressionMethods,
} from "../src/services-compression.js";
import { registerContractMethods } from "../src/services-contract.js";
import { registerMeshMethods } from "../src/services-mesh.js";
import { _resetDiscoveryStateForTests, registerDiscoveryMethods } from "../src/services-discovery.js";
import {
	getCollaborationMeshLeaseOwner,
	getCollaborationMeshSystemForTests,
} from "../src/services-collaboration-mesh.js";
import { savePersistedSabhaStateSnapshot } from "../src/services-collaboration-store.js";
import {
	_resetCollaborationStateForTests,
	registerCollaborationMethods,
} from "../src/services-collaboration.js";

const discover = vi.fn(async () => []);
const refresh = vi.fn(async () => undefined);
const providers_list = vi.fn(() => [
	{
		id: "openai",
		name: "OpenAI",
		authenticated: true,
		credentialSource: "env",
		models: [{ id: "gpt-4.1" }],
		lastRefreshed: 100,
		baseUrl: "https://api.openai.com/v1",
	},
]);
const models = vi.fn(() => [
	{
		id: "gpt-4.1",
		name: "GPT-4.1",
		provider: "openai",
		originProvider: "openai",
		mode: "chat",
		capabilities: ["chat", "function_calling"],
		contextWindow: 128_000,
		maxOutputTokens: 16_384,
		pricing: { inputPerMillion: 1, outputPerMillion: 2 },
		aliases: ["gpt4.1"],
		source: "api",
	},
]);
const providerRoles = vi.fn(() => [
	{
		id: "openai",
		name: "OpenAI",
		authenticated: true,
		credentialSource: "env",
		models: [{ id: "gpt-4.1", roles: ["chat", "function_calling"] }],
	},
]);
const capabilities = vi.fn(() => [
	{ capability: "chat", modelCount: 1, providerCount: 1, providers: ["openai"], modes: ["chat"] },
]);
const cheapestModels = vi.fn(() => ({
	matches: [{ modelId: "gpt-4.1", providerId: "openai" }],
	candidates: 1,
	pricedCandidates: 1,
	skippedNoPricing: 0,
	priceMetric: "blended",
	missingCredentials: [],
}));
const modelRouteInfo = vi.fn(() => [
	{ provider: "openai", originProvider: "openai", isDirect: true, isPreferred: true },
]);
const providerHealth = vi.fn(() => [
	{ providerId: "openai", state: "closed", failureCount: 0, lastError: null },
]);
const missingCredentialPrompts = vi.fn(() => []);
const toJSON = vi.fn(() => ({ discoveredAt: 1_763_000_000_000 }));

vi.mock("kosha-discovery", () => ({
	ModelRegistry: class FakeModelRegistry {
		constructor(_config?: Record<string, unknown>) {}
		static async loadConfigFile(overrides?: Record<string, unknown>) {
			return overrides ?? {};
		}
		discover = discover;
		refresh = refresh;
		providers_list = providers_list;
		models = models;
		providerRoles = providerRoles;
		capabilities = capabilities;
		cheapestModels = cheapestModels;
		modelRouteInfo = modelRouteInfo;
		providerHealth = providerHealth;
		missingCredentialPrompts = missingCredentialPrompts;
		toJSON = toJSON;
	},
}));

describe("collaboration + consumer bridge contract services", () => {
	let tmpDir: string;
	let router: RpcRouter;
	let notifications: RpcNotification[];
	const ctx = {
		clientId: "vaayu-client",
		transport: "socket" as const,
		kind: "request" as const,
		auth: {
			keyId: "key-1",
			tenantId: "tenant-1",
			scopes: ["read", "write", "sessions", "memory", "tools"],
		},
	};

	beforeEach(async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-daemon-collab-"));
		process.env.CHITRAGUPTA_HOME = tmpDir;
		DatabaseManager.reset();
		_resetCollaborationStateForTests();
		initAgentSchema(DatabaseManager.instance(tmpDir));
		router = new RpcRouter();
		notifications = [];
		router.setNotifier((notification) => {
			notifications.push(notification);
			return 1;
		});
		const sessionStore = await import("@chitragupta/smriti/session-store");
		registerSessionMethods(router, sessionStore, {} as never);
		registerTurnMethods(router, sessionStore);
		registerCompressionMethods(router);
		registerDiscoveryMethods(router);
		registerContractMethods(router);
		registerCollaborationMethods(router);
		registerMeshMethods(router);
		_setCompressionRuntimeForTests({
			name: "pakt-core",
			status: async () => ({
				runtime: "pakt-core",
				transport: "inproc",
				available: true,
				command: "@sriinnu/pakt",
				args: [],
				connected: true,
				tools: ["pakt_compress", "pakt_auto"],
			}),
			compress: async ({ text, format }: { text: string; format?: string }) => ({
				runtime: "pakt-core",
				action: "compressed",
				compressed: `pakt:${format ?? "text"}:${text.length}`,
				savings: 33,
			}),
			auto: async ({ text }: { text: string }) => ({
				runtime: "pakt-core",
				action: "compressed",
				result: text,
				savings: 20,
			}),
		});
	});

	afterEach(() => {
		_setCompressionRuntimeForTests(null);
		_resetDiscoveryStateForTests();
		delete process.env.CHITRAGUPTA_HOME;
		_resetCollaborationStateForTests();
		DatabaseManager.reset();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

		it("exposes bridge info and grouped capabilities", async () => {
		const info = await router.handle("bridge.info", {}, ctx) as Record<string, unknown>;
		expect(info.engine).toBe("chitragupta");
		expect(info.authority).toMatchObject({
			durableMemory: true,
			canonicalSessions: true,
			routingPolicy: true,
		});
		expect(info.auth).toMatchObject({
			authenticated: true,
			keyId: "key-1",
			tenantId: "tenant-1",
		});

		const caps = await router.handle("bridge.capabilities", {}, ctx) as Record<string, unknown>;
		const groups = caps.groups as Record<string, string[]>;
		expect(groups.bridge).toContain("bridge.info");
		expect(groups.compression).toContain("compression.compress");
			expect(groups.sabha).toContain("sabha.ask");
			expect(groups.sabha).toContain("sabha.resume");
			expect(groups.sabha).toContain("sabha.record");
		expect(groups.sabha).toContain("sabha.repl.apply");
		expect(groups.sabha).toContain("sabha.repl.merge");
		expect(groups.discovery).toContain("discovery.models");
		expect(groups.session).toContain("session.open");
		expect(groups.session).toContain("session.turn");
		expect((caps.sabhaProtocol as { verbs: string[] }).verbs).toEqual(
			expect.arrayContaining([
					"list_active",
					"get",
					"resume",
					"ask",
				"submit_perspective",
				"deliberate",
				"events",
				"sync",
				"repl.pull",
				"repl.apply",
				"repl.merge",
				"record",
				"escalate",
			]),
		);

		const capabilityQuery = await router.handle("capabilities", {
			capability: "coding.patch-and-validate",
		}, ctx) as { capabilities: Array<{ id: string }> };
		expect(capabilityQuery.capabilities.map((capability) => capability.id)).toContain("adapter.takumi.executor");

			const route = await router.handle("route.resolve", {
				consumer: "takumi",
				sessionId: "sess-1",
			capability: "coding.patch-and-validate",
			constraints: {
				preferLocal: true,
				allowCloud: false,
			},
		}, ctx) as { selected: { id: string } | null; policyTrace: string[] };
			expect(route.selected?.id).toBe("tool.coding_agent");
			expect(route.policyTrace).toContain("prefer-local");

			const routeClasses = await router.handle("route.classes", {}, ctx) as {
				routeClasses: Array<{ id: string; capability: string }>;
			};
			expect(routeClasses.routeClasses).toEqual(expect.arrayContaining([
				expect.objectContaining({ id: "coding.fast-local", capability: "coding.patch-and-validate" }),
				expect.objectContaining({ id: "coding.review.strict", capability: "coding.review" }),
				expect.objectContaining({ id: "chat.local-fast", capability: "model.local.chat" }),
				expect.objectContaining({ id: "chat.flex", capability: "model.chat" }),
				expect.objectContaining({ id: "tool.use.flex", capability: "model.tool-use" }),
			]));

			const strictRoute = await router.handle("route.resolve", {
				consumer: "takumi",
				sessionId: "sess-strict",
				routeClass: "coding.review.strict",
			}, ctx) as {
				selected: { id: string } | null;
				routeClass: { id: string; capability: string } | null;
				executionBinding: {
					source: string;
					kind: string;
					preferredModelIds: string[];
					preferredProviderIds: string[];
					allowCrossProvider: boolean;
				} | null;
				policyTrace: string[];
			};
			expect(strictRoute.selected?.id).toBe("adapter.takumi.executor");
			expect(strictRoute.routeClass).toEqual(expect.objectContaining({
				id: "coding.review.strict",
				capability: "coding.review",
			}));
			expect(strictRoute.executionBinding).toEqual(expect.objectContaining({
				source: "kosha-discovery",
				kind: "executor",
				selectedModelId: "gpt-4.1",
				selectedProviderId: "openai",
				preferredModelIds: ["gpt-4.1"],
				preferredProviderIds: ["openai"],
				allowCrossProvider: true,
			}));
			expect(strictRoute.policyTrace).toContain("route-class:coding.review.strict");

			const chatRoute = await router.handle("route.resolve", {
				consumer: "vaayu",
				sessionId: "sess-chat",
				capability: "chat",
			}, ctx) as {
				selected: { id: string } | null;
				discoveryHints: {
					capability: string;
					capabilities: Array<{ capability: string }>;
					cheapest: { candidates: number } | null;
				} | null;
			};
			expect(chatRoute.selected?.id).toBe("discovery.model.openai.gpt-4-1");
			expect(chatRoute.discoveryHints).toEqual(expect.objectContaining({
				capability: "model.chat",
				capabilities: [expect.objectContaining({ capability: "chat" })],
			}));
			expect(chatRoute.discoveryHints?.cheapest).toEqual(expect.objectContaining({ candidates: 1 }));

				const flexChatRoute = await router.handle("route.resolve", {
					consumer: "vaayu",
					sessionId: "sess-chat-flex",
					routeClass: "chat.flex",
			}, ctx) as {
				selected: { id: string } | null;
				routeClass: { id: string; capability: string } | null;
				discoveryHints: {
					query: { capability: string; mode: string };
					models: Array<{ id: string }>;
				} | null;
			};
			expect(flexChatRoute.routeClass).toEqual(expect.objectContaining({
				id: "chat.flex",
				capability: "model.chat",
			}));
			expect(flexChatRoute.selected?.id).toBe("discovery.model.openai.gpt-4-1");
				expect(flexChatRoute.discoveryHints).toEqual(expect.objectContaining({
					query: expect.objectContaining({ capability: "chat", mode: "chat" }),
					models: [expect.objectContaining({ id: "gpt-4.1" })],
				}));

				const preferredFlexRoute = await router.handle("route.resolve", {
					consumer: "vaayu",
					sessionId: "sess-chat-flex-preferred",
					routeClass: "chat.flex",
					context: {
						preferredModelId: "gpt-4.1",
					},
				}, ctx) as {
					selected: { id: string } | null;
					policyTrace: string[];
				};
				expect(preferredFlexRoute.selected?.id).toBe("discovery.model.openai.gpt-4-1");
				expect(preferredFlexRoute.policyTrace).toEqual(expect.arrayContaining([
					"discovery-explicit:discovery.model.openai.gpt-4-1",
					"discovery-hard:discovery.model.openai.gpt-4-1",
				]));

			const batchRoute = await router.handle("route.resolveBatch", {
				consumer: "takumi",
				sessionId: "sess-batch",
				routes: [
					{ key: "planner", routeClass: "coding.deep-reasoning" },
					{ key: "reviewer", routeClass: "coding.review.strict" },
				],
			}, ctx) as {
				contractVersion: number;
				resolutions: Array<{
					key: string;
					selected: { id: string } | null;
					executionBinding: { preferredModelIds?: string[]; preferredProviderIds?: string[] } | null;
				}>;
			};
			expect(batchRoute.contractVersion).toBe(1);
			expect(batchRoute.resolutions).toEqual(expect.arrayContaining([
				expect.objectContaining({
					key: "planner",
					selected: expect.objectContaining({ id: "adapter.takumi.executor" }),
					executionBinding: expect.objectContaining({
						selectedModelId: "gpt-4.1",
						selectedProviderId: "openai",
						preferredModelIds: ["gpt-4.1"],
						preferredProviderIds: ["openai"],
					}),
				}),
				expect.objectContaining({
					key: "reviewer",
					selected: expect.objectContaining({ id: "adapter.takumi.executor" }),
				}),
			]));
			});

	it("reports daemon-owned mesh status and topology for the collaboration runtime", async () => {
		const status = await router.handle("mesh.status", {}, ctx) as {
			running: boolean;
			localActorsAlive: number;
			capabilityRouterActive: boolean;
		};
		expect(status.running).toBe(true);
		expect(status.localActorsAlive).toBeGreaterThanOrEqual(2);
		expect(status.capabilityRouterActive).toBe(true);

		const topology = await router.handle("mesh.topology", {}, ctx) as {
			actorCount: number;
			capabilityIndex: Record<string, string[]>;
		};
		expect(topology.actorCount).toBeGreaterThanOrEqual(2);
		expect(Object.keys(topology.capabilityIndex)).toContain("sabha.consultation");
	});

	it("exposes PAKT as the engine-owned compression runtime and selects it for compaction work", async () => {
		const runtime = await router.handle("runtime.compression_policy", {}, ctx) as {
			preferredRuntime: string;
			defaultRuntime: string;
			available: boolean;
			supports: string[];
			capabilities: Array<{ id: string; capabilities: string[] }>;
		};
		expect(runtime.preferredRuntime).toBe("pakt-core");
		expect(runtime.defaultRuntime).toBe("pakt-core");
		expect(runtime.available).toBe(true);
		expect(runtime.supports).toContain("pakt-core");
		expect(runtime.supports).toContain("pakt");
		expect(runtime.capabilities.map((capability) => capability.id)).toContain("adapter.pakt.compression");

		const capabilityQuery = await router.handle("capabilities", {
			capability: "session.compact",
		}, ctx) as { capabilities: Array<{ id: string }> };
		expect(capabilityQuery.capabilities.map((capability) => capability.id)).toContain("adapter.pakt.compression");

		const route = await router.handle("route.resolve", {
			consumer: "vaayu",
			sessionId: "sess-compress",
			capability: "session.compact",
			constraints: {
				preferLocal: true,
				allowCloud: false,
			},
		}, ctx) as { selected: { id: string } | null; policyTrace: string[] };
		expect(route.selected?.id).toBe("adapter.pakt.compression");
		expect(route.policyTrace).toContain("prefer-local");
	});

	it("does not route compaction work to PAKT when the runtime is unavailable", async () => {
		_setCompressionRuntimeForTests({
			name: "pakt",
			status: async () => ({
				runtime: "pakt",
				transport: "stdio",
				available: false,
				command: "pakt",
				args: ["serve", "--stdio"],
				connected: false,
				tools: [],
				missingTools: ["pakt_compress", "pakt_auto"],
				error: "pakt unavailable",
			}),
			compress: async () => ({ runtime: "pakt" }),
			auto: async () => ({ runtime: "pakt" }),
		});

		const runtime = await router.handle("runtime.compression_policy", {}, ctx) as {
			defaultRuntime: string | null;
			available: boolean;
		};
		expect(runtime.defaultRuntime).toBeNull();
		expect(runtime.available).toBe(false);

		const route = await router.handle("route.resolve", {
			consumer: "vaayu",
			sessionId: "sess-compress-down",
			capability: "session.compact",
			constraints: {
				preferLocal: true,
				allowCloud: false,
			},
		}, ctx) as { selected: { id: string } | null; reason: string };
		expect(route.selected).toBeNull();
		expect(route.reason).toContain("No engine capability matched session.compact");
	});

	it("supports consumer-friendly session aliases", async () => {
		const project = path.join(tmpDir, "proj-a");
		const opened = await router.handle("session.open", {
			project,
			title: "Bridge session",
		}, ctx) as {
			session: { meta: { id: string; project: string }; turns: unknown[] };
			created: boolean;
		};

		expect(opened.created).toBe(true);
		expect(opened.session.meta.project).toBe(project);

		await router.handle("session.turn", {
			sessionId: opened.session.meta.id,
			project,
			turn: {
				turnNumber: 1,
				role: "user",
				content: "hello from consumer",
			},
		}, ctx);

		const reopened = await router.handle("session.open", {
			id: opened.session.meta.id,
			project,
		}, ctx) as {
			session: { turns: Array<{ content: string }> };
			created: boolean;
		};

		expect(reopened.created).toBe(false);
		expect(reopened.session.turns).toHaveLength(1);
		expect(reopened.session.turns[0].content).toContain("hello from consumer");
	});

	it("rehydrates persisted Sabha state after runtime reset", async () => {
		const asked = await router.handle("sabha.ask", {
			question: "Should we migrate the auth flow?",
			convener: "vaayu",
			participants: [
				{ id: "kartru", role: "proposer", expertise: 0.9, credibility: 0.85, clientId: "client-kartru" },
				{ id: "parikshaka", role: "challenger", expertise: 0.8, credibility: 0.9, clientId: "client-parikshaka" },
			],
		}, ctx) as { sabha: { id: string; revision: number; topic: string } };

		_resetCollaborationStateForTests();

		const loaded = await router.handle("sabha.get", {
			id: asked.sabha.id,
			expectedRevision: asked.sabha.revision,
		}, ctx) as { sabha: { id: string; revision: number; topic: string; clientBindings: Record<string, string> } };

		expect(loaded.sabha.id).toBe(asked.sabha.id);
		expect(loaded.sabha.revision).toBe(asked.sabha.revision);
		expect(loaded.sabha.topic).toBe("Should we migrate the auth flow?");
		expect(loaded.sabha.clientBindings).toMatchObject({
			kartru: "client-kartru",
			parikshaka: "client-parikshaka",
		});
	});

	it("runs sabha ask, deliberate, gather, record, and escalate through the daemon contract", async () => {
			const project = path.join(tmpDir, "proj-b");
			const opened = await router.handle("session.open", {
			project,
			title: "Sabha session",
		}, ctx) as { session: { meta: { id: string } } };

		const asked = await router.handle("sabha.ask", {
			question: "Should we refactor the auth module?",
			convener: "vaayu",
			participants: [
				{ id: "kartru", role: "proposer", expertise: 0.9, credibility: 0.85, clientId: "client-kartru" },
				{ id: "parikshaka", role: "challenger", expertise: 0.8, credibility: 0.9, clientId: "client-parikshaka" },
				{ id: "anveshi", role: "observer", expertise: 0.7, credibility: 0.8 },
			],
		}, ctx) as { sabha: { id: string; status: string; clientBindings: Record<string, string> }; notificationsSent: number };

		expect(asked.sabha.status).toBe("convened");
		expect((asked.sabha as Record<string, unknown>).revision).toBe(1);
		expect(asked.notificationsSent).toBe(1);
			expect(asked.sabha.clientBindings).toMatchObject({
				kartru: "client-kartru",
				parikshaka: "client-parikshaka",
			});
			expect(notifications.some((notification) => notification.method === "sabha.consult")).toBe(true);

			const perspective = await router.handle("sabha.submit_perspective", {
				id: asked.sabha.id,
				participantId: "parikshaka",
				summary: "Refactor only if we can prove the recent regressions come from auth complexity.",
				reasoning: "The council should see concrete defect evidence before committing to a disruptive refactor.",
				position: "oppose",
				recommendedAction: "Collect auth regression data first",
				evidence: [
					{ label: "release-notes", detail: "Two auth regressions are documented in the last release notes." },
				],
			}, { ...ctx, clientId: "client-parikshaka" }) as {
				sabha: {
					consultationSummary: { perspectiveCount: number; respondedCount: number; pendingCount: number };
					respondedParticipantIds: string[];
					pendingParticipantIds: string[];
				};
				perspective: { participantId: string; clientId: string | null };
			};
			expect(perspective.perspective.participantId).toBe("parikshaka");
			expect(perspective.perspective.clientId).toBe("client-parikshaka");
			expect(perspective.sabha.consultationSummary).toMatchObject({
				perspectiveCount: 1,
				respondedCount: 1,
				pendingCount: 2,
			});
			expect((perspective.sabha as Record<string, unknown>).revision).toBe(2);
			expect(perspective.sabha.respondedParticipantIds).toEqual(["parikshaka"]);
			expect(perspective.sabha.pendingParticipantIds).toEqual(["kartru", "anveshi"]);
			expect(notifications.some((notification) => notification.method === "sabha.perspective")).toBe(true);

			await router.handle("sabha.submit_perspective", {
				id: asked.sabha.id,
				participantId: "anveshi",
				summary: "The pattern does resemble earlier successful refactors, but the council should preserve a rollback path.",
				position: "observe",
			}, { ...ctx, clientId: "client-anveshi" });

			const deliberating = await router.handle("sabha.deliberate", {
				id: asked.sabha.id,
			proposerId: "kartru",
			proposal: {
				pratijna: "The auth module should be refactored.",
				hetu: "Because its complexity and bug surface are both high.",
				udaharana: "Where complexity and bug density are high, refactoring improves maintainability, as with the payment module.",
				upanaya: "The auth module has high complexity and repeated defects.",
				nigamana: "Therefore, the auth module should be refactored.",
			},
			challenges: [
				{
					challengerId: "parikshaka",
					targetStep: "hetu",
					challenge: "Show the strongest evidence for repeated auth regressions.",
				},
			],
		}, ctx) as { sabha: { status: string; currentRound: { allChallenges: Array<{ challenge: string }> } } };
		expect(deliberating.sabha.status).toBe("deliberating");
		expect(deliberating.sabha.currentRound.allChallenges).toHaveLength(1);

		await router.handle("sabha.respond", {
			id: asked.sabha.id,
			recordIndex: 0,
			response: "Three independent regressions landed in the last two release cycles.",
		}, ctx);

		await router.handle("sabha.vote", {
			id: asked.sabha.id,
			participantId: "kartru",
			position: "support",
			reasoning: "The proposal is justified.",
		}, ctx);
		await router.handle("sabha.vote", {
			id: asked.sabha.id,
			participantId: "parikshaka",
			position: "support",
			reasoning: "The evidence is sufficient.",
		}, ctx);
		const concluded = await router.handle("sabha.vote", {
			id: asked.sabha.id,
			participantId: "anveshi",
			position: "support",
			reasoning: "Repeated pattern matches prior successful refactors.",
			conclude: true,
		}, ctx) as { sabha: { finalVerdict: string } };
		expect(concluded.sabha.finalVerdict).toBe("accepted");

		const gathered = await router.handle("sabha.gather", {
			id: asked.sabha.id,
		}, ctx) as {
			sabha: {
				rounds: Array<{ roundNumber: number }>;
				currentRound: { voteSummary: { count: number } };
			};
			explanation: string;
		};

			expect(gathered.sabha.rounds).toHaveLength(1);
			expect(gathered.sabha.currentRound.voteSummary.count).toBe(3);
			expect((gathered.sabha as Record<string, unknown>).revision).toBeGreaterThanOrEqual(8);
			expect(((gathered.sabha as Record<string, unknown>).recentEvents as Array<{ eventType: string }>).length).toBeGreaterThan(0);
			expect(gathered.explanation).toContain("Sabha");

			const events = await router.handle("sabha.events", {
				id: asked.sabha.id,
				sinceRevision: 2,
			}, ctx) as {
				currentRevision: number;
				snapshotHash: string;
				events: Array<{ eventId: string; revision: number; parentRevision: number; eventType: string }>;
				hasMore: boolean;
			};
			expect(events.currentRevision).toBeGreaterThanOrEqual(8);
			expect(events.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
			expect(events.hasMore).toBe(false);
			expect(events.events[0]?.eventId).toBeTruthy();
			expect(events.events[0]?.parentRevision).toBe(events.events[0]?.revision - 1);

			const syncByEvents = await router.handle("sabha.sync", {
				id: asked.sabha.id,
				sinceRevision: 2,
				snapshotHash: events.snapshotHash,
			}, ctx) as {
				mode: string;
				currentRevision: number;
				snapshotHash: string;
				events: Array<{ revision: number }>;
			};
			expect(syncByEvents.mode).toBe("events");
			expect(syncByEvents.currentRevision).toBe(events.currentRevision);
			expect(syncByEvents.snapshotHash).toBe(events.snapshotHash);
			expect(syncByEvents.events.length).toBeGreaterThan(0);

			const syncBySnapshot = await router.handle("sabha.sync", {
				id: asked.sabha.id,
				sinceRevision: 2,
				snapshotHash: "stale-snapshot",
			}, ctx) as {
				mode: string;
				sabha: { id: string; snapshotHash: string };
				events: unknown[];
			};
			expect(syncBySnapshot.mode).toBe("snapshot");
			expect(syncBySnapshot.sabha.id).toBe(asked.sabha.id);
			expect(syncBySnapshot.sabha.snapshotHash).toBe(events.snapshotHash);
			expect(syncBySnapshot.events).toEqual([]);

			const concludeOnlyAsk = await router.handle("sabha.ask", {
				question: "Should we escalate immediately without a completed vote?",
			convener: "vaayu",
			participants: [
				{ id: "kartru", role: "proposer", expertise: 0.9, credibility: 0.85 },
				{ id: "parikshaka", role: "challenger", expertise: 0.8, credibility: 0.9 },
			],
		}, ctx) as { sabha: { id: string } };
		await router.handle("sabha.deliberate", {
			id: concludeOnlyAsk.sabha.id,
			proposerId: "kartru",
			proposal: {
				pratijna: "This should be escalated immediately.",
				hetu: "No automated policy consensus is available.",
				udaharana: "When policy is ambiguous, the action is escalated, as with destructive approvals.",
				upanaya: "This decision crosses an unclear approval boundary.",
				nigamana: "Therefore, the decision should be escalated.",
			},
		}, ctx);
		const concludeOnly = await router.handle("sabha.deliberate", {
			id: concludeOnlyAsk.sabha.id,
			conclude: true,
		}, ctx) as {
			sabha: { finalVerdict: string; rounds: Array<{ roundNumber: number }> };
			explanation: string;
		};
		expect(concludeOnly.sabha.finalVerdict).toBe("escalated");
		expect(concludeOnly.sabha.rounds).toHaveLength(1);
		expect(concludeOnly.explanation).toContain("Sabha");

			const recorded = await router.handle("sabha.record", {
				id: asked.sabha.id,
				sessionId: opened.session.meta.id,
			project,
			category: "architecture",
			confidence: 0.91,
			}, ctx) as {
				decision: { description: string; metadata: Record<string, unknown> };
			};

			expect(recorded.decision.description).toContain("Sabha outcome");
			expect(recorded.decision.metadata.sabhaId).toBe(asked.sabha.id);
			expect(recorded.decision.metadata.perspectiveCount).toBe(2);
			expect([...(recorded.decision.metadata.respondedParticipantIds as string[])].sort()).toEqual(["anveshi", "parikshaka"]);
			expect(recorded.decision.metadata.pendingParticipantIds).toEqual(["kartru"]);
			expect(notifications.some((notification) => notification.method === "sabha.recorded")).toBe(true);

		const escalatedAsk = await router.handle("sabha.ask", {
			question: "Should this action cross a human approval boundary?",
			convener: "vaayu",
			participants: [
				{ id: "kartru", role: "proposer", expertise: 0.9, credibility: 0.85 },
				{ id: "parikshaka", role: "challenger", expertise: 0.8, credibility: 0.9 },
			],
		}, ctx) as { sabha: { id: string } };

		const escalated = await router.handle("sabha.escalate", {
			id: escalatedAsk.sabha.id,
			reason: "Human approval required by policy",
		}, ctx) as { sabha: { status: string; finalVerdict: string } };

			expect(escalated.sabha.status).toBe("escalated");
			expect(escalated.sabha.finalVerdict).toBe("escalated");
			expect(notifications.some((notification) => notification.method === "sabha.escalated")).toBe(true);
		});

		it("rejects Sabha perspectives for unknown or closed participants", async () => {
			const asked = await router.handle("sabha.ask", {
				question: "Should this be approved?",
				convener: "vaayu",
				participants: [
					{ id: "kartru", role: "proposer", expertise: 0.9, credibility: 0.85 },
					{ id: "parikshaka", role: "challenger", expertise: 0.8, credibility: 0.9, clientId: "client-parikshaka" },
				],
			}, ctx) as { sabha: { id: string } };

			await expect(router.handle("sabha.submit_perspective", {
				id: asked.sabha.id,
				participantId: "ghost",
				summary: "I disagree.",
			}, ctx)).rejects.toThrow("not part of Sabha");

			await expect(router.handle("sabha.submit_perspective", {
				id: asked.sabha.id,
				participantId: "parikshaka",
				summary: "Wrong client should not be accepted.",
				reasoning: "Bound participants must come from the bound client.",
				position: "observe",
			}, { ...ctx, clientId: "wrong-client" })).rejects.toThrow("is bound to client");

			await router.handle("sabha.submit_perspective", {
				id: asked.sabha.id,
				participantId: "kartru",
				summary: "Initial council input.",
				reasoning: "The first perspective should stick.",
				position: "observe",
			}, ctx);

			await expect(router.handle("sabha.submit_perspective", {
				id: asked.sabha.id,
				participantId: "kartru",
				summary: "Replacement council input.",
				reasoning: "Duplicate submissions should be rejected.",
				position: "observe",
			}, ctx)).rejects.toThrow("already submitted a perspective");

			await router.handle("sabha.escalate", {
				id: asked.sabha.id,
				reason: "Human approval required",
			}, ctx);

			await expect(router.handle("sabha.submit_perspective", {
				id: asked.sabha.id,
				participantId: "kartru",
				summary: "Too late",
			}, ctx)).rejects.toThrow("consultation is closed");
		});

			it("rejects invalid participant weighting input", async () => {
				await expect(router.handle("sabha.ask", {
					question: "Should this be approved?",
					convener: "vaayu",
					participants: [
						{ id: "kartru", role: "proposer", expertise: "not-a-number", credibility: 0.85 },
						{ id: "parikshaka", role: "challenger", expertise: 0.8, credibility: 0.9 },
					],
				}, ctx)).rejects.toThrow("invalid expertise or credibility");
			});

			it("restores Sabha state, bindings, and perspectives after restart", async () => {
				const asked = await router.handle("sabha.ask", {
					question: "Should the council survive restart?",
					convener: "vaayu",
					participants: [
						{ id: "kartru", role: "proposer", expertise: 0.9, credibility: 0.85, clientId: "client-kartru" },
						{ id: "parikshaka", role: "challenger", expertise: 0.8, credibility: 0.9, clientId: "client-parikshaka" },
					],
				}, ctx) as { sabha: { id: string } };

				await router.handle("sabha.submit_perspective", {
					id: asked.sabha.id,
					participantId: "parikshaka",
					summary: "Persist the council state before restart.",
					reasoning: "Consultation continuity should survive daemon restart.",
					position: "oppose",
				}, { ...ctx, clientId: "client-parikshaka" });

				_resetCollaborationStateForTests();
				router = new RpcRouter();
				notifications = [];
				router.setNotifier((notification) => {
					notifications.push(notification);
					return 1;
				});
				const sessionStore = await import("@chitragupta/smriti/session-store");
				registerSessionMethods(router, sessionStore, {} as never);
				registerTurnMethods(router, sessionStore);
				registerCompressionMethods(router);
				registerContractMethods(router);
				registerCollaborationMethods(router);

				const restored = await router.handle("sabha.get", {
					id: asked.sabha.id,
				}, ctx) as {
					sabha: {
						clientBindings: Record<string, string>;
						revision: number;
						recentEvents: Array<{ eventType: string }>;
						respondedParticipantIds: string[];
						pendingParticipantIds: string[];
					};
				};

				expect(restored.sabha.clientBindings).toMatchObject({
					kartru: "client-kartru",
					parikshaka: "client-parikshaka",
				});
				expect(restored.sabha.revision).toBe(2);
				expect(restored.sabha.recentEvents.map((event) => event.eventType)).toEqual([
					"convened",
					"perspective_submitted",
				]);
				expect(restored.sabha.respondedParticipantIds).toEqual(["parikshaka"]);
			expect(restored.sabha.pendingParticipantIds).toEqual(["kartru"]);
			});

		it("dispatches Sabha consultations over the mesh and records returned perspectives", async () => {
				const mesh = getCollaborationMeshSystemForTests();
				mesh.spawn("mesh-reviewer", {
					behavior: (_env, actor) => {
						actor.reply({
							summary: "Stage the rollout behind a guard.",
							reasoning: "Recent regressions suggest a gradual rollout is safer than immediate full exposure.",
							position: "observe",
							recommendedAction: "Roll out behind a project-scoped guard",
							evidence: [
								{
									label: "recent-regressions",
									detail: "Two recent fixes were easier to validate behind a staged rollout.",
								},
							],
							metadata: {
								source: "mesh-reviewer",
							},
						});
					},
				});

				const asked = await router.handle("sabha.ask", {
					question: "Should the rollout happen immediately?",
					convener: "vaayu",
					targetClientIds: ["vaayu-client"],
					participants: [
						{
							id: "mesh-peer",
							role: "observer",
							expertise: 0.74,
							credibility: 0.81,
							meshTarget: "mesh-reviewer",
						},
						{
							id: "kartru",
							role: "proposer",
							expertise: 0.82,
							credibility: 0.84,
						},
					],
				}, ctx) as {
					sabha: {
						id: string;
						perspectives: Array<{ participantId: string; summary: string; metadata: Record<string, unknown> }>;
						consultationSummary: { perspectiveCount: number; respondedCount: number; pendingCount: number };
						recentEvents: Array<{ eventType: string; payload: Record<string, unknown> }>;
					};
					meshDispatches: Array<{ participantId: string; status: string; replySummary?: string; replyFrom?: string }>;
				};

				expect(asked.meshDispatches).toEqual([
					expect.objectContaining({
						participantId: "mesh-peer",
						status: "accepted",
						replySummary: "Stage the rollout behind a guard.",
						replyFrom: "mesh-reviewer",
					}),
				]);
				expect(asked.sabha.consultationSummary).toMatchObject({
					perspectiveCount: 1,
					respondedCount: 1,
					pendingCount: 1,
				});
				expect(asked.sabha.perspectives).toEqual([
					expect.objectContaining({
						participantId: "mesh-peer",
						summary: "Stage the rollout behind a guard.",
						metadata: expect.objectContaining({
							source: "sabha.mesh",
							meshReplyFrom: "mesh-reviewer",
							meshTarget: "mesh-reviewer",
						}),
					}),
				]);
				expect(asked.sabha.recentEvents.at(-1)).toEqual(expect.objectContaining({
					eventType: "mesh_dispatch",
					payload: expect.objectContaining({
						participantId: "mesh-peer",
						replyFrom: "mesh-reviewer",
					}),
				}));
				expect(notifications.some((notification) => notification.method === "sabha.mesh_dispatch")).toBe(true);

				const gathered = await router.handle("sabha.gather", {
					id: asked.sabha.id,
				}, ctx) as {
					sabha: {
						respondedParticipantIds: string[];
						pendingParticipantIds: string[];
						dispatchLog: Array<{
							participantId: string;
							status: string;
							replyFrom?: string;
							leaseOwner?: string;
						}>;
					};
				};
				expect(gathered.sabha.respondedParticipantIds).toEqual(["mesh-peer"]);
				expect(gathered.sabha.pendingParticipantIds).toEqual(["kartru"]);
				expect(gathered.sabha.dispatchLog).toEqual(expect.arrayContaining([
					expect.objectContaining({
						participantId: "mesh-peer",
						status: "pending",
						leaseOwner: expect.stringContaining("sabha-daemon"),
					}),
					expect.objectContaining({
						participantId: "mesh-peer",
						status: "accepted",
						replyFrom: "mesh-reviewer",
					}),
				]));
		});

		it("pins capability-routed Sabha participants to the actor that first replied", async () => {
			const asked = await router.handle("sabha.ask", {
				question: "Should memory context influence this rollout?",
				convener: "vaayu",
				participants: [
					{
						id: "memory-peer",
						role: "observer",
						expertise: 0.74,
						credibility: 0.81,
						meshTarget: "capability:sabha.consult.memory",
					},
					{
						id: "kartru",
						role: "proposer",
						expertise: 0.82,
						credibility: 0.84,
					},
				],
			}, ctx) as {
				sabha: {
					meshBindings: Array<{ participantId: string; target: string; resolvedTarget?: string }>;
					recentEvents: Array<{ eventType: string; payload: Record<string, unknown> }>;
					perspectives: Array<{ metadata: Record<string, unknown> }>;
				};
			};

			expect(asked.sabha.meshBindings).toEqual([
				expect.objectContaining({
					participantId: "memory-peer",
					target: "capability:sabha.consult.memory",
					resolvedTarget: "sabha:memory",
				}),
			]);
			expect(asked.sabha.recentEvents.at(-1)).toEqual(expect.objectContaining({
				eventType: "mesh_dispatch",
				payload: expect.objectContaining({
					participantId: "memory-peer",
					resolvedTarget: "sabha:memory",
				}),
			}));
			expect(asked.sabha.perspectives[0]?.metadata).toEqual(expect.objectContaining({
				meshReplyFrom: "sabha:memory",
			}));
		});

		it("resumes an expired pending Sabha mesh lease after restart", async () => {
			const now = Date.now();
			const leaseOwner = getCollaborationMeshLeaseOwner();
			savePersistedSabhaStateSnapshot({
				sabha: {
					id: "sabha-restart",
					topic: "Should memory context influence this rollout?",
					status: "convened",
					convener: "vaayu",
					participants: [
						{ id: "memory-peer", role: "observer", expertise: 0.74, credibility: 0.81 },
						{ id: "kartru", role: "proposer", expertise: 0.82, credibility: 0.86 },
					],
					rounds: [],
					finalVerdict: null,
					createdAt: now - 60_000,
					concludedAt: null,
				},
				revision: 1,
				clientBindings: {},
				meshBindings: [
					{
						participantId: "memory-peer",
						target: "capability:sabha.consult.memory",
						mode: "ask",
						timeoutMs: 1_000,
						topic: "sabha.consult",
					},
				],
				dispatchLog: [
					{
						participantId: "memory-peer",
						target: "capability:sabha.consult.memory",
						mode: "ask",
						status: "pending",
						attemptedAt: now - 20_000,
						leaseOwner: "stale-node",
						leaseExpiresAt: now - 10_000,
					},
				],
				perspectives: [],
			});

			DatabaseManager.reset();
			_resetCollaborationStateForTests();
			initAgentSchema(DatabaseManager.instance(tmpDir));

			router = new RpcRouter();
			notifications = [];
			router.setNotifier((notification) => {
				notifications.push(notification);
				return 1;
			});
			registerCompressionMethods(router);
			registerDiscoveryMethods(router);
			registerContractMethods(router);
			registerCollaborationMethods(router);
			registerMeshMethods(router);

			let recovered: {
				sabha: {
					perspectives: Array<{ participantId: string; metadata: Record<string, unknown> }>;
					dispatchLog: Array<{ participantId: string; status: string; replyFrom?: string; resumed?: boolean }>;
					recentEvents: Array<{ eventType: string; payload?: Record<string, unknown> }>;
				};
			} | null = null;

			for (let attempt = 0; attempt < 20; attempt += 1) {
				recovered = await router.handle("sabha.get", { id: "sabha-restart" }, ctx) as typeof recovered;
				if ((recovered?.sabha.perspectives.length ?? 0) > 0) break;
				await new Promise((resolve) => setTimeout(resolve, 20));
			}

			expect(recovered?.sabha.perspectives).toEqual([
				expect.objectContaining({
					participantId: "memory-peer",
					metadata: expect.objectContaining({
						meshReplyFrom: "sabha:memory",
					}),
				}),
			]);
			expect(recovered?.sabha.dispatchLog).toEqual(expect.arrayContaining([
				expect.objectContaining({
					participantId: "memory-peer",
					status: "pending",
				}),
				expect.objectContaining({
					participantId: "memory-peer",
					status: "accepted",
					replyFrom: "sabha:memory",
					resumed: true,
				}),
			]));
			expect(recovered?.sabha.recentEvents).toEqual(expect.arrayContaining([
				expect.objectContaining({
					eventType: "mesh_dispatch_resumed",
					payload: expect.objectContaining({
						participantId: "memory-peer",
						resumed: true,
					}),
				}),
			]));
		});

		it("resumes a same-owner pending mesh lease immediately after restart", async () => {
			const now = Date.now();
			const leaseOwner = getCollaborationMeshLeaseOwner();
			savePersistedSabhaStateSnapshot({
				sabha: {
					id: "sabha-restart-same-owner",
					topic: "Should the daemon resume its own pending council lease after restart?",
					status: "convened",
					convener: "vaayu",
					participants: [
						{ id: "memory-peer", role: "observer", expertise: 0.74, credibility: 0.81 },
						{ id: "kartru", role: "proposer", expertise: 0.82, credibility: 0.86 },
					],
					rounds: [],
					finalVerdict: null,
					createdAt: now - 60_000,
					concludedAt: null,
				},
				revision: 1,
				clientBindings: {},
				meshBindings: [
					{
						participantId: "memory-peer",
						target: "capability:sabha.consult.memory",
						mode: "ask",
						timeoutMs: 10_000,
						topic: "sabha.consult",
					},
				],
				dispatchLog: [
					{
						participantId: "memory-peer",
						target: "capability:sabha.consult.memory",
						mode: "ask",
						status: "pending",
						attemptedAt: now - 500,
						leaseOwner,
						leaseExpiresAt: now + 20_000,
					},
				],
				perspectives: [],
			});

			DatabaseManager.reset();
			_resetCollaborationStateForTests();
			initAgentSchema(DatabaseManager.instance(tmpDir));

			router = new RpcRouter();
			notifications = [];
			router.setNotifier((notification) => {
				notifications.push(notification);
				return 1;
			});
			registerCompressionMethods(router);
			registerDiscoveryMethods(router);
			registerContractMethods(router);
			registerCollaborationMethods(router);
			registerMeshMethods(router);

			let recovered: {
				sabha: {
					perspectives: Array<{ participantId: string; metadata: Record<string, unknown> }>;
					dispatchLog: Array<{ participantId: string; status: string; replyFrom?: string; resumed?: boolean; leaseOwner?: string }>;
					recentEvents: Array<{ eventType: string; payload?: Record<string, unknown> }>;
				};
			} | null = null;

			for (let attempt = 0; attempt < 20; attempt += 1) {
				recovered = await router.handle("sabha.get", { id: "sabha-restart-same-owner" }, ctx) as typeof recovered;
				if ((recovered?.sabha.perspectives.length ?? 0) > 0) break;
				await new Promise((resolve) => setTimeout(resolve, 20));
			}

			expect(recovered?.sabha.perspectives).toEqual([
				expect.objectContaining({
					participantId: "memory-peer",
					metadata: expect.objectContaining({
						meshReplyFrom: "sabha:memory",
					}),
				}),
			]);
			expect(recovered?.sabha.dispatchLog).toEqual(expect.arrayContaining([
				expect.objectContaining({
					participantId: "memory-peer",
					status: "pending",
					leaseOwner,
				}),
				expect.objectContaining({
					participantId: "memory-peer",
					status: "accepted",
					replyFrom: "sabha:memory",
					resumed: true,
				}),
			]));
			expect(recovered?.sabha.recentEvents).toEqual(expect.arrayContaining([
				expect.objectContaining({
					eventType: "mesh_dispatch_resumed",
					payload: expect.objectContaining({
						participantId: "memory-peer",
						status: "accepted",
						resumed: true,
					}),
				}),
			]));
		});

		it("does not resume a foreign unexpired mesh lease after restart", async () => {
			const now = Date.now();
			savePersistedSabhaStateSnapshot({
				sabha: {
					id: "sabha-restart-foreign-owner",
					topic: "Should an unexpired foreign mesh lease be taken over?",
					status: "convened",
					convener: "vaayu",
					participants: [
						{ id: "memory-peer", role: "observer", expertise: 0.74, credibility: 0.81 },
						{ id: "kartru", role: "proposer", expertise: 0.82, credibility: 0.86 },
					],
					rounds: [],
					finalVerdict: null,
					createdAt: now - 60_000,
					concludedAt: null,
				},
				revision: 1,
				clientBindings: {},
				meshBindings: [
					{
						participantId: "memory-peer",
						target: "capability:sabha.consult.memory",
						mode: "ask",
						timeoutMs: 10_000,
						topic: "sabha.consult",
					},
				],
				dispatchLog: [
					{
						participantId: "memory-peer",
						target: "capability:sabha.consult.memory",
						mode: "ask",
						status: "pending",
						attemptedAt: now - 500,
						leaseOwner: "remote-node",
						leaseExpiresAt: now + 20_000,
					},
				],
				perspectives: [],
			});

			DatabaseManager.reset();
			_resetCollaborationStateForTests();
			initAgentSchema(DatabaseManager.instance(tmpDir));

			router = new RpcRouter();
			notifications = [];
			router.setNotifier((notification) => {
				notifications.push(notification);
				return 1;
			});
			registerCompressionMethods(router);
			registerDiscoveryMethods(router);
			registerContractMethods(router);
			registerCollaborationMethods(router);
			registerMeshMethods(router);

			await new Promise((resolve) => setTimeout(resolve, 40));
			const recovered = await router.handle("sabha.get", { id: "sabha-restart-foreign-owner" }, ctx) as {
				sabha: {
					perspectives: Array<{ participantId: string }>;
					dispatchLog: Array<{ participantId: string; status: string; leaseOwner?: string }>;
					recentEvents: Array<{ eventType: string; payload?: Record<string, unknown> }>;
				};
			};

			expect(recovered.sabha.perspectives).toEqual([]);
			expect(recovered.sabha.dispatchLog).toEqual([
				expect.objectContaining({
					participantId: "memory-peer",
					status: "pending",
					leaseOwner: "remote-node",
				}),
			]);
			expect(
				recovered.sabha.recentEvents.some(
					(event) => event.eventType === "mesh_dispatch_resumed",
				),
			).toBe(false);
		});

		it("resumes pending mesh work through the explicit sabha.resume contract", async () => {
			const now = Date.now();
			savePersistedSabhaStateSnapshot({
				sabha: {
					id: "sabha-explicit-resume",
					topic: "Should the council resume from a stale lease?",
					status: "convened",
					convener: "vaayu",
					participants: [
						{ id: "memory-peer", role: "observer", expertise: 0.74, credibility: 0.81 },
						{ id: "kartru", role: "proposer", expertise: 0.82, credibility: 0.86 },
					],
					rounds: [],
					finalVerdict: null,
					createdAt: now - 60_000,
					concludedAt: null,
				},
				revision: 1,
				clientBindings: {},
				meshBindings: [
					{
						participantId: "memory-peer",
						target: "capability:sabha.consult.memory",
						mode: "ask",
						timeoutMs: 1_000,
						topic: "sabha.consult",
					},
				],
				dispatchLog: [
					{
						participantId: "memory-peer",
						target: "capability:sabha.consult.memory",
						mode: "ask",
						status: "pending",
						attemptedAt: now - 20_000,
						leaseOwner: "stale-node",
						leaseExpiresAt: now - 10_000,
					},
				],
				perspectives: [],
			});

			DatabaseManager.reset();
			_resetCollaborationStateForTests();
			initAgentSchema(DatabaseManager.instance(tmpDir));

			router = new RpcRouter();
			notifications = [];
			router.setNotifier((notification) => {
				notifications.push(notification);
				return 1;
			});
			registerCompressionMethods(router);
			registerDiscoveryMethods(router);
			registerContractMethods(router);
			registerCollaborationMethods(router);
			registerMeshMethods(router);

			const resumed = await router.handle("sabha.resume", {
				id: "sabha-explicit-resume",
			}, ctx) as {
				sabha: {
					perspectives: Array<{ participantId: string; metadata: Record<string, unknown> }>;
					dispatchLog: Array<{ participantId: string; status: string; replyFrom?: string; resumed?: boolean }>;
				};
				meshDispatches: Array<{ participantId: string; status: string; resumed?: boolean }>;
			};

			if (resumed.meshDispatches.length > 0) {
				expect(resumed.meshDispatches).toEqual(expect.arrayContaining([
					expect.objectContaining({
						participantId: "memory-peer",
						status: "accepted",
						resumed: true,
					}),
				]));
			}
			expect(resumed.sabha.perspectives).toEqual([
				expect.objectContaining({
					participantId: "memory-peer",
					metadata: expect.objectContaining({
						meshReplyFrom: "sabha:memory",
					}),
				}),
			]);
			expect(resumed.sabha.dispatchLog).toEqual(expect.arrayContaining([
				expect.objectContaining({
					participantId: "memory-peer",
					status: "accepted",
					replyFrom: "sabha:memory",
					resumed: true,
				}),
			]));
		});

		it("records failed mesh dispatches when no actor or peer satisfies the target", async () => {
				const asked = await router.handle("sabha.ask", {
					question: "Should this rely on a missing capability?",
					convener: "vaayu",
					participants: [
						{
							id: "missing-peer",
							role: "observer",
							expertise: 0.7,
							credibility: 0.7,
							meshTarget: "capability:sabha.consult.missing",
						},
						{
							id: "kartru",
							role: "proposer",
							expertise: 0.75,
							credibility: 0.8,
						},
					],
				}, ctx) as {
					meshDispatches: Array<{ participantId: string; status: string; error?: string }>;
					sabha: { recentEvents: Array<{ eventType: string; payload: Record<string, unknown> }> };
				};

				expect(asked.meshDispatches).toEqual([
					expect.objectContaining({
						participantId: "missing-peer",
						status: "failed",
						error: expect.stringContaining("No mesh actor or peer advertises capability"),
					}),
				]);
			expect(asked.sabha.recentEvents.at(-1)).toEqual(expect.objectContaining({
				eventType: "mesh_dispatch",
				payload: expect.objectContaining({
					participantId: "missing-peer",
					status: "failed",
				}),
			}));
		});

		it("resumes persisted mesh consultations after restart when the actor becomes available", async () => {
			const asked = await router.handle("sabha.ask", {
				question: "Should a late peer still be consulted after restart?",
				convener: "vaayu",
				participants: [
					{
						id: "late-peer",
						role: "observer",
						expertise: 0.7,
						credibility: 0.72,
						meshTarget: "late-peer",
					},
					{
						id: "kartru",
						role: "proposer",
						expertise: 0.82,
						credibility: 0.84,
					},
				],
			}, ctx) as {
				sabha: {
					id: string;
					recentEvents: Array<{ eventType: string }>;
				};
				meshDispatches: Array<{ status: string }>;
			};

			expect(asked.meshDispatches[0]?.status).toBe("failed");
			expect(asked.sabha.recentEvents.at(-1)?.eventType).toBe("mesh_dispatch");

			_resetCollaborationStateForTests();
			DatabaseManager.reset();
			initAgentSchema(DatabaseManager.instance(tmpDir));
			router = new RpcRouter();
			notifications = [];
			router.setNotifier((notification) => {
				notifications.push(notification);
				return 1;
			});
			const mesh = getCollaborationMeshSystemForTests();
			mesh.spawn("late-peer", {
				behavior: (_env, actor) => {
					actor.reply({
						summary: "The late peer has joined and approves a staged retry.",
						reasoning: "Restart recovery should resume the pending consultation rather than drop it.",
						position: "support",
					});
				},
			});
			const sessionStore = await import("@chitragupta/smriti/session-store");
			registerSessionMethods(router, sessionStore, {} as never);
			registerTurnMethods(router, sessionStore);
			registerCompressionMethods(router);
			registerContractMethods(router);
			registerCollaborationMethods(router);

			const gathered = await router.handle("sabha.gather", {
				id: asked.sabha.id,
				retryMesh: true,
			}, ctx) as {
				sabha: {
					respondedParticipantIds: string[];
					perspectives: Array<{ participantId: string; summary: string }>;
					recentEvents: Array<{ eventType: string; payload: Record<string, unknown> }>;
				};
				meshDispatches: Array<{ participantId: string; status: string; replyFrom?: string; resumed?: boolean }>;
			};

			if (gathered.meshDispatches.length > 0) {
				expect(gathered.meshDispatches).toEqual([
					expect.objectContaining({
						participantId: "late-peer",
						status: "accepted",
						replyFrom: "late-peer",
						resumed: true,
					}),
				]);
			}
			expect(gathered.sabha.respondedParticipantIds).toEqual(["late-peer"]);
			expect(gathered.sabha.perspectives).toEqual([
				expect.objectContaining({
					participantId: "late-peer",
					summary: "The late peer has joined and approves a staged retry.",
				}),
			]);
			expect(gathered.sabha.recentEvents.some((event) => event.eventType === "mesh_dispatch_resumed")).toBe(true);
			expect(gathered.sabha.recentEvents.findLast((event) => event.eventType === "mesh_dispatch_resumed")).toEqual(expect.objectContaining({
				eventType: "mesh_dispatch_resumed",
				payload: expect.objectContaining({
					participantId: "late-peer",
					status: "accepted",
					resumed: true,
				}),
			}));
		});

		it("keeps sabha.get side-effect free unless mesh resume is explicitly requested", async () => {
			const asked = await router.handle("sabha.ask", {
				question: "Should plain reads resume pending mesh work?",
				convener: "vaayu",
				participants: [
					{
						id: "late-peer",
						role: "observer",
						expertise: 0.7,
						credibility: 0.72,
						meshTarget: "late-peer",
					},
					{
						id: "kartru",
						role: "proposer",
						expertise: 0.82,
						credibility: 0.84,
					},
				],
			}, ctx) as { sabha: { id: string } };

			const before = await router.handle("sabha.events", {
				id: asked.sabha.id,
				sinceRevision: 0,
			}, ctx) as {
				currentRevision: number;
				events: Array<{ eventType: string }>;
			};

			const readOnly = await router.handle("sabha.get", {
				id: asked.sabha.id,
			}, ctx) as {
				meshDispatches: Array<{ status: string }>;
				sabha: { recentEvents: Array<{ eventType: string }> };
			};

			const after = await router.handle("sabha.events", {
				id: asked.sabha.id,
				sinceRevision: 0,
			}, ctx) as {
				currentRevision: number;
				events: Array<{ eventType: string }>;
			};

			expect(readOnly.meshDispatches).toEqual([]);
			expect(after.currentRevision).toBe(before.currentRevision);
			expect(after.events.map((event) => event.eventType)).toEqual(before.events.map((event) => event.eventType));
			expect(readOnly.sabha.recentEvents.some((event) => event.eventType === "mesh_dispatch_resumed")).toBe(false);
		});

		it("pulls replicated Sabha state without resuming pending mesh dispatches", async () => {
			const asked = await router.handle("sabha.ask", {
				question: "Should replication reads stay side-effect free?",
				convener: "vaayu",
				participants: [
					{
						id: "late-peer",
						role: "observer",
						expertise: 0.7,
						credibility: 0.72,
						meshTarget: "late-peer",
					},
					{
						id: "kartru",
						role: "proposer",
						expertise: 0.82,
						credibility: 0.84,
					},
				],
			}, ctx) as {
				sabha: { id: string; revision: number };
			};

			const before = await router.handle("sabha.events", {
				id: asked.sabha.id,
				sinceRevision: 0,
			}, ctx) as {
				currentRevision: number;
				events: Array<{ eventType: string }>;
			};

			const pulled = await router.handle("sabha.repl.pull", {
				id: asked.sabha.id,
				sinceRevision: 0,
				snapshotHash: "stale",
			}, ctx) as {
				mode: string;
				currentRevision: number;
				state: { revision: number };
			};

			const after = await router.handle("sabha.events", {
				id: asked.sabha.id,
				sinceRevision: 0,
			}, ctx) as {
				currentRevision: number;
				events: Array<{ eventType: string }>;
			};

			expect(pulled.mode).toBe("snapshot");
			expect(pulled.currentRevision).toBe(before.currentRevision);
			expect(pulled.state.revision).toBe(before.currentRevision);
			expect(after.currentRevision).toBe(before.currentRevision);
			expect(after.events.map((event) => event.eventType)).toEqual(before.events.map((event) => event.eventType));
			expect(after.events.some((event) => event.eventType === "mesh_dispatch_resumed")).toBe(false);
		});

		it("keeps sabha.sync side-effect free unless mesh resume is explicitly requested", async () => {
			const asked = await router.handle("sabha.ask", {
				question: "Should sync stay side-effect free by default?",
				convener: "vaayu",
				participants: [
					{
						id: "late-peer",
						role: "observer",
						expertise: 0.72,
						credibility: 0.74,
						meshTarget: "late-peer",
					},
					{
						id: "kartru",
						role: "proposer",
						expertise: 0.82,
						credibility: 0.84,
					},
				],
			}, ctx) as {
				sabha: { id: string; revision: number; snapshotHash: string };
			};

			const before = await router.handle("sabha.events", {
				id: asked.sabha.id,
				sinceRevision: 0,
			}, ctx) as {
				currentRevision: number;
				events: Array<{ eventType: string }>;
			};

			const synced = await router.handle("sabha.sync", {
				id: asked.sabha.id,
				sinceRevision: asked.sabha.revision,
				snapshotHash: asked.sabha.snapshotHash,
			}, ctx) as {
				meshDispatches: Array<{ status: string }>;
			};

			const after = await router.handle("sabha.events", {
				id: asked.sabha.id,
				sinceRevision: 0,
			}, ctx) as {
				currentRevision: number;
				events: Array<{ eventType: string }>;
			};

			expect(synced.meshDispatches).toEqual([]);
			expect(after.currentRevision).toBe(before.currentRevision);
			expect(after.events.map((event) => event.eventType)).toEqual(before.events.map((event) => event.eventType));
			expect(after.events.some((event) => event.eventType === "mesh_dispatch_resumed")).toBe(false);
		});

		it("applies replicated Sabha snapshots into a clean replica", async () => {
			const asked = await router.handle("sabha.ask", {
				question: "Should replicated snapshots seed a clean replica?",
				convener: "vaayu",
				participants: [
					{ id: "kartru", role: "proposer", expertise: 0.9, credibility: 0.85, clientId: "client-kartru" },
					{ id: "parikshaka", role: "challenger", expertise: 0.8, credibility: 0.9, clientId: "client-parikshaka" },
				],
			}, ctx) as { sabha: { id: string } };

			await router.handle("sabha.submit_perspective", {
				id: asked.sabha.id,
				participantId: "parikshaka",
				summary: "Replica should preserve council context.",
				reasoning: "The council state should survive replication.",
				position: "observe",
			}, { ...ctx, clientId: "client-parikshaka" });

			const snapshot = await router.handle("sabha.repl.pull", {
				id: asked.sabha.id,
				sinceRevision: 0,
				snapshotHash: "stale",
			}, ctx) as {
				mode: string;
				currentRevision: number;
				snapshotHash: string;
				state: {
					revision: number;
					clientBindings: Record<string, string>;
				};
			};
			const oplog = await router.handle("sabha.events", {
				id: asked.sabha.id,
				sinceRevision: 0,
			}, ctx) as {
				events: Array<{
					sabhaId: string;
					eventId: string;
					revision: number;
					parentRevision: number;
					eventType: string;
					createdAt: number;
					payload: Record<string, unknown>;
				}>;
			};

			const replicaDir = fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-daemon-collab-replica-"));
			try {
				process.env.CHITRAGUPTA_HOME = replicaDir;
				DatabaseManager.reset();
				_resetCollaborationStateForTests();
				initAgentSchema(DatabaseManager.instance(replicaDir));
				router = new RpcRouter();
				notifications = [];
				router.setNotifier((notification) => {
					notifications.push(notification);
					return 1;
				});
				const sessionStore = await import("@chitragupta/smriti/session-store");
				registerSessionMethods(router, sessionStore, {} as never);
				registerTurnMethods(router, sessionStore);
				registerCompressionMethods(router);
				registerContractMethods(router);
				registerCollaborationMethods(router);

				const applied = await router.handle("sabha.repl.apply", {
					id: asked.sabha.id,
					expectedRevision: 0,
					state: snapshot.state,
					events: oplog.events,
				}, ctx) as {
					applied: boolean;
					currentRevision: number;
					insertedEvents: number;
					sabha: {
						revision: number;
						clientBindings: Record<string, string>;
						respondedParticipantIds: string[];
						pendingParticipantIds: string[];
					};
				};

				expect(applied.applied).toBe(true);
				expect(applied.currentRevision).toBe(snapshot.currentRevision);
				expect(applied.insertedEvents).toBeGreaterThan(0);
				expect(applied.sabha.revision).toBe(snapshot.state.revision);
				expect(applied.sabha.clientBindings).toMatchObject(snapshot.state.clientBindings);
				expect(applied.sabha.respondedParticipantIds).toEqual(["parikshaka"]);
				expect(applied.sabha.pendingParticipantIds).toEqual(["kartru"]);

			const noOp = await router.handle("sabha.repl.apply", {
					id: asked.sabha.id,
					expectedRevision: snapshot.currentRevision,
					state: snapshot.state,
					events: oplog.events,
				}, ctx) as {
					applied: boolean;
					mode: string;
					currentRevision: number;
				};
				expect(noOp.applied).toBe(false);
				expect(noOp.mode).toBe("noop");
				expect(noOp.currentRevision).toBe(snapshot.currentRevision);
			} finally {
				fs.rmSync(replicaDir, { recursive: true, force: true });
			}
		});

		it("fast-forwards replicated Sabha state when local history is a prefix", async () => {
			const asked = await router.handle("sabha.ask", {
				question: "Should prefix histories merge cleanly?",
				convener: "vaayu",
				participants: [
					{ id: "kartru", role: "proposer", expertise: 0.9, credibility: 0.85 },
					{ id: "parikshaka", role: "challenger", expertise: 0.8, credibility: 0.9 },
				],
			}, ctx) as { sabha: { id: string; revision: number } };

			await router.handle("sabha.submit_perspective", {
				id: asked.sabha.id,
				participantId: "kartru",
				summary: "First perspective",
				reasoning: "Seed the local history.",
				position: "observe",
			}, ctx);

			const baseSnapshot = await router.handle("sabha.repl.pull", {
				id: asked.sabha.id,
				sinceRevision: 0,
				snapshotHash: "stale",
			}, ctx) as { state: Record<string, unknown>; currentRevision: number };
			const oplog = await router.handle("sabha.events", {
				id: asked.sabha.id,
				sinceRevision: 0,
			}, ctx) as { events: Array<Record<string, unknown>> };

			const replicaDir = fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-daemon-collab-merge-"));
			try {
				process.env.CHITRAGUPTA_HOME = replicaDir;
				DatabaseManager.reset();
				_resetCollaborationStateForTests();
				_resetDiscoveryStateForTests();
				initAgentSchema(DatabaseManager.instance(replicaDir));
				router = new RpcRouter();
				notifications = [];
				router.setNotifier((notification) => {
					notifications.push(notification);
					return 1;
				});
				const sessionStore = await import("@chitragupta/smriti/session-store");
				registerSessionMethods(router, sessionStore, {} as never);
				registerTurnMethods(router, sessionStore);
				registerCompressionMethods(router);
				registerDiscoveryMethods(router);
				registerContractMethods(router);
				registerCollaborationMethods(router);

				await router.handle("sabha.repl.apply", {
					id: asked.sabha.id,
					expectedRevision: 0,
					state: baseSnapshot.state,
					events: oplog.events,
				}, ctx);

				await router.handle("sabha.submit_perspective", {
					id: asked.sabha.id,
					participantId: "parikshaka",
					summary: "Replica-specific second perspective",
					reasoning: "Advance the replica ahead of the seed revision.",
					position: "observe",
				}, ctx);

				const remoteSnapshot = await router.handle("sabha.repl.pull", {
					id: asked.sabha.id,
					sinceRevision: 0,
					snapshotHash: "stale",
				}, ctx) as { state: Record<string, unknown>; currentRevision: number };
				const remoteEvents = await router.handle("sabha.events", {
					id: asked.sabha.id,
					sinceRevision: 0,
				}, ctx) as { events: Array<Record<string, unknown>> };

				process.env.CHITRAGUPTA_HOME = tmpDir;
				DatabaseManager.reset();
				_resetCollaborationStateForTests();
				_resetDiscoveryStateForTests();
				initAgentSchema(DatabaseManager.instance(tmpDir));
				router = new RpcRouter();
				router.setNotifier((notification) => {
					notifications.push(notification);
					return 1;
				});
				const originalSessionStore = await import("@chitragupta/smriti/session-store");
				registerSessionMethods(router, originalSessionStore, {} as never);
				registerTurnMethods(router, originalSessionStore);
				registerCompressionMethods(router);
				registerDiscoveryMethods(router);
				registerContractMethods(router);
				registerCollaborationMethods(router);

				const merged = await router.handle("sabha.repl.merge", {
					id: asked.sabha.id,
					state: remoteSnapshot.state,
					events: remoteEvents.events,
				}, ctx) as {
					applied: boolean;
					mode: string;
					currentRevision: number;
					sabha: { respondedParticipantIds: string[] };
				};

				expect(merged.applied).toBe(true);
				expect(merged.mode).toBe("fast-forward");
				expect(merged.currentRevision).toBe(remoteSnapshot.currentRevision);
				expect(merged.sabha.respondedParticipantIds).toEqual(["kartru", "parikshaka"]);
			} finally {
				fs.rmSync(replicaDir, { recursive: true, force: true });
			}
		});

		it("rejects remote-ahead Sabha snapshots without oplog history when the replica already has local history", async () => {
			const asked = await router.handle("sabha.ask", {
				question: "Should remote-ahead snapshots require their event chain?",
				convener: "vaayu",
				participants: [
					{ id: "kartru", role: "proposer", expertise: 0.9, credibility: 0.85 },
					{ id: "parikshaka", role: "challenger", expertise: 0.8, credibility: 0.9 },
				],
			}, ctx) as { sabha: { id: string } };

			await router.handle("sabha.submit_perspective", {
				id: asked.sabha.id,
				participantId: "kartru",
				summary: "Local seed perspective",
				reasoning: "Create a non-empty local history first.",
				position: "observe",
			}, ctx);

			const baseSnapshot = await router.handle("sabha.repl.pull", {
				id: asked.sabha.id,
				sinceRevision: 0,
				snapshotHash: "stale",
			}, ctx) as { state: Record<string, unknown>; currentRevision: number };
			const oplog = await router.handle("sabha.events", {
				id: asked.sabha.id,
				sinceRevision: 0,
			}, ctx) as { events: Array<Record<string, unknown>> };

			const replicaDir = fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-daemon-collab-missing-history-"));
			try {
				process.env.CHITRAGUPTA_HOME = replicaDir;
				DatabaseManager.reset();
				_resetCollaborationStateForTests();
				_resetDiscoveryStateForTests();
				initAgentSchema(DatabaseManager.instance(replicaDir));
				router = new RpcRouter();
				notifications = [];
				router.setNotifier((notification) => {
					notifications.push(notification);
					return 1;
				});
				const sessionStore = await import("@chitragupta/smriti/session-store");
				registerSessionMethods(router, sessionStore, {} as never);
				registerTurnMethods(router, sessionStore);
				registerCompressionMethods(router);
				registerDiscoveryMethods(router);
				registerContractMethods(router);
				registerCollaborationMethods(router);

				await router.handle("sabha.repl.apply", {
					id: asked.sabha.id,
					expectedRevision: 0,
					state: baseSnapshot.state,
					events: oplog.events,
				}, ctx);

				await router.handle("sabha.submit_perspective", {
					id: asked.sabha.id,
					participantId: "parikshaka",
					summary: "Replica has moved ahead",
					reasoning: "Advance the replica so it requires an oplog to merge further.",
					position: "observe",
				}, ctx);

				const remoteSnapshot = await router.handle("sabha.repl.pull", {
					id: asked.sabha.id,
					sinceRevision: 0,
					snapshotHash: "stale",
				}, ctx) as { state: Record<string, unknown>; currentRevision: number };

				process.env.CHITRAGUPTA_HOME = tmpDir;
				DatabaseManager.reset();
				_resetCollaborationStateForTests();
				_resetDiscoveryStateForTests();
				initAgentSchema(DatabaseManager.instance(tmpDir));
				router = new RpcRouter();
				router.setNotifier((notification) => {
					notifications.push(notification);
					return 1;
				});
				const originalSessionStore = await import("@chitragupta/smriti/session-store");
				registerSessionMethods(router, originalSessionStore, {} as never);
				registerTurnMethods(router, originalSessionStore);
				registerCompressionMethods(router);
				registerDiscoveryMethods(router);
				registerContractMethods(router);
				registerCollaborationMethods(router);

				const merged = await router.handle("sabha.repl.merge", {
					id: asked.sabha.id,
					state: remoteSnapshot.state,
					events: [],
				}, ctx) as {
					applied: boolean;
					mode: string;
					currentRevision: number;
					conflict?: { reason: string };
				};

				expect(merged.applied).toBe(false);
				expect(merged.mode).toBe("conflict");
				expect(merged.currentRevision).toBe(baseSnapshot.currentRevision);
				expect(merged.conflict?.reason).toBe("missing-history");
			} finally {
				fs.rmSync(replicaDir, { recursive: true, force: true });
			}
		});

		it("rejects replicated Sabha snapshots with non-contiguous event chains", async () => {
			const asked = await router.handle("sabha.ask", {
				question: "Should broken replicated event chains be rejected?",
				convener: "vaayu",
				participants: [
					{ id: "kartru", role: "proposer", expertise: 0.9, credibility: 0.85 },
					{ id: "parikshaka", role: "challenger", expertise: 0.8, credibility: 0.9 },
				],
			}, ctx) as { sabha: { id: string } };

			const snapshot = await router.handle("sabha.repl.pull", {
				id: asked.sabha.id,
				sinceRevision: 0,
				snapshotHash: "stale",
			}, ctx) as {
				state: Record<string, unknown>;
			};
			const oplog = await router.handle("sabha.events", {
				id: asked.sabha.id,
				sinceRevision: 0,
			}, ctx) as {
				events: Array<Record<string, unknown>>;
			};

			const brokenEvents = oplog.events.map((event, index) =>
				index === 0 ? { ...event, parentRevision: 99 } : event,
			);

			await expect(router.handle("sabha.repl.apply", {
				id: asked.sabha.id,
				expectedRevision: 1,
				state: snapshot.state,
				events: brokenEvents,
			}, ctx)).rejects.toThrow("non-contiguous");
		});

		it("rejects malformed replicated Sabha side-channel arrays", async () => {
			const asked = await router.handle("sabha.ask", {
				question: "Should malformed replicated mesh bindings be rejected?",
				convener: "vaayu",
				participants: [
					{ id: "kartru", role: "proposer", expertise: 0.9, credibility: 0.85 },
					{ id: "parikshaka", role: "challenger", expertise: 0.8, credibility: 0.9 },
				],
			}, ctx) as { sabha: { id: string } };

			const snapshot = await router.handle("sabha.repl.pull", {
				id: asked.sabha.id,
				sinceRevision: 0,
				snapshotHash: "stale",
			}, ctx) as { state: Record<string, unknown> };
			const oplog = await router.handle("sabha.events", {
				id: asked.sabha.id,
				sinceRevision: 0,
			}, ctx) as { events: Array<Record<string, unknown>> };

			const malformedState = {
				...snapshot.state,
				meshBindings: [{ participantId: "kartru", target: "capability:review", mode: "ask", timeoutMs: "bad" }],
			};

			await expect(router.handle("sabha.repl.apply", {
				id: asked.sabha.id,
				expectedRevision: 0,
				state: malformedState,
				events: oplog.events,
			}, ctx)).rejects.toThrow("timeoutMs");
		});

		it("rejects raw replicated Sabha apply when local history is not a prefix of incoming events", async () => {
			const asked = await router.handle("sabha.ask", {
				question: "Should divergent raw replica histories be rejected?",
				convener: "vaayu",
				participants: [
					{ id: "kartru", role: "proposer", expertise: 0.9, credibility: 0.85 },
					{ id: "parikshaka", role: "challenger", expertise: 0.8, credibility: 0.9 },
				],
			}, ctx) as { sabha: { id: string } };

			await router.handle("sabha.submit_perspective", {
				id: asked.sabha.id,
				participantId: "kartru",
				summary: "Local branch",
				reasoning: "Create the first local event chain.",
				position: "observe",
			}, ctx);

			const snapshot = await router.handle("sabha.repl.pull", {
				id: asked.sabha.id,
				sinceRevision: 0,
				snapshotHash: "stale",
			}, ctx) as { state: Record<string, unknown> };
			const oplog = await router.handle("sabha.events", {
				id: asked.sabha.id,
				sinceRevision: 0,
			}, ctx) as { events: Array<Record<string, unknown>> };

			const divergentEvents = oplog.events.map((event, index) =>
				index === 0 ? { ...event, eventId: "divergent-event-id" } : event,
			);

			await expect(router.handle("sabha.repl.apply", {
				id: asked.sabha.id,
				expectedRevision: 1,
				state: { ...snapshot.state, revision: 2 },
				events: divergentEvents,
			}, ctx)).rejects.toThrow("local history is not a prefix");
		});

		it("rejects stale expectedRevision values on mutating Sabha calls", async () => {
			const asked = await router.handle("sabha.ask", {
				question: "Should stale writers be rejected?",
				convener: "vaayu",
				participants: [
					{ id: "kartru", role: "proposer", expertise: 0.9, credibility: 0.85 },
					{ id: "parikshaka", role: "challenger", expertise: 0.8, credibility: 0.9 },
				],
			}, ctx) as { sabha: { id: string; revision: number } };

			await expect(router.handle("sabha.submit_perspective", {
				id: asked.sabha.id,
				expectedRevision: asked.sabha.revision - 1,
				participantId: "kartru",
				summary: "This write should be rejected.",
				reasoning: "The writer is stale.",
				position: "observe",
			}, ctx)).rejects.toThrow("revision mismatch");

			const accepted = await router.handle("sabha.submit_perspective", {
				id: asked.sabha.id,
				expectedRevision: asked.sabha.revision,
				participantId: "kartru",
				summary: "This write is current.",
				reasoning: "The writer used the latest revision.",
				position: "observe",
			}, ctx) as { sabha: { revision: number } };

			expect(accepted.sabha.revision).toBe(asked.sabha.revision + 1);
		});
		it("returns a bounded Sabha resume context for pending consultations", async () => {
			const asked = await router.handle("sabha.ask", {
				question: "Who still needs to respond to the staged rollout?",
				convener: "lead",
				participants: [
					{ id: "planner", role: "planner", clientId: "planner-client" },
					{ id: "reviewer", role: "reviewer", target: "capability:memory-recall", mode: "ask", timeoutMs: 1_500 },
				],
			}, ctx) as {
				sabha: { id: string; resumeContext: string };
			};

			expect(asked.sabha.resumeContext).toContain("Durable Sabha resume context:");
			expect(asked.sabha.resumeContext).toContain("pending participants:");
			expect(asked.sabha.resumeContext).toContain("reviewer");

			const fetched = await router.handle("sabha.get", { id: asked.sabha.id }, ctx) as {
				sabha: { resumeContext: string };
			};
			expect(fetched.sabha.resumeContext).toContain("recent Sabha events:");
			expect(fetched.sabha.resumeContext).toContain("Resume from the last durable revision");
		});
	});
