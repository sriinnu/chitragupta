# P2P Actor Mesh — @chitragupta/sutra/mesh

Real distributed actor system over WebSocket transport with SWIM-inspired
gossip failure detection, HMAC-authenticated peer connections, and automatic
dead peer cleanup.

## Architecture

```
                           CHITRAGUPTA P2P MESH NETWORK
 ┌──────────────────────────────────────────────────────────────────────────┐
 │                                                                          │
 │   Node A (ws://10.0.0.1:3142/mesh)     Node B (ws://10.0.0.2:3142/mesh)│
 │   ┌──────────────────────────┐          ┌──────────────────────────┐    │
 │   │       ActorSystem        │          │       ActorSystem        │    │
 │   │  ┌────────────────────┐  │  WebSocket  ┌────────────────────┐  │    │
 │   │  │    MeshRouter      │◄─┼──────────┼─►│    MeshRouter      │  │    │
 │   │  │  ┌──────────────┐  │  │  /mesh   │  │  ┌──────────────┐  │  │    │
 │   │  │  │ Local Actors  │  │  │          │  │  │ Local Actors  │  │  │    │
 │   │  │  │  echo-a       │  │  │          │  │  │  echo-b       │  │  │    │
 │   │  │  │  worker-a     │  │  │          │  │  │  worker-b     │  │  │    │
 │   │  │  └──────────────┘  │  │          │  │  └──────────────┘  │  │    │
 │   │  └────────┬───────────┘  │          │  └────────┬───────────┘  │    │
 │   │           │              │          │           │              │    │
 │   │  ┌────────┴───────────┐  │          │  ┌────────┴───────────┐  │    │
 │   │  │  GossipProtocol    │  │          │  │  GossipProtocol    │  │    │
 │   │  │  (SWIM failure     │  │          │  │  (SWIM failure     │  │    │
 │   │  │   detection)       │  │          │  │   detection)       │  │    │
 │   │  └────────┬───────────┘  │          │  └────────┬───────────┘  │    │
 │   │           │              │          │           │              │    │
 │   │  ┌────────┴───────────┐  │          │  ┌────────┴───────────┐  │    │
 │   │  │  NetworkGossip     │◄─┼── SWIM ──┼─►│  NetworkGossip     │  │    │
 │   │  │  (actor→node map)  │  │  views   │  │  (actor→node map)  │  │    │
 │   │  └────────┬───────────┘  │          │  └────────┬───────────┘  │    │
 │   │           │              │          │           │              │    │
 │   │  ┌────────┴───────────┐  │          │  ┌────────┴───────────┐  │    │
 │   │  │ PeerConnectionMgr  │  │          │  │ PeerConnectionMgr  │  │    │
 │   │  │  ┌──────────────┐  │  │          │  │  ┌──────────────┐  │  │    │
 │   │  │  │ WsPeerChannel │──┼──┼──────────┼──┼──│ WsPeerChannel │  │  │    │
 │   │  │  │ (ping/pong)   │  │  │ WebSocket│  │  │ (ping/pong)   │  │  │    │
 │   │  │  │ (HMAC auth)   │  │  │          │  │  │ (HMAC auth)   │  │  │    │
 │   │  │  └──────────────┘  │  │          │  │  └──────────────┘  │  │    │
 │   │  └────────────────────┘  │          │  └────────────────────┘  │    │
 │   └──────────────────────────┘          └──────────────────────────┘    │
 │                                                                          │
 │   Node C (ws://10.0.0.3:3142/mesh)                                      │
 │   ┌──────────────────────────┐                                          │
 │   │       ActorSystem        │   ◄── gossip converges all nodes         │
 │   │  MeshRouter              │       to same actor-to-node map          │
 │   │  GossipProtocol          │                                          │
 │   │  NetworkGossip           │   ◄── Router.doDeliver() looks up        │
 │   │  PeerConnectionMgr       │       remote actors via location map     │
 │   └──────────────────────────┘                                          │
 └──────────────────────────────────────────────────────────────────────────┘
```

## Component Overview

### ActorSystem (`actor-system.ts`)
Top-level coordinator. Owns the router, gossip protocol, and actor registry.
Provides `bootstrapP2P(config)` to activate real networking.

### MeshRouter (`mesh-router.ts`)
The nervous system. Routes envelopes with 3-tier priority:
1. **Local actor** — direct in-process delivery
2. **Peer channel match** — explicit peer targeting by ID
3. **Location resolver** — `actorId → nodeId → PeerChannel` forwarding

Also handles: broadcast (`*`), topic pub/sub, request-reply correlation,
TTL enforcement, and loop prevention via hop tracking.

### GossipProtocol (`gossip-protocol.ts`)
SWIM-inspired failure detection. Maintains a peer view of
`{ actorId, status, generation, lastSeen }` for every known actor.
Status lifecycle: `alive → suspect → dead`.

