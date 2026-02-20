/**
 * Welcome onboarding card for first-time Hub visitors.
 *
 * Shown on the Overview page when `hub_onboarded` is not set in
 * localStorage. Walks the user through the key dashboard sections
 * and hides permanently when dismissed.
 * @module components/welcome
 */

import { useState } from "preact/hooks";
import { route } from "preact-router";

// ── Types ─────────────────────────────────────────────────────────

/** A single step in the getting-started checklist. */
interface Step {
	label: string;
	description: string;
	navigateTo: string;
	icon: string;
}

// ── Constants ─────────────────────────────────────────────────────

const STORAGE_KEY = "hub_onboarded";

const STEPS: Step[] = [
	{
		label: "Check System Health",
		description: "View budget, session costs, and daemon status on this page.",
		navigateTo: "/",
		icon: "\uD83D\uDCCA",
	},
	{
		label: "Browse Sessions",
		description: "View turn-by-turn conversation history and token usage.",
		navigateTo: "/sessions",
		icon: "\uD83D\uDDC2",
	},
	{
		label: "Explore Models",
		description: "See available models, compare costs, and view router decisions.",
		navigateTo: "/models",
		icon: "\uD83E\uDD16",
	},
	{
		label: "Configure Providers",
		description: "Add or test AI provider connections (Anthropic, OpenAI, Ollama).",
		navigateTo: "/providers",
		icon: "\uD83D\uDD0C",
	},
	{
		label: "Inspect Memory",
		description: "Search GraphRAG nodes, consolidation rules, and learned patterns.",
		navigateTo: "/memory",
		icon: "\uD83E\uDDE0",
	},
	{
		label: "Manage Devices",
		description: "View paired browsers and revoke access if needed.",
		navigateTo: "/devices",
		icon: "\uD83D\uDCF1",
	},
];

// ── Component ─────────────────────────────────────────────────────

/**
 * First-visit welcome card with a getting-started checklist.
 *
 * Each step links to the relevant dashboard page. Once dismissed
 * via the close button, the card never appears again (persisted
 * in localStorage).
 */
export function Welcome(): preact.JSX.Element | null {
	const [visible, setVisible] = useState(
		() => !localStorage.getItem(STORAGE_KEY),
	);

	if (!visible) return null;

	const dismiss = (): void => {
		localStorage.setItem(STORAGE_KEY, "1");
		setVisible(false);
	};

	return (
		<div
			style={{
				background: "linear-gradient(135deg, rgba(99,102,241,0.12), rgba(59,130,246,0.08))",
				border: "1px solid rgba(99,102,241,0.3)",
				borderRadius: "10px",
				padding: "24px",
				marginBottom: "28px",
				position: "relative",
			}}
		>
			{/* Close button */}
			<button
				onClick={dismiss}
				style={{
					position: "absolute",
					top: "12px",
					right: "14px",
					background: "none",
					border: "none",
					color: "#8888a0",
					fontSize: "18px",
					cursor: "pointer",
					padding: "4px",
					lineHeight: 1,
				}}
				aria-label="Dismiss welcome"
			>
				{"\u2715"}
			</button>

			<h2 style={{ color: "#e8e8ed", fontSize: "18px", marginBottom: "4px" }}>
				Welcome to Chitragupta Hub
			</h2>
			<p style={{ color: "#8888a0", fontSize: "13px", marginBottom: "20px", maxWidth: "600px" }}>
				You're paired and ready to go. Here's a quick tour of what you can do
				from this dashboard. Click any item to jump to that section.
			</p>

			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
					gap: "10px",
				}}
			>
				{STEPS.map((step) => (
					<button
						key={step.navigateTo}
						onClick={() => route(step.navigateTo)}
						style={{
							display: "flex",
							alignItems: "flex-start",
							gap: "10px",
							padding: "12px 14px",
							background: "rgba(22,22,30,0.7)",
							border: "1px solid #2a2a3a",
							borderRadius: "8px",
							textAlign: "left",
							cursor: "pointer",
							transition: "border-color 0.15s",
						}}
					>
						<span style={{ fontSize: "20px", lineHeight: 1, marginTop: "2px" }}>
							{step.icon}
						</span>
						<div>
							<div style={{ color: "#e8e8ed", fontSize: "13px", fontWeight: 600, marginBottom: "2px" }}>
								{step.label}
							</div>
							<div style={{ color: "#8888a0", fontSize: "12px", lineHeight: 1.4 }}>
								{step.description}
							</div>
						</div>
					</button>
				))}
			</div>

			<div style={{ marginTop: "16px", fontSize: "12px", color: "#8888a0" }}>
				Need the CLI too? Run{" "}
				<code style={{ color: "#6366f1", background: "#16161e", padding: "2px 6px", borderRadius: "4px" }}>
					chitragupta 'Hello'
				</code>{" "}
				to start a conversation, or{" "}
				<code style={{ color: "#6366f1", background: "#16161e", padding: "2px 6px", borderRadius: "4px" }}>
					chitragupta daemon start
				</code>{" "}
				for background services.
			</div>
		</div>
	);
}
