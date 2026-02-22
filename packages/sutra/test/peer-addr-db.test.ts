/** PeerAddrDb unit tests — Bitcoin-style persistent peer address database. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { PeerAddrDb } from "../src/mesh/peer-addr-db.js";
import type { PeerNodeInfo } from "../src/mesh/peer-types.js";

const makeInfo = (id: string, port = 3142): PeerNodeInfo => ({
	nodeId: id,
	endpoint: `ws://10.0.${Math.floor(port / 256)}.${port % 256}:${port}/mesh`,
	joinedAt: Date.now(),
});

describe("PeerAddrDb", () => {
	// ── Add & Query ──────────────────────────────────────────────

	it("adds new peers to the 'new' bucket", () => {
		const db = new PeerAddrDb();
		db.add(makeInfo("node-1", 3001), "exchange");
		db.add(makeInfo("node-2", 3002), "relay");
		const counts = db.getCounts();
		expect(counts.new).toBe(2);
		expect(counts.tried).toBe(0);
	});

	it("updates existing entry instead of creating duplicate", () => {
		const db = new PeerAddrDb();
		const info = makeInfo("node-1", 3001);
		db.add(info, "exchange");
		db.add({ ...info, label: "updated" }, "exchange");
		expect(db.getCounts().total).toBe(1);
	});

	it("ignores entries without endpoint or nodeId", () => {
		const db = new PeerAddrDb();
		db.add({ nodeId: "", endpoint: "ws://foo:3142/mesh", joinedAt: Date.now() }, "exchange");
		db.add({ nodeId: "n1", endpoint: "", joinedAt: Date.now() }, "exchange");
		expect(db.getCounts().total).toBe(0);
	});

	// ── Connected / Failed ──────────────────────────────────────

	it("promotes peer from 'new' to 'tried' on connect", () => {
		const db = new PeerAddrDb();
		db.add(makeInfo("node-1", 3001), "exchange");
		expect(db.getCounts().new).toBe(1);
		db.markConnected("node-1");
		expect(db.getCounts().tried).toBe(1);
		expect(db.getCounts().new).toBe(0);
	});

	it("creates tried entry for unknown peer on connect", () => {
		const db = new PeerAddrDb();
		db.markConnected("new-peer", "ws://10.0.0.1:3142/mesh");
		expect(db.getCounts().tried).toBe(1);
	});

	it("tracks failures", () => {
		const db = new PeerAddrDb();
		db.add(makeInfo("node-1", 3001), "exchange");
		db.markFailed("node-1");
		db.markFailed("node-1");
		const all = db.getAll();
		expect(all.new[0].failures).toBe(2);
	});

	it("tracks attempts", () => {
		const db = new PeerAddrDb();
		db.add(makeInfo("node-1", 3001), "exchange");
		db.markAttempted("node-1");
		db.markAttempted("node-1");
		const all = db.getAll();
		expect(all.new[0].attempts).toBe(2);
	});

	// ── Bootstrap ──────────────────────────────────────────────

	it("returns tried peers first in bootstrap list", () => {
		const db = new PeerAddrDb();
		db.add(makeInfo("tried-1", 3001), "exchange");
		db.markConnected("tried-1");
		db.add(makeInfo("new-1", 3002), "exchange");
		const bootstrap = db.getBootstrapPeers(10);
		expect(bootstrap.length).toBe(2);
		expect(bootstrap[0].nodeId).toBe("tried-1");
	});

	it("enforces subnet diversity in bootstrap (max 2 per /24)", () => {
		const db = new PeerAddrDb();
		// All on same /24 subnet (10.0.11.x)
		for (let i = 1; i <= 5; i++) {
			const info: PeerNodeInfo = {
				nodeId: `node-${i}`,
				endpoint: `ws://10.0.11.${i}:3142/mesh`,
				joinedAt: Date.now(),
			};
			db.add(info, "exchange");
			db.markConnected(`node-${i}`, `ws://10.0.11.${i}:3142/mesh`);
		}
		const bootstrap = db.getBootstrapPeers(10);
		expect(bootstrap.length).toBe(2); // max 2 per /24
	});

	it("respects limit parameter", () => {
		const db = new PeerAddrDb();
		for (let i = 1; i <= 10; i++) {
			// Each on a different /24 subnet to avoid diversity cap
			db.add({ nodeId: `node-${i}`, endpoint: `ws://10.${i}.0.1:3142/mesh`, joinedAt: Date.now() }, "exchange");
		}
		expect(db.getBootstrapPeers(3).length).toBe(3);
	});

	// ── Subnet Diversity ────────────────────────────────────────

	it("enforces maxPerSubnet in new table", () => {
		const db = new PeerAddrDb({ maxPerSubnet: 2 });
		// All on subnet 10.0.11.0/24
		for (let i = 1; i <= 5; i++) {
			db.add({
				nodeId: `node-${i}`,
				endpoint: `ws://10.0.11.${i}:3142/mesh`,
				joinedAt: Date.now(),
			}, "exchange");
		}
		expect(db.getCounts().new).toBe(2); // only 2 accepted
	});

	// ── Capacity & Eviction ─────────────────────────────────────

	it("evicts oldest 'new' entry when at capacity", () => {
		const db = new PeerAddrDb({ maxNew: 3, maxPerSubnet: 100 });
		for (let i = 1; i <= 4; i++) {
			db.add(makeInfo(`node-${i}`, 3000 + i), "exchange");
		}
		expect(db.getCounts().new).toBe(3); // 1 evicted
	});

	it("evicts least reliable 'tried' entry when at capacity", () => {
		const db = new PeerAddrDb({ maxTried: 2, maxPerSubnet: 100 });
		db.add(makeInfo("good", 3001), "exchange");
		db.markConnected("good");
		db.add(makeInfo("bad", 3002), "exchange");
		db.markConnected("bad");
		db.markFailed("bad");
		db.markFailed("bad");
		// Adding a 3rd should evict "bad"
		db.markConnected("new-peer", "ws://10.0.12.1:3142/mesh");
		expect(db.getCounts().tried).toBe(2);
		const all = db.getAll();
		const nodeIds = all.tried.map((a) => a.nodeId);
		expect(nodeIds).toContain("good");
		expect(nodeIds).toContain("new-peer");
	});

	// ── Pruning ─────────────────────────────────────────────────

	it("prunes entries older than maxAge", () => {
		const db = new PeerAddrDb();
		db.add(makeInfo("old-peer", 3001), "exchange");
		// Manually set lastSeen to 8 days ago
		const all = db.getAll();
		all.new[0].lastSeen = Date.now() - 8 * 24 * 60 * 60 * 1000;
		const pruned = db.prune();
		expect(pruned).toBe(1);
		expect(db.getCounts().total).toBe(0);
	});

	// ── Persistence ─────────────────────────────────────────────

	let tmpDir: string;
	beforeEach(async () => { tmpDir = await mkdtemp(join(tmpdir(), "peer-addr-")); });
	afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

	it("saves and loads peer database from disk", async () => {
		const db1 = new PeerAddrDb();
		db1.add(makeInfo("node-a", 3001), "exchange");
		db1.add(makeInfo("node-b", 3002), "static");
		db1.markConnected("node-a");

		const filePath = join(tmpDir, "peers.json");
		await db1.save(filePath);

		const db2 = new PeerAddrDb();
		await db2.load(filePath);
		expect(db2.getCounts().tried).toBe(1);
		expect(db2.getCounts().new).toBe(1);
		expect(db2.getCounts().total).toBe(2);
	});

	it("handles missing file gracefully on load", async () => {
		const db = new PeerAddrDb();
		await db.load(join(tmpDir, "nonexistent.json"));
		expect(db.getCounts().total).toBe(0);
	});

	// ── Event Integration ───────────────────────────────────────

	it("tracks peers via attachTo event handler", () => {
		const db = new PeerAddrDb();
		// Simulate a minimal event emitter matching PeerConnectionManager.on()
		type Handler = (event: { type: string; peerId?: string; info?: PeerNodeInfo }) => void;
		let handler: Handler | null = null;
		const mockManager = {
			on(h: Handler) {
				handler = h;
				return () => { handler = null; };
			},
		};

		const unsub = db.attachTo(mockManager);

		// Simulate peer:connected
		handler!({
			type: "peer:connected",
			peerId: "node-x",
			info: makeInfo("node-x", 3001),
		});
		expect(db.getCounts().tried).toBe(1);

		// Simulate peer:discovered
		handler!({
			type: "peer:discovered",
			info: makeInfo("node-y", 3002),
		});
		expect(db.getCounts().new).toBe(1);

		// Simulate peer:dead
		handler!({ type: "peer:dead", peerId: "node-x" });
		const all = db.getAll();
		expect(all.tried[0].failures).toBe(1);

		unsub();
	});
});
