# @chitragupta/core

![Logo](../../assets/logos/core.svg)

**Foundation (आधार -- Adhara)**

**Foundation types, plugin system, event bus, cascading configuration, runtime validation, authentication (Kavach), and observability (Drishti) for the Chitragupta monorepo.**

`@chitragupta/core` is the bedrock layer that every other Chitragupta package depends on. It defines the shared type system, the plugin registry, the event bus for cross-package communication, cascading configuration that merges four scope levels, runtime validation without external dependencies, a zero-dependency auth stack (JWT, RBAC, OAuth, multi-tenant), and a full observability suite (structured logging, distributed tracing, Prometheus metrics, health checks).

---

## Key Features

- **Plugin system** -- Register, unregister, and query plugins by type (provider, tool, command, theme, agent-profile)
- **Event bus** -- Typed publish/subscribe with `on`, `off`, `once`, `emit`, and `removeAll`
- **Cascading configuration** -- Four config layers (global, workspace, project, session) merged with `cascadeConfigs`
- **Agent profiles** -- 9 built-in personality profiles (3 general + 6 Agent Garage specialists) with custom profile support
- **Foundation types** -- `TokenUsage`, `CostBreakdown`, `StopReason`, `Position`, `Range`, `ToolHandler`, `ToolContext`, `ToolResult`, `ToolDefinition`, and more
- **Error hierarchy** -- Structured error types (`ChitraguptaError` base class) for consistent error handling
- **Runtime validation (Niyama)** -- Fluent validation builder (`v.string().min(1)`, `v.number().range(0, 1)`, `v.object({...})`) with zero external dependencies
- **Authentication (Kavach)** -- JWT signing/verification, RBAC engine (16 permissions, 4 built-in roles), OAuth (Google/Apple/GitHub), multi-tenant isolation, HTTP/WebSocket middleware
- **Observability (Drishti)** -- Structured logger with transports, distributed tracing via AsyncLocalStorage, Prometheus-compatible metrics (Counter, Gauge, Histogram), and health checks (memory, event loop, disk)

## Architecture

```
@chitragupta/core
├── types.ts              Foundation interfaces & type system
├── errors.ts             ChitraguptaError hierarchy
├── events.ts             createEventBus() — typed pub/sub
├── plugin.ts             createPluginRegistry() — plugin lifecycle
├── config.ts             Cascading configuration & settings I/O
├── agent-profile.ts      9 built-in profiles + resolveProfile()
├── validation.ts         Niyama — fluent runtime validation
├── auth/                 Kavach — authentication & authorization
│   ├── jwt.ts            HMAC-SHA256 JWT (sign, verify, decode, refresh)
│   ├── rbac.ts           RBACEngine — 16 permissions, 4 roles
│   ├── oauth.ts          Google/Apple/GitHub token verification
│   ├── tenant.ts         Multi-tenant context & store
│   ├── middleware.ts      authenticateRequest, authorizeRoute
│   └── token-exchange.ts  Token exchange & refresh endpoints
└── observability/        Drishti — observability stack
    ├── logger.ts         Logger + Console/JSON/File transports
    ├── tracing.ts        Distributed tracing (Tracer, Span, SpanEvent)
    ├── metrics.ts        Counter, Gauge, Histogram, MetricsRegistry
    └── health.ts         HealthChecker + Memory/EventLoop/Disk checks
```

## API

### Event Bus

```typescript
import { createEventBus } from "@chitragupta/core";

const bus = createEventBus();

bus.on<{ file: string }>("file:saved", (data) => {
  console.log(`Saved ${data.file}`);
});

bus.emit("file:saved", { file: "README.md" });

// One-time listener
bus.once("shutdown", () => {
  console.log("Goodbye");
});
```

### Plugin Registry

```typescript
import { createPluginRegistry } from "@chitragupta/core";
import type { Plugin, ChitraguptaAPI } from "@chitragupta/core";

const registry = createPluginRegistry();

const myPlugin: Plugin = {
  name: "my-tool",
  version: "1.0.0",
  type: "tool",
  description: "A custom tool",
  init(api: ChitraguptaAPI) {
    // Register tool with the system
  },
};

registry.register(myPlugin);

const allTools = registry.getAll("tool");
const found = registry.get("my-tool");
```

### Configuration

```typescript
import {
  createConfig,
  cascadeConfigs,
  loadGlobalSettings,
  saveGlobalSettings,
  getChitraguptaHome,
} from "@chitragupta/core";

// Create a config layer
const projectConfig = createConfig("project");
projectConfig.set("defaultModel", "claude-sonnet-4-5-20250929");

// Cascade multiple layers (later layers override earlier)
const merged = cascadeConfigs(globalConfig, workspaceConfig, projectConfig);

// Persistent settings
const settings = await loadGlobalSettings();
settings.defaultProvider = "anthropic";
await saveGlobalSettings(settings);
```

### Runtime Validation (Niyama)

Zero-dependency fluent validation for configuration and API inputs.

