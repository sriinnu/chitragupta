# P2P Actor Mesh — Network Architecture

> Full documentation for Chitragupta's peer-to-peer distributed actor mesh.
> For general architecture, see [ARCHITECTURE.md](./ARCHITECTURE.md).
> For communication primitives (CommHub, Samiti, Sabha), see the [Sutra README](../packages/sutra/README.md).

---

## Overview

The P2P Actor Mesh extends Sutra's in-process actor model into a real distributed system. Multiple Chitragupta nodes form a self-organizing mesh network over WebSocket connections, enabling agents on different machines to communicate as naturally as local actors.

The design draws heavily from **Bitcoin's network layer** — the most battle-tested P2P protocol in existence — adapted for actor-based AI agent communication rather than transaction relay.

```
┌─────────────────────────────────┐     ┌─────────────────────────────────┐
│ Node A (ws://10.0.1.5:3142)    │     │ Node B (ws://10.0.2.8:3142)    │
│                                 │     │                                 │
│  ┌─────────┐   ┌────────────┐  │ WS  │  ┌────────────┐   ┌─────────┐ │
│  │ Agent 1 ├──→│ MeshRouter ├──┼─────┼──┤ MeshRouter │←──┤ Agent 3 │ │
│  └─────────┘   └──────┬─────┘  │     │  └──────┬─────┘   └─────────┘ │
│  ┌─────────┐          │        │     │         │          ┌─────────┐ │
│  │ Agent 2 │   ┌──────┴─────┐  │     │  ┌──────┴─────┐   │ Agent 4 │ │
│  └─────────┘   │  Gossip    │  │     │  │  Gossip    │   └─────────┘ │
│                │ (SWIM)     │←─┼─────┼──│ (SWIM)     │              │
│                └────────────┘  │     │  └────────────┘              │
│  ┌──────────┐  ┌────────────┐  │     │  ┌────────────┐              │
│  │PeerGuard │  │  AddrDb    │  │     │  │  AddrDb    │              │
│  └──────────┘  └────────────┘  │     │  └────────────┘              │
└─────────────────────────────────┘     └─────────────────────────────────┘
```

---

## Bitcoin-Inspired Design

We adopted these principles from Bitcoin's network protocol (BIP-150, BIP-155, Bitcoin Core `addrman`):

| Bitcoin Concept | Our Implementation | Purpose |
|---|---|---|
| `version` message | Version handshake in auth | Protocol compatibility negotiation |
| `addr` message relay | `relayPeerAddr()` | Transitive peer discovery |
| `addrman` (two-table) | `PeerAddrDb` (new/tried) | Persistent peer storage with eclipse resistance |
| Subnet bucketing | `PeerGuard` /24 diversity | Anti-eclipse: limit connections per subnet |
| Outbound preference | `minOutbound` in PeerGuard | Attacker can't control all your connections |
| Connection age rotation | `maxInboundAgeMs` | Prevent long-lived Sybil connections |
| HMAC authentication | `meshSecret` + nonce-HMAC | Mutual authentication on connect |

### Why Bitcoin's Model?

Bitcoin has operated a fully decentralized P2P network with 10,000+ nodes for 15+ years under active adversarial conditions. Its network layer handles:
- Eclipse attacks (isolating a node from honest peers)
- Sybil attacks (flooding with attacker-controlled nodes)
- Network partitions and churn
- NAT traversal and heterogeneous connectivity

These are the exact same challenges a distributed AI agent mesh faces.

---

## Components

### ActorSystem (`actor-system.ts`)

Top-level coordinator. Manages actor lifecycle, message routing, and P2P bootstrap.

```typescript
const system = new ActorSystem({
  gossipIntervalMs: 500,
  suspectTimeoutMs: 15_000,
  deadTimeoutMs: 30_000,
});
system.start();

// Bootstrap P2P networking
const port = await system.bootstrapP2P({
  listenPort: 3142,
  staticPeers: ["ws://10.0.1.5:3142/mesh"],
  meshSecret: process.env.MESH_SECRET,
});

// Actors on this node are now reachable from any peer
system.spawn("my-agent", { behavior: agentBehavior });
```

