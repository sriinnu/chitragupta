/**
 * Shared layout wrapper for all Hub pages.
 *
 * Provides a consistent shell (nav, header, footer) around page content.
 * @module components/layout
 */

import type { ComponentChildren } from "preact";

/** Props accepted by the {@link Layout} component. */
interface LayoutProps {
	children: ComponentChildren;
}

/**
 * Top-level layout component.
 *
 * Wraps child page content with navigation and chrome.
 * Currently a minimal pass-through; will gain nav sidebar, header, etc.
 */
export function Layout({ children }: LayoutProps): preact.JSX.Element {
	return <div class="hub-layout">{children}</div>;
}
