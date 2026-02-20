/**
 * WebSocket connection status indicator with ECG heartbeat trace.
 *
 * Renders an animated SVG ECG line reflecting the current WebSocket state:
 * green sweep for connected, yellow blink for connecting, red slow pulse
 * for disconnected. The ECG shape is always visible regardless of state.
 * When a tool is actively running, shows the tool name with a pulse.
 * @module components/ws-indicator
 */

import { wsStatus, activeToolName } from "../signals/realtime.js";
import type { WsStatus } from "../signals/realtime.js";

/** Map of connection states to display colours. */
const STATUS_COLORS: Record<WsStatus, string> = {
	connected: "var(--color-success)",
	connecting: "var(--color-warning)",
	disconnected: "var(--color-error)",
};

/** Animation CSS class per connection state. */
const STATUS_CLASSES: Record<WsStatus, string> = {
	connected: "hub-ecg-sweep",
	connecting: "hub-ecg-blink",
	disconnected: "hub-ecg-pulse",
};

/**
 * ECG heartbeat SVG path.
 * Flat -> P-wave bump -> flat -> QRS spike -> flat -> T-wave -> flat.
 */
const ECG_PATH =
	"M0,12 L8,12 L10,10 L12,12 L18,12 L20,12 " +
	"L22,2 L24,22 L26,8 L28,12 L34,12 L36,14 L38,10 L40,12 L48,12";

/** ECG trace dimensions for the SVG viewBox. */
const ECG_WIDTH = 48;
const ECG_HEIGHT = 24;

/**
 * Renders an animated ECG heartbeat trace indicating WebSocket health.
 * The heartbeat shape is always visible; only colour and animation vary.
 * Shows the active tool name when a tool is executing.
 */
export function WsIndicator(): preact.JSX.Element {
	const status = wsStatus.value;
	const color = STATUS_COLORS[status];
	const animClass = STATUS_CLASSES[status];
	const toolName = activeToolName.value;
	const isAlive = status === "connected";

	return (
		<div
			title={`WebSocket: ${status}${toolName ? ` | Running: ${toolName}` : ""}`}
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: "var(--space-sm)",
				cursor: "default",
			}}
		>
			{/* Active tool indicator */}
			{toolName && (
				<span
					style={{
						fontSize: "var(--font-size-xs)",
						color: "var(--color-accent)",
						fontWeight: 500,
						maxWidth: "140px",
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
					class="hub-tool-pulse"
				>
					{toolName}
				</span>
			)}

			{/* ECG heartbeat trace — always shows ECG shape */}
			<svg
				width="72"
				height="22"
				viewBox={`0 0 ${ECG_WIDTH} ${ECG_HEIGHT}`}
				style={{ overflow: "visible" }}
			>
				<defs>
					<filter id="ecg-glow">
						<feGaussianBlur stdDeviation="1.5" result="blur" />
						<feMerge>
							<feMergeNode in="blur" />
							<feMergeNode in="SourceGraphic" />
						</feMerge>
					</filter>
				</defs>

				{/* Background trace (dim, always ECG shape) */}
				<path
					d={ECG_PATH}
					fill="none"
					stroke={color}
					strokeWidth="1"
					opacity="0.2"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>

				{/* Animated foreground trace */}
				<path
					d={ECG_PATH}
					fill="none"
					stroke={color}
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
					filter={isAlive ? "url(#ecg-glow)" : undefined}
					class={animClass}
					strokeDasharray={isAlive ? "80" : undefined}
					strokeDashoffset={isAlive ? "80" : undefined}
				/>
			</svg>

			<span style={{ fontSize: "var(--font-size-sm)", color: "var(--color-muted)" }}>
				{status}
			</span>

			<style>{`
				/* Connected: green sweep along the ECG path */
				.hub-ecg-sweep {
					animation: hub-ecg-sweep-kf 1.8s linear infinite;
				}
				@keyframes hub-ecg-sweep-kf {
					0% { stroke-dashoffset: 80; }
					100% { stroke-dashoffset: -80; }
				}

				/* Connecting: yellow blink (fade in/out) */
				.hub-ecg-blink {
					animation: hub-ecg-blink-kf 1s ease-in-out infinite;
				}
				@keyframes hub-ecg-blink-kf {
					0%, 100% { opacity: 0.3; }
					50% { opacity: 1; }
				}

				/* Disconnected: red slow pulse (dimmer, slower) */
				.hub-ecg-pulse {
					animation: hub-ecg-pulse-kf 2.5s ease-in-out infinite;
				}
				@keyframes hub-ecg-pulse-kf {
					0%, 100% { opacity: 0.35; }
					50% { opacity: 0.85; }
				}

				/* Tool name pulse */
				.hub-tool-pulse {
					animation: hub-tool-pulse-kf 1.5s ease-in-out infinite;
				}
				@keyframes hub-tool-pulse-kf {
					0%, 100% { opacity: 1; }
					50% { opacity: 0.5; }
				}
			`}</style>
		</div>
	);
}