### PeerConnectionManager (`peer-connection.ts`)

Orchestrates all WebSocket connections — outbound, inbound, reconnection, TLS, discovery.

**Key responsibilities:**
- Outbound connections to static peers and discovered peers
- Inbound listener with WebSocket upgrade handling
- Exponential backoff reconnection for outbound peers
- HMAC-SHA256 mutual authentication
- TLS (wss://) support for encrypted transport
- Bitcoin-style peer exchange and addr relay
- PeerGuard integration for anti-eclipse protection

### WsPeerChannel (`ws-peer-channel.ts`)

A single peer connection wrapping a WebSocket. Implements the `PeerChannel` interface so the MeshRouter treats remote peers identically to local actors.

**Wire protocol messages:**
| Type | Direction | Purpose |
|------|-----------|---------|
| `auth` | Outbound→Inbound | HMAC authentication + version handshake |
| `auth:ok` | Inbound→Outbound | Authentication accepted + version info |
| `auth:fail` | Inbound→Outbound | Authentication rejected |
| `envelope` | Bidirectional | Actor message delivery |
| `gossip` | Bidirectional | SWIM protocol view exchange |
| `discovery` | Bidirectional | Peer address exchange |
| `samiti` | Bidirectional | Ambient broadcast relay |
| `ping` / `pong` | Bidirectional | Heartbeat liveness detection |

### MeshRouter (`mesh-router.ts`)

Routes messages between local actors and remote peers. Supports:
- Priority lanes (critical > high > normal > low > background)
- TTL hop limiting (prevents infinite relay loops)
- Origin stamping and visited-node tracking
- Reply route registration for cross-node ask/reply

### GossipProtocol (`gossip-protocol.ts`)

SWIM-inspired protocol for distributed actor location tracking and failure detection.

```
alive → suspect (no heartbeat) → dead (evicted)
        ↑ pong received ──────┘
```

Lamport generation clocks ensure causal ordering across the mesh.

### NetworkGossip (`network-gossip.ts`)

Bridges the in-process GossipProtocol with the real P2P network. Periodically exchanges actor location maps with connected peers so every node knows which actors live where.

---

## Security

### Authentication (HMAC-SHA256)

Every connection is mutually authenticated using a shared `meshSecret`:

1. Outbound peer sends `auth` frame with nonce + HMAC(nonce, secret)
2. Inbound peer verifies HMAC using constant-time comparison
3. If valid, responds with `auth:ok`; otherwise `auth:fail` and closes
4. All subsequent messages are signed with HMAC per-frame

```typescript
await system.bootstrapP2P({
  meshSecret: "shared-secret-between-trusted-nodes",
});
```

### Anti-Eclipse Protection (PeerGuard)

`PeerGuard` implements Bitcoin-style connection diversity rules:

| Protection | Config | Default | Purpose |
|---|---|---|---|
| Subnet diversity | `maxPerSubnet` | 8 | Max connections per /24 subnet |
| Rate limiting | `maxAttemptsPerMinute` | 10 | Cap inbound attempts per IP |
| Max inbound | `maxInbound` | 25 | Separate cap for inbound connections |
| Min outbound | `minOutbound` | 4 | Ensure minimum outbound (attacker can't control) |
| Inbound age rotation | `maxInboundAgeMs` | 1 hour | Cycle oldest inbound connections |

**Why this matters:** In an eclipse attack, an adversary floods a node with connections from nodes they control, isolating it from the honest network. Subnet diversity ensures no single /24 block can dominate your peer set. Outbound preference ensures you always have connections YOU initiated (which the attacker can't intercept).

### Peer Scoring

Every peer is scored by reliability for preferred reconnection:

```
score = (successes / total) * recencyWeight + staticBonus
recencyWeight = max(0.1, 1 - ageHours / 24)
staticBonus = 0.2 if seed/static peer
```

`getRankedPeers()` returns peers sorted by score — used for reconnection priority after restart.

### TLS Transport

Enable encrypted transport with standard Node.js TLS options:

```typescript
await system.bootstrapP2P({
  tls: true,
  tlsCert: fs.readFileSync("cert.pem"),
  tlsKey: fs.readFileSync("key.pem"),
  tlsCa: fs.readFileSync("ca.pem"),      // optional: custom CA
  tlsAllowSelfSigned: false,             // dev/test only
});
```

Inbound connections use `https.createServer()`. Outbound wss:// connections use the `ws` package (native WebSocket doesn't support custom CA certificates).

---

## Peer Discovery

### Static Peers

Seed nodes configured at startup — always reconnected on failure:

```typescript
await system.bootstrapP2P({
  staticPeers: [
    "ws://seed1.example.com:3142/mesh",
    "ws://seed2.example.com:3142/mesh",
  ],
});
```

### Peer Exchange (Bitcoin `addr` Relay)

When two nodes connect, they exchange their known peer lists. When a new peer is discovered, its address is **relayed transitively** to all connected peers — exactly like Bitcoin's `addr` message propagation.

```
Node A connects to Node B
  → B sends A its known peers: [C, D]
  → A discovers C and D, connects to them
  → A relays C and D's addresses to all its other peers
  → Mesh converges: all nodes know all nodes
```

**Configuration:**
```typescript
{
  enablePeerExchange: true,        // default: true
  maxDiscoveredPeers: 10,          // max auto-connect from discovery
  peerExchangeIntervalMs: 30_000,  // periodic re-exchange interval
}
```

### Peer Address Database (PeerAddrDb)

Bitcoin-style persistent peer storage with a two-table design:

| Table | Purpose | Eviction |
|---|---|---|
| **new** | Addresses heard about but never connected to | Oldest entry when at capacity |
| **tried** | Addresses we've successfully connected to | Least reliable when at capacity |

**Key features:**
- Subnet diversity in "new" table (max entries per /24)
- Bootstrap peers ranked by `reliability * recency + triedBonus`
- Bootstrap set enforces diversity (max 2 per /24 subnet)
- JSON persistence to disk for fast restart
- Automatic pruning of entries older than 7 days
- Event-driven integration with PeerConnectionManager

```typescript
import { PeerAddrDb } from "@chitragupta/sutra/mesh";

const addrDb = new PeerAddrDb({ maxTried: 256, maxNew: 1000 });

// Load persisted peers from previous run
await addrDb.load("~/.chitragupta/peers.json");

// Subscribe to connection events for automatic tracking
const unsub = addrDb.attachTo(connectionManager);

// Get best peers for bootstrap
const bootstrapPeers = addrDb.getBootstrapPeers(20);

// Save on shutdown
await addrDb.save("~/.chitragupta/peers.json");
```

---

## Version Handshake

Every connection begins with a version exchange (Bitcoin's `version`/`verack` pattern):

```typescript
// Sent in the auth frame:
{
  protocol: "mesh/1.0",        // wire protocol version
  userAgent: "chitragupta-sutra",
  timestamp: 1740268800000,    // for time offset calculation
  services: ["actor", "gossip", "discovery", "samiti"],
  minProtocol: "mesh/1.0",    // minimum accepted version
}
```

After handshake, each channel exposes `remoteVersionInfo` for protocol-aware behavior.

---

## Message Flow

### Cross-Node Tell

```
Node A: system.tell("sender", "remote-actor", payload)
  → MeshRouter looks up "remote-actor" location via NetworkGossip
  → Finds it on Node B → serializes as { type: "envelope", data: ... }
  → WsPeerChannel.receive() sends over WebSocket
  → Node B: WsPeerChannel.handleIncoming() → MeshRouter.route()
  → Delivered to "remote-actor" mailbox
```

### Cross-Node Ask/Reply

```
Node A: system.ask("caller", "remote-echo", "hello")
  → Creates envelope with type: "ask", unique ID, replyTo
  → Routed to Node B via WsPeerChannel
  → Node B: "remote-echo" processes, calls ctx.reply()
  → Reply envelope sent back to Node A via registered reply route
  → Node A: Promise resolves with reply payload
```

### Gossip Convergence

```
Every gossipIntervalMs:
  → NetworkGossip builds actor location map
  → Sends to random subset of peers (fanout)
  → Peers merge locations with their own map
  → After ~3 rounds, all nodes know all actor locations
```

---

## Configuration Reference

```typescript
interface PeerNetworkConfig {
  // Identity
  nodeId?: string;                    // auto-generated UUID if omitted
  label?: string;                     // human-readable node name
  capabilities?: string[];            // e.g. ["agent", "memory", "coding"]

  // Listener
  listenPort?: number;                // default: 3142
  listenHost?: string;                // default: "0.0.0.0"

  // Peers
  staticPeers?: string[];             // seed endpoints
  maxPeers?: number;                  // default: 50

  // Authentication
  meshSecret?: string;                // HMAC-SHA256 shared secret

  // Heartbeat
  pingIntervalMs?: number;            // default: 10_000
  maxMissedPings?: number;            // default: 3

  // Reconnection
  reconnectBaseMs?: number;           // default: 1_000
  reconnectMaxMs?: number;            // default: 60_000

  // Gossip
  gossipIntervalMs?: number;          // default: 5_000

  // TLS
  tls?: boolean;
  tlsCert?: string | Buffer;
  tlsKey?: string | Buffer;
  tlsCa?: string | Buffer | Array<string | Buffer>;
  tlsAllowSelfSigned?: boolean;

  // Discovery
  enablePeerExchange?: boolean;       // default: true
  maxDiscoveredPeers?: number;        // default: 10
  peerExchangeIntervalMs?: number;    // default: 30_000

  // Security
  guard?: PeerGuardConfig;            // anti-eclipse config
}
```

---

## Source Files

| File | LOC | Purpose |
|------|-----|---------|
| `actor-system.ts` | 446 | Top-level coordinator, P2P bootstrap |
| `peer-connection.ts` | 445 | Connection manager, TLS, discovery, reconnect |
| `ws-peer-channel.ts` | 448 | Single WebSocket peer, auth, ping/pong |
| `mesh-router.ts` | 422 | Message routing, priority lanes, TTL |
| `peer-addr-db.ts` | 269 | Bitcoin-style persistent peer database |
| `network-gossip.ts` | 290 | Network-level gossip bridge |
| `peer-guard.ts` | 272 | Anti-eclipse protections, peer scoring |
| `gossip-protocol.ts` | 272 | SWIM failure detection |
| `peer-types.ts` | 194 | Type definitions, wire protocol, config |
| `peer-envelope.ts` | 143 | Serialization, HMAC signing, validation |
| `actor.ts` | 210 | Actor lifecycle, mailbox processing |
| `actor-mailbox.ts` | 123 | Priority mailbox (4 lanes) |
| `types.ts` | 120 | Core types (MeshEnvelope, PeerChannel) |
| `index.ts` | 70 | Module exports |
| **Total** | **3,724** | |

---

## Test Coverage

| Test File | Tests | What It Covers |
|-----------|-------|----------------|
| `p2p-mesh-integration.test.ts` | 12 | Multi-node connect, ask/reply, broadcast, 5-node cluster, discovery, version handshake |
| `p2p-mesh.test.ts` | ~50 | Unit tests for MeshRouter, WsPeerChannel, envelope handling |
| `peer-guard.test.ts` | 13 | Rate limiting, subnet diversity, peer scoring, counts |
| `peer-addr-db.test.ts` | 18 | Two-table storage, bootstrap, persistence, event integration |
| `mesh.test.ts` | ~30 | Actor, Mailbox, GossipProtocol unit tests |
| `mesh-router.test.ts` | ~20 | Routing, TTL, priority, broadcast |

---

[Back to Architecture](./ARCHITECTURE.md) | [Back to Sutra README](../packages/sutra/README.md) | [Back to root](../README.md)
