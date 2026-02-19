/**
 * Root application component for Chitragupta Hub.
 *
 * Sets up hash-based routing via preact-router and wraps all
 * pages in a shared {@link Layout}. When no JWT token is present,
 * the Pairing page is shown instead of the router.
 * @module app
 */

import Router from "preact-router";
import { Layout } from "./components/layout.js";
import { isAuthenticated } from "./signals/auth.js";

// ── Placeholder page components ────────────────────────────────────

/** Overview dashboard page. */
function Overview(): preact.JSX.Element {
	return <div>Overview</div>;
}

/** Session browser page. */
function Sessions(): preact.JSX.Element {
	return <div>Sessions</div>;
}

/** Model registry page. */
function Models(): preact.JSX.Element {
	return <div>Models</div>;
}

/** Provider configuration page. */
function Providers(): preact.JSX.Element {
	return <div>Providers</div>;
}

/** Memory explorer page. */
function Memory(): preact.JSX.Element {
	return <div>Memory</div>;
}

/** Skill catalogue page. */
function Skills(): preact.JSX.Element {
	return <div>Skills</div>;
}

/** Settings page. */
function Settings(): preact.JSX.Element {
	return <div>Settings</div>;
}

/** Device management page. */
function Devices(): preact.JSX.Element {
	return <div>Devices</div>;
}

/** Device pairing / initial auth page. */
function Pairing(): preact.JSX.Element {
	return <div>Pairing</div>;
}

// ── App root ───────────────────────────────────────────────────────

/**
 * Root application component.
 *
 * Checks the auth signal to decide between the main router and the
 * pairing screen. All routes are wrapped in the shared Layout.
 */
export function App(): preact.JSX.Element {
	if (!isAuthenticated.value) {
		return (
			<Layout>
				<Pairing />
			</Layout>
		);
	}

	return (
		<Layout>
			<Router>
				<Overview path="/" />
				<Sessions path="/sessions" />
				<Models path="/models" />
				<Providers path="/providers" />
				<Memory path="/memory" />
				<Skills path="/skills" />
				<Settings path="/settings" />
				<Devices path="/devices" />
				<Pairing path="/pair" />
			</Router>
		</Layout>
	);
}
