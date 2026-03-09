import { describe, expect, it, vi } from "vitest";

const {
	getMeshPeersViaDaemonMock,
	getMeshStatusViaDaemonMock,
} = vi.hoisted(() => ({
	getMeshStatusViaDaemonMock: vi.fn(),
	getMeshPeersViaDaemonMock: vi.fn(),
}));

vi.mock("../src/modes/daemon-bridge-collective.js", () => ({
	getMeshStatusViaDaemon: (...args: unknown[]) => getMeshStatusViaDaemonMock(...args),
	getMeshPeersViaDaemon: (...args: unknown[]) => getMeshPeersViaDaemonMock(...args),
	getMeshTopologyViaDaemon: vi.fn(),
	getMeshGossipViaDaemon: vi.fn(),
}));

import { createMeshPeersTool, createMeshStatusTool } from "../src/modes/mcp-tools-mesh.js";

describe("mesh MCP tools", () => {
	it("reports local actors and local capability routing accurately", async () => {
		const snapshot = {
			isRunning: true,
			running: true,
			actorCount: 3,
			localActorsAlive: 3,
			localActors: [
				{ actorId: "sys:memory", status: "alive", generation: 1, lastSeen: Date.now(), capabilities: ["memory-search"] },
				{ actorId: "sys:skills", status: "alive", generation: 1, lastSeen: Date.now(), capabilities: ["skill-find"] },
				{ actorId: "sys:session", status: "alive", generation: 1, lastSeen: Date.now(), capabilities: ["session-list"] },
			],
			p2pBootstrapped: false,
			nodeId: null,
			meshPort: 0,
			peers: [],
			connectedCount: 0,
			totalPeers: 0,
			actorLocations: 0,
			gossipRunning: true,
			gossipPeers: 0,
			remoteGossipPeers: [],
			capabilityRouterActive: true,
		};
		getMeshStatusViaDaemonMock.mockResolvedValue(snapshot);
		getMeshPeersViaDaemonMock.mockResolvedValue(snapshot);

		const statusTool = createMeshStatusTool();
		const peersTool = createMeshPeersTool();

		const statusResult = await statusTool.execute({});
		const peersResult = await peersTool.execute({});

		const status = JSON.parse(String(statusResult.content[0].text)) as Record<string, unknown>;
		expect(status.localActorsAlive).toBe(3);
		expect(status.gossipPeers).toBe(0);
		expect(status.capabilityRouterActive).toBe(true);
		expect(status.p2pBootstrapped).toBe(false);

		const peersText = String(peersResult.content[0].text);
		expect(peersText).toContain("Local Actors (3)");
		expect(peersText).toContain("Remote Gossip Peers: none");
		expect(peersText).toContain("P2P: not bootstrapped");
	});
});
