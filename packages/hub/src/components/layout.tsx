/**
 * Shell layout for the Chitragupta Hub SPA.
 *
 * Renders a responsive sidebar with navigation links, a topbar with
 * breadcrumbs and the WebSocket indicator, and a scrollable content
 * area for pages. Sidebar collapses to a hamburger on narrow viewports.
 * @module components/layout
 */

import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { route } from "preact-router";
import { WsIndicator } from "./ws-indicator.js";

// ── Types ─────────────────────────────────────────────────────────

/** Props accepted by the {@link Layout} component. */
export interface LayoutProps {
	children: ComponentChildren;
	/** Current URL path for highlighting the active nav link. */
	currentUrl?: string;
}

/** A single navigation entry. */
interface NavItem {
	path: string;
	label: string;
	icon: string;
}

/** A navigation section with grouped items. */
interface NavSection {
	title: string;
	items: NavItem[];
}

// ── Constants ─────────────────────────────────────────────────────

const NAV_SECTIONS: NavSection[] = [
	{
		title: "Dashboard",
		items: [
			{ path: "/", label: "Overview", icon: "\uD83D\uDCCA" },
			{ path: "/sessions", label: "Sessions", icon: "\uD83D\uDDC2" },
			{ path: "/models", label: "Models", icon: "\uD83E\uDD16" },
			{ path: "/providers", label: "Providers", icon: "\uD83D\uDD0C" },
		],
	},
	{
		title: "Cognitive",
		items: [
			{ path: "/consciousness", label: "Consciousness", icon: "\uD83E\uDDD8" },
			{ path: "/intelligence", label: "Intelligence", icon: "\uD83E\uDDE0" },
			{ path: "/evolution", label: "Evolution", icon: "\uD83C\uDF31" },
		],
	},
	{
		title: "System",
		items: [
			{ path: "/memory", label: "Memory", icon: "\uD83D\uDCDD" },
			{ path: "/skills", label: "Skills", icon: "\u26A1" },
			{ path: "/collaboration", label: "Collaboration", icon: "\uD83E\uDD1D" },
			{ path: "/agents", label: "Agents", icon: "\uD83D\uDC65" },
			{ path: "/workflows", label: "Workflows", icon: "\uD83D\uDD04" },
		],
	},
	{
		title: "Config",
		items: [
			{ path: "/settings", label: "Settings", icon: "\u2699\uFE0F" },
			{ path: "/devices", label: "Devices", icon: "\uD83D\uDCF1" },
		],
	},
];

/** Map from path to human-readable breadcrumb label. */
const BREADCRUMB_LABELS: Record<string, string> = {
	"/": "Overview",
	"/sessions": "Sessions",
	"/models": "Models",
	"/providers": "Providers",
	"/consciousness": "Consciousness",
	"/intelligence": "Intelligence",
	"/evolution": "Evolution",
	"/memory": "Memory",
	"/skills": "Skills",
	"/collaboration": "Collaboration",
	"/agents": "Agents",
	"/workflows": "Workflows",
	"/settings": "Settings",
	"/devices": "Devices",
	"/pair": "Pairing",
};

// ── Helpers ───────────────────────────────────────────────────────

/** Check if the given path matches the current URL (prefix match for sub-paths). */
function isActivePath(activePath: string, itemPath: string): boolean {
	if (itemPath === "/") return activePath === "/";
	return activePath === itemPath || activePath.startsWith(`${itemPath}/`);
}

/** Derive breadcrumb text from the current URL. */
function getBreadcrumb(path: string): string {
	return BREADCRUMB_LABELS[path] ?? path.slice(1).replace(/-/g, " ");
}

// ── Component ─────────────────────────────────────────────────────

/**
 * Top-level layout shell with responsive sidebar, breadcrumb topbar,
 * and content area.
 *
 * The sidebar displays grouped navigation sections. Active links use
 * prefix matching so sub-paths stay highlighted. A hamburger toggle
 * appears on narrow viewports (<768px).
 */
