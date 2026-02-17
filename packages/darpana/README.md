# @chitragupta/darpana

![Logo](../../assets/logos/darpana.svg)

**Darpana** (दर्पण = mirror) — high-performance LLM API proxy that mirrors the Anthropic Messages API to any LLM provider.

Use Claude Code, Cursor, or any Anthropic-compatible client with **any model** — OpenAI, Gemini, Groq, DeepSeek, Ollama, LM Studio, vLLM, or any OpenAI-compatible endpoint.

## Why Darpana?

- **Zero-config** — auto-detects credentials from Claude Code, Codex CLI, env vars, and Ollama
- **No API keys needed** — reuses OAuth tokens from CLIs you already have, or uses local Ollama
- **<5ms overhead** — raw `node:http`, keep-alive connection pools, zero-copy stream piping
- **Any provider in one config line** — if it speaks OpenAI-compatible, it works
- **Full streaming support** — SSE chunks transformed on-the-fly, never buffered
- **Claude model alias mapping** — `claude-sonnet-4-20250514` → your model of choice

## Quick Start

### Zero-Config (just run it)

If you have **Claude Code** or **Codex CLI** installed, Darpana reads their stored OAuth tokens automatically. No API keys to copy, no config file to write:

```bash
pnpm proxy

# Output:
#   darpana (दर्पण)  LLM API Proxy
#   Listening on  http://127.0.0.1:8082
#
#   Credentials:
#     Anthropic ← Claude Code OAuth (~/.claude/.credentials.json)
#     OpenAI    ← Codex CLI OAuth (~/.codex/auth.json)
#     Ollama    ← ollama CLI installed
```

Then point any Anthropic-compatible client at it:

```bash
ANTHROPIC_BASE_URL=http://localhost:8082 claude
```

### With Local LLMs (no API keys, no CLIs)

```bash
# Start Ollama (if not already running)
ollama serve

# Start proxy — auto-detects Ollama at localhost:11434
pnpm proxy

# Use with Claude Code
ANTHROPIC_BASE_URL=http://localhost:8082 claude
```

That's it. No API keys, no config file, no setup.

### With Explicit API Keys

```bash
# Set any API key(s) you have (overrides CLI credentials)
# export your OpenAI / Gemini / Groq keys:
export OPENAI_API_KEY    # set to your OpenAI key
export GEMINI_API_KEY    # set to your Gemini key
export GROQ_API_KEY      # set to your Groq key

# Start proxy — auto-detects all providers from env
pnpm proxy

# Use with Claude Code
ANTHROPIC_BASE_URL=http://localhost:8082 claude
```

### With a Config File

Create `darpana.json` in your project root:

```json
{
  "port": 8082,
  "providers": {
    "ollama": {
      "type": "openai-compat",
      "endpoint": "http://localhost:11434/v1",
      "models": {}
    },
    "openai": {
      "type": "openai-compat",
      "endpoint": "https://api.openai.com/v1",
      "apiKey": "${OPENAI_API_KEY}",
      "models": {
        "gpt-4.1": {},
        "gpt-4.1-mini": {},
        "o3-mini": {}
      }
    },
    "gemini": {
      "type": "google",
      "apiKey": "${GEMINI_API_KEY}",
      "models": {
        "gemini-2.5-pro": {},
        "gemini-2.5-flash": {}
      }
    }
  },
  "aliases": {
    "opus": "openai/o3-mini",
    "sonnet": "openai/gpt-4.1",
    "haiku": "ollama/llama3"
  }
}
```

Values like `${OPENAI_API_KEY}` are interpolated from environment variables at startup.

## How It Works

```
Claude Code / Cursor / any Anthropic client
        │
        │  POST /v1/messages (Anthropic format)
        ▼
   ┌─────────┐
   │ Darpana  │  ← <5ms: parse → route → convert → forward
   └────┬─────┘
        │
   ┌────┴──────────────────────────────┐
   │         │         │               │
   ▼         ▼         ▼               ▼
 OpenAI   Gemini    Ollama    Any OpenAI-compat
(cloud)   (cloud)   (local)      endpoint
```

Darpana accepts Anthropic-format requests and converts them to the target provider's format:

| Converter | Providers |
|-----------|-----------|
| **openai-compat** | OpenAI, Groq, DeepSeek, Mistral, Together, OpenRouter, Ollama, vLLM, LM Studio, llama.cpp, any OpenAI-compatible server |
| **google** | Gemini (AI Studio + Vertex AI) |
| **passthrough** | Anthropic itself (useful for logging/auth wrapping) |

