/**
 * Error boundary component for catching render errors.
 *
 * Wraps child components and catches uncaught exceptions during
 * rendering, displaying a retry card instead of a blank screen.
 * Uses Preact's class component `componentDidCatch` lifecycle.
 * @module components/error-boundary
 */

import { Component } from "preact";
import type { ComponentChildren } from "preact";

// ── Types ─────────────────────────────────────────────────────────

/** Props for the {@link ErrorBoundary} component. */
interface ErrorBoundaryProps {
	children: ComponentChildren;
}

/** Internal state for tracking caught errors. */
interface ErrorBoundaryState {
	hasError: boolean;
	error: Error | null;
}

// ── Component ─────────────────────────────────────────────────────

/**
 * Catches render errors from child components and displays a
 * recoverable error card with a retry button.
 *
 * Mount at the root of the application (wrapping the router) to
 * prevent full-page crashes.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	state: ErrorBoundaryState = { hasError: false, error: null };

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error): void {
		console.error("[ErrorBoundary] Caught render error:", error);
	}

	/** Reset the error state and re-render children. */
	private handleRetry = (): void => {
		this.setState({ hasError: false, error: null });
	};

	render(): ComponentChildren {
		if (this.state.hasError) {
			return (
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						justifyContent: "center",
						minHeight: "300px",
						padding: "var(--space-2xl)",
						textAlign: "center",
					}}
				>
					<div
						style={{
							background: "var(--color-surface)",
							border: "1px solid var(--color-error)",
							borderRadius: "var(--radius-lg)",
							padding: "var(--space-xl) var(--space-2xl)",
							maxWidth: "440px",
						}}
					>
						<div style={{ fontSize: "32px", marginBottom: "var(--space-lg)" }}>
							{"\u26A0\uFE0F"}
						</div>
						<div style={{ fontSize: "var(--font-size-base)", color: "var(--color-text)", fontWeight: 600, marginBottom: "var(--space-sm)" }}>
							Something went wrong
						</div>
						<div style={{ fontSize: "var(--font-size-md)", color: "var(--color-muted)", marginBottom: "var(--space-lg)", lineHeight: 1.5 }}>
							{this.state.error?.message ?? "An unexpected error occurred while rendering this page."}
						</div>
						<button
							onClick={this.handleRetry}
							style={{
								padding: "var(--space-sm) var(--space-xl)",
								background: "var(--color-accent)",
								color: "var(--color-white)",
								border: "none",
								borderRadius: "var(--radius-md)",
								fontSize: "var(--font-size-md)",
								cursor: "pointer",
							}}
						>
							Retry
						</button>
					</div>
				</div>
			);
		}

		return this.props.children;
	}
}
