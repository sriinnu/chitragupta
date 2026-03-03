/**
 * @chitragupta/tantra — Extension Hook Registry.
 *
 * Manages lifecycle hooks from loaded extensions. Hooks are dispatched
 * in registration order with error isolation — one failing hook does
 * not prevent others from running.
 *
 * @module
 */

import type {
	ExtensionHookName,
	ExtensionHooks,
	SessionContext,
	TurnContext,
	ToolCallContext,
	ToolResultContext,
	ErrorContext,
	InputContext,
	BeforeAgentContext,
	ModelSelectContext,
	CompactContext,
	SessionSwitchContext,
} from "./extension-types.js";

/** Hook handler function type — union of all possible context types. */
type HookHandler = (ctx: unknown) => void | Promise<void>;

/** Registered hook entry. */
interface HookEntry {
	extensionName: string;
	handler: HookHandler;
	registeredAt: number;
}

/**
 * Extension Hook Registry.
 *
 * Collects hooks from extensions and dispatches them with error isolation.
 * Each hook is wrapped in a try/catch so one extension can't crash others.
 */
export class HookRegistry {
	private hooks = new Map<ExtensionHookName, HookEntry[]>();
	private _dispatchCount = 0;
	private _errorCount = 0;

	/** Register all hooks from an extension. */
	registerHooks(extensionName: string, hooks: ExtensionHooks): void {
		const hookNames: ExtensionHookName[] = [
			"onSessionStart", "onSessionEnd", "onTurnStart", "onTurnEnd",
			"onToolCall", "onToolResult", "onError",
			"onInput", "onBeforeAgentStart", "onModelSelect", "onCompact", "onSessionSwitch",
		];

		for (const name of hookNames) {
			const handler = hooks[name];
			if (typeof handler === "function") {
				const entries = this.hooks.get(name) ?? [];
				entries.push({
					extensionName,
					handler: handler as HookHandler,
					registeredAt: Date.now(),
				});
				this.hooks.set(name, entries);
			}
		}
	}

	/** Unregister all hooks from an extension. */
	unregisterHooks(extensionName: string): void {
		for (const [name, entries] of this.hooks) {
			this.hooks.set(name, entries.filter(e => e.extensionName !== extensionName));
		}
	}

	/** Dispatch a session lifecycle hook. */
	async dispatchSessionHook(
		hookName: "onSessionStart" | "onSessionEnd",
		ctx: SessionContext,
	): Promise<void> {
		await this.dispatch(hookName, ctx);
	}

	/** Dispatch a turn lifecycle hook. */
	async dispatchTurnHook(
		hookName: "onTurnStart" | "onTurnEnd",
		ctx: TurnContext,
	): Promise<void> {
		await this.dispatch(hookName, ctx);
	}

	/** Dispatch a tool call hook (before execution). */
	async dispatchToolCall(ctx: ToolCallContext): Promise<void> {
		await this.dispatch("onToolCall", ctx);
	}

	/** Dispatch a tool result hook (after execution). */
	async dispatchToolResult(ctx: ToolResultContext): Promise<void> {
		await this.dispatch("onToolResult", ctx);
	}

	/** Dispatch an error hook. */
	async dispatchError(ctx: ErrorContext): Promise<void> {
		await this.dispatch("onError", ctx);
	}

	/** Dispatch onInput — returns the (possibly transformed) context. */
	async dispatchInput(ctx: InputContext): Promise<InputContext> {
		await this.dispatch("onInput", ctx);
		return ctx;
	}

	/** Dispatch onBeforeAgentStart — extensions can inject system prompt segments. */
	async dispatchBeforeAgentStart(ctx: BeforeAgentContext): Promise<BeforeAgentContext> {
		await this.dispatch("onBeforeAgentStart", ctx);
		return ctx;
	}

	/** Dispatch onModelSelect. */
	async dispatchModelSelect(ctx: ModelSelectContext): Promise<void> {
		await this.dispatch("onModelSelect", ctx);
	}

	/** Dispatch onCompact. */
	async dispatchCompact(ctx: CompactContext): Promise<void> {
		await this.dispatch("onCompact", ctx);
	}

	/** Dispatch onSessionSwitch. */
	async dispatchSessionSwitch(ctx: SessionSwitchContext): Promise<void> {
		await this.dispatch("onSessionSwitch", ctx);
	}

	/** Get hook registration count per hook name. */
	getStats(): Record<string, number> {
		const stats: Record<string, number> = {
			_totalDispatches: this._dispatchCount,
			_totalErrors: this._errorCount,
		};
		for (const [name, entries] of this.hooks) {
			stats[name] = entries.length;
		}
		return stats;
	}

	/** Check if any hooks are registered for a given name. */
	hasHooks(name: ExtensionHookName): boolean {
		return (this.hooks.get(name)?.length ?? 0) > 0;
	}

	/** Clear all hooks. */
	clear(): void {
		this.hooks.clear();
	}

	// ── Private ─────────────────────────────────────────────────────

	private async dispatch(name: ExtensionHookName, ctx: unknown): Promise<void> {
		const entries = this.hooks.get(name);
		if (!entries || entries.length === 0) return;

		this._dispatchCount++;

		for (const entry of entries) {
			try {
				await entry.handler(ctx);
			} catch (err) {
				this._errorCount++;
				process.stderr.write(
					`[extension:${entry.extensionName}] Hook ${name} failed: ${err instanceof Error ? err.message : String(err)}\n`,
				);
			}
		}
	}
}