Adding a new OpenAI-compatible provider is literally one config entry — no code changes.

## Credential Auto-Detection

Darpana detects credentials in this priority order:

| Priority | Source | What it provides |
|----------|--------|-----------------|
| 1 | **Config file** (`darpana.json`) | Full control over all providers |
| 2 | **Environment variables** (`OPENAI_API_KEY`, etc.) | Explicit API keys |
| 3 | **Claude Code OAuth** (`~/.claude/.credentials.json`) | Anthropic API access via stored OAuth token |
| 4 | **Codex CLI OAuth** (`~/.codex/auth.json`) | OpenAI API access via stored OAuth token |
| 5 | **Ollama** (localhost:11434) | Always available as wildcard fallback |

### How CLI detection works

**Claude Code** (`claude`): When you authenticate with `claude`, it stores an OAuth access token at `~/.claude/.credentials.json`. Darpana reads this token and uses it as the Anthropic API key — giving you passthrough access to Claude models without setting `ANTHROPIC_API_KEY`.

**Codex CLI** (`codex`): When you authenticate with `codex`, it stores OAuth tokens at `~/.codex/auth.json`. Darpana reads this and uses it to access OpenAI models without setting `OPENAI_API_KEY`. It also reads your preferred model from `~/.codex/config.toml`.

**Ollama**: Always added as a fallback provider. No authentication needed — it's a local server. If no cloud credentials are found at all, Ollama becomes the primary provider.

### What this means

If you have **Claude Code installed and logged in** — you already have Anthropic access. No keys to copy.

If you have **Codex CLI installed and logged in** — you already have OpenAI access. No keys to copy.

If you have **neither** — Ollama works locally with no keys at all.

```bash
# This just works if you have claude or codex installed:
pnpm proxy
ANTHROPIC_BASE_URL=http://localhost:8082 claude
```

## CLI Options

```bash
darpana [options]

Options:
  --port <number>      Port to listen on (default: 8082, env: DARPANA_PORT)
  --host <string>      Host to bind to (default: 127.0.0.1, env: DARPANA_HOST)
  --config <path>      Path to config file (default: ./darpana.json)
  --big-model <spec>   Override opus + sonnet alias (e.g. "openai/o3-mini")
  --small-model <spec> Override haiku alias (e.g. "ollama/llama3")
```

### Examples

```bash
# Use Ollama for everything, no keys
pnpm proxy

# Use a specific Ollama model for all Claude models
pnpm proxy --big-model "local/deepseek-r1:70b" --small-model "local/llama3"

# Custom port
pnpm proxy --port 9000

# Point to remote Ollama
OLLAMA_HOST=http://192.168.1.100:11434 pnpm proxy

# Point to LM Studio
pnpm proxy --config lmstudio.json

# Use with a config file
pnpm proxy --config ./my-providers.json
```

## Local LLM Servers (No Keys Required)

### Ollama

```bash
# Install: https://ollama.com
ollama pull llama3
ollama serve   # starts on :11434

pnpm proxy     # auto-detects Ollama
```

### LM Studio

```bash
# Start LM Studio's local server (usually on :1234)
# Then create a config:
echo '{
  "providers": {
    "lmstudio": {
      "type": "openai-compat",
      "endpoint": "http://localhost:1234/v1",
      "models": {}
    }
  },
  "aliases": { "sonnet": "lmstudio/your-model-name", "haiku": "lmstudio/your-model-name" }
}' > darpana.json

pnpm proxy
```

### vLLM

```bash
# Start vLLM server
python -m vllm.entrypoints.openai.api_server --model meta-llama/Llama-3-8b

echo '{
  "providers": {
    "vllm": {
      "type": "openai-compat",
      "endpoint": "http://localhost:8000/v1",
      "models": {}
    }
  },
  "aliases": { "sonnet": "vllm/meta-llama/Llama-3-8b" }
}' > darpana.json

pnpm proxy
```

### llama.cpp

```bash
# Start llama.cpp server (OpenAI-compatible mode)
./llama-server -m model.gguf --port 8080

echo '{
  "providers": {
    "llamacpp": {
      "type": "openai-compat",
      "endpoint": "http://localhost:8080/v1",
      "models": {}
    }
  },
  "aliases": { "sonnet": "llamacpp/model" }
}' > darpana.json

pnpm proxy
```

