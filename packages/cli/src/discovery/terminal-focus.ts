/**
 * @chitragupta/cli — Terminal Focus / Jump Module.
 *
 * Provides a 5-tier fallback chain for focusing the terminal running
 * a given Chitragupta process:
 *   1. tmux  — select-window + select-pane
 *   2. screen — reattach session
 *   3. iTerm2 — AppleScript activation (macOS only)
 *   4. TTY   — open device (macOS) or xdotool (Linux)
 *   5. Notification — desktop notification fallback
 *
 * @module
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

/** Target terminal to focus. */
export interface FocusTarget {
	/** Process ID of the Chitragupta process. */
	pid: number;
	/** TTY device name (e.g. "ttys001"). */
	tty?: string;
	/** tmux session/window/pane identifiers. */
	tmux?: { session: string; window: string; pane: string };
	/** GNU Screen session (and optional window). */
	screen?: { session: string; window?: string };
}

/** Result of a focus attempt. */
export interface FocusResult {
	/** Whether the focus operation succeeded. */
	success: boolean;
	/** Which method was used (or attempted last). */
	method: "tmux" | "screen" | "iterm2" | "tty" | "notification";
	/** Human-readable status message. */
	message: string;
}

/**
 * Attempt to focus the terminal running the given process.
 *
 * Tries a 5-tier fallback chain in order:
 *   tmux -> screen -> iTerm2 -> TTY -> notification
 *
 * @param target - The terminal/process to focus.
 * @returns Result indicating which method succeeded (or final fallback).
 */
export async function focusTerminal(target: FocusTarget): Promise<FocusResult> {
	// Tier 1: tmux
	if (target.tmux) {
		const result = await tryTmux(target.tmux);
		if (result.success) return result;
	}

	// Tier 2: screen
	if (target.screen) {
		const result = await tryScreen(target.screen);
		if (result.success) return result;
	}

	// Tier 3: iTerm2 (macOS only)
	if (process.platform === "darwin") {
		const result = await tryITerm2();
		if (result.success) return result;
	}

	// Tier 4: TTY
	if (target.tty) {
		const result = await tryTty(target.tty, target.pid);
		if (result.success) return result;
	}

	// Tier 5: Notification (always available)
	return sendNotification(target.pid);
}

// ─── Tier 1: tmux ───────────────────────────────────────────────────────────

async function tryTmux(
	tmux: { session: string; window: string; pane: string },
): Promise<FocusResult> {
	try {
		const winTarget = `${tmux.session}:${tmux.window}`;
		const paneTarget = `${winTarget}.${tmux.pane}`;

		await execFile("tmux", ["select-window", "-t", winTarget]);
		await execFile("tmux", ["select-pane", "-t", paneTarget]);

		return {
			success: true,
			method: "tmux",
			message: `Focused tmux pane ${paneTarget}`,
		};
	} catch {
		return {
			success: false,
			method: "tmux",
			message: "tmux select-pane failed (session may have been detached)",
		};
	}
}

// ─── Tier 2: GNU Screen ─────────────────────────────────────────────────────

async function tryScreen(
	screen: { session: string; window?: string },
): Promise<FocusResult> {
	try {
		const args = ["-r", screen.session];
		if (screen.window) {
			args.push("-p", screen.window);
		}
		await execFile("screen", args);
		return {
			success: true,
			method: "screen",
			message: `Reattached screen session ${screen.session}`,
		};
	} catch {
		return {
			success: false,
			method: "screen",
			message: `screen -r ${screen.session} failed`,
		};
	}
}

// ─── Tier 3: iTerm2 (macOS AppleScript) ─────────────────────────────────────

async function tryITerm2(): Promise<FocusResult> {
	try {
		// Check if iTerm2 is running before sending AppleScript
		const { stdout } = await execFile("pgrep", ["-x", "iTerm2"]);
		if (!stdout.trim()) {
			return { success: false, method: "iterm2", message: "iTerm2 is not running" };
		}

		await execFile("osascript", [
			"-e",
			'tell application "iTerm2" to activate',
		]);

		return {
			success: true,
			method: "iterm2",
			message: "Activated iTerm2 via AppleScript",
		};
	} catch {
		return {
			success: false,
			method: "iterm2",
			message: "iTerm2 activation failed (not installed or not running)",
		};
	}
}

// ─── Tier 4: TTY ────────────────────────────────────────────────────────────

