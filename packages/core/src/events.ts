import type { EventBus } from "./types.js";

/**
 * Create a simple typed event emitter with no external dependencies.
 *
 * Provides on/off/emit/once/removeAll methods for decoupled event-driven
 * communication between Chitragupta subsystems.
 *
 * Handlers that throw are caught and logged, preventing one broken listener
 * from disrupting others.
 *
 * @returns A new {@link EventBus} instance.
 *
 * @example
 * ```ts
 * const bus = createEventBus();
 * bus.on("session:created", (data) => console.log(data));
 * bus.emit("session:created", { id: "s-123" });
 * ```
 */
export function createEventBus(): EventBus {
	const listeners = new Map<string, Set<(...args: any[]) => void>>();

	return {
		on<T>(event: string, handler: (data: T) => void): void {
			if (!listeners.has(event)) {
				listeners.set(event, new Set());
			}
			listeners.get(event)!.add(handler);
		},

		off(event: string, handler: (...args: any[]) => void): void {
			listeners.get(event)?.delete(handler);
		},

		emit<T>(event: string, data: T): void {
			const handlers = listeners.get(event);
			if (!handlers) return;
			for (const handler of handlers) {
				try {
					handler(data);
				} catch (_err) {
					// Handler errors are caught to prevent one broken listener from disrupting others.
					// Cannot log here — core has no logger dependency. Consumers should wrap handlers.
				}
			}
		},

		once<T>(event: string, handler: (data: T) => void): void {
			const wrapper = (data: T) => {
				listeners.get(event)?.delete(wrapper);
				handler(data);
			};
			if (!listeners.has(event)) {
				listeners.set(event, new Set());
			}
			listeners.get(event)!.add(wrapper);
		},

		removeAll(event?: string): void {
			if (event) {
				listeners.delete(event);
			} else {
				listeners.clear();
			}
		},
	};
}
