# @chitragupta/tantra

![Logo](../../assets/logos/tantra.svg)

**तन्त्र (tantra) -- Technique / System**

**MCP (Model Context Protocol) server and client with JSON-RPC transport, stdio/SSE, server lifecycle management, circuit breakers, capability aggregation, auto-discovery, and Chitragupta tool bridging.**

Tantra implements the Model Context Protocol (MCP), enabling Chitragupta to both expose its tools as an MCP server and consume external MCP tool servers as a client. It includes a full JSON-RPC 2.0 implementation, two transport layers (stdio and SSE), and a bridge that converts between Chitragupta's native `ToolHandler` interface and the MCP tool format. The `AutonomousMcpManager` provides self-healing server management with circuit breakers, quarantine, and health-driven load balancing. This means any MCP-compatible tool ecosystem plugs directly into Chitragupta, and any Chitragupta tool can be served to external MCP clients.

---

## Key Features

- **MCP server** -- `McpServer` exposes tools, resources, and prompts over MCP protocol
- **MCP client** -- `McpClient` connects to and invokes tools from external MCP servers
- **JSON-RPC 2.0** -- Full request/response/notification support with standard error codes
- **Stdio transport** -- `StdioServerTransport` and `StdioClientTransport` for process-based communication
- **SSE transport** -- `SSEServerTransport` and `SSEClientTransport` for HTTP-based streaming
- **Tool bridge** -- `chitraguptaToolToMcp()` and `mcpToolToChitragupta()` for bidirectional conversion
- **Bulk operations** -- `exposeChitraguptaTools()` exposes all Chitragupta tools as MCP, `importMcpTools()` imports all MCP tools as Chitragupta handlers
- **Server registry** -- `McpServerRegistry` with CRUD, event system, and persistence
- **Server lifecycle** -- `ServerLifecycleManager` with strict state machine, health checks, and auto-restart with exponential backoff
- **Capability aggregation** -- `CapabilityAggregator` with namespaced tools, routing, and fuzzy search
- **Server discovery** -- `ServerDiscovery` from config, conventions, and npm packages with file watching
- **Autonomous management** -- `AutonomousMcpManager` with circuit breakers, quarantine, health scoring, auto-discovery, and load balancing

## Architecture

| Module | Purpose |
|--------|---------|
| `types.ts` | MCP protocol types, tool schemas, resource types |
| `jsonrpc.ts` | `createRequest()`, `createResponse()`, `createNotification()`, `parseMessage()`, error codes |
| `transport/stdio.ts` | `StdioServerTransport`, `StdioClientTransport` |
| `transport/sse.ts` | `SSEServerTransport`, `SSEClientTransport` |
| `server.ts` | `McpServer` -- MCP server implementation |
| `client.ts` | `McpClient` -- MCP client implementation |
| `bridge.ts` | `chitraguptaToolToMcp()`, `mcpToolToChitragupta()`, `exposeChitraguptaTools()`, `importMcpTools()` |
| `registry-types.ts` | `ServerState`, `McpRemoteServerConfig`, `ManagedServerInfo`, `ServerStats`, `RegistryEvent`, `VALID_TRANSITIONS` |
| `server-registry.ts` | `McpServerRegistry` interface, `createMcpServerRegistry()` factory, server CRUD, aggregation, persistence |
| `server-lifecycle.ts` | `ServerLifecycleManager` -- state machine enforcement, health checks, auto-restart with backoff |
| `capability-aggregator.ts` | `CapabilityAggregator` -- namespaced tool/resource merging, routing, fuzzy search |
| `server-discovery.ts` | `ServerDiscovery` -- config-based, convention-based, NPM-based discovery, file watching |
| `mcp-autonomous.ts` | `AutonomousMcpManager` -- circuit breakers, quarantine, health scoring, auto-discovery, load balancing |
| `mcp-errors.ts` | `McpError`, `McpNotFoundError`, `McpTimeoutError`, `McpProtocolError`, `McpServerCrashedError` |

## API

### MCP Server

```typescript
import { McpServer } from "@chitragupta/tantra";
import { StdioServerTransport } from "@chitragupta/tantra";

const server = new McpServer({
  name: "chitragupta-tools",
  version: "1.0.0",
});

// Register a tool
server.registerTool({
  name: "read-file",
  description: "Read a file from disk",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
    },
    required: ["path"],
  },
  handler: async (input) => {
    const content = await fs.readFile(input.path, "utf-8");
    return { content: [{ type: "text", text: content }] };
  },
});

// Start serving over stdio
const transport = new StdioServerTransport();
await server.connect(transport);
```

### MCP Client

```typescript
import { McpClient } from "@chitragupta/tantra";
import { StdioClientTransport } from "@chitragupta/tantra";

const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "@some/mcp-server"],
});

const client = new McpClient();
await client.connect(transport);

// List available tools
const tools = await client.listTools();

// Call a tool
const result = await client.callTool("search", {
  query: "TypeScript generics",
});
console.log(result.content);

await client.disconnect();
```

