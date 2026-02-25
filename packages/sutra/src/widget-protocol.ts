/**
 * WidgetDataStream — Widget Data Protocol execution layer.
 *
 * Manages widget lifecycle: registration, script execution via `execFile`,
 * Samiti channel subscriptions, refresh timers, and subscriber fan-out.
 * Chitragupta handles all execution; TUI consumers only render updates.
 *
 * Architecture: TUI (Takumi) subscribes -> WidgetDataStream -> Samiti channel -> Script executor -> Result
 *
 * @module widget-protocol
 */

import { execFile } from "node:child_process";
import { Samiti } from "./samiti.js";
import type { SamitiMessage } from "./samiti-types.js";
import {
	WIDGET_DEFAULTS,
	type WidgetSource,
	type WidgetUpdate,
	type WidgetDataStreamConfig,
} from "./widget-protocol-types.js";

/** Handler type for widget update callbacks. */
type UpdateHandler = (update: WidgetUpdate) => void;

/**
 * Manages widget data sources, executing scripts securely and streaming
 * formatted results to TUI consumers via Samiti channels.
 *
 * @example
 * ```ts
 * const samiti = new Samiti();
 * const stream = new WidgetDataStream(samiti);
 * stream.registerWidget({
 *   id: "cpu-usage",
 *   label: "CPU Usage",
 *   script: "/usr/bin/top -l 1 -n 0",
 *   refreshMs: 5000,
 *   format: "plain",
 * });
 * stream.subscribe("cpu-usage", (update) => console.log(update.content));
 * stream.start();
 * ```
 */
export class WidgetDataStream {
	private readonly widgets = new Map<string, WidgetSource>();
	private readonly timers = new Map<string, ReturnType<typeof setInterval>>();
	private readonly subscribers = new Map<string, Set<UpdateHandler>>();
	private readonly latestValues = new Map<string, WidgetUpdate>();
	private readonly channelUnsubs = new Map<string, () => void>();
	private readonly samiti: Samiti;
	private readonly maxConcurrent: number;
	private readonly defaultTimeout: number;
	private readonly maxWidgets: number;
	private activeScripts = 0;
	private running = false;
	private destroyed = false;

	constructor(samiti: Samiti, config?: WidgetDataStreamConfig) {
		this.samiti = samiti;
		this.maxConcurrent = config?.maxConcurrentScripts ?? WIDGET_DEFAULTS.maxConcurrentScripts;
		this.defaultTimeout = config?.defaultTimeoutMs ?? WIDGET_DEFAULTS.defaultTimeoutMs;
		this.maxWidgets = config?.maxWidgets ?? WIDGET_DEFAULTS.maxWidgets;
	}

	// ─── Registration ────────────────────────────────────────────────

	/**
	 * Register a widget data source. Creates a Samiti channel if the
	 * widget specifies one and it does not already exist.
	 *
	 * @param source - Widget source configuration.
	 * @throws If the widget ID is already registered or maxWidgets is reached.
	 */
	registerWidget(source: WidgetSource): void {
		this.assertAlive();

		if (this.widgets.has(source.id)) {
			throw new Error(`Widget "${source.id}" is already registered.`);
		}
		if (this.widgets.size >= this.maxWidgets) {
			throw new Error(
				`Maximum widgets reached (${this.maxWidgets}). ` +
				`Unregister a widget before adding a new one.`,
			);
		}

		this.widgets.set(source.id, { ...source });

		// Ensure Samiti channel exists for channel-based widgets.
		if (source.channel && !this.samiti.getChannel(source.channel)) {
			this.samiti.createChannel(source.channel, `Widget channel: ${source.label}`);
		}

		// If already running, wire up immediately.
		if (this.running) {
			this.wireWidget(source);
		}
	}

	/**
	 * Unregister a widget and stop its refresh timer / channel listener.
	 *
	 * @param widgetId - The widget to unregister.
	 * @returns True if the widget was found and removed, false otherwise.
	 */
	unregisterWidget(widgetId: string): boolean {
		this.assertAlive();

		if (!this.widgets.has(widgetId)) return false;

		this.unwireWidget(widgetId);
		this.widgets.delete(widgetId);
		this.subscribers.delete(widgetId);
		this.latestValues.delete(widgetId);
		return true;
	}

	// ─── Subscription ────────────────────────────────────────────────

	/**
	 * Subscribe to updates for a specific widget. Returns an unsubscribe function.
	 *
	 * @param widgetId - The widget to subscribe to.
	 * @param handler - Callback invoked with each update.
	 * @returns Unsubscribe function that removes this handler.
	 * @throws If the widget is not registered.
	 */
	subscribe(widgetId: string, handler: UpdateHandler): () => void {
		this.assertAlive();

		if (!this.widgets.has(widgetId)) {
			throw new Error(`Widget "${widgetId}" is not registered.`);
		}

		let subs = this.subscribers.get(widgetId);
		if (!subs) {
			subs = new Set();
			this.subscribers.set(widgetId, subs);
		}
		subs.add(handler);

		return () => {
			const s = this.subscribers.get(widgetId);
			if (s) {
				s.delete(handler);
				if (s.size === 0) this.subscribers.delete(widgetId);
			}
		};
	}

	// ─── Query ───────────────────────────────────────────────────────

	/** Get the latest value for a widget (for late joiners). */
	getLatest(widgetId: string): WidgetUpdate | undefined {
		return this.latestValues.get(widgetId);
	}

	/** List all registered widget IDs. */
	listWidgets(): string[] {
		return [...this.widgets.keys()];
	}

