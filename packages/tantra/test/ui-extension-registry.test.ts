import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	UIExtensionRegistry,
	type UIExtension,
	type UIExtensionEvent,
} from "../src/ui-extension-registry.js";

// ─── Test Fixtures ──────────────────────────────────────────────────────────

/** Create a test extension with all contribution types. */
function createExtension(
	skillName: string,
	opts: {
		version?: string;
		widgetCount?: number;
		keybindCount?: number;
		panelCount?: number;
		registeredAt?: number;
	} = {},
): UIExtension {
	const {
		version = "1.0.0",
		widgetCount = 1,
		keybindCount = 1,
		panelCount = 1,
		registeredAt = Date.now(),
	} = opts;

	return {
		skillName,
		version,
		widgets: Array.from({ length: widgetCount }, (_, i) => ({
			id: `${skillName}-widget-${i}`,
			label: `Widget ${i} from ${skillName}`,
			position: "center" as const,
			refreshMs: 5000,
			format: "plain" as const,
		})),
		keybinds: Array.from({ length: keybindCount }, (_, i) => ({
			key: `ctrl+${skillName[0]}${i}`,
			description: `Keybind ${i} from ${skillName}`,
			command: `${skillName}:action${i}`,
		})),
		panels: Array.from({ length: panelCount }, (_, i) => ({
			id: `${skillName}-panel-${i}`,
			title: `Panel ${i} from ${skillName}`,
			type: "sidebar" as const,
			format: "markdown" as const,
		})),
		registeredAt,
	};
}

/** Create an extension with only widgets (no keybinds or panels). */
function createWidgetOnly(skillName: string): UIExtension {
	return createExtension(skillName, { keybindCount: 0, panelCount: 0 });
}

/** Create an extension with only keybinds. */
function createKeybindOnly(skillName: string): UIExtension {
	return createExtension(skillName, { widgetCount: 0, panelCount: 0 });
}

