# @chitragupta/ui

![Logo](../../assets/logos/ui.svg)

**चित्रगुप्त दृश्य (Chitragupta Drishya) -- Terminal UI**

**Full terminal rendering stack for Chitragupta: ANSI escape sequences, keyboard input, theming with the Nakshatram palette, and a library of rich components -- from Markdown renderers and diff viewers to ECG-style agent heartbeat monitors.**

The `@chitragupta/ui` package is the visual layer of the Chitragupta ecosystem. Everything is built on raw ANSI escape sequences with zero heavy dependencies. The Nakshatram theme provides a distinctive star-chart color palette, and the iconic **chi** prompt renders the Devanagari character at the command line as the CLI's visual identity.

---

## Key Features

- **ANSI utilities** -- Colors (fg, bg, RGB), styles (bold, dim, italic, underline, strikethrough), cursor control, screen management
- **Key handling** -- Parse raw keypresses into structured `KeyEvent` objects with modifier detection
- **Input handler** -- Line editing with history, completions, and key bindings
- **Screen management** -- `Screen` class for buffered rendering with alternate screen support
- **Nakshatram theming** -- `DEFAULT_THEME` (Nakshatram star-chart palette), `MINIMAL_THEME`, custom theme registration, `hexToAnsi()` conversion
- **Rich components** -- Spinner, Markdown renderer, Editor, SelectList, StatusBar, MessageList, Overlay, SessionTree, DiffViewer, Toast, ProgressBar, Breadcrumb
- **HeartbeatMonitor** -- ECG-style ASCII waveform visualization of agent tree vitals with blinking dead agents and token budget bars
- **Chitragupta prompt** -- The iconic **chi** prompt renders as the CLI's visual identity

## Architecture

| Module | Purpose |
|--------|---------|
| `ansi.ts` | Color, style, cursor, and screen ANSI escape sequences |
| `keys.ts` | `parseKeypress()`, `matchKey()`, `KeyEvent` type |
| `input.ts` | `InputHandler` -- line editor with history and completions |
| `screen.ts` | `Screen` -- buffered terminal rendering |
| `theme.ts` | `Theme` type, Nakshatram palette, `registerTheme()`, `hexToAnsi()` |
| `components/` | All UI components (see below) |

### Components

| Component | Purpose |
|-----------|---------|
| `Spinner` | Animated loading spinner |
| `renderMarkdown` | Render Markdown to ANSI-styled terminal output |
| `Editor` | Multi-line editor with autocomplete via `CompletionProvider` |
| `SelectList` | Interactive selection list |
| `StatusBar` | Bottom status bar with sections and provider health |
| `MessageList` | Scrollable message display with metadata |
| `Overlay` | Modal overlay system |
| `SessionTree` | Tree view for session branching |
| `renderDiff` / `renderUnifiedDiff` | Side-by-side and unified diff rendering |
| `ToastManager` | Temporary notification toasts |
| `ProgressBar` / `MultiProgress` | Single and multi-bar progress display |
| `Breadcrumb` | Navigation breadcrumb trail |
| `HeartbeatMonitor` | ECG-style ASCII waveform visualization for agent tree vitals |

## API

### ANSI Colors and Styles

```typescript
import {
  bold,
  red,
  green,
  cyan,
  rgb,
  dim,
  stripAnsi,
} from "@chitragupta/ui";

console.log(bold(red("Error: ")) + "Something went wrong");
console.log(green("Success!"));
console.log(rgb(255, 165, 0, "Orange text"));
console.log(dim("Subtle information"));

const plain = stripAnsi(colored); // Strip all ANSI codes
```

### Keyboard Input

```typescript
import { parseKeypress, matchKey } from "@chitragupta/ui";
import type { KeyEvent } from "@chitragupta/ui";

process.stdin.on("data", (data) => {
  const key: KeyEvent = parseKeypress(data);

  if (matchKey(key, { name: "c", ctrl: true })) {
    process.exit(0);
  }

  if (key.name === "return") {
    // Handle enter
  }
});
```

### Screen

```typescript
import { Screen } from "@chitragupta/ui";

const screen = new Screen();
screen.enterAlternateScreen();

screen.write(0, 0, "Hello, Chitragupta!");
screen.flush();

screen.exitAlternateScreen();
```

### Theming

The default Nakshatram theme provides a star-chart color palette -- deep indigo backgrounds with warm amber accents, designed for long coding sessions.

```typescript
import {
  DEFAULT_THEME,
  registerTheme,
  getTheme,
  hexToAnsi,
} from "@chitragupta/ui";
import type { Theme } from "@chitragupta/ui";

const myTheme: Theme = {
  ...DEFAULT_THEME,
  primary: hexToAnsi("#FF6B35"),
  secondary: hexToAnsi("#4ECDC4"),
};

registerTheme("custom", myTheme);
const theme = getTheme("custom");
```

### Components

