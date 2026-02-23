# Mesh Hardening, Typed Schemas & Akasha Events

Changes introduced in `78e1ae3` — addresses review gaps blocking downstream integration with Vaayu/takumi.

## 1. Auth Timeout for Inbound Peers

**Package:** `@chitragupta/sutra` | **File:** `mesh/peer-connection.ts`

Previously, inbound peer auth (`ws.once("message")`) waited indefinitely if no auth frame arrived, causing resource leaks.

Now, a `setTimeout` closes the socket after `authNonceWindowMs` (default 120s) if no auth frame is received:

```typescript
const authTimeout = setTimeout(() => {
  ws.close(1008, "auth timeout");
}, this.nonceWindowMs);
ws.once("message", (raw) => {
  clearTimeout(authTimeout);
  // ... handle auth
});
```

## 2. CapabilityLearner Wired to Actor Mesh

**Package:** `@chitragupta/sutra` | **Files:** `mesh/actor.ts`, `mesh/actor-system.ts`

### ActorLearner Interface

```typescript
import type { ActorLearner } from "@chitragupta/sutra";

interface ActorLearner {
  recordSuccess(actorId: string, envelope: MeshEnvelope): void;
  recordFailure(actorId: string, envelope: MeshEnvelope): void;
}
```

The `Actor` constructor now accepts an optional `learner` parameter. When present, `drain()` calls `recordSuccess` on behavior completion and `recordFailure` on behavior error.

### ActorSystem Integration

`ActorSystem` now:
- Creates a `CapabilityLearner` in its constructor
- Passes it to every spawned `Actor`
- Starts/stops the learner with the system lifecycle
- Calls `capabilityRouter.updateLoad()` on spawn/stop, feeding the load-aware scoring

## 3. Typed Tool Response Schemas

**Package:** `@chitragupta/tantra` | **File:** `types.ts`

Three typed interfaces for MCP tool responses, enabling downstream consumers to parse structured data instead of text:

```typescript
import type {
  VasanaTendencyResult,
  HealthStatusResult,
  MeshStatusResult,
} from "@chitragupta/tantra";
```

### VasanaTendencyResult

Returned in `_metadata.typed` by the `vasana_tendencies` tool:

| Field | Type | Description |
|-------|------|-------------|
| `tendency` | `string` | Name of the behavioral tendency |
| `valence` | `string` | Positive/negative/neutral |
| `strength` | `number` | Tendency strength [0, 1] |
| `stability` | `number` | How stable the tendency is [0, 1] |
| `predictiveAccuracy` | `number` | Holdout prediction accuracy [0, 1] |
| `reinforcementCount` | `number` | Times the tendency was reinforced |
| `description` | `string` | Human-readable description |

### HealthStatusResult

Returned in `_metadata.typed` by the `health_status` tool:

| Field | Type | Description |
|-------|------|-------------|
| `state` | `{ sattva, rajas, tamas }` | Current Triguna values (2-simplex) |
| `dominant` | `string` | Dominant guna |
| `trend` | `{ sattva, rajas, tamas }` | Trend direction per guna |
| `alerts` | `string[]` | Health alerts |
| `history` | `Array<{ timestamp, state, dominant }>` | Recent state history |

### MeshStatusResult

For the `mesh_status` tool:

| Field | Type | Description |
|-------|------|-------------|
| `running` | `boolean` | Whether the actor system is running |
| `actorCount` | `number` | Number of active actors |
| `gossipAlive` | `number` | Alive peers in gossip |
| `peersConnected` | `number` | Connected P2P peers |
| `nodeId` | `string \| null` | This node's ID |

### Consuming `_metadata.typed`

```typescript
const result = await callTool("vasana_tendencies", { limit: 5 });
const typed = result._metadata?.typed as VasanaTendencyResult[];
// typed[0].strength, typed[0].stability, etc.
```

## 4. Akasha Event Emission

**Package:** `@chitragupta/smriti` | **File:** `akasha.ts`

`AkashaField` now supports a callback for trace lifecycle events:

```typescript
import { AkashaField } from "@chitragupta/smriti";
import type { AkashaEvent } from "@chitragupta/smriti";

const akasha = new AkashaField();
akasha.setOnEvent((event: AkashaEvent) => {
  console.log(event.type, event.traceId, event.topic);
});
```

### Event Types

| `event.type` | Trigger | Description |
|---|---|---|
| `"trace:created"` | `leave()` | A new stigmergic trace was deposited |
| `"trace:reinforced"` | `reinforce()` | An existing trace was reinforced by another agent |

### WebSocket Forwarding

In serve mode, Akasha events are automatically broadcast to WebSocket clients:

```
ws.onmessage → { type: "akasha:trace:created", traceId: "aks-...", topic: "..." }
ws.onmessage → { type: "akasha:trace:reinforced", traceId: "aks-...", topic: "..." }
```

## 5. Marga Default Provider/Model Constants

**Package:** `@chitragupta/swara` | **File:** `marga-decide.ts`

Default fallback provider and model are now named exports:

```typescript
import {
  MARGA_DEFAULT_PROVIDER,  // "ollama"
  MARGA_DEFAULT_MODEL,     // "qwen3:8b"
} from "@chitragupta/swara";
```

Previously inline literals, these can now be imported by downstream consumers (e.g., Vaayu) for display, fallback logic, or configuration UI.

## LOC Compliance

| File | Before | After | Limit |
|------|--------|-------|-------|
| `peer-connection.ts` | 404 | 409 | 450 |
| `actor.ts` | 210 | 220 | 450 |
| `actor-system.ts` | 380 | 387 | 450 |
| `tantra/types.ts` | 151 | 186 | 450 |
| `mcp-tools-introspection.ts` | 346 | 360 | 450 |
| `akasha.ts` | 443 | 448 | 450 |
| `marga-decide.ts` | 351 | 356 | 450 |
| `main-serve-mode.ts` | 453 | 450 | 450 |
