/**
 * Floating live chat panel for interacting with the Chitragupta agent.
 *
 * Toggle via a FAB button in the bottom-right corner. Uses the
 * existing WebSocket `chat` message type for send/receive. Streams
 * responses in real-time via `stream:text` events.
 * @module components/chat-panel
 */

import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import { effect } from "@preact/signals";
import { Spinner } from "./spinner.js";
import { Badge } from "./badge.js";
import {
	lastEvent,
	activeToolName,
	streamBuffer,
	sendWsMessage,
	wsStatus,
} from "../signals/realtime.js";

// ── Types ─────────────────────────────────────────────────────────

/** A single message in the chat history. */
interface ChatMessage {
	role: "user" | "assistant";
	content: string;
	timestamp: number;
}

// ── Component ─────────────────────────────────────────────────────

/**
 * Floating chat panel component.
 *
 * Renders a FAB toggle button and, when open, a panel with message
 * history, streaming response, and input bar. Uses the WebSocket
 * for real-time communication.
 */
export function ChatPanel(): preact.JSX.Element {
	const [open, setOpen] = useState(false);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [input, setInput] = useState("");
	const [waiting, setWaiting] = useState(false);
	const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);
	const scrollRef = useRef<HTMLDivElement>(null);

	// Auto-scroll on new messages or stream updates
	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	});

	// Listen for chat:done to finalize the assistant response
	useEffect(() => {
		const dispose = effect(() => {
			const ev = lastEvent.value;
			if (!ev || !currentRequestId) return;

			if (ev.type === "chat:done") {
				const finalContent = streamBuffer.peek();
				if (finalContent) {
					setMessages((prev) => [
						...prev,
						{ role: "assistant", content: finalContent, timestamp: Date.now() },
					]);
				}
				setWaiting(false);
				setCurrentRequestId(null);
			}
		});
		return dispose;
	}, [currentRequestId]);

	/** Send a chat message via WebSocket. */
	const handleSend = useCallback(() => {
		const text = input.trim();
		if (!text || waiting || wsStatus.value !== "connected") return;

		const requestId = `hub-${Date.now()}`;
		setCurrentRequestId(requestId);
		setMessages((prev) => [...prev, { role: "user", content: text, timestamp: Date.now() }]);
		setInput("");
		setWaiting(true);

		sendWsMessage({ type: "chat", data: { message: text }, requestId });
	}, [input, waiting]);

	/** Abort the current request. */
	const handleAbort = useCallback(() => {
		if (currentRequestId) {
			sendWsMessage({ action: "abort", requestId: currentRequestId });
			setWaiting(false);
			setCurrentRequestId(null);
		}
	}, [currentRequestId]);

	const handleKeyDown = useCallback((e: KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	}, [handleSend]);

	const connected = wsStatus.value === "connected";
	const currentStream = waiting ? streamBuffer.value : "";
	const currentTool = activeToolName.value;

	// FAB button only (when closed)
	if (!open) {
		return (
			<button
				onClick={() => setOpen(true)}
				style={{
					position: "fixed",
					bottom: "var(--space-xl)",
					right: "var(--space-xl)",
					width: "48px",
					height: "48px",
					borderRadius: "50%",
					background: "var(--color-accent)",
					color: "var(--color-white)",
					border: "none",
					fontSize: "20px",
					cursor: "pointer",
					boxShadow: "var(--shadow-lg)",
					zIndex: 90,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
				}}
				title="Open chat"
			>
				{"\uD83D\uDCAC"}
			</button>
		);
	}

	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				right: 0,
				bottom: 0,
				width: "400px",
				maxWidth: "100vw",
				background: "var(--color-bg)",
				borderLeft: "1px solid var(--color-border)",
				display: "flex",
				flexDirection: "column",
				zIndex: 90,
				boxShadow: "var(--shadow-lg)",
			}}
		>
			{/* Header */}
			<div style={{
				padding: "var(--space-md) var(--space-lg)",
				borderBottom: "1px solid var(--color-border)",
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
			}}>
				<div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
					<span style={{ fontSize: "var(--font-size-base)", color: "var(--color-text)", fontWeight: 600 }}>Chat</span>
					<Badge label={connected ? "connected" : "offline"} variant={connected ? "success" : "error"} />
				</div>
				<button
					onClick={() => setOpen(false)}
					style={{
						background: "none",
						border: "none",
						color: "var(--color-muted)",
						fontSize: "18px",
						cursor: "pointer",
					}}
				>
					{"\u2715"}
				</button>
			</div>

			{/* Messages */}
			<div
				ref={scrollRef}
				style={{
					flex: 1,
					overflowY: "auto",
					padding: "var(--space-lg)",
					display: "flex",
					flexDirection: "column",
					gap: "var(--space-md)",
				}}
			>
				{messages.length === 0 && !waiting && (
					<div style={{ color: "var(--color-muted)", fontSize: "var(--font-size-md)", textAlign: "center", padding: "var(--space-2xl)" }}>
						Send a message to start chatting.
					</div>
				)}

				{messages.map((msg, i) => (
					<MessageBubble key={i} message={msg} />
				))}

				{/* Streaming response */}
				{waiting && (
					<div style={{
						background: "var(--color-surface)",
						borderRadius: "var(--radius-lg) var(--radius-lg) var(--radius-lg) 0",
						padding: "var(--space-md)",
						borderLeft: "3px solid var(--color-success)",
					}}>
						{currentTool && (
							<div style={{ marginBottom: "var(--space-sm)" }}>
								<Badge label={`running: ${currentTool}`} variant="accent" />
							</div>
						)}
						{currentStream ? (
							<div style={{ fontSize: "var(--font-size-md)", color: "var(--color-text)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
								{currentStream}
							</div>
						) : (
							<Spinner size="sm" />
						)}
					</div>
				)}
			</div>

			{/* Input bar */}
			<div style={{
				padding: "var(--space-md) var(--space-lg)",
				borderTop: "1px solid var(--color-border)",
				display: "flex",
				gap: "var(--space-sm)",
			}}>
				{waiting ? (
					<button
						onClick={handleAbort}
						style={{
							flex: 1,
							padding: "var(--space-sm) var(--space-lg)",
							background: "var(--color-error-muted)",
							color: "var(--color-error)",
							border: "none",
							borderRadius: "var(--radius-md)",
							fontSize: "var(--font-size-md)",
							cursor: "pointer",
						}}
					>
						Abort
					</button>
				) : (
					<>
						<input
							type="text"
							value={input}
							onInput={(e) => setInput((e.target as HTMLInputElement).value)}
							onKeyDown={handleKeyDown}
							placeholder={connected ? "Type a message..." : "WebSocket disconnected"}
							disabled={!connected}
							style={{
								flex: 1,
								padding: "var(--space-sm) var(--space-md)",
								background: "var(--color-surface)",
								border: "1px solid var(--color-border)",
								borderRadius: "var(--radius-md)",
								color: "var(--color-text)",
								fontSize: "var(--font-size-md)",
								outline: "none",
							}}
						/>
						<button
							onClick={handleSend}
							disabled={!input.trim() || !connected}
							style={{
								padding: "var(--space-sm) var(--space-lg)",
								background: "var(--color-accent)",
								color: "var(--color-white)",
								border: "none",
								borderRadius: "var(--radius-md)",
								fontSize: "var(--font-size-md)",
								cursor: input.trim() && connected ? "pointer" : "default",
							}}
						>
							Send
						</button>
					</>
				)}
			</div>
		</div>
	);
}

// ── Message bubble ────────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }): preact.JSX.Element {
	const isUser = message.role === "user";
	return (
		<div style={{ alignSelf: isUser ? "flex-end" : "flex-start", maxWidth: "85%" }}>
			<div style={{
				background: isUser ? "var(--color-accent-muted)" : "var(--color-surface)",
				borderRadius: isUser
					? "var(--radius-lg) var(--radius-lg) 0 var(--radius-lg)"
					: "var(--radius-lg) var(--radius-lg) var(--radius-lg) 0",
				padding: "var(--space-sm) var(--space-md)",
				borderLeft: isUser ? "none" : "3px solid var(--color-success)",
			}}>
				<div style={{ fontSize: "var(--font-size-md)", color: "var(--color-text)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
					{message.content}
				</div>
			</div>
		</div>
	);
}