```typescript
import { Spinner, renderMarkdown, ProgressBar } from "@chitragupta/ui";

// Spinner
const spinner = new Spinner("Loading...");
spinner.start();
// ... work ...
spinner.stop("Done!");

// Markdown rendering
const output = renderMarkdown("# Hello\n\nThis is **bold** text.");
console.log(output);

// Progress bar
const bar = new ProgressBar({ total: 100, width: 40 });
bar.update(50); // 50%
bar.finish();
```

### Diff Viewer

```typescript
import { renderDiff, renderUnifiedDiff } from "@chitragupta/ui";
import type { DiffOptions } from "@chitragupta/ui";

const diff = renderUnifiedDiff(oldText, newText, {
  contextLines: 3,
  colorize: true,
});
console.log(diff);
```

### Toast Notifications

```typescript
import { ToastManager } from "@chitragupta/ui";

const toasts = new ToastManager();
toasts.show({ message: "File saved!", type: "success", duration: 3000 });
toasts.show({ message: "Warning: large file", type: "warning" });
```

### Heartbeat Monitor (ECG)

The `HeartbeatMonitor` renders an ECG-style ASCII waveform visualization of agent tree vitals in the terminal. Each agent gets its own line with a tree-indented label, a live-scrolling PQRST waveform, status icon, beat age, and token budget progress bar. Dead agents blink. The whole thing looks like you are monitoring the vital signs of your agent swarm.

#### Status Icons

| Icon | Status | Meaning |
|------|--------|---------|
| `♥` | alive | Agent is healthy and sending heartbeats |
| `♡` | stale | Agent hasn't sent a heartbeat recently |
| `✕` | dead / killed | Agent is dead or was force-killed |
| `✓` | completed | Agent finished its task normally |
| `☠` | error | Agent crashed or encountered a fatal error |

#### PQRST Waveform

The ECG trace is rendered using Unicode box-drawing characters that approximate the characteristic P-wave dip, QRS spike, and T-wave of a real ECG trace:

```
─ ─ ╮ ╰ ─ ╯ ╭ ╮ ╰ ╯ ─ ─ ─ ╮ ╰ ─ ╯ ╭ ╮ ╰ ╯ ─ ─ ─ ╮ ╰ ─ ╯
```

- **Alive agents** -- Regular heartbeat rhythm with short gaps between beats
- **Stale agents** -- Longer gaps between beats (looks weak / fading)
- **Error agents** -- Erratic short spikes with tight spacing
- **Dead / killed / completed** -- Flat-line (`───────────`)

#### Tree Rendering

Agent hierarchy is displayed using tree-drawing characters:

```
  root-001 [Main conversation]   ─╮╰─╯╭╮╰╯───╮╰─╯╭╮╰╯ │ ♥ 0.2s ago │ ████████ 12k/200k
  ├─ child-001 [Analyze tests]  ─╮╰─╯╭╮╰╯───╮╰─╯╭╮╰╯ │ ♥ 1.3s ago │ ██████░░ 98k/140k
  │  └─ grand-01 [Run suite]    ─╮╰─╯╭╮╰╯───╮╰─╯╭╮╰╯ │ ♡ 28s ago  │ ███░░░░░ 30k/98k
  └─ child-002 [Write docs]     ───────────────────── │ ✓ 45s ago  │ ██████░░ 85k/140k
```

#### Token Budget Progress Bars

Each agent line includes a progress bar showing token usage vs budget. The bar color changes based on utilization:
- **Green** -- Under 60% usage
- **Yellow** -- 60-80% usage
- **Red** -- Over 80% usage

#### Blinking Effect

When `blinkDead` is enabled (default), dead and killed agents alternate between normal and dimmed rendering on each animation frame, creating a visual blinking effect.

#### Code Example

```typescript
import { HeartbeatMonitor } from "@chitragupta/ui";
import type { HeartbeatEntry, HeartbeatMonitorConfig } from "@chitragupta/ui";

// Create with custom configuration
const monitor = new HeartbeatMonitor({
	width: 30,           // Waveform width in characters
	showTree: true,      // Show tree hierarchy indentation
	showBudget: true,    // Show token budget bar
	blinkDead: true,     // Blink dead/killed agents
	refreshInterval: 500, // Auto-refresh interval (ms)
});

// Update the agent list (call whenever heartbeats change)
const agents: HeartbeatEntry[] = [
	{
		agentId: "root-001",
		status: "alive",
		depth: 0,
		purpose: "Main conversation",
		lastBeatAge: 200,
		tokenUsage: 12_000,
		tokenBudget: 200_000,
	},
	{
		agentId: "child-001",
		status: "stale",
		depth: 1,
		purpose: "Analyze test suite",
		lastBeatAge: 28_000,
		tokenUsage: 30_000,
		tokenBudget: 140_000,
	},
];
monitor.update(agents);

// Start auto-refresh (advances animation frame at refreshInterval)
monitor.start();

// Render the full multi-line ECG display
const output = monitor.render();
console.log(output);

// Or render a compact single-line summary:
// ♥ 1/2 alive │ ♡ 1 stale
const compact = monitor.renderCompact();
console.log(compact);

// Manually advance one animation frame (if driving your own loop)
monitor.tick();

// Stop auto-refresh
monitor.stop();
```

---

[Back to Chitragupta root](../../README.md)
