/** PeerGuard unit tests — connection diversity and anti-eclipse protections. */
import { describe, it, expect } from "vitest";
import { PeerGuard } from "../src/mesh/peer-guard.js";

describe("PeerGuard", () => {
	// ── Rate Limiting ──────────────────────────────────────────────

	it("rejects connections that exceed rate limit per IP", () => {
		const guard = new PeerGuard({ maxAttemptsPerMinute: 3 });
		expect(guard.shouldAcceptInbound("10.0.0.1")).toBeNull();
		expect(guard.shouldAcceptInbound("10.0.0.1")).toBeNull();
		expect(guard.shouldAcceptInbound("10.0.0.1")).toBeNull();
		const rejection = guard.shouldAcceptInbound("10.0.0.1");
		expect(rejection).toContain("rate limited");
	});

	it("allows connections from different IPs under rate limit", () => {
		const guard = new PeerGuard({ maxAttemptsPerMinute: 2 });
		expect(guard.shouldAcceptInbound("10.0.0.1")).toBeNull();
		expect(guard.shouldAcceptInbound("10.0.0.2")).toBeNull();
		expect(guard.shouldAcceptInbound("10.0.0.1")).toBeNull();
		expect(guard.shouldAcceptInbound("10.0.0.2")).toBeNull();
		// Now both should be limited
		expect(guard.shouldAcceptInbound("10.0.0.1")).toContain("rate limited");
		expect(guard.shouldAcceptInbound("10.0.0.2")).toContain("rate limited");
	});

	// ── Subnet Diversity ──────────────────────────────────────────

	it("enforces subnet diversity (max connections per /24)", () => {
		const guard = new PeerGuard({ maxPerSubnet: 2, maxAttemptsPerMinute: 100 });
		guard.recordInbound("192.168.1.10");
		guard.recordInbound("192.168.1.20");
		// 3rd from same /24 should be rejected
		const rejection = guard.shouldAcceptInbound("192.168.1.30");
		expect(rejection).toContain("subnet");
		expect(rejection).toContain("at capacity");
	});

	it("allows connections from different subnets", () => {
		const guard = new PeerGuard({ maxPerSubnet: 2, maxAttemptsPerMinute: 100 });
		guard.recordInbound("192.168.1.10");
		guard.recordInbound("192.168.1.20");
		// Different /24 should be fine
		expect(guard.shouldAcceptInbound("192.168.2.10")).toBeNull();
	});

	it("tracks subnet counts through connection/disconnection", () => {
		const guard = new PeerGuard({ maxPerSubnet: 2, maxAttemptsPerMinute: 100 });
		guard.recordInbound("192.168.1.10");
		guard.recordInbound("192.168.1.20");
		// Remove one
		guard.removeConnection("ws://192.168.1.10:3142/mesh", false);
		// Now should accept from same subnet
		expect(guard.shouldAcceptInbound("192.168.1.30")).toBeNull();
	});

	it("disables subnet diversity when configured", () => {
		const guard = new PeerGuard({ maxPerSubnet: 1, enforceSubnetDiversity: false, maxAttemptsPerMinute: 100 });
		guard.recordInbound("192.168.1.10");
		expect(guard.shouldAcceptInbound("192.168.1.20")).toBeNull();
	});

	// ── Max Inbound ──────────────────────────────────────────────

	it("enforces max inbound connections", () => {
		const guard = new PeerGuard({ maxInbound: 2, maxAttemptsPerMinute: 100, enforceSubnetDiversity: false });
		guard.recordInbound("10.0.0.1");
		guard.recordInbound("10.0.0.2");
		const rejection = guard.shouldAcceptInbound("10.0.0.3");
		expect(rejection).toContain("max inbound");
	});

	// ── Outbound Needs ──────────────────────────────────────────

	it("reports need for more outbound connections", () => {
		const guard = new PeerGuard({ minOutbound: 3 });
		expect(guard.needsMoreOutbound()).toBe(true);
		guard.recordOutbound("ws://10.0.0.1:3142/mesh");
		guard.recordOutbound("ws://10.0.0.2:3142/mesh");
		expect(guard.needsMoreOutbound()).toBe(true);
		guard.recordOutbound("ws://10.0.0.3:3142/mesh");
		expect(guard.needsMoreOutbound()).toBe(false);
	});

	// ── Peer Scoring ──────────────────────────────────────────────

	it("tracks peer success and failure scores", () => {
		const guard = new PeerGuard();
		guard.recordSuccess("node-1", "ws://10.0.0.1:3142/mesh", 50);
		guard.recordSuccess("node-1", "ws://10.0.0.1:3142/mesh", 100);
		guard.recordFailure("node-2", "ws://10.0.0.2:3142/mesh");

		const scores = guard.getScores();
		expect(scores.get("node-1")!.successes).toBe(2);
		expect(scores.get("node-1")!.avgLatencyMs).toBe(75);
		expect(scores.get("node-2")!.failures).toBe(1);
	});

	it("ranks peers by reliability", () => {
		const guard = new PeerGuard();
		guard.recordSuccess("good-peer", "ws://10.0.0.1:3142/mesh", 50);
		guard.recordSuccess("good-peer", "ws://10.0.0.1:3142/mesh", 60);
		guard.recordSuccess("bad-peer", "ws://10.0.0.2:3142/mesh", 200);
		guard.recordFailure("bad-peer", "ws://10.0.0.2:3142/mesh");
		guard.recordFailure("bad-peer", "ws://10.0.0.2:3142/mesh");

		const ranked = guard.getRankedPeers();
		expect(ranked[0].nodeId).toBe("good-peer");
	});

	it("loads and retrieves persisted scores", () => {
		const guard = new PeerGuard();
		guard.loadScores([{
			nodeId: "persisted", endpoint: "ws://10.0.0.5:3142/mesh",
			successes: 100, failures: 5, avgLatencyMs: 42,
			lastSeen: Date.now(), firstSeen: Date.now() - 86_400_000,
			isStatic: true,
		}]);
		const scores = guard.getScores();
		expect(scores.get("persisted")!.successes).toBe(100);
		expect(scores.get("persisted")!.isStatic).toBe(true);
	});

	// ── Counts ──────────────────────────────────────────────────

	it("reports correct counts", () => {
		const guard = new PeerGuard();
		guard.recordOutbound("ws://10.0.0.1:3142/mesh");
		guard.recordInbound("192.168.1.5");
		const counts = guard.getCounts();
		expect(counts.outbound).toBe(1);
		expect(counts.inbound).toBe(1);
		expect(counts.subnets).toBe(2); // 10.0.0.0/24 + 192.168.1.0/24
	});

	it("decrements counts on disconnect", () => {
		const guard = new PeerGuard();
		guard.recordOutbound("ws://10.0.0.1:3142/mesh");
		guard.recordInbound("10.0.0.2");
		guard.removeConnection("ws://10.0.0.1:3142/mesh", true);
		guard.removeConnection("10.0.0.2", false);
		const counts = guard.getCounts();
		expect(counts.outbound).toBe(0);
		expect(counts.inbound).toBe(0);
	});
});
