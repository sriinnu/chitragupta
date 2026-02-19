/**
 * WebSocket connection status indicator.
 *
 * Renders a small coloured dot reflecting the current WebSocket state:
 * green for connected, yellow for connecting, red for disconnected.
 * Hover tooltip shows the status text.
 * @module components/ws-indicator
 */

import { wsStatus } from "../signals/realtime.js";
import type { WsStatus } from "../signals/realtime.js";

/** Map of connection states to display colours. */
const STATUS_COLORS: Record<WsStatus, string> = {
	connected: "#22c55e",
	connecting: "#eab308",
	disconnected: "#ef4444",
};

/**
 * Renders a small coloured dot indicating WebSocket connection health.
 * Shows a tooltip on hover with the current status text.
 */
export function WsIndicator(): preact.JSX.Element {
	const status = wsStatus.value;
	const color = STATUS_COLORS[status];

	return (
		<div
			title={`WebSocket: ${status}`}
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: "6px",
				cursor: "default",
			}}
		>
			<span
				style={{
					width: "8px",
					height: "8px",
					borderRadius: "50%",
					backgroundColor: color,
					display: "inline-block",
					boxShadow: `0 0 4px ${color}`,
				}}
			/>
			<span style={{ fontSize: "12px", color: "#8888a0" }}>{status}</span>
		</div>
	);
}