export function Layout({ children, currentUrl }: LayoutProps): preact.JSX.Element {
	const activePath = currentUrl ?? "/";
	const [sidebarOpen, setSidebarOpen] = useState(false);

	return (
		<div style={{ display: "flex", minHeight: "100vh", background: "var(--color-bg)" }}>
			{/* ── Mobile overlay ───────────────────────────────── */}
			{sidebarOpen && (
				<div
					onClick={() => setSidebarOpen(false)}
					style={{
						position: "fixed",
						inset: 0,
						background: "rgba(0,0,0,0.5)",
						zIndex: 40,
					}}
				/>
			)}

			{/* ── Sidebar ───────────────────────────────────────── */}
			<nav
				style={{
					width: "var(--sidebar-width)",
					minWidth: "var(--sidebar-width)",
					background: "var(--color-sidebar)",
					borderRight: "1px solid var(--color-border)",
					display: "flex",
					flexDirection: "column",
					padding: "var(--space-lg) 0",
					position: sidebarOpen ? "fixed" : undefined,
					top: sidebarOpen ? 0 : undefined,
					left: sidebarOpen ? 0 : undefined,
					bottom: sidebarOpen ? 0 : undefined,
					zIndex: sidebarOpen ? 50 : undefined,
					overflowY: "auto",
				}}
				class="hub-sidebar"
			>
				{/* Branding */}
				<div
					style={{
						padding: "0 var(--space-xl) var(--space-xl)",
						borderBottom: "1px solid var(--color-border)",
						marginBottom: "var(--space-sm)",
					}}
				>
					<span style={{ fontSize: "var(--font-size-lg)", fontWeight: "bold", color: "var(--color-text)" }}>
						Chitragupta
					</span>
					<div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)", marginTop: "2px" }}>
						Hub Dashboard
					</div>
				</div>

				{/* Nav sections */}
				{NAV_SECTIONS.map((section) => (
					<div key={section.title} style={{ marginBottom: "var(--space-xs)" }}>
						<div
							style={{
								padding: "var(--space-sm) var(--space-xl)",
								fontSize: "var(--font-size-xs)",
								color: "var(--color-muted)",
								textTransform: "uppercase",
								letterSpacing: "0.5px",
								fontWeight: 600,
							}}
						>
							{section.title}
						</div>
						{section.items.map((item) => {
							const active = isActivePath(activePath, item.path);
							return (
								<a
									key={item.path}
									href={item.path}
									onClick={(e: Event) => {
										e.preventDefault();
										route(item.path);
										setSidebarOpen(false);
									}}
									style={{
										display: "flex",
										alignItems: "center",
										gap: "10px",
										padding: "8px 20px",
										color: active ? "var(--color-text)" : "var(--color-muted)",
										backgroundColor: active ? "var(--color-accent-muted)" : "transparent",
										borderLeft: active ? "3px solid var(--color-accent)" : "3px solid transparent",
										textDecoration: "none",
										fontSize: "var(--font-size-base)",
										transition: `background-color var(--transition-fast), color var(--transition-fast)`,
									}}
								>
									<span style={{ fontSize: "var(--font-size-lg)", width: "20px", textAlign: "center" }}>
										{item.icon}
									</span>
									{item.label}
								</a>
							);
						})}
					</div>
				))}
			</nav>

			{/* ── Main area ─────────────────────────────────────── */}
			<div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
				{/* Topbar */}
				<header
					style={{
						height: "var(--topbar-height)",
						borderBottom: "1px solid var(--color-border)",
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						padding: "0 var(--space-xl)",
						gap: "var(--space-lg)",
					}}
				>
					{/* Left: hamburger + breadcrumb */}
					<div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
						<button
							onClick={() => setSidebarOpen(!sidebarOpen)}
							class="hub-hamburger"
							style={{
								display: "none",
								background: "none",
								border: "none",
								color: "var(--color-muted)",
								fontSize: "20px",
								cursor: "pointer",
								padding: "var(--space-xs)",
							}}
						>
							{sidebarOpen ? "\u2715" : "\u2630"}
						</button>
						<div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
							<span style={{ fontSize: "var(--font-size-sm)", color: "var(--color-muted)" }}>
								Hub
							</span>
							<span style={{ fontSize: "var(--font-size-sm)", color: "var(--color-border)" }}>/</span>
							<span style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text)", fontWeight: 500 }}>
								{getBreadcrumb(activePath)}
							</span>
						</div>
					</div>

					{/* Right: WS indicator */}
					<WsIndicator />
				</header>

				{/* Content */}
				<main
					style={{
						flex: 1,
						padding: "var(--space-xl)",
						overflowY: "auto",
					}}
				>
					{children}
				</main>
			</div>

			{/* ── Responsive styles ───────────────────────────── */}
			<style>{`
				@media (max-width: 768px) {
					.hub-sidebar { display: none !important; }
					.hub-sidebar[style*="position: fixed"] { display: flex !important; }
					.hub-hamburger { display: block !important; }
				}
			`}</style>
		</div>
	);
}