## Model Aliases

Darpana maps Claude model names to your configured models. When Claude Code asks for `claude-sonnet-4-20250514`, the router:

1. Strips the `anthropic/` prefix (if present)
2. Checks exact alias match (`sonnet` → configured target)
3. Checks fuzzy match (model name contains `sonnet` → alias target)
4. Checks explicit `provider/model` syntax
5. Searches all providers for a matching model name
6. Falls back to the first wildcard provider (empty models map)

This means **any Claude model name** automatically routes through your aliases — no client-side configuration needed.

## Provider Config Reference

```typescript
interface ProviderConfig {
  type: "openai-compat" | "google" | "passthrough";
  endpoint?: string;          // Base URL (not needed for google/passthrough)
  apiKey?: string;            // API key (not needed for local servers)
  models?: Record<string, {
    upstreamName?: string;    // Override the model name sent upstream
    maxTokensCap?: number;    // Cap max_tokens for this model
  }>;
  headers?: Record<string, string>;  // Extra headers
  timeout?: number;           // Request timeout in ms (default: 120000)
  maxRetries?: number;        // Retry count on 429/5xx (default: 1)
}
```

**Empty `models` map** means the provider accepts any model name (wildcard) — perfect for Ollama and other local servers where you don't want to enumerate models.

## Auth

Optional API key protection for the proxy itself:

```json
{
  "auth": {
    "apiKey": "my-secret-proxy-key"
  }
}
```

Clients must then send `x-api-key: my-secret-proxy-key` or `Authorization: Bearer my-secret-proxy-key`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DARPANA_PORT` | Override listen port |
| `DARPANA_HOST` | Override listen host |
| `DARPANA_CONFIG` | Path to config file |
| `OLLAMA_HOST` | Ollama server URL (default: `http://localhost:11434`) |
| `OPENAI_API_KEY` | Auto-configures OpenAI provider |
| `GEMINI_API_KEY` | Auto-configures Gemini provider |
| `GROQ_API_KEY` | Auto-configures Groq provider |
| `DEEPSEEK_API_KEY` | Auto-configures DeepSeek provider |
| `TOGETHER_API_KEY` | Auto-configures Together AI provider |
| `OPENROUTER_API_KEY` | Auto-configures OpenRouter provider |
| `ANTHROPIC_API_KEY` | Auto-configures Anthropic passthrough |

When **no config file is found**, Darpana auto-detects providers from these env vars. If **no cloud keys are set**, it defaults to Ollama on localhost.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/messages` | Main proxy endpoint (streaming + non-streaming) |
| `POST` | `/v1/messages/count_tokens` | Token counting (passthrough) |
| `GET` | `/` | Health check — lists providers, aliases, status |

## Architecture

```
packages/darpana/
├── src/
│   ├── index.ts              # Public API exports
│   ├── types.ts              # Anthropic/OpenAI/Gemini API types + config types
│   ├── config.ts             # Config loader (JSON file + env auto-detect)
│   ├── router.ts             # Model → provider resolution + alias matching
│   ├── server.ts             # Raw node:http server (~200 lines)
│   ├── stream.ts             # SSE stream transformer (on-the-fly conversion)
│   ├── upstream.ts           # HTTP client with keep-alive pools + retry
│   ├── converters/
│   │   ├── openai.ts         # Anthropic ↔ OpenAI format
│   │   ├── google.ts         # Anthropic ↔ Gemini format
│   │   └── passthrough.ts    # Anthropic → Anthropic (forward as-is)
│   └── bin/
│       └── darpana.ts        # CLI entry point
└── test/                     # 66 tests (vitest)
```

### Performance: Why <5ms

The proxy does 3 things on the hot path:

1. **Parse incoming JSON** (~0.5ms for 10KB)
2. **Map model + transform fields** (~0.1ms)
3. **Serialize outgoing JSON** (~0.3ms)

Everything else is I/O wait. We achieve this with:

- Raw `node:http` — no framework middleware chain
- `http.Agent` with `keepAlive: true` — no TCP handshake per request
- Stream piping for SSE — transform chunks on-the-fly, never buffer
- No sync logging on hot path

## Part of Chitragupta

Darpana is the `@chitragupta/darpana` package in the [Chitragupta](https://github.com/sriinnu/chitragupta) monorepo — an autonomous AI agent platform with GraphRAG memory, self-evolving skills, and multi-provider support.
