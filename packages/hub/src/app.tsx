/**
 * Root application component for Chitragupta Hub.
 *
 * Sets up pathname-based routing via preact-router and wraps all
 * pages in a shared {@link Layout}. When no JWT token is present,
 * the Pairing page is shown instead of the router. Connects the
 * WebSocket event stream reactively when the auth signal changes.
 * @module app
 */

import { useEffect, useState } from "preact/hooks";
import { effect } from "@preact/signals";
import Router from "preact-router";
import { Layout } from "./components/layout.js";
import { ToastContainer } from "./components/toast.js";
import { ErrorBoundary } from "./components/error-boundary.js";
import { isAuthenticated } from "./signals/auth.js";
import { connectWebSocket, disconnectWebSocket } from "./signals/realtime.js";

// ── Page imports ────────────────────────────────────────────────

import { Overview } from "./pages/overview.js";
import { Sessions } from "./pages/sessions.js";
import { Models } from "./pages/models.js";
import { Providers } from "./pages/providers.js";
import { Memory } from "./pages/memory.js";
import { Skills } from "./pages/skills.js";
import { Settings } from "./pages/settings.js";
import { Devices } from "./pages/devices.js";
import { Pairing } from "./auth/pairing.js";
import { Consciousness } from "./pages/consciousness.js";
import { Intelligence } from "./pages/intelligence.js";
import { Collaboration } from "./pages/collaboration.js";
import { Evolution } from "./pages/evolution.js";
import { Agents } from "./pages/agents.js";
import { Workflows } from "./pages/workflows.js";
import { ChatPanel } from "./components/chat-panel.js";

// ── App root ───────────────────────────────────────────────────────

/**
 * Root application component.
 *
 * Checks the auth signal to decide between the main router and the
 * pairing screen. All routes are wrapped in the shared Layout.
 * Connects the WebSocket event stream when authenticated.
 */
export function App(): preact.JSX.Element {
	const [currentUrl, setCurrentUrl] = useState(window.location.pathname || "/");

	// Connect WebSocket reactively when auth state changes.
	// Uses @preact/signals `effect()` so signal reads are auto-tracked;
	// the inner disposer is cleaned up when the component unmounts.
	useEffect(() => {
		const dispose = effect(() => {
			if (isAuthenticated.value) {
				connectWebSocket();
			} else {
				disconnectWebSocket();
			}
		});
		return dispose;
	}, []);

	const handleRouteChange = (e: { url: string }): void => {
		setCurrentUrl(e.url);
	};

	if (!isAuthenticated.value) {
		return (
			<ErrorBoundary>
				<Layout currentUrl="/pair">
					<Pairing />
				</Layout>
				<ToastContainer />
			</ErrorBoundary>
		);
	}

	return (
		<ErrorBoundary>
			<Layout currentUrl={currentUrl}>
				<Router onChange={handleRouteChange}>
					<Overview path="/" />
					<Sessions path="/sessions" />
					<Models path="/models" />
					<Providers path="/providers" />
					<Memory path="/memory" />
					<Skills path="/skills" />
					<Settings path="/settings" />
					<Devices path="/devices" />
					<Consciousness path="/consciousness" />
					<Intelligence path="/intelligence" />
					<Collaboration path="/collaboration" />
					<Evolution path="/evolution" />
					<Agents path="/agents" />
					<Workflows path="/workflows" />
					<Pairing path="/pair" />
				</Router>
			</Layout>
			<ChatPanel />
			<ToastContainer />
		</ErrorBoundary>
	);
}
