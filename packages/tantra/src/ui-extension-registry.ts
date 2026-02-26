/**
 * Centralized UI Extension Registry.
 *
 * Aggregates UI contributions (widgets, keybinds, panels) from skills
 * and exposes them to TUI consumers via a single query surface.
 * When a skill with UI contributions is discovered, Chitragupta
 * auto-registers it here. The TUI simply calls
 * {@link UIExtensionRegistry.getAvailableUIExtensions}.
 *
 * @module
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** Widget position in the TUI layout. */
export type WidgetPosition = "left" | "center" | "right";

/** Widget content format. */
export type WidgetFormat = "plain" | "ansi" | "json";

/** Panel display type. */
export type PanelType = "sidebar" | "modal" | "overlay" | "tab";

/** Panel content format. */
export type PanelFormat = "plain" | "ansi" | "markdown" | "json";

/** A widget contribution from a skill. */
export interface UIWidget {
	/** Unique widget identifier. */
	id: string;
	/** Human-readable label. */
	label: string;
	/** Layout position hint. */
	position?: WidgetPosition;
	/** Auto-refresh interval in milliseconds. */
	refreshMs?: number;
	/** Content format for rendering. */
	format?: WidgetFormat;
}

/** A keybind contribution from a skill. */
export interface UIKeybind {
	/** Key combination (e.g. "ctrl+k"). */
	key: string;
	/** Human-readable description. */
	description: string;
	/** Command to invoke. */
	command: string;
	/** Optional command arguments. */
	args?: Record<string, unknown>;
}

/** A panel contribution from a skill. */
export interface UIPanel {
	/** Unique panel identifier. */
	id: string;
	/** Panel display title. */
	title: string;
	/** Panel display type. */
	type: PanelType;
	/** Content format for rendering. */
	format?: PanelFormat;
}

/** A registered UI extension from a skill. */
export interface UIExtension {
	/** Source skill name. */
	skillName: string;
	/** Skill version. */
	version: string;
	/** Widget contributions. */
	widgets: UIWidget[];
	/** Keybind contributions. */
	keybinds: UIKeybind[];
	/** Panel contributions. */
	panels: UIPanel[];
	/** When this extension was registered (epoch ms). */
	registeredAt: number;
}

/** Event emitted when extensions change. */
export interface UIExtensionEvent {
	/** Whether the extension was added or removed. */
	type: "registered" | "unregistered";
	/** Skill that triggered the event. */
	skillName: string;
	/** Number of widgets in the extension. */
	widgetCount: number;
	/** Number of keybinds in the extension. */
	keybindCount: number;
	/** Number of panels in the extension. */
	panelCount: number;
}

/** Configuration for {@link UIExtensionRegistry}. */
export interface UIExtensionRegistryConfig {
	/** Maximum number of extensions. Default: 100. */
	maxExtensions?: number;
}

/** Listener function for extension change events. */
type UIExtensionListener = (event: UIExtensionEvent) => void;

/** Result from {@link UIExtensionRegistry.findWidget}. */
export interface WidgetSearchResult {
	/** The extension containing the widget. */
	extension: UIExtension;
	/** The matched widget. */
	widget: UIWidget;
}

// ─── Default Configuration ──────────────────────────────────────────────────

const DEFAULT_MAX_EXTENSIONS = 100;

// ─── Registry ───────────────────────────────────────────────────────────────

/**
 * Centralized registry for UI extensions contributed by skills.
 *
 * Skills register their widget, keybind, and panel contributions here.
 * TUI consumers query the registry to discover available UI elements
 * without needing to know about individual skills.
 */
export class UIExtensionRegistry {
	private readonly extensions = new Map<string, UIExtension>();
	private readonly listeners: UIExtensionListener[] = [];
	private readonly maxExtensions: number;

	constructor(config?: UIExtensionRegistryConfig) {
		this.maxExtensions = config?.maxExtensions ?? DEFAULT_MAX_EXTENSIONS;
	}

	/**
	 * Register UI contributions from a skill.
	 *
	 * If a skill with the same name is already registered, it is replaced
	 * (an unregister event fires first, then a register event).
	 *
	 * @throws Error if the registry is at capacity and the skill is new.
	 */
	register(extension: UIExtension): void {
		const existing = this.extensions.has(extension.skillName);

		if (!existing && this.extensions.size >= this.maxExtensions) {
			throw new Error(
				`UIExtensionRegistry: max capacity (${this.maxExtensions}) reached. ` +
				`Unregister an extension before adding "${extension.skillName}".`,
			);
		}

		// Replace existing: fire unregister first
		if (existing) {
			this.emitEvent("unregistered", this.extensions.get(extension.skillName)!);
		}

		this.extensions.set(extension.skillName, extension);
		this.emitEvent("registered", extension);
	}

	/**
	 * Unregister a skill's UI contributions by skill name.
	 *
	 * @returns `true` if the skill was found and removed, `false` otherwise.
	 */
	unregister(skillName: string): boolean {
		const ext = this.extensions.get(skillName);
		if (!ext) return false;

		this.extensions.delete(skillName);
		this.emitEvent("unregistered", ext);
		return true;
	}

	/** Get all registered UI extensions, ordered by registration time. */
	getAvailableUIExtensions(): UIExtension[] {
		return [...this.extensions.values()].sort(
			(a, b) => a.registeredAt - b.registeredAt,
		);
	}

	/** Get extensions that contribute at least one widget. */
	getWidgetExtensions(): UIExtension[] {
		return this.getAvailableUIExtensions().filter(
			(ext) => ext.widgets.length > 0,
		);
	}

	/** Get extensions that contribute at least one keybind. */
	getKeybindExtensions(): UIExtension[] {
		return this.getAvailableUIExtensions().filter(
			(ext) => ext.keybinds.length > 0,
		);
	}

	/** Get extensions that contribute at least one panel. */
	getPanelExtensions(): UIExtension[] {
		return this.getAvailableUIExtensions().filter(
			(ext) => ext.panels.length > 0,
		);
	}

	/**
	 * Find a specific widget by ID across all extensions.
	 *
	 * @returns The extension and widget if found, `undefined` otherwise.
	 */
	findWidget(widgetId: string): WidgetSearchResult | undefined {
		for (const extension of this.extensions.values()) {
			const widget = extension.widgets.find((w) => w.id === widgetId);
			if (widget) return { extension, widget };
		}
		return undefined;
	}

	/**
	 * Subscribe to extension change events.
	 *
	 * @returns Unsubscribe function. Call it to remove the listener.
	 */
	onChange(handler: UIExtensionListener): () => void {
		this.listeners.push(handler);
		return () => {
			const idx = this.listeners.indexOf(handler);
			if (idx >= 0) this.listeners.splice(idx, 1);
		};
	}

	/** Number of registered extensions. */
	get size(): number {
		return this.extensions.size;
	}

	/** Remove all registered extensions (fires unregister events). */
	clear(): void {
		const all = [...this.extensions.values()];
		this.extensions.clear();
		for (const ext of all) {
			this.emitEvent("unregistered", ext);
		}
	}

	// ─── Internal ─────────────────────────────────────────────────────────

	/** Emit an event to all registered listeners. */
	private emitEvent(type: UIExtensionEvent["type"], ext: UIExtension): void {
		const event: UIExtensionEvent = {
			type,
			skillName: ext.skillName,
			widgetCount: ext.widgets.length,
			keybindCount: ext.keybinds.length,
			panelCount: ext.panels.length,
		};
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch {
				// Listener errors must not break the registry
			}
		}
	}
}