### NetworkGossip (`network-gossip.ts`)
Bridges local gossip with real WebSocket transport. Periodically exchanges
peer views across the mesh (fanout=3). Maintains the **actor-to-node
location map** that the router consults for distributed forwarding.

### PeerConnectionManager (`peer-connection.ts`)
Orchestrates all peer connections:
- **Listener**: HTTP server on port 3142, accepts WebSocket upgrades on `/mesh`
- **Outbound**: Connects to `staticPeers` with exponential backoff reconnect
- **Auth**: HMAC-SHA256 challenge-response on every connection
- **Health**: Tracks peer states, emits unified event stream

### WsPeerChannel (`ws-peer-channel.ts`)
Single peer connection wrapping a WebSocket. Handles:
- Serialization/deserialization of PeerMessage wire protocol
- HMAC frame signing (when meshSecret is configured)
- Ping/pong heartbeat with dead peer detection and auto-kill
- Connection state machine: `connecting → authenticating → connected → dead`

## Message Flow

### Actor-to-Actor (Cross-Node)
```
Node A: actor "echo-a" sends to "worker-b" on Node B

  1. echo-a calls ActorRef.tell("echo-a", payload)
  2. MeshRouter.route(envelope{to: "worker-b"})
  3. Router.doDeliver() → not local → not peer channel
  4. Router calls actorLocationFn("worker-b") → returns "node-b-id"
  5. Router finds PeerChannel for "node-b-id"
  6. WsPeerChannel.receive(envelope) → stampOrigin → serialize → WS send
  7. Node B: WsPeerChannel.handleIncoming → verify HMAC → deserialize
  8. Node B: localRouter.route(envelope) → delivers to worker-b actor
```

### Gossip Exchange
```
Every 5 seconds (configurable):

  1. NetworkGossip selects random peers (fanout=3)
  2. Sends local GossipProtocol view (actor list + status)
  3. Remote peer receives → merges into their GossipProtocol
  4. Updates actor-to-node location map
  5. All nodes converge on consistent view of actor population
```

### Heartbeat (Ping/Pong)
```
Every 10 seconds (configurable):

  1. WsPeerChannel sends { type: "ping", ts: Date.now() }
  2. Remote peer replies { type: "pong", ts: original_ts }
  3. Latency measured: now - original_ts
  4. If pong not received → missedPings++
  5. If missedPings > maxMissedPings (default 3):
     → Declare DEAD → emit peer:dead → kill connection → cleanup
```

## Security Model

### Authentication
Every connection uses **HMAC-SHA256 challenge-response**:
1. Connecting peer generates a nonce: `nodeId:timestamp:random`
2. Signs the nonce with shared `meshSecret`: `HMAC-SHA256(nonce, secret)`
3. Sends `{ type: "auth", nodeId, nonce, hmac, info }` as first frame
4. Listener verifies HMAC with constant-time comparison
5. On success: `{ type: "auth:ok", nodeId, info }` — connection live
6. On failure: `{ type: "auth:fail" }` → socket closed with 1008

### Frame Signing
When `meshSecret` is configured, every WebSocket frame is wrapped:
```json
{ "sig": "hmac-sha256-hex", "body": "serialized-peer-message" }
```
Receiver verifies the signature before processing. Invalid signatures
are silently dropped (logged as `peer:auth_failed` event).

### No Raw Secrets on Wire
The `meshSecret` is never transmitted. Only HMAC-derived signatures
travel over the network.

## Configuration

### Environment Variables
```bash
CHITRAGUPTA_MESH_PORT=3142       # Listener port
CHITRAGUPTA_MESH_HOST=0.0.0.0   # Bind host
CHITRAGUPTA_MESH_PEERS=ws://10.0.0.2:3142/mesh,ws://10.0.0.3:3142/mesh
CHITRAGUPTA_MESH_SECRET=your-shared-hmac-secret
CHITRAGUPTA_MESH_LABEL=node-alpha
CHITRAGUPTA_MESH_ADDR_DB_PATH=~/.chitragupta/peers.json
```

### Settings (chitragupta.json)
```json
{
  "mesh": {
    "listenPort": 3142,
    "listenHost": "0.0.0.0",
    "staticPeers": ["ws://10.0.0.2:3142/mesh"],
    "meshSecret": "shared-secret",
    "authNonceWindowMs": 120000,
    "pingIntervalMs": 10000,
    "maxMissedPings": 3,
    "maxPeers": 50,
    "gossipIntervalMs": 5000,
    "peerAddrDbPath": "~/.chitragupta/peers.json",
    "peerAddrDbBootstrapCount": 20,
    "peerAddrDbSaveIntervalMs": 30000,
    "label": "node-alpha",
    "capabilities": ["agent", "memory"]
  }
}
```

