# @chitragupta/hub

![Logo](assets/logo.svg)

**Preact SPA dashboard for the Chitragupta AI agent platform.**

Real-time session monitoring, budget tracking, cognitive system visualization, and device pairing — served from the CLI's built-in HTTP server.

## Features

- **15 pages**: Overview, Sessions, Models, Providers, Memory, Skills, Settings, Devices, Consciousness, Intelligence, Collaboration, Evolution, Agents, Workflows, Daemon
- **Preact + Signals**: Reactive state with `@preact/signals`, client-side routing via `preact-router`
- **Design tokens**: CSS custom properties in `tokens.css` — themeable without JS
- **WebSocket**: Live session updates, agent heartbeat streaming
- **Device pairing**: QR code + PIN pairing flow for cross-device sync

## Installation

This is a **private** package (not published to npm). It's built and served by `@chitragupta/cli`.

```bash
cd packages/hub
pnpm install
pnpm dev     # Vite dev server
pnpm build   # Production build to dist/
```

## Architecture

```
hub/
  src/
    pages/         # 15 page components
    components/    # Shared UI components
    signals/       # Preact signals (auth, budget, session state)
    styles/        # tokens.css design system
    api.ts         # Backend API client
    main.tsx       # Entry point + router
```

## License

MIT