	/** Get all registered widget sources (defensive copies). */
	getWidgetSources(): WidgetSource[] {
		return [...this.widgets.values()].map((s) => ({ ...s }));
	}

	// ─── Lifecycle ───────────────────────────────────────────────────

	/** Start all refresh timers and Samiti listeners. */
	start(): void {
		this.assertAlive();
		if (this.running) return;
		this.running = true;

		for (const source of this.widgets.values()) {
			this.wireWidget(source);
		}
	}

	/** Stop all timers and listeners (can be restarted). */
	stop(): void {
		this.assertAlive();
		if (!this.running) return;
		this.running = false;

		for (const widgetId of this.widgets.keys()) {
			this.unwireWidget(widgetId);
		}
	}

	/** Destroy and clean up. No further operations are allowed. */
	destroy(): void {
		if (this.destroyed) return;
		this.stop();
		this.widgets.clear();
		this.subscribers.clear();
		this.latestValues.clear();
		this.destroyed = true;
	}

	/** Whether the stream is currently running. */
	get isRunning(): boolean {
		return this.running;
	}

	// ─── Private: Wiring ─────────────────────────────────────────────

	/** Set up timers and channel listeners for a single widget. */
	private wireWidget(source: WidgetSource): void {
		// Script-based with refresh interval.
		if (source.script && source.refreshMs > 0) {
			// Execute immediately, then set interval.
			void this.executeWidget(source);
			const timer = setInterval(() => void this.executeWidget(source), source.refreshMs);
			this.timers.set(source.id, timer);
		} else if (source.script && source.refreshMs === 0) {
			// One-shot script execution (event-driven will trigger re-execution).
			void this.executeWidget(source);
		}

		// Channel-based: subscribe to Samiti messages.
		if (source.channel) {
			const unsub = this.samiti.onMessage(source.channel, (msg: SamitiMessage) => {
				const update: WidgetUpdate = {
					widgetId: source.id,
					content: typeof msg.data === "string" ? msg.data : msg.content,
					timestamp: Date.now(),
					ok: true,
				};
				this.publishUpdate(update);
			});
			this.channelUnsubs.set(source.id, unsub);
		}
	}

	/** Tear down timers and channel listeners for a single widget. */
	private unwireWidget(widgetId: string): void {
		const timer = this.timers.get(widgetId);
		if (timer) {
			clearInterval(timer);
			this.timers.delete(widgetId);
		}

		const unsub = this.channelUnsubs.get(widgetId);
		if (unsub) {
			unsub();
			this.channelUnsubs.delete(widgetId);
		}
	}

	// ─── Private: Execution ──────────────────────────────────────────

	/**
	 * Execute a widget's script and publish the result.
	 * Uses `execFile` (not `exec`) to prevent shell injection.
	 * Respects the concurrency limit.
	 */
	private async executeWidget(source: WidgetSource): Promise<void> {
		if (!source.script) return;
		if (this.activeScripts >= this.maxConcurrent) return;

		this.activeScripts++;
		const timeout = source.timeoutMs ?? this.defaultTimeout;
		const parts = this.splitCommand(source.script);

		try {
			const stdout = await this.runExecFile(parts.command, parts.args, timeout);
			const update: WidgetUpdate = {
				widgetId: source.id,
				content: stdout,
				timestamp: Date.now(),
				ok: true,
			};
			this.publishUpdate(update);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			const update: WidgetUpdate = {
				widgetId: source.id,
				content: "",
				timestamp: Date.now(),
				ok: false,
				error: message,
			};
			this.publishUpdate(update);
		} finally {
			this.activeScripts--;
		}
	}

	/**
	 * Wrapper around `execFile` that returns a Promise.
	 * Separated for testability (vi.mock targets this module).
	 */
	private runExecFile(command: string, args: string[], timeout: number): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			execFile(
				command,
				args,
				{ timeout, maxBuffer: WIDGET_DEFAULTS.maxBuffer },
				(error, stdout) => {
					if (error) {
						reject(error);
					} else {
						resolve(stdout);
					}
				},
			);
		});
	}

	/**
	 * Split a script string into command and arguments.
	 * Handles simple quoting (double quotes only).
	 */
	private splitCommand(script: string): { command: string; args: string[] } {
		const tokens: string[] = [];
		let current = "";
		let inQuote = false;

		for (const ch of script) {
			if (ch === '"') {
				inQuote = !inQuote;
			} else if (ch === " " && !inQuote) {
				if (current.length > 0) {
					tokens.push(current);
					current = "";
				}
			} else {
				current += ch;
			}
		}
		if (current.length > 0) tokens.push(current);

		return {
			command: tokens[0] ?? "",
			args: tokens.slice(1),
		};
	}

	// ─── Private: Fan-out ────────────────────────────────────────────

	/** Publish a widget update to all subscribers and cache as latest. */
	private publishUpdate(update: WidgetUpdate): void {
		this.latestValues.set(update.widgetId, update);

		const subs = this.subscribers.get(update.widgetId);
		if (!subs) return;

		for (const handler of subs) {
			try {
				handler(update);
			} catch (_err) {
				// Error isolation: never let a subscriber crash the publisher.
			}
		}
	}

	// ─── Private: Guards ─────────────────────────────────────────────

	/** Throw if the instance has been destroyed. */
	private assertAlive(): void {
		if (this.destroyed) {
			throw new Error("WidgetDataStream has been destroyed. No further operations are allowed.");
		}
	}
}