### PeerNetworkConfig (Programmatic)
```typescript
const system = new ActorSystem({ maxMailboxSize: 5000 });
system.start();

const meshPort = await system.bootstrapP2P({
  listenPort: 3142,
  staticPeers: ["ws://10.0.0.2:3142/mesh"],
  meshSecret: "shared-hmac-secret",
  authNonceWindowMs: 120_000,
  pingIntervalMs: 10_000,
  maxMissedPings: 3,
  maxPeers: 50,
  gossipIntervalMs: 5_000,
  peerAddrDbPath: "~/.chitragupta/peers.json",
  peerAddrDbBootstrapCount: 20,
  peerAddrDbSaveIntervalMs: 30_000,
  label: "node-alpha",
  capabilities: ["agent", "memory"],
});
```

## API Reference

### ActorSystem
```typescript
system.bootstrapP2P(config: PeerNetworkConfig): Promise<number>  // returns mesh port
system.spawn(id, { behavior, expertise?, capabilities? }): ActorRef
system.tell(from, to, payload, opts?)
system.ask(from, to, payload, opts?): Promise<MeshEnvelope>
system.broadcast(from, payload, opts?)
system.subscribe(actorId, topic)
system.findByExpertise(expertise): PeerView[]
system.findAlive(): PeerView[]
system.getRouter(): MeshRouter
system.getConnectionManager(): PeerConnectionManager | null
system.getNetworkGossip(): NetworkGossip | null
system.shutdown(): Promise<void>
```

### HTTP Endpoints (CLI serve mode)
```
POST /api/webhooks/:channel   — Inbound webhook (HMAC-signed)
GET  /api/mesh/status         — Mesh network health snapshot
GET  /api/mesh/peers          — List connected peers
POST /api/mesh/peers          — Connect to a new peer endpoint
```

## Wire Protocol

All messages are JSON with a `type` discriminator:

| Type | Direction | Purpose |
|------|-----------|---------|
| `envelope` | bidirectional | Actor message (MeshEnvelope) |
| `gossip` | bidirectional | SWIM peer view exchange |
| `discovery` | bidirectional | Known peer endpoint sharing |
| `samiti` | bidirectional | Samiti channel broadcast |
| `ping` | outbound | Heartbeat probe |
| `pong` | inbound | Heartbeat response |
| `auth` | outbound | HMAC identity handshake |
| `auth:ok` | inbound | Authentication accepted |
| `auth:fail` | inbound | Authentication rejected |

## Connection Lifecycle

```
     connect()
         │
         ▼
   ┌─────────────┐     waitForOpen()     ┌────────────────┐
   │ CONNECTING   │────────────────────►  │ AUTHENTICATING  │
   └─────────────┘                        └───────┬────────┘
                                                  │
                                     auth:ok      │  auth:fail
                                    ┌─────────────┤
                                    ▼             ▼
                              ┌───────────┐  ┌──────────────┐
                              │ CONNECTED  │  │ DISCONNECTED │
                              └─────┬─────┘  └──────────────┘
                                    │
                    ping timeout    │   socket close
                   (no heartbeat)   │   (remote/error)
                          ┌─────────┤
                          ▼         ▼
                     ┌────────┐  ┌──────────────┐
                     │  DEAD  │  │ DISCONNECTED │
                     └───┬────┘  └──────┬───────┘
                         │              │
                         │   outbound?  │
                         ▼              ▼
                    kill + cleanup   reconnect
                                   (exp backoff)
```

## File Structure

```
packages/sutra/src/mesh/
├── types.ts              — Core types: MeshEnvelope, PeerChannel, PeerView
├── actor-mailbox.ts      — Lock-free priority mailbox
├── actor.ts              — Actor with behavior + mailbox
├── actor-system.ts       — Top-level coordinator (444 LOC)
├── mesh-router.ts        — Distributed message routing (378 LOC)
├── gossip-protocol.ts    — SWIM failure detection (272 LOC)
├── peer-types.ts         — Wire protocol + config types (151 LOC)
├── peer-envelope.ts      — Serialization + HMAC signing (143 LOC)
├── ws-peer-channel.ts    — WebSocket PeerChannel (408 LOC)
├── peer-connection.ts    — Connection manager (364 LOC)
├── network-gossip.ts     — Distributed gossip exchange (275 LOC)
├── index.ts              — Public exports
└── README.md             — This file
```

## Test Coverage

38 tests in `packages/sutra/test/p2p-mesh.test.ts`:
- **peer-envelope** (17): serialization, validation, HMAC signing, hop tracking
- **NetworkGossip** (7): location map, eviction, gossip merge
- **MeshRouter distributed** (5): 3-tier routing priority
- **WsPeerChannel** (9): lifecycle, stats, gossip, HMAC frames, dead detection
