/**
 * Generic tab component with signal-based active state.
 *
 * Renders a horizontal tab bar where clicking a tab updates the active
 * key. Uses Preact signals for reactive state without prop drilling.
 * @module components/tabs
 */

import { signal, type Signal } from "@preact/signals";
import type { ComponentChildren } from "preact";

// ── Types ─────────────────────────────────────────────────────────

/** A single tab definition. */
export interface TabDef {
	/** Unique key used to match with content. */
	key: string;
	/** Display label for the tab button. */
	label: string;
}

/** Props for the {@link Tabs} component. */
export interface TabsProps {
	/** Tab definitions — at least two required. */
	tabs: TabDef[];
	/** Signal tracking the currently active tab key. */
	activeKey: Signal<string>;
	/** Optional tab content rendered below the tab bar. */
	children?: ComponentChildren;
}

// ── Helpers ───────────────────────────────────────────────────────

/** Create a tab state signal initialised to the given key. */
export function createTabSignal(initial: string): Signal<string> {
	return signal(initial);
}

// ── Component ─────────────────────────────────────────────────────

/**
 * Horizontal tab bar with signal-driven active state.
 *
 * The active tab is highlighted with the accent colour. Renders
 * children below the tab bar — consumers conditionally render
 * content based on `activeKey.value`.
 */
export function Tabs({ tabs, activeKey, children }: TabsProps): preact.JSX.Element {
	return (
		<div>
			<div
				style={{
					display: "flex",
					gap: "var(--space-xs)",
					marginBottom: "var(--space-xl)",
					borderBottom: "1px solid var(--color-border)",
					paddingBottom: "0",
				}}
			>
				{tabs.map((tab) => {
					const active = activeKey.value === tab.key;
					return (
						<button
							key={tab.key}
							onClick={() => { activeKey.value = tab.key; }}
							style={{
								padding: "var(--space-sm) var(--space-lg)",
								background: "transparent",
								color: active ? "var(--color-accent)" : "var(--color-muted)",
								border: "none",
								borderBottom: active ? "2px solid var(--color-accent)" : "2px solid transparent",
								fontSize: "var(--font-size-md)",
								fontWeight: active ? 600 : 400,
								cursor: "pointer",
								transition: `color var(--transition-fast), border-color var(--transition-fast)`,
								marginBottom: "-1px",
							}}
						>
							{tab.label}
						</button>
					);
				})}
			</div>
			{children}
		</div>
	);
}