### SSE Transport

```typescript
import { McpServer, SSEServerTransport } from "@chitragupta/tantra";

const server = new McpServer({ name: "chitragupta", version: "1.0.0" });
const transport = new SSEServerTransport({ port: 3001 });
await server.connect(transport);

// Client connects over HTTP
import { McpClient, SSEClientTransport } from "@chitragupta/tantra";

const clientTransport = new SSEClientTransport({
  url: "http://localhost:3001",
});
const client = new McpClient();
await client.connect(clientTransport);
```

### Chitragupta Tool Bridge

```typescript
import {
  chitraguptaToolToMcp,
  mcpToolToChitragupta,
  exposeChitraguptaTools,
  importMcpTools,
} from "@chitragupta/tantra";
import { getAllTools } from "@chitragupta/yantra";

// Convert a single Chitragupta tool to MCP format
const mcpTool = chitraguptaToolToMcp(readTool);

// Convert an MCP tool to Chitragupta format
const chitraguptaTool = mcpToolToChitragupta(mcpToolDef, client);

// Bulk: expose all Chitragupta tools as MCP
const mcpTools = exposeChitraguptaTools(getAllTools());

// Bulk: import all tools from an MCP server as Chitragupta handlers
const importedTools = await importMcpTools(client);
```

### Pluggable MCP Server Registry

```typescript
import { createMcpServerRegistry } from "@chitragupta/tantra";

const registry = createMcpServerRegistry();

// Add a server (auto-starts by default)
await registry.addServer({
	id: "filesystem",
	name: "filesystem",
	transport: "stdio",
	command: "mcp-filesystem-server",
	args: ["/workspace"],
	autoRestart: true,
	maxRestarts: 5,
	health: { interval: 30000, timeout: 5000, maxFailures: 3, restartDelay: 1000 },
	tags: ["io", "filesystem"],
});

// Subscribe to events
const unsubscribe = registry.onEvent((event) => {
	if (event.type === "server:state-changed") {
		console.log(`${event.serverId}: ${event.from} -> ${event.to}`);
	}
});

// List only ready servers
const ready = registry.listServers({ states: ["ready"] });

// Fuzzy-search for tools across all servers
const matches = registry.findTools("read file", 5);

// Persist and restore configuration
await registry.saveConfig("./mcp-servers.json");
await registry.loadConfig("./mcp-servers.json", true);

// Cleanup
unsubscribe();
await registry.dispose();
```

### Server Lifecycle Manager

**State machine:**
```
idle -> starting -> ready -> stopping -> stopped
                     |                    ^
                   error -> restarting -> starting
                     |
                   stopping -> stopped -> idle (re-register)
```

```typescript
import { ServerLifecycleManager } from "@chitragupta/tantra";

const lifecycle = new ServerLifecycleManager();

lifecycle.onStateChange((serverId, from, to, info) => {
	console.log(`[${serverId}] ${from} -> ${to}`);
});

lifecycle.onToolsChanged((serverId, info) => {
	console.log(`[${serverId}] now has ${info.tools.length} tools`);
});

const info = await lifecycle.start({
	id: "git",
	name: "git",
	transport: "stdio",
	command: "mcp-git-server",
	autoRestart: true,
	maxRestarts: 3,
});
```

### Capability Aggregator

```typescript
import { CapabilityAggregator } from "@chitragupta/tantra";

const agg = new CapabilityAggregator();

agg.addServer("fs-1", "filesystem", [
	{ name: "read_file", description: "Read a file", inputSchema: {} },
	{ name: "write_file", description: "Write a file", inputSchema: {} },
]);

// Get all tools (namespaced)
const tools = agg.getAllTools();
// -> filesystem.read_file, filesystem.write_file

// Fuzzy search
const results = agg.findTools("read", 5);
```

### Autonomous MCP Manager

**Circuit breaker pattern:**
```
Closed -> Open:       failureCount exceeds threshold
Open -> Half-Open:    after cooldown period
Half-Open -> Closed:  on successful probe
Half-Open -> Open:    on failed probe
```

```typescript
import { createMcpServerRegistry, AutonomousMcpManager } from "@chitragupta/tantra";

const registry = createMcpServerRegistry();
const manager = new AutonomousMcpManager(registry);

manager.start({
	discoveryDirectories: [".chitragupta/mcp"],
	discoveryIntervalMs: 30_000,
	healthThreshold: 0.6,
	quarantineMaxCrashes: 3,
	quarantineDurationMs: 600_000,
	circuitBreakerFailureThreshold: 5,
});

// Check system health
const report = manager.getHealthReport();
console.log(`Overall health: ${report.overallHealth}`);
console.log(`Quarantined: ${report.quarantinedCount}`);

manager.stop();
await registry.dispose();
```

---

[Back to Chitragupta root](../../README.md)
