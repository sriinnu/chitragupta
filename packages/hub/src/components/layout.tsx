/**
 * Shell layout for the Chitragupta Hub SPA.
 *
 * Renders a fixed sidebar with navigation links, a slim topbar with
 * the WebSocket indicator, and a scrollable content area for pages.
 * @module components/layout
 */

import type { ComponentChildren } from "preact";
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

// ── Constants ─────────────────────────────────────────────────────

const NAV_ITEMS: NavItem[] = [
	{ path: "/", label: "Overview", icon: "\uD83D\uDCCA" },
	{ path: "/sessions", label: "Sessions", icon: "\uD83D\uDDC2" },
	{ path: "/models", label: "Models", icon: "\uD83E\uDD16" },
	{ path: "/providers", label: "Providers", icon: "\uD83D\uDD0C" },
	{ path: "/memory", label: "Memory", icon: "\uD83E\uDDE0" },
	{ path: "/skills", label: "Skills", icon: "\u26A1" },
	{ path: "/settings", label: "Settings", icon: "\u2699\uFE0F" },
	{ path: "/devices", label: "Devices", icon: "\uD83D\uDCF1" },
];

const SIDEBAR_WIDTH = 240;
const TOPBAR_HEIGHT = 48;

// ── Component ─────────────────────────────────────────────────────

/**
 * Top-level layout shell with sidebar, topbar, and content area.
 *
 * The sidebar displays the app title and navigation links. The active
 * link is highlighted with the accent colour background. The topbar
 * shows the WebSocket connection indicator.
 */
export function Layout({ children, currentUrl }: LayoutProps): preact.JSX.Element {
	const activePath = currentUrl ?? "/";

	return (
		<div style={{ display: "flex", minHeight: "100vh", background: "#0a0a0f" }}>
			{/* ── Sidebar ───────────────────────────────────────── */}
			<nav
				style={{
					width: `${SIDEBAR_WIDTH}px`,
					minWidth: `${SIDEBAR_WIDTH}px`,
					background: "#0d0d14",
					borderRight: "1px solid #2a2a3a",
					display: "flex",
					flexDirection: "column",
					padding: "16px 0",
				}}
			>
				<div
					style={{
						padding: "0 20px 20px",
						borderBottom: "1px solid #2a2a3a",
						marginBottom: "8px",
					}}
				>
					<span style={{ fontSize: "18px", fontWeight: "bold", color: "#e8e8ed" }}>
						Chitragupta
					</span>
					<div style={{ fontSize: "11px", color: "#8888a0", marginTop: "2px" }}>
						Hub Dashboard
					</div>
				</div>

				{NAV_ITEMS.map((item) => {
					const isActive = activePath === item.path;
					return (
						<a
							key={item.path}
							href={item.path}
							style={{
								display: "flex",
								alignItems: "center",
								gap: "10px",
								padding: "10px 20px",
								color: isActive ? "#e8e8ed" : "#8888a0",
								backgroundColor: isActive ? "rgba(99, 102, 241, 0.15)" : "transparent",
								borderLeft: isActive ? "3px solid #6366f1" : "3px solid transparent",
								textDecoration: "none",
								fontSize: "14px",
								transition: "background-color 0.15s, color 0.15s",
							}}
						>
							<span style={{ fontSize: "16px", width: "20px", textAlign: "center" }}>
								{item.icon}
							</span>
							{item.label}
						</a>
					);
				})}
			</nav>

			{/* ── Main area ─────────────────────────────────────── */}
			<div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
				{/* Topbar */}
				<header
					style={{
						height: `${TOPBAR_HEIGHT}px`,
						borderBottom: "1px solid #2a2a3a",
						display: "flex",
						alignItems: "center",
						justifyContent: "flex-end",
						padding: "0 20px",
						gap: "16px",
					}}
				>
					<WsIndicator />
				</header>

				{/* Content */}
				<main
					style={{
						flex: 1,
						padding: "24px",
						overflowY: "auto",
					}}
				>
					{children}
				</main>
			</div>
		</div>
	);
}