```typescript
import { v, validate, assertValid } from "@chitragupta/core";

// Define a schema
const schema = v.object({
  name: v.string().min(1).max(100),
  port: v.number().integer().range(1, 65535),
  tags: v.array(v.string()),
  enabled: v.boolean(),
});

// Validate (returns errors)
const result = validate(schema, input);
if (!result.valid) {
  console.error(result.errors);
}

// Assert (throws on invalid)
assertValid(schema, input);
```

### Authentication -- Kavach (Shield)

Zero-dependency auth stack: JWT, RBAC, OAuth, multi-tenant, middleware.

```typescript
import {
  signJWT,
  verifyJWT,
  RBACEngine,
  BUILT_IN_ROLES,
  authenticateRequest,
  authorizeRoute,
  verifyGoogleToken,
  InMemoryTenantStore,
  handleTokenExchange,
} from "@chitragupta/core";

// JWT — HMAC-SHA256
const token = await signJWT(
  { sub: "user-1", role: "admin" },
  { secret: "my-secret", expiresIn: "24h" },
);
const payload = await verifyJWT(token, { secret: "my-secret" });

// RBAC — 16 permissions across 4 built-in roles
const rbac = new RBACEngine();
rbac.can("admin", "memory:write");     // true
rbac.can("viewer", "memory:write");    // false
rbac.can("operator", "agent:execute"); // true

// OAuth — verify third-party tokens
const claims = await verifyGoogleToken(idToken, { clientId: "..." });

// Middleware — HTTP request authentication & route authorization
const authCtx = await authenticateRequest(request, jwtConfig);
const allowed = authorizeRoute(authCtx, "POST", "/api/sessions");
```

### Observability -- Drishti (Vision)

Structured logging, distributed tracing, Prometheus metrics, and health checks.

```typescript
import {
  createLogger,
  configureLogging,
  Tracer,
  getTracer,
  Counter,
  Histogram,
  getMetricsRegistry,
  HealthChecker,
  MemoryHealthCheck,
} from "@chitragupta/core";

// Logger — structured, multi-transport
const log = createLogger("my-module");
log.info("Server started", { port: 8080 });
log.error("Failed to connect", { error });
configureLogging({ level: "debug", transports: ["console", "json"] });

// Tracing — AsyncLocalStorage-based distributed traces
const tracer = getTracer();
const span = tracer.startSpan("process-request");
span.addEvent("query-started");
span.end();

// Metrics — Prometheus-compatible
const requestCount = new Counter("http_requests_total", "Total HTTP requests");
requestCount.inc({ method: "GET", status: "200" });
const latency = new Histogram("request_duration_ms", "Request latency", [10, 50, 100, 500]);
latency.observe(42);

// Health — composable health checks
const checker = new HealthChecker();
checker.register(new MemoryHealthCheck({ maxHeapPercent: 90 }));
const report = await checker.check(); // { status: "healthy", checks: [...] }
```

### Agent Profiles

Chitragupta ships with **9 built-in agent profiles** -- 3 general-purpose and 6 specialist agents (the Agent Garage):

| Profile | ID | Voice | Purpose |
|---------|-----|-------|---------|
| `CHITRAGUPTA_PROFILE` | `chitragupta` | bold | Default -- opinionated, full-stack engineer |
| `MINIMAL_PROFILE` | `minimal` | minimal | Terse, no personality, just answers |
| `FRIENDLY_PROFILE` | `friendly` | friendly | Warm, encouraging, helpful guide |
| `KARTRU_PROFILE` | `kartru` | bold | Coding Agent -- convention-aware, self-validating |
| `PARIKSHAKA_PROFILE` | `parikshaka` | precise | Code Reviewer -- read-only, structured issue reporting |
| `ANVESHI_PROFILE` | `anveshi` | analytical | Debugger -- 5-step systematic investigation |
| `SHODHAKA_PROFILE` | `shodhaka` | scholarly | Researcher -- architecture overview, pattern finding |
| `PARIKARTRU_PROFILE` | `parikartru` | methodical | Refactorer -- plan-before-execute, validation loop |
| `LEKHAKA_PROFILE` | `lekhaka` | clear | Documenter -- README, JSDoc, changelog generation |

```typescript
import {
  CHITRAGUPTA_PROFILE,
  KARTRU_PROFILE,
  BUILT_IN_PROFILES,
  resolveProfile,
} from "@chitragupta/core";

// Use the default profile
const profile = resolveProfile("chitragupta"); // CHITRAGUPTA_PROFILE
console.log(profile.name);        // "Chitragupta"
console.log(profile.voice);       // "bold"

// Use a specialist agent profile
const coder = resolveProfile("kartru"); // KARTRU_PROFILE
console.log(coder.name);          // "Kartru"
console.log(coder.expertise);     // ["typescript", "code-generation", ...]

// All 9 profiles are in BUILT_IN_PROFILES
console.log(Object.keys(BUILT_IN_PROFILES)); // ["chitragupta", "minimal", "friendly", "kartru", ...]
```

## Test Coverage

| Module | Tests |
|--------|-------|
| Core types & config | 15 test files |
| Auth (Kavach) | 102 tests |
| Observability (Drishti) | 93 tests |
| **Total** | 15 test files, 0 failures |

---

[Back to Chitragupta root](../../README.md)
