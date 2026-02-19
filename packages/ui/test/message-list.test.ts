/**
 * Tests for MessageList — scrollable conversation display with role-based
 * rendering, streaming updates, and collapsible tool output.
 */
import { describe, it, expect } from "vitest";
import { stripAnsi } from "../src/ansi.js";
import { MessageList } from "../src/components/message-list.js";
import type { KeyEvent } from "../src/keys.js";

/** Helper to create a minimal KeyEvent */
function key(name: string, opts?: Partial<KeyEvent>): KeyEvent {
	return { name, ctrl: false, meta: false, shift: false, sequence: "", ...opts };
}

describe("MessageList", () => {
	describe("construction", () => {
		it("creates empty list", () => {
			const ml = new MessageList();
			expect(ml.messageCount).toBe(0);
		});
	});

	describe("addMessage", () => {
		it("adds messages and increments count", () => {
			const ml = new MessageList();
			ml.addMessage("user", "Hello");
			ml.addMessage("assistant", "Hi there");
			expect(ml.messageCount).toBe(2);
		});

		it("auto-scrolls to bottom on add", () => {
			const ml = new MessageList();
			for (let i = 0; i < 20; i++) {
				ml.addMessage("user", `Message ${i}`);
			}
			// Render with small height — should show last messages
			const lines = ml.render(60, 5);
			const stripped = lines.map(stripAnsi).join("\n");
			// The latest message should be visible
			expect(stripped).toContain("Message 19");
		});
	});

	describe("updateLastMessage", () => {
		it("updates the last message content", () => {
			const ml = new MessageList();
			ml.addMessage("assistant", "streaming...");
			ml.updateLastMessage("streaming complete!");
			const lines = ml.render(60, 20);
			const stripped = lines.map(stripAnsi).join("\n");
			expect(stripped).toContain("streaming complete!");
		});

		it("does nothing on empty list", () => {
			const ml = new MessageList();
			ml.updateLastMessage("no-op");
			expect(ml.messageCount).toBe(0);
		});
	});

	describe("render", () => {
		it("renders user messages with prompt symbol", () => {
			const ml = new MessageList();
			ml.addMessage("user", "Hello world");
			const lines = ml.render(60, 20);
			const stripped = lines.map(stripAnsi).join("\n");
			expect(stripped).toContain("You");
			expect(stripped).toContain("Hello world");
		});

		it("renders assistant messages with agent name", () => {
			const ml = new MessageList();
			ml.addMessage("assistant", "I can help");
			const lines = ml.render(60, 20);
			const stripped = lines.map(stripAnsi).join("\n");
			expect(stripped).toContain("Chitragupta");
		});

		it("renders assistant messages with custom agent name", () => {
			const ml = new MessageList();
			ml.addMessage("assistant", "response", { agent: "Kartru" });
			const lines = ml.render(60, 20);
			const stripped = lines.map(stripAnsi).join("\n");
			expect(stripped).toContain("Kartru");
		});

		it("renders assistant messages with model info", () => {
			const ml = new MessageList();
			ml.addMessage("assistant", "response", { model: "claude-3-opus" });
			const lines = ml.render(60, 20);
			const stripped = lines.map(stripAnsi).join("\n");
			expect(stripped).toContain("claude-3-opus");
		});

		it("renders tool messages with gear icon", () => {
			const ml = new MessageList();
			ml.addMessage("tool", "running command", { toolName: "bash" });
			const lines = ml.render(60, 20);
			const stripped = lines.map(stripAnsi).join("\n");
			expect(stripped).toContain("bash");
		});

		it("renders collapsible tool output", () => {
			const ml = new MessageList();
			ml.addMessage("tool", "run", { toolName: "test", toolOutput: "output line 1\noutput line 2" });
			const lines = ml.render(60, 20);
			const stripped = lines.map(stripAnsi).join("\n");
			// Default collapsed — should show preview
			expect(stripped).toContain("Tab to expand");
		});

		it("renders system messages in muted style", () => {
			const ml = new MessageList();
			ml.addMessage("system", "System notice");
			const lines = ml.render(60, 20);
			const stripped = lines.map(stripAnsi).join("\n");
			expect(stripped).toContain("System notice");
		});

		it("renders error messages with error symbol", () => {
			const ml = new MessageList();
			ml.addMessage("error", "Something went wrong");
			const lines = ml.render(60, 20);
			const stripped = lines.map(stripAnsi).join("\n");
			expect(stripped).toContain("Error");
			expect(stripped).toContain("Something went wrong");
		});

		it("renders generic messages for unknown roles", () => {
			const ml = new MessageList();
			ml.addMessage("custom", "Custom role");
			const lines = ml.render(60, 20);
			const stripped = lines.map(stripAnsi).join("\n");
			expect(stripped).toContain("custom");
			expect(stripped).toContain("Custom role");
		});

		it("pads output to fill height", () => {
			const ml = new MessageList();
			ml.addMessage("user", "short");
			const lines = ml.render(60, 20);
			expect(lines).toHaveLength(20);
		});
	});

	describe("scrolling", () => {
		it("scrolls up on shift+up", () => {
			const ml = new MessageList();
			for (let i = 0; i < 30; i++) ml.addMessage("user", `Msg ${i}`);
			ml.render(60, 5); // initial render at bottom
			ml.handleKey(key("up", { shift: true }));
			const lines = ml.render(60, 5);
			// After scrolling up, should not show the last message
			const stripped = lines.map(stripAnsi).join("\n");
			expect(stripped).not.toContain("Msg 29");
		});

		it("scrolls down on shift+down", () => {
			const ml = new MessageList();
			for (let i = 0; i < 30; i++) ml.addMessage("user", `Msg ${i}`);
			ml.render(60, 5);
			ml.handleKey(key("up", { shift: true }));
			ml.handleKey(key("up", { shift: true }));
			ml.handleKey(key("down", { shift: true }));
			// Should have scrolled back down partially
			const lines = ml.render(60, 5);
			expect(lines.length).toBe(5);
		});

		it("supports pageup/pagedown", () => {
			const ml = new MessageList();
			for (let i = 0; i < 50; i++) ml.addMessage("user", `Line ${i}`);
			ml.render(60, 5);
			ml.handleKey(key("pageup"));
			const lines = ml.render(60, 5);
			const stripped = lines.map(stripAnsi).join("\n");
			// After pageup from bottom, should not show the very last message
			expect(stripped).not.toContain("Line 49");
		});

		it("ctrl+home scrolls to top", () => {
			const ml = new MessageList();
			for (let i = 0; i < 30; i++) ml.addMessage("user", `Msg ${i}`);
			ml.render(60, 5);
			ml.handleKey(key("home", { ctrl: true }));
			const lines = ml.render(60, 5);
			const stripped = lines.map(stripAnsi).join("\n");
			expect(stripped).toContain("Msg 0");
		});

		it("ctrl+end scrolls to bottom", () => {
			const ml = new MessageList();
			for (let i = 0; i < 30; i++) ml.addMessage("user", `Msg ${i}`);
			ml.render(60, 5);
			ml.handleKey(key("home", { ctrl: true }));
			ml.handleKey(key("end", { ctrl: true }));
			const lines = ml.render(60, 5);
			const stripped = lines.map(stripAnsi).join("\n");
			expect(stripped).toContain("Msg 29");
		});
	});

	describe("tool collapse toggle", () => {
		it("tab toggles tool output collapse", () => {
			const ml = new MessageList();
			ml.addMessage("tool", "run", { toolName: "test", toolOutput: "detailed output" });
			ml.render(60, 20);
			// Initially collapsed
			let stripped = ml.render(60, 20).map(stripAnsi).join("\n");
			expect(stripped).toContain("Tab to expand");

			// Toggle to expand
			ml.handleKey(key("tab"));
			stripped = ml.render(60, 20).map(stripAnsi).join("\n");
			expect(stripped).toContain("Tab to collapse");
			expect(stripped).toContain("detailed output");
		});
	});

	describe("scrollToBottom", () => {
		it("scrolls to bottom programmatically", () => {
			const ml = new MessageList();
			for (let i = 0; i < 30; i++) ml.addMessage("user", `Msg ${i}`);
			ml.render(60, 5);
			ml.handleKey(key("home", { ctrl: true })); // scroll to top
			ml.scrollToBottom();
			const lines = ml.render(60, 5);
			const stripped = lines.map(stripAnsi).join("\n");
			expect(stripped).toContain("Msg 29");
		});
	});

	describe("clear", () => {
		it("removes all messages", () => {
			const ml = new MessageList();
			ml.addMessage("user", "msg1");
			ml.addMessage("user", "msg2");
			ml.clear();
			expect(ml.messageCount).toBe(0);
		});
	});
});
