#!/usr/bin/env node
/**
 * Chitragupta System Tray App.
 *
 * Minimal Node.js system tray/notification app that polls the Chitragupta
 * daemon HTTP endpoint and shows live session status.
 *
 * Works on Windows (balloon notifications), macOS (Notification Center),
 * and Linux (notify-send). No native dependencies — pure Node.js.
 *
 * Usage:
 *   node index.js                    # Start tray polling
 *   node index.js --port 3690        # Custom daemon port
 *   node index.js --interval 5000    # Custom poll interval (ms)
 *   node index.js --hub-url http://localhost:3001  # Custom Hub URL
 *
 * @module
 */

import http from "node:http";
import { exec } from "node:child_process";
import { platform } from "node:os";

// ─── Configuration ─────────────────────────────────────────────────────────

const DEFAULT_PORT = 3690;
const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_HUB_URL = "http://localhost:3001";

/** Parse CLI arguments. */
function parseArgs(argv) {
  const args = { port: DEFAULT_PORT, interval: DEFAULT_INTERVAL_MS, hubUrl: DEFAULT_HUB_URL };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--port" && argv[i + 1]) args.port = parseInt(argv[++i], 10) || DEFAULT_PORT;
    else if (argv[i] === "--interval" && argv[i + 1]) args.interval = parseInt(argv[++i], 10) || DEFAULT_INTERVAL_MS;
    else if (argv[i] === "--hub-url" && argv[i + 1]) args.hubUrl = argv[++i];
  }
  return args;
}

// ─── HTTP Client ───────────────────────────────────────────────────────────

/** Fetch JSON from daemon HTTP endpoint. */
function fetchJson(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: "127.0.0.1", port, path, timeout: 3000 }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`Invalid JSON from ${path}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

// ─── Notifications ─────────────────────────────────────────────────────────

/**
 * Send a desktop notification.
 * Uses platform-native notification mechanisms:
 *   - Windows: PowerShell balloon toast
 *   - macOS: osascript Notification Center
 *   - Linux: notify-send
 */
function notify(title, message) {
  const os = platform();

  if (os === "win32") {
    const ps = `
      [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null;
      $n = New-Object System.Windows.Forms.NotifyIcon;
      $n.Icon = [System.Drawing.SystemIcons]::Information;
      $n.Visible = $true;
      $n.ShowBalloonTip(5000, '${title.replace(/'/g, "''")}', '${message.replace(/'/g, "''")}', 'Info');
      Start-Sleep -Seconds 6;
      $n.Dispose();
    `.replace(/\n/g, " ");
    exec(`powershell -Command "${ps}"`, { timeout: 10000 });
  } else if (os === "darwin") {
    const escaped = message.replace(/"/g, '\\"');
    exec(`osascript -e 'display notification "${escaped}" with title "${title}"'`, { timeout: 5000 });
  } else {
    exec(`notify-send "${title}" "${message}" --expire-time=5000 2>/dev/null`, { timeout: 5000 });
  }
}

/** Open a URL in the default browser. */
function openBrowser(url) {
  const os = platform();
  if (os === "win32") exec(`start "" "${url}"`);
  else if (os === "darwin") exec(`open "${url}"`);
  else exec(`xdg-open "${url}" 2>/dev/null`);
}

// ─── State ─────────────────────────────────────────────────────────────────

/** @typedef {{ alive: boolean, sessionCount: number, daemonPid: number | null, uptime: number | null, lastActivity: number }} TrayState */

/** @type {TrayState} */
let currentState = {
  alive: false,
  sessionCount: 0,
  daemonPid: null,
  uptime: null,
  lastActivity: Date.now(),
};

let previousAlive = false;
let previousSessionCount = 0;

// ─── Poll Loop ─────────────────────────────────────────────────────────────

/**
 * Poll daemon status and telemetry, update state, and fire notifications.
 */
async function poll(port) {
  try {
    // Fetch daemon status
    const status = await fetchJson(port, "/status");
    const daemon = status?.daemon ?? {};

    // Fetch telemetry instances
    let instances = [];
    try {
      const telemetry = await fetchJson(port, "/telemetry/instances");
      instances = telemetry?.instances ?? [];
    } catch {
      // Telemetry endpoint may not exist yet — that's fine
    }

    const sessionCount = instances.length;

    currentState = {
      alive: true,
      sessionCount,
      daemonPid: daemon.pid ?? null,
      uptime: daemon.uptime ?? null,
      lastActivity: Date.now(),
    };

    // Notifications on state changes
    if (!previousAlive) {
      notify("Chitragupta", `Daemon connected (PID ${currentState.daemonPid})`);
    }

    if (sessionCount !== previousSessionCount && previousAlive) {
      if (sessionCount > previousSessionCount) {
        notify("Chitragupta", `New MCP session started (${sessionCount} active)`);
      } else {
        notify("Chitragupta", `MCP session ended (${sessionCount} active)`);
      }
    }

    previousAlive = true;
    previousSessionCount = sessionCount;
  } catch {
    if (previousAlive) {
      notify("Chitragupta", "Daemon disconnected");
    }
    currentState = { alive: false, sessionCount: 0, daemonPid: null, uptime: null, lastActivity: Date.now() };
    previousAlive = false;
    previousSessionCount = 0;
  }
}

/** Format uptime for display. */
function formatUptime(seconds) {
  if (!seconds) return "unknown";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

/** Print current state to console. */
function printState() {
  const s = currentState;
  const status = s.alive ? "\x1b[32mALIVE\x1b[0m" : "\x1b[31mDOWN\x1b[0m";
  const uptime = formatUptime(s.uptime);
  const sessions = s.sessionCount;
  const pid = s.daemonPid ?? "—";

  // Clear line and print status
  process.stdout.write(`\r\x1b[K  Daemon: ${status}  PID: ${pid}  Uptime: ${uptime}  Sessions: ${sessions}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  console.log("Chitragupta Tray Monitor");
  console.log(`  Daemon: http://127.0.0.1:${args.port}`);
  console.log(`  Hub: ${args.hubUrl}`);
  console.log(`  Poll interval: ${args.interval}ms`);
  console.log(`  Platform: ${platform()}`);
  console.log();
  console.log("  Press Ctrl+C to stop, 'o' to open Hub dashboard\n");

  // Initial poll
  await poll(args.port);
  printState();

  // Periodic polling
  const timer = setInterval(async () => {
    await poll(args.port);
    printState();
  }, args.interval);

  // Keyboard input (non-blocking)
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", (data) => {
      const key = data.toString();
      if (key === "o" || key === "O") {
        console.log("\n  Opening Hub dashboard...");
        openBrowser(args.hubUrl);
      } else if (key === "\x03") {
        // Ctrl+C
        clearInterval(timer);
        console.log("\n\nStopped.");
        process.exit(0);
      } else if (key === "s" || key === "S") {
        // Status dump
        console.log("\n" + JSON.stringify(currentState, null, 2));
      }
    });
  }

  // Graceful shutdown
  process.on("SIGINT", () => {
    clearInterval(timer);
    console.log("\n\nStopped.");
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
