/**
 * P2P Mesh Transport Tests — peer-envelope, network-gossip,
 * mesh-router distributed routing, and WsPeerChannel.
 *
 * Focuses on the new P2P functionality for distributed actor
 * communication over WebSocket peers.
 * @module
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	serializePeerMessage, deserializePeerMessage,
	validateEnvelope, stampOrigin, hasVisited,
	signMessage, verifySignature, createEnvelope,
} from "../src/mesh/peer-envelope.js";
import { NetworkGossip } from "../src/mesh/network-gossip.js";
import { MeshRouter } from "../src/mesh/mesh-router.js";
import { WsPeerChannel, type WsLike } from "../src/mesh/ws-peer-channel.js";
import type { MeshEnvelope, PeerView } from "../src/mesh/types.js";
import type { PeerMessage } from "../src/mesh/peer-types.js";

// ─── Shared Helpers ─────────────────────────────────────────────────────────

function makeEnvelope(ov: Partial<MeshEnvelope> = {}): MeshEnvelope {
	return {
		id: ov.id ?? "env-1", from: ov.from ?? "actor-a", to: ov.to ?? "actor-b",
		type: ov.type ?? "tell", payload: ov.payload ?? { msg: "hello" },
		priority: ov.priority ?? 1, timestamp: ov.timestamp ?? Date.now(),
		ttl: ov.ttl ?? 30_000, hops: ov.hops ?? [],
		topic: ov.topic, correlationId: ov.correlationId,
	};
}

function makeMockWs(readyState = 1): WsLike & { sentData: string[] } {
	const sentData: string[] = [];
	return {
		readyState, sentData,
		send(data: string) { sentData.push(data); },
		close: vi.fn(), addEventListener: vi.fn(),
	};
}

function makeView(actorId: string, gen = 1): PeerView {
	return { actorId, status: "alive", generation: gen, lastSeen: Date.now() };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. PEER ENVELOPE
// ═══════════════════════════════════════════════════════════════════════════

describe("peer-envelope", () => {
	describe("serialize / deserialize round-trip", () => {
		it("round-trips an envelope message", () => {
			const msg: PeerMessage = { type: "envelope", data: makeEnvelope() };
			const parsed = deserializePeerMessage(serializePeerMessage(msg));
			expect(parsed).not.toBeNull();
			expect(parsed!.type).toBe("envelope");
		});

		it("round-trips a ping message preserving ts", () => {
			const msg: PeerMessage = { type: "ping", ts: 1234567890 };
			const parsed = deserializePeerMessage(serializePeerMessage(msg));
			expect(parsed!.type).toBe("ping");
			expect((parsed as { ts: number }).ts).toBe(1234567890);
		});

		it("rejects non-JSON, missing-type, and oversized input", () => {
			expect(deserializePeerMessage("not-json{{{")).toBeNull();
			expect(deserializePeerMessage('{"data": 1}')).toBeNull();
			expect(deserializePeerMessage("x".repeat(1_048_577))).toBeNull();
		});
	});

	describe("validateEnvelope", () => {
		it("accepts a valid envelope", () => {
			expect(validateEnvelope(makeEnvelope())).toBe(true);
		});

		it("rejects null, undefined, and primitives", () => {
			for (const v of [null, undefined, 42, "str"]) {
				expect(validateEnvelope(v)).toBe(false);
			}
		});

		it("rejects malformed fields", () => {
			expect(validateEnvelope(makeEnvelope({ id: "" }))).toBe(false);
			expect(validateEnvelope({ ...makeEnvelope(), type: "unknown" })).toBe(false);
			expect(validateEnvelope({ ...makeEnvelope(), priority: 5 })).toBe(false);
			expect(validateEnvelope(makeEnvelope({ timestamp: 0 }))).toBe(false);
			expect(validateEnvelope(makeEnvelope({ ttl: 0 }))).toBe(false);
			expect(validateEnvelope({ ...makeEnvelope(), hops: "not-array" })).toBe(false);
		});

		it("accepts all valid types and priorities", () => {
			for (const t of ["tell", "ask", "reply", "signal"] as const) {
				expect(validateEnvelope(makeEnvelope({ type: t }))).toBe(true);
			}
			for (const p of [0, 1, 2, 3] as const) {
				expect(validateEnvelope(makeEnvelope({ priority: p }))).toBe(true);
			}
		});
	});

	describe("stampOrigin / hasVisited", () => {
		it("adds nodeId to hops without duplication", () => {
			const env = makeEnvelope({ hops: [] });
			const stamped = stampOrigin(env, "node-1");
			expect(stamped.hops).toEqual(["node-1"]);
			// Stamping again should not duplicate
			const stamped2 = stampOrigin(stamped, "node-1");
			expect(stamped2.hops).toEqual(["node-1"]);
		});

		it("appends to existing hops without mutating original", () => {
			const env = makeEnvelope({ hops: ["a", "b"] });
			const stamped = stampOrigin(env, "c");
			expect(stamped.hops).toEqual(["a", "b", "c"]);
			expect(env.hops).toEqual(["a", "b"]); // immutability
		});

		it("hasVisited correctly checks hop membership", () => {
			const env = makeEnvelope({ hops: ["x", "y", "z"] });
			expect(hasVisited(env, "y")).toBe(true);
			expect(hasVisited(env, "w")).toBe(false);
		});
	});

	describe("signMessage / verifySignature", () => {
		const secret = "mesh-shared-secret-42";

		it("produces a 64-char hex signature", () => {
			expect(signMessage("hello", secret)).toMatch(/^[0-9a-f]{64}$/);
		});

		it("verifies valid signatures and rejects invalid ones", () => {
			const payload = '{"type":"envelope"}';
			const sig = signMessage(payload, secret);
			expect(verifySignature(payload, sig, secret)).toBe(true);
			expect(verifySignature("tampered", sig, secret)).toBe(false);
			expect(verifySignature(payload, sig, "wrong-secret")).toBe(false);
			expect(verifySignature(payload, sig.slice(0, 32), secret)).toBe(false);
		});

		it("produces different signatures for different payloads", () => {
			expect(signMessage("a", secret)).not.toBe(signMessage("b", secret));
		});
	});

	describe("createEnvelope", () => {
		it("produces a valid envelope with defaults", () => {
			const env = createEnvelope("sender", "receiver", { x: 1 });
			expect(validateEnvelope(env)).toBe(true);
			expect(env.from).toBe("sender");
			expect(env.to).toBe("receiver");
			expect(env.type).toBe("tell");
			expect(env.hops).toEqual([]);
		});

		it("applies custom options", () => {
			const env = createEnvelope("a", "b", null, {
				type: "ask", priority: 3, ttl: 5_000,
				topic: "t", correlationId: "c-1", nodeId: "node-x",
			});
			expect(env.type).toBe("ask");
			expect(env.priority).toBe(3);
			expect(env.ttl).toBe(5_000);
			expect(env.topic).toBe("t");
			expect(env.correlationId).toBe("c-1");
			expect(env.id).toMatch(/^node-x-/);
		});

		it("generates unique ids across calls", () => {
			const ids = new Set(Array.from({ length: 10 }, () => createEnvelope("a", "b", null).id));
			expect(ids.size).toBe(10);
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. NETWORK GOSSIP
// ═══════════════════════════════════════════════════════════════════════════

describe("NetworkGossip", () => {
	function mockGossipProtocol() {
		return {
			getView: vi.fn(() => [] as PeerView[]),
			merge: vi.fn((_v: PeerView[]) => [] as PeerView[]),
		};
	}
	function mockConnectionManager() {
		return { on: vi.fn(() => () => {}), getConnectedChannels: vi.fn(() => []) };
	}

	let gossip: ReturnType<typeof mockGossipProtocol>;
	let connections: ReturnType<typeof mockConnectionManager>;
	let net: NetworkGossip;

	beforeEach(() => {
		gossip = mockGossipProtocol();
		connections = mockConnectionManager();
		net = new NetworkGossip("local-node", gossip as never, connections as never, {
			locationTtlMs: 200, exchangeIntervalMs: 100_000,
		});
	});
	afterEach(() => net.destroy());

	it("findNode returns undefined for unknown actors", () => {
		expect(net.findNode("unknown")).toBeUndefined();
	});

	it("receiveGossip populates actor locations", () => {
		net.receiveGossip("node-a", [makeView("actor-1"), makeView("actor-2")]);
		expect(net.findNode("actor-1")).toBe("node-a");
		expect(net.findNode("actor-2")).toBe("node-a");
	});

	it("receiveGossip emits actor:located events", () => {
		const events: unknown[] = [];
		net.on((e) => events.push(e));
		net.receiveGossip("node-x", [makeView("a1")]);
		const located = events.filter((e: any) => e.type === "actor:located");
		expect(located).toHaveLength(1);
		expect((located[0] as any).actorId).toBe("a1");
	});

	it("same actor from different node triggers relocation", () => {
		net.receiveGossip("node-a", [makeView("migrating")]);
		const events: unknown[] = [];
		net.on((e) => events.push(e));
		net.receiveGossip("node-b", [makeView("migrating", 2)]);

		expect(net.findNode("migrating")).toBe("node-b");
		const rel = events.filter((e: any) => e.type === "actor:relocated");
		expect(rel).toHaveLength(1);
		expect((rel[0] as any).fromNode).toBe("node-a");
		expect((rel[0] as any).toNode).toBe("node-b");
	});

	it("getLocations returns all known locations", () => {
		net.receiveGossip("n1", [makeView("a1")]);
		net.receiveGossip("n2", [makeView("a2")]);
		const locs = net.getLocations();
		expect(locs.size).toBe(2);
		expect(locs.get("a1")).toBe("n1");
		expect(locs.get("a2")).toBe("n2");
	});

	it("evicts stale locations after TTL", async () => {
		net.receiveGossip("old-node", [makeView("stale")]);
		expect(net.findNode("stale")).toBe("old-node");
		await new Promise((r) => setTimeout(r, 250));
		expect(net.findNode("stale")).toBeUndefined();
	});

	it("getLocations evicts stale entries", async () => {
		net.receiveGossip("n1", [makeView("ephemeral")]);
		await new Promise((r) => setTimeout(r, 250));
		expect(net.getLocations().size).toBe(0);
	});

	it("receiveGossip delegates merge to gossip protocol", () => {
		const views = [makeView("x")];
		net.receiveGossip("peer-1", views);
		expect(gossip.merge).toHaveBeenCalledWith(views);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. MESH ROUTER — setActorLocationResolver
// ═══════════════════════════════════════════════════════════════════════════

describe("MeshRouter distributed routing", () => {
	let router: MeshRouter;
	beforeEach(() => { router = new MeshRouter(); });
	afterEach(() => router.destroy());

	it("delivers locally when actor exists, ignoring resolver", () => {
		const local: MeshEnvelope[] = [];
		router.addActor({ actorId: "local-a", receive: (e) => local.push(e) });
		const remote: MeshEnvelope[] = [];
		router.addChannel({
			peerId: "rn", actorId: "peer:rn", receive: (e) => remote.push(e),
		});
		router.setActorLocationResolver(() => "rn");
		router.route(makeEnvelope({ to: "local-a" }));
		expect(local).toHaveLength(1);
		expect(remote).toHaveLength(0);
	});

	it("forwards to PeerChannel when resolver returns nodeId", () => {
		const received: MeshEnvelope[] = [];
		router.addChannel({
			peerId: "node-42", actorId: "peer:node-42",
			receive: (e) => received.push(e),
		});
		router.setActorLocationResolver((id) => id === "remote-actor" ? "node-42" : undefined);
		const events: unknown[] = [];
		router.on((e) => events.push(e));
		router.route(makeEnvelope({ to: "remote-actor" }));
		expect(received).toHaveLength(1);
		expect((events[0] as any).type).toBe("delivered");
	});

	it("reports undeliverable when resolver returns undefined", () => {
		router.setActorLocationResolver(() => undefined);
		const events: unknown[] = [];
		router.on((e) => events.push(e));
		router.route(makeEnvelope({ to: "ghost" }));
		expect((events[0] as any).type).toBe("undeliverable");
		expect((events[0] as any).reason).toContain("ghost");
	});

	it("reports undeliverable when resolver nodeId has no matching channel", () => {
		router.setActorLocationResolver(() => "no-such-node");
		const events: unknown[] = [];
		router.on((e) => events.push(e));
		router.route(makeEnvelope({ to: "orphan" }));
		expect((events[0] as any).type).toBe("undeliverable");
	});

	it("falls through to undeliverable with no resolver set", () => {
		const events: unknown[] = [];
		router.on((e) => events.push(e));
		router.route(makeEnvelope({ to: "nowhere" }));
		expect((events[0] as any).type).toBe("undeliverable");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. WsPeerChannel
// ═══════════════════════════════════════════════════════════════════════════

describe("WsPeerChannel", () => {
	let ch: WsPeerChannel;
	beforeEach(() => {
		ch = new WsPeerChannel({
			peerId: "remote-1", localNodeId: "local-node",
			pingIntervalMs: 60_000, maxMissedPings: 3,
		});
	});
	afterEach(() => ch.destroy());

	it("initializes with disconnected state and correct ids", () => {
		expect(ch.state).toBe("disconnected");
		expect(ch.peerId).toBe("remote-1");
		expect(ch.actorId).toBe("peer:remote-1");
	});

	it("receive() serializes envelope with stampOrigin over socket", () => {
		const ws = makeMockWs();
		ch.attachSocket(ws);
		ch.receive(makeEnvelope({ from: "a", to: "b" }));
		expect(ws.sentData).toHaveLength(1);
		const parsed = JSON.parse(ws.sentData[0]) as PeerMessage;
		expect(parsed.type).toBe("envelope");
		expect((parsed as any).data.hops).toContain("local-node");
	});

	it("receive() silently skips when disconnected", () => {
		const ws = makeMockWs();
		ch.receive(makeEnvelope()); // no socket attached
		expect(ws.sentData).toHaveLength(0);
	});

	it("transitions to connected on attachSocket, disconnected on close", () => {
		const ws = makeMockWs();
		ch.attachSocket(ws);
		expect(ch.state).toBe("connected");
		expect(ch.stats.connectedAt).toBeDefined();
		ch.close("done");
		expect(ch.state).toBe("disconnected");
		expect(ch.stats.disconnectedAt).toBeDefined();
	});

	it("tracks messagesSent and bytesOut in stats", () => {
		const ws = makeMockWs();
		ch.attachSocket(ws);
		expect(ch.stats.messagesSent).toBe(0);
		ch.receive(makeEnvelope());
		expect(ch.stats.messagesSent).toBe(1);
		expect(ch.stats.bytesOut).toBeGreaterThan(0);
	});

	it("sendGossip sends gossip-typed message", () => {
		const ws = makeMockWs();
		ch.attachSocket(ws);
		ch.sendGossip([makeView("a1")]);
		expect(ws.sentData).toHaveLength(1);
		expect(JSON.parse(ws.sentData[0]).type).toBe("gossip");
	});

	it("does not send when socket readyState is not OPEN", () => {
		const ws = makeMockWs(0);
		ch.attachSocket(ws);
		ch.receive(makeEnvelope());
		expect(ws.sentData).toHaveLength(0);
	});

	it("close emits peer:disconnected event with reason", () => {
		const ws = makeMockWs();
		ch.attachSocket(ws);
		const events: unknown[] = [];
		ch.on((e) => events.push(e));
		ch.close("shutdown");
		const dc = events.filter((e: any) => e.type === "peer:disconnected");
		expect(dc).toHaveLength(1);
		expect((dc[0] as any).reason).toBe("shutdown");
	});

	it("wraps frames with HMAC signature when meshSecret is set", () => {
		const signed = new WsPeerChannel({
			peerId: "sec", localNodeId: "local", meshSecret: "s3cret",
			pingIntervalMs: 60_000,
		});
		const ws = makeMockWs();
		signed.attachSocket(ws);
		signed.receive(makeEnvelope());
		const frame = JSON.parse(ws.sentData[0]) as { sig: string; body: string };
		expect(frame.sig).toBeDefined();
		expect(frame.body).toBeDefined();
		expect(verifySignature(frame.body, frame.sig, "s3cret")).toBe(true);
		signed.destroy();
	});
});