async function tryTty(tty: string, pid: number): Promise<FocusResult> {
	const platform = process.platform;

	try {
		if (platform === "darwin") {
			// macOS: open the TTY device to bring Terminal.app / iTerm to front
			const devPath = tty.startsWith("/dev/") ? tty : `/dev/${tty}`;
			await execFile("open", [devPath]);
			return {
				success: true,
				method: "tty",
				message: `Opened TTY device ${devPath}`,
			};
		}

		if (platform === "linux") {
			// Linux: use xdotool to find window by PID and activate it
			const { stdout } = await execFile("xdotool", ["search", "--pid", String(pid)]);
			const windowId = stdout.trim().split("\n")[0];
			if (windowId) {
				await execFile("xdotool", ["windowactivate", windowId]);
				return {
					success: true,
					method: "tty",
					message: `Activated window ${windowId} for PID ${pid} via xdotool`,
				};
			}
		}
	} catch {
		/* fall through to failure */
	}

	return {
		success: false,
		method: "tty",
		message: `Could not focus TTY ${tty} for PID ${pid}`,
	};
}

// ─── Tier 5: Desktop Notification ───────────────────────────────────────────

async function sendNotification(pid: number): Promise<FocusResult> {
	const title = "Chitragupta";
	const body = `Session running in PID ${pid} — switch to its terminal manually.`;
	const platform = process.platform;

	try {
		if (platform === "darwin") {
			await execFile("osascript", [
				"-e",
				`display notification "${body}" with title "${title}"`,
			]);
		} else if (platform === "linux") {
			await execFile("notify-send", [title, body]);
		} else {
			return {
				success: false,
				method: "notification",
				message: `No notification mechanism available on ${platform}`,
			};
		}

		return {
			success: true,
			method: "notification",
			message: `Sent desktop notification for PID ${pid}`,
		};
	} catch {
		return {
			success: false,
			method: "notification",
			message: "Desktop notification failed — no notification daemon found",
		};
	}
}

// ─── Multiplexer Detection ──────────────────────────────────────────────────

/**
 * Detect multiplexer info for an arbitrary PID.
 *
 * Checks (in order):
 *   1. tmux — parses `tmux list-panes -a` for matching pane_pid
 *   2. screen — parses `screen -ls` for sessions (heuristic)
 *   3. TTY — queries `ps -o tty=` for the PID
 *
 * @param pid - Process ID to inspect.
 * @returns Partial FocusTarget with whatever info was discovered.
 */
export async function detectMuxInfo(pid: number): Promise<Partial<FocusTarget>> {
	const result: Partial<FocusTarget> = { pid };

	// 1. Check tmux panes
	const tmux = await detectTmuxPane(pid);
	if (tmux) {
		result.tmux = tmux;
		return result;
	}

	// 2. Check screen sessions
	const screen = await detectScreenSession(pid);
	if (screen) {
		result.screen = screen;
	}

	// 3. Get TTY
	const tty = await detectTty(pid);
	if (tty) {
		result.tty = tty;
	}

	return result;
}

/** Parse tmux list-panes to find which pane contains the given PID. */
async function detectTmuxPane(
	pid: number,
): Promise<{ session: string; window: string; pane: string } | null> {
	try {
		const { stdout } = await execFile("tmux", [
			"list-panes", "-a",
			"-F", "#{pane_pid} #{session_name} #{window_index} #{pane_index}",
		]);

		for (const line of stdout.trim().split("\n")) {
			const parts = line.trim().split(" ");
			if (parts.length < 4) continue;
			const [panePid, sessionName, windowIdx, paneIdx] = parts;
			if (parseInt(panePid ?? "0", 10) === pid) {
				return {
					session: sessionName ?? "",
					window: windowIdx ?? "0",
					pane: paneIdx ?? "0",
				};
			}
		}
	} catch {
		/* tmux not available or no server running */
	}

	return null;
}

/** Detect screen session (heuristic — screen does not expose per-window PIDs easily). */
async function detectScreenSession(
	_pid: number,
): Promise<{ session: string; window?: string } | null> {
	try {
		const { stdout } = await execFile("screen", ["-ls"]);
		// Look for attached/detached sessions
		const match = /(\d+\.\S+)\s+\((Attached|Detached)\)/.exec(stdout);
		if (match?.[1]) {
			return { session: match[1] };
		}
	} catch {
		/* screen not available */
	}

	return null;
}

/** Get TTY device for a PID. */
async function detectTty(pid: number): Promise<string | null> {
	const platform = process.platform;

	try {
		if (platform === "darwin") {
			const { stdout } = await execFile("ps", ["-o", "tty=", "-p", String(pid)]);
			const tty = stdout.trim();
			return tty && tty !== "??" ? tty : null;
		}

		if (platform === "linux") {
			// Try /proc first (faster), fall back to ps
			try {
				const { stdout } = await execFile("readlink", [`/proc/${pid}/fd/0`]);
				const link = stdout.trim();
				if (link.startsWith("/dev/")) {
					return link.replace("/dev/", "");
				}
			} catch {
				const { stdout } = await execFile("ps", ["-o", "tty=", "-p", String(pid)]);
				const tty = stdout.trim();
				return tty && tty !== "?" ? tty : null;
			}
		}
	} catch {
		/* detection failed */
	}

	return null;
}