/** Create an extension with only panels. */
function createPanelOnly(skillName: string): UIExtension {
	return createExtension(skillName, { widgetCount: 0, keybindCount: 0 });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("UIExtensionRegistry", () => {
	let registry: UIExtensionRegistry;

	beforeEach(() => {
		registry = new UIExtensionRegistry();
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Register / Unregister Lifecycle
	// ═══════════════════════════════════════════════════════════════════════

	describe("register / unregister lifecycle", () => {
		it("should register an extension and retrieve it", () => {
			const ext = createExtension("git-tools");
			registry.register(ext);

			expect(registry.size).toBe(1);
			const all = registry.getAvailableUIExtensions();
			expect(all).toHaveLength(1);
			expect(all[0].skillName).toBe("git-tools");
		});

		it("should unregister an extension by skill name", () => {
			registry.register(createExtension("git-tools"));
			registry.register(createExtension("docker-tools"));
			expect(registry.size).toBe(2);

			const removed = registry.unregister("git-tools");
			expect(removed).toBe(true);
			expect(registry.size).toBe(1);
			expect(registry.getAvailableUIExtensions()[0].skillName).toBe("docker-tools");
		});

		it("should return false when unregistering a non-existent skill", () => {
			expect(registry.unregister("nonexistent")).toBe(false);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// getAvailableUIExtensions
	// ═══════════════════════════════════════════════════════════════════════

	describe("getAvailableUIExtensions", () => {
		it("should return all registered extensions sorted by registeredAt", () => {
			registry.register(createExtension("beta", { registeredAt: 200 }));
			registry.register(createExtension("alpha", { registeredAt: 100 }));
			registry.register(createExtension("gamma", { registeredAt: 300 }));

			const all = registry.getAvailableUIExtensions();
			expect(all.map((e) => e.skillName)).toEqual(["alpha", "beta", "gamma"]);
		});

		it("should return empty array when no extensions registered", () => {
			expect(registry.getAvailableUIExtensions()).toEqual([]);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Filtered Queries
	// ═══════════════════════════════════════════════════════════════════════

	describe("getWidgetExtensions", () => {
		it("should return only extensions with widgets", () => {
			registry.register(createWidgetOnly("has-widgets"));
			registry.register(createKeybindOnly("no-widgets"));

			const result = registry.getWidgetExtensions();
			expect(result).toHaveLength(1);
			expect(result[0].skillName).toBe("has-widgets");
		});
	});

	describe("getKeybindExtensions", () => {
		it("should return only extensions with keybinds", () => {
			registry.register(createKeybindOnly("has-keybinds"));
			registry.register(createPanelOnly("no-keybinds"));

			const result = registry.getKeybindExtensions();
			expect(result).toHaveLength(1);
			expect(result[0].skillName).toBe("has-keybinds");
		});
	});

	describe("getPanelExtensions", () => {
		it("should return only extensions with panels", () => {
			registry.register(createPanelOnly("has-panels"));
			registry.register(createWidgetOnly("no-panels"));

			const result = registry.getPanelExtensions();
			expect(result).toHaveLength(1);
			expect(result[0].skillName).toBe("has-panels");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// findWidget
	// ═══════════════════════════════════════════════════════════════════════

	describe("findWidget", () => {
		it("should find a widget by ID across extensions", () => {
			registry.register(createExtension("alpha", { widgetCount: 2 }));
			registry.register(createExtension("beta", { widgetCount: 3 }));

			const result = registry.findWidget("beta-widget-1");
			expect(result).toBeDefined();
			expect(result!.extension.skillName).toBe("beta");
			expect(result!.widget.id).toBe("beta-widget-1");
		});

		it("should return undefined for unknown widget ID", () => {
			registry.register(createExtension("alpha"));
			expect(registry.findWidget("nonexistent")).toBeUndefined();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// onChange
	// ═══════════════════════════════════════════════════════════════════════

	describe("onChange", () => {
		it("should fire on register", () => {
			const events: UIExtensionEvent[] = [];
			registry.onChange((e) => events.push(e));

			registry.register(createExtension("alpha"));

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe("registered");
			expect(events[0].skillName).toBe("alpha");
			expect(events[0].widgetCount).toBe(1);
			expect(events[0].keybindCount).toBe(1);
			expect(events[0].panelCount).toBe(1);
		});

		it("should fire on unregister", () => {
			registry.register(createExtension("alpha"));

			const events: UIExtensionEvent[] = [];
			registry.onChange((e) => events.push(e));

			registry.unregister("alpha");

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe("unregistered");
			expect(events[0].skillName).toBe("alpha");
		});

		it("should unsubscribe when the returned function is called", () => {
			const events: UIExtensionEvent[] = [];
			const unsub = registry.onChange((e) => events.push(e));

			registry.register(createExtension("alpha"));
			expect(events).toHaveLength(1);

			unsub();

			registry.register(createExtension("beta"));
			expect(events).toHaveLength(1); // No new event after unsub
		});

		it("should not break if a listener throws", () => {
			const badListener = vi.fn(() => { throw new Error("boom"); });
			const goodListener = vi.fn();

			registry.onChange(badListener);
			registry.onChange(goodListener);

			registry.register(createExtension("alpha"));

			expect(badListener).toHaveBeenCalledOnce();
			expect(goodListener).toHaveBeenCalledOnce();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// maxExtensions Limit
	// ═══════════════════════════════════════════════════════════════════════

	describe("maxExtensions limit", () => {
		it("should enforce max capacity", () => {
			const small = new UIExtensionRegistry({ maxExtensions: 2 });
			small.register(createExtension("alpha"));
			small.register(createExtension("beta"));

			expect(() => small.register(createExtension("gamma"))).toThrow(
				/max capacity/,
			);
		});

		it("should allow replacement even at max capacity", () => {
			const small = new UIExtensionRegistry({ maxExtensions: 2 });
			small.register(createExtension("alpha", { version: "1.0.0" }));
			small.register(createExtension("beta"));

			// Replacing alpha should not throw
			small.register(createExtension("alpha", { version: "2.0.0" }));
			expect(small.size).toBe(2);

			const alpha = small.getAvailableUIExtensions().find(
				(e) => e.skillName === "alpha",
			);
			expect(alpha!.version).toBe("2.0.0");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Duplicate Registration
	// ═══════════════════════════════════════════════════════════════════════

	describe("duplicate registration", () => {
		it("should replace existing extension on re-register", () => {
			registry.register(createExtension("alpha", { version: "1.0.0", widgetCount: 1 }));
			registry.register(createExtension("alpha", { version: "2.0.0", widgetCount: 3 }));

			expect(registry.size).toBe(1);
			const ext = registry.getAvailableUIExtensions()[0];
			expect(ext.version).toBe("2.0.0");
			expect(ext.widgets).toHaveLength(3);
		});

		it("should fire unregister then register on replacement", () => {
			registry.register(createExtension("alpha", { version: "1.0.0" }));

			const events: UIExtensionEvent[] = [];
			registry.onChange((e) => events.push(e));

			registry.register(createExtension("alpha", { version: "2.0.0" }));

			expect(events).toHaveLength(2);
			expect(events[0].type).toBe("unregistered");
			expect(events[1].type).toBe("registered");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// clear
	// ═══════════════════════════════════════════════════════════════════════

	describe("clear", () => {
		it("should remove all extensions", () => {
			registry.register(createExtension("alpha"));
			registry.register(createExtension("beta"));
			registry.register(createExtension("gamma"));

			registry.clear();

			expect(registry.size).toBe(0);
			expect(registry.getAvailableUIExtensions()).toEqual([]);
		});

		it("should fire unregister events for each cleared extension", () => {
			registry.register(createExtension("alpha"));
			registry.register(createExtension("beta"));

			const events: UIExtensionEvent[] = [];
			registry.onChange((e) => events.push(e));

			registry.clear();

			expect(events).toHaveLength(2);
			expect(events.every((e) => e.type === "unregistered")).toBe(true);
			const names = events.map((e) => e.skillName).sort();
			expect(names).toEqual(["alpha", "beta"]);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// size
	// ═══════════════════════════════════════════════════════════════════════

	describe("size", () => {
		it("should return 0 for empty registry", () => {
			expect(registry.size).toBe(0);
		});

		it("should return correct count after registrations", () => {
			registry.register(createExtension("a"));
			registry.register(createExtension("b"));
			registry.register(createExtension("c"));
			expect(registry.size).toBe(3);
		});

		it("should decrease after unregister", () => {
			registry.register(createExtension("a"));
			registry.register(createExtension("b"));
			registry.unregister("a");
			expect(registry.size).toBe(1);
		});
	});
});
