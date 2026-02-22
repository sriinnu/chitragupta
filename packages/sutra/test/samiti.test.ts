import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Samiti } from "@chitragupta/sutra";
import type { SamitiMessage, SamitiChannel } from "@chitragupta/sutra";

describe("Samiti", () => {
	let samiti: Samiti;

	beforeEach(() => {
		samiti = new Samiti();
	});

	afterEach(() => {
		samiti.destroy();
	});

	// ═══════════════════════════════════════════════════════════════
	// DEFAULT CHANNELS
	// ═══════════════════════════════════════════════════════════════

	describe("default channels", () => {
		it("should create 5 default channels on construction", () => {
			const channels = samiti.listChannels();
			expect(channels).toHaveLength(5);
		});

		it("should include #security channel", () => {
			const ch = samiti.getChannel("#security");
			expect(ch).toBeDefined();
			expect(ch!.name).toBe("#security");
			expect(ch!.description).toContain("Security");
		});

		it("should include #performance channel", () => {
			const ch = samiti.getChannel("#performance");
			expect(ch).toBeDefined();
			expect(ch!.description).toContain("Performance");
		});

		it("should include #correctness channel", () => {
			const ch = samiti.getChannel("#correctness");
			expect(ch).toBeDefined();
		});

		it("should include #style channel", () => {
			const ch = samiti.getChannel("#style");
			expect(ch).toBeDefined();
		});

		it("should include #alerts channel", () => {
			const ch = samiti.getChannel("#alerts");
			expect(ch).toBeDefined();
		});

		it("should have empty subscribers on default channels", () => {
			const ch = samiti.getChannel("#security")!;
			expect(ch.subscribers.size).toBe(0);
		});

		it("should have empty messages on default channels", () => {
			const ch = samiti.getChannel("#security")!;
			expect(ch.messages).toHaveLength(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// CHANNEL CREATION
	// ═══════════════════════════════════════════════════════════════

	describe("createChannel", () => {
		it("should create a new channel with given name and description", () => {
			const ch = samiti.createChannel("#testing", "Test observations");
			expect(ch.name).toBe("#testing");
			expect(ch.description).toBe("Test observations");
			expect(ch.subscribers.size).toBe(0);
			expect(ch.messages).toHaveLength(0);
		});

		it("should set createdAt to current time", () => {
			const before = Date.now();
			const ch = samiti.createChannel("#testing", "Tests");
			const after = Date.now();
			expect(ch.createdAt).toBeGreaterThanOrEqual(before);
			expect(ch.createdAt).toBeLessThanOrEqual(after);
		});

		it("should use defaultMaxHistory when maxHistory not specified", () => {
			const s = new Samiti({ defaultMaxHistory: 50 });
			const ch = s.createChannel("#custom", "Custom channel");
			expect(ch.maxHistory).toBe(50);
			s.destroy();
		});

		it("should respect custom maxHistory", () => {
			const ch = samiti.createChannel("#custom", "Custom", 200);
			expect(ch.maxHistory).toBe(200);
		});

		it("should clamp maxHistory to HARD_CEILING (10000)", () => {
			const ch = samiti.createChannel("#custom", "Custom", 999_999);
			expect(ch.maxHistory).toBe(10_000);
		});

		it("should throw when channel name already exists", () => {
			expect(() => samiti.createChannel("#security", "Duplicate")).toThrow(
				'Channel "#security" already exists.',
			);
		});

		it("should throw when max channels limit is reached", () => {
			// Default 5 channels + create 15 more = 20 (default maxChannels)
			for (let i = 0; i < 15; i++) {
				samiti.createChannel(`#ch-${i}`, `Channel ${i}`);
			}
			expect(() => samiti.createChannel("#overflow", "Too many")).toThrow(
				"Maximum channels reached",
			);
		});

		it("should respect custom maxChannels config", () => {
			const s = new Samiti({ maxChannels: 6 }); // 5 defaults + 1 more
			s.createChannel("#extra", "One more");
			expect(() => s.createChannel("#toomany", "Nope")).toThrow("Maximum channels reached");
			s.destroy();
		});

		it("should clamp maxChannels to HARD_CEILING (100)", () => {
			const s = new Samiti({ maxChannels: 500 });
			// Should be clamped to 100; we can create 95 more (5 defaults)
			for (let i = 0; i < 95; i++) {
				s.createChannel(`#ch-${i}`, `Channel ${i}`);
			}
			expect(() => s.createChannel("#overflow", "Too many")).toThrow(
				"Maximum channels reached",
			);
			s.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// CHANNEL DELETION
	// ═══════════════════════════════════════════════════════════════

	describe("deleteChannel", () => {
		it("should delete an existing channel", () => {
			expect(samiti.deleteChannel("#security")).toBe(true);
			expect(samiti.getChannel("#security")).toBeUndefined();
		});

		it("should return false for non-existent channel", () => {
			expect(samiti.deleteChannel("#nope")).toBe(false);
		});

		it("should free up a slot for a new channel after deletion", () => {
			const s = new Samiti({ maxChannels: 6 });
			s.createChannel("#extra", "Extra");
			expect(() => s.createChannel("#another", "Another")).toThrow("Maximum channels reached");
			s.deleteChannel("#extra");
			expect(() => s.createChannel("#another", "Another")).not.toThrow();
			s.destroy();
		});

		it("should remove listeners for the deleted channel", () => {
			const handler = vi.fn();
			samiti.onMessage("#security", handler);
			samiti.deleteChannel("#security");
			// Re-create and broadcast — old handler should not fire
			samiti.createChannel("#security", "Recreated");
			samiti.broadcast("#security", {
				channel: "#security",
				sender: "test",
				severity: "info",
				category: "test",
				content: "After deletion",
			});
			expect(handler).not.toHaveBeenCalled();
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// GET & LIST CHANNELS
	// ═══════════════════════════════════════════════════════════════

	describe("getChannel", () => {
		it("should return undefined for non-existent channel", () => {
			expect(samiti.getChannel("#nonexistent")).toBeUndefined();
		});

		it("should return a snapshot (not a live reference)", () => {
			const ch1 = samiti.getChannel("#security")!;
			samiti.subscribe("#security", "agent-1");
			const ch2 = samiti.getChannel("#security")!;
			// ch1 snapshot should not reflect the new subscriber
			expect(ch1.subscribers.size).toBe(0);
			expect(ch2.subscribers.size).toBe(1);
		});
	});

	describe("listChannels", () => {
		it("should return all channels sorted by creation time", () => {
			const channels = samiti.listChannels();
			for (let i = 1; i < channels.length; i++) {
				expect(channels[i].createdAt).toBeGreaterThanOrEqual(channels[i - 1].createdAt);
			}
		});

		it("should return empty array after all channels are deleted", () => {
			for (const ch of samiti.listChannels()) {
				samiti.deleteChannel(ch.name);
			}
			expect(samiti.listChannels()).toHaveLength(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// SUBSCRIBE / UNSUBSCRIBE
	// ═══════════════════════════════════════════════════════════════

	describe("subscribe", () => {
		it("should add an agent to a channel's subscribers", () => {
			samiti.subscribe("#security", "agent-1");
			const ch = samiti.getChannel("#security")!;
			expect(ch.subscribers.has("agent-1")).toBe(true);
		});

		it("should handle duplicate subscribe gracefully (idempotent)", () => {
			samiti.subscribe("#security", "agent-1");
			samiti.subscribe("#security", "agent-1"); // No error
			const ch = samiti.getChannel("#security")!;
			expect(ch.subscribers.size).toBe(1);
		});

		it("should throw for non-existent channel", () => {
			expect(() => samiti.subscribe("#nope", "agent-1")).toThrow(
				'Channel "#nope" does not exist.',
			);
		});

		it("should throw when max subscribers per channel is reached", () => {
			for (let i = 0; i < 50; i++) {
				samiti.subscribe("#security", `agent-${i}`);
			}
			expect(() => samiti.subscribe("#security", "agent-overflow")).toThrow(
				"subscriber limit",
			);
		});

		it("should allow same agent on multiple channels", () => {
			samiti.subscribe("#security", "agent-1");
			samiti.subscribe("#performance", "agent-1");
			expect(samiti.getChannel("#security")!.subscribers.has("agent-1")).toBe(true);
			expect(samiti.getChannel("#performance")!.subscribers.has("agent-1")).toBe(true);
		});
	});

	describe("unsubscribe", () => {
		it("should remove an agent from a channel's subscribers", () => {
			samiti.subscribe("#security", "agent-1");
			samiti.unsubscribe("#security", "agent-1");
			const ch = samiti.getChannel("#security")!;
			expect(ch.subscribers.has("agent-1")).toBe(false);
		});

		it("should not throw when unsubscribing an agent that isn't subscribed", () => {
			expect(() => samiti.unsubscribe("#security", "nobody")).not.toThrow();
		});

		it("should throw for non-existent channel", () => {
			expect(() => samiti.unsubscribe("#nope", "agent-1")).toThrow(
				'Channel "#nope" does not exist.',
			);
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// BROADCAST
	// ═══════════════════════════════════════════════════════════════

	describe("broadcast", () => {
		it("should return a fully-formed message", () => {
			const msg = samiti.broadcast("#security", {
				channel: "#security",
				sender: "anveshi",
				severity: "warning",
				category: "credential-leak",
				content: "API key found in config.ts",
			});
			expect(msg.id).toMatch(/^sam-[0-9a-f]{8}$/);
			expect(msg.channel).toBe("#security");
			expect(msg.sender).toBe("anveshi");
			expect(msg.severity).toBe("warning");
			expect(msg.category).toBe("credential-leak");
			expect(msg.content).toBe("API key found in config.ts");
			expect(msg.timestamp).toBeGreaterThan(0);
			expect(msg.ttl).toBe(86_400_000); // Default 24h
		});

		it("should allow custom TTL", () => {
			const msg = samiti.broadcast("#alerts", {
				channel: "#alerts",
				sender: "system",
				severity: "info",
				category: "heartbeat",
				content: "Agent alive",
				ttl: 5000,
			});
			expect(msg.ttl).toBe(5000);
		});

		it("should store message in channel history", () => {
			samiti.broadcast("#security", {
				channel: "#security",
				sender: "test",
				severity: "info",
				category: "test",
				content: "Hello",
			});
			const history = samiti.getHistory("#security");
			expect(history).toHaveLength(1);
			expect(history[0].content).toBe("Hello");
		});

		it("should preserve message references", () => {
			const msg1 = samiti.broadcast("#correctness", {
				channel: "#correctness",
				sender: "test",
				severity: "info",
				category: "test",
				content: "First",
			});
			const msg2 = samiti.broadcast("#correctness", {
				channel: "#correctness",
				sender: "test",
				severity: "info",
				category: "test",
				content: "Related",
				references: [msg1.id],
			});
			expect(msg2.references).toEqual([msg1.id]);
		});

		it("should store structured data in data field", () => {
			const msg = samiti.broadcast("#performance", {
				channel: "#performance",
				sender: "profiler",
				severity: "warning",
				category: "slow-query",
				content: "Query took 5s",
				data: { queryTime: 5000, table: "users" },
			});
			expect(msg.data).toEqual({ queryTime: 5000, table: "users" });
		});

		it("should throw for non-existent channel", () => {
			expect(() =>
				samiti.broadcast("#nonexistent", {
					channel: "#nonexistent",
					sender: "test",
					severity: "info",
					category: "test",
					content: "Hello",
				}),
			).toThrow('Channel "#nonexistent" does not exist.');
		});

		it("should throw when message content exceeds maxMessageSize", () => {
			const hugeContent = "x".repeat(1_048_577);
			expect(() =>
				samiti.broadcast("#security", {
					channel: "#security",
					sender: "test",
					severity: "info",
					category: "test",
					content: hugeContent,
				}),
			).toThrow("exceeds maximum");
		});

		it("should include data size in message size check", () => {
			const bigData = "y".repeat(1_048_570);
			expect(() =>
				samiti.broadcast("#security", {
					channel: "#security",
					sender: "test",
					severity: "info",
					category: "test",
					content: "small",
					data: bigData,
				}),
			).toThrow("exceeds maximum");
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// RING BUFFER OVERFLOW
	// ═══════════════════════════════════════════════════════════════

	describe("ring buffer overflow", () => {
		it("should drop oldest messages when maxHistory is exceeded", () => {
			const s = new Samiti({ defaultMaxHistory: 3, maxChannels: 10 });
			s.createChannel("#small", "Small buffer", 3);

			s.broadcast("#small", { channel: "#small", sender: "t", severity: "info", category: "c", content: "A" });
			s.broadcast("#small", { channel: "#small", sender: "t", severity: "info", category: "c", content: "B" });
			s.broadcast("#small", { channel: "#small", sender: "t", severity: "info", category: "c", content: "C" });
			s.broadcast("#small", { channel: "#small", sender: "t", severity: "info", category: "c", content: "D" }); // A drops

			const history = s.getHistory("#small");
			expect(history).toHaveLength(3);
			expect(history[0].content).toBe("B");
			expect(history[1].content).toBe("C");
			expect(history[2].content).toBe("D");
			s.destroy();
		});

		it("should maintain correct order after multiple overflows", () => {
			const s = new Samiti({ maxChannels: 10 });
			s.createChannel("#tiny", "Tiny buffer", 2);

			for (let i = 0; i < 10; i++) {
				s.broadcast("#tiny", { channel: "#tiny", sender: "t", severity: "info", category: "c", content: `${i}` });
			}

			const history = s.getHistory("#tiny");
			expect(history).toHaveLength(2);
			expect(history[0].content).toBe("8");
			expect(history[1].content).toBe("9");
			s.destroy();
		});

		it("should respect per-channel maxHistory", () => {
			samiti.createChannel("#big", "Big buffer", 500);
			samiti.createChannel("#small", "Small buffer", 5);

			const bigCh = samiti.getChannel("#big")!;
			const smallCh = samiti.getChannel("#small")!;
			expect(bigCh.maxHistory).toBe(500);
			expect(smallCh.maxHistory).toBe(5);
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// TTL EXPIRATION & PRUNING
	// ═══════════════════════════════════════════════════════════════

	describe("TTL expiration and pruning", () => {
		it("should remove expired messages on pruneExpired()", () => {
			vi.useFakeTimers();
			try {
				const s = new Samiti();
				s.broadcast("#security", {
					channel: "#security",
					sender: "test",
					severity: "info",
					category: "test",
					content: "Expires soon",
					ttl: 1000,
				});

				vi.advanceTimersByTime(1001);
				const pruned = s.pruneExpired();
				expect(pruned).toBe(1);
				expect(s.getHistory("#security")).toHaveLength(0);
				s.destroy();
			} finally {
				vi.useRealTimers();
			}
		});

		it("should not remove messages with ttl=0 (infinite)", () => {
			vi.useFakeTimers();
			try {
				const s = new Samiti();
				s.broadcast("#security", {
					channel: "#security",
					sender: "test",
					severity: "info",
					category: "test",
					content: "Lives forever",
					ttl: 0,
				});

				vi.advanceTimersByTime(999_999_999);
				const pruned = s.pruneExpired();
				expect(pruned).toBe(0);
				expect(s.getHistory("#security")).toHaveLength(1);
				s.destroy();
			} finally {
				vi.useRealTimers();
			}
		});

		it("should lazily prune on listen() calls", () => {
			vi.useFakeTimers();
			try {
				const s = new Samiti();
				s.broadcast("#security", {
					channel: "#security",
					sender: "test",
					severity: "info",
					category: "test",
					content: "Will expire",
					ttl: 500,
				});
				s.broadcast("#security", {
					channel: "#security",
					sender: "test",
					severity: "info",
					category: "test",
					content: "Stays longer",
					ttl: 5000,
				});

				vi.advanceTimersByTime(600);
				const results = s.listen("#security");
				expect(results).toHaveLength(1);
				expect(results[0].content).toBe("Stays longer");
				s.destroy();
			} finally {
				vi.useRealTimers();
			}
		});

		it("should prune selectively — only expired messages removed", () => {
			vi.useFakeTimers();
			try {
				const s = new Samiti();
				s.broadcast("#alerts", {
					channel: "#alerts",
					sender: "sys",
					severity: "info",
					category: "a",
					content: "Short lived",
					ttl: 100,
				});
				s.broadcast("#alerts", {
					channel: "#alerts",
					sender: "sys",
					severity: "warning",
					category: "b",
					content: "Medium lived",
					ttl: 5000,
				});
				s.broadcast("#alerts", {
					channel: "#alerts",
					sender: "sys",
					severity: "critical",
					category: "c",
					content: "Immortal",
					ttl: 0,
				});

				vi.advanceTimersByTime(200);
				const pruned = s.pruneExpired();
				expect(pruned).toBe(1);

				const remaining = s.getHistory("#alerts");
				expect(remaining).toHaveLength(2);
				expect(remaining[0].content).toBe("Medium lived");
				expect(remaining[1].content).toBe("Immortal");
				s.destroy();
			} finally {
				vi.useRealTimers();
			}
		});

		it("should return 0 when no messages are expired", () => {
			samiti.broadcast("#security", {
				channel: "#security",
				sender: "test",
				severity: "info",
				category: "test",
				content: "Fresh",
			});
			const pruned = samiti.pruneExpired();
			expect(pruned).toBe(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// LISTEN (FILTERING)
	// ═══════════════════════════════════════════════════════════════

	describe("listen", () => {
		it("should return all messages for a channel by default", () => {
			samiti.broadcast("#security", { channel: "#security", sender: "a", severity: "info", category: "c", content: "1" });
			samiti.broadcast("#security", { channel: "#security", sender: "b", severity: "warning", category: "c", content: "2" });
			const results = samiti.listen("#security");
			expect(results).toHaveLength(2);
		});

		it("should return empty array for non-existent channel", () => {
			expect(samiti.listen("#nonexistent")).toEqual([]);
		});

		it("should filter by severity", () => {
			samiti.broadcast("#security", { channel: "#security", sender: "a", severity: "info", category: "c", content: "Info" });
			samiti.broadcast("#security", { channel: "#security", sender: "a", severity: "warning", category: "c", content: "Warn" });
			samiti.broadcast("#security", { channel: "#security", sender: "a", severity: "critical", category: "c", content: "Crit" });

			const warnings = samiti.listen("#security", { severity: "warning" });
			expect(warnings).toHaveLength(1);
			expect(warnings[0].content).toBe("Warn");
		});

		it("should filter by since timestamp", () => {
			vi.useFakeTimers();
			try {
				const s = new Samiti();
				s.broadcast("#alerts", { channel: "#alerts", sender: "a", severity: "info", category: "c", content: "Old" });
				vi.advanceTimersByTime(1000);
				const cutoff = Date.now();
				vi.advanceTimersByTime(1000);
				s.broadcast("#alerts", { channel: "#alerts", sender: "a", severity: "info", category: "c", content: "New" });

				const results = s.listen("#alerts", { since: cutoff });
				expect(results).toHaveLength(1);
				expect(results[0].content).toBe("New");
				s.destroy();
			} finally {
				vi.useRealTimers();
			}
		});

		it("should respect limit parameter (most recent N)", () => {
			for (let i = 0; i < 10; i++) {
				samiti.broadcast("#security", { channel: "#security", sender: "a", severity: "info", category: "c", content: `${i}` });
			}
			const results = samiti.listen("#security", { limit: 3 });
			expect(results).toHaveLength(3);
			expect(results[0].content).toBe("7");
			expect(results[2].content).toBe("9");
		});

		it("should combine severity + since + limit filters", () => {
			vi.useFakeTimers();
			try {
				const s = new Samiti();

				// Old messages
				s.broadcast("#alerts", { channel: "#alerts", sender: "a", severity: "info", category: "c", content: "Old info" });
				s.broadcast("#alerts", { channel: "#alerts", sender: "a", severity: "warning", category: "c", content: "Old warn" });

				vi.advanceTimersByTime(1000);
				const cutoff = Date.now();
				vi.advanceTimersByTime(1000);

				// New messages
				s.broadcast("#alerts", { channel: "#alerts", sender: "a", severity: "info", category: "c", content: "New info 1" });
				s.broadcast("#alerts", { channel: "#alerts", sender: "a", severity: "warning", category: "c", content: "New warn 1" });
				s.broadcast("#alerts", { channel: "#alerts", sender: "a", severity: "warning", category: "c", content: "New warn 2" });
				s.broadcast("#alerts", { channel: "#alerts", sender: "a", severity: "info", category: "c", content: "New info 2" });

				const results = s.listen("#alerts", {
					severity: "warning",
					since: cutoff,
					limit: 1,
				});
				expect(results).toHaveLength(1);
				expect(results[0].content).toBe("New warn 2");
				s.destroy();
			} finally {
				vi.useRealTimers();
			}
		});

		it("should return empty array for channel with no matching messages", () => {
			samiti.broadcast("#security", { channel: "#security", sender: "a", severity: "info", category: "c", content: "Info" });
			const results = samiti.listen("#security", { severity: "critical" });
			expect(results).toEqual([]);
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// GET HISTORY
	// ═══════════════════════════════════════════════════════════════

	describe("getHistory", () => {
		it("should return empty array for non-existent channel", () => {
			expect(samiti.getHistory("#nonexistent")).toEqual([]);
		});

		it("should return messages oldest first", () => {
			samiti.broadcast("#security", { channel: "#security", sender: "a", severity: "info", category: "c", content: "First" });
			samiti.broadcast("#security", { channel: "#security", sender: "a", severity: "info", category: "c", content: "Second" });
			const history = samiti.getHistory("#security");
			expect(history[0].content).toBe("First");
			expect(history[1].content).toBe("Second");
		});

		it("should respect limit parameter", () => {
			for (let i = 0; i < 5; i++) {
				samiti.broadcast("#security", { channel: "#security", sender: "a", severity: "info", category: "c", content: `${i}` });
			}
			const history = samiti.getHistory("#security", 2);
			expect(history).toHaveLength(2);
			// Should return the most recent 2, oldest first
			expect(history[0].content).toBe("3");
			expect(history[1].content).toBe("4");
		});

		it("should not prune expired messages (raw history)", () => {
			vi.useFakeTimers();
			try {
				const s = new Samiti();
				s.broadcast("#security", {
					channel: "#security",
					sender: "a",
					severity: "info",
					category: "c",
					content: "Expired",
					ttl: 100,
				});
				vi.advanceTimersByTime(200);

				// getHistory returns raw data, no pruning
				const history = s.getHistory("#security");
				expect(history).toHaveLength(1);
				expect(history[0].content).toBe("Expired");
				s.destroy();
			} finally {
				vi.useRealTimers();
			}
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// REAL-TIME LISTENERS (onMessage)
	// ═══════════════════════════════════════════════════════════════

	describe("onMessage", () => {
		it("should invoke the handler on broadcast", () => {
			const handler = vi.fn();
			samiti.onMessage("#security", handler);
			samiti.broadcast("#security", {
				channel: "#security",
				sender: "test",
				severity: "info",
				category: "test",
				content: "Hello",
			});
			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler.mock.calls[0][0].content).toBe("Hello");
		});

		it("should support multiple listeners on the same channel", () => {
			const h1 = vi.fn();
			const h2 = vi.fn();
			samiti.onMessage("#security", h1);
			samiti.onMessage("#security", h2);
			samiti.broadcast("#security", {
				channel: "#security",
				sender: "test",
				severity: "info",
				category: "test",
				content: "Both",
			});
			expect(h1).toHaveBeenCalledTimes(1);
			expect(h2).toHaveBeenCalledTimes(1);
		});

		it("should return an unsubscribe function", () => {
			const handler = vi.fn();
			const unsub = samiti.onMessage("#security", handler);
			expect(unsub).toBeTypeOf("function");
		});

		it("should stop invoking handler after unsubscribe", () => {
			const handler = vi.fn();
			const unsub = samiti.onMessage("#security", handler);
			samiti.broadcast("#security", {
				channel: "#security",
				sender: "test",
				severity: "info",
				category: "test",
				content: "Before",
			});
			unsub();
			samiti.broadcast("#security", {
				channel: "#security",
				sender: "test",
				severity: "info",
				category: "test",
				content: "After",
			});
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it("should allow calling unsubscribe multiple times safely", () => {
			const handler = vi.fn();
			const unsub = samiti.onMessage("#security", handler);
			unsub();
			expect(() => unsub()).not.toThrow();
		});

		it("should not affect other listeners when one unsubscribes", () => {
			const h1 = vi.fn();
			const h2 = vi.fn();
			const unsub1 = samiti.onMessage("#security", h1);
			samiti.onMessage("#security", h2);

			unsub1();
			samiti.broadcast("#security", {
				channel: "#security",
				sender: "test",
				severity: "info",
				category: "test",
				content: "Only h2",
			});
			expect(h1).not.toHaveBeenCalled();
			expect(h2).toHaveBeenCalledTimes(1);
		});

		it("should isolate handler errors — one crash doesn't affect others", () => {
			const good = vi.fn();
			samiti.onMessage("#security", () => {
				throw new Error("Boom!");
			});
			samiti.onMessage("#security", good);

			samiti.broadcast("#security", {
				channel: "#security",
				sender: "test",
				severity: "info",
				category: "test",
				content: "Test",
			});
			expect(good).toHaveBeenCalledTimes(1);
		});

		it("should throw for non-existent channel", () => {
			expect(() => samiti.onMessage("#nope", vi.fn())).toThrow(
				'Channel "#nope" does not exist.',
			);
		});

		it("should not fire for messages on other channels", () => {
			const handler = vi.fn();
			samiti.onMessage("#security", handler);
			samiti.broadcast("#performance", {
				channel: "#performance",
				sender: "test",
				severity: "info",
				category: "test",
				content: "Wrong channel",
			});
			expect(handler).not.toHaveBeenCalled();
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// STATS
	// ═══════════════════════════════════════════════════════════════

	describe("stats", () => {
		it("should report correct channel count", () => {
			expect(samiti.stats().channels).toBe(5); // 5 defaults
		});

		it("should report 0 total messages initially", () => {
			expect(samiti.stats().totalMessages).toBe(0);
		});

		it("should report correct total messages after broadcasts", () => {
			samiti.broadcast("#security", { channel: "#security", sender: "a", severity: "info", category: "c", content: "1" });
			samiti.broadcast("#security", { channel: "#security", sender: "a", severity: "info", category: "c", content: "2" });
			samiti.broadcast("#performance", { channel: "#performance", sender: "a", severity: "info", category: "c", content: "3" });
			expect(samiti.stats().totalMessages).toBe(3);
		});

		it("should report unique subscribers across channels", () => {
			samiti.subscribe("#security", "agent-1");
			samiti.subscribe("#performance", "agent-1"); // Same agent, different channel
			samiti.subscribe("#security", "agent-2");
			expect(samiti.stats().subscribers).toBe(2); // 2 unique agents
		});

		it("should report 0 subscribers initially", () => {
			expect(samiti.stats().subscribers).toBe(0);
		});

		it("should update after channel deletion", () => {
			samiti.subscribe("#security", "agent-1");
			samiti.broadcast("#security", { channel: "#security", sender: "a", severity: "info", category: "c", content: "msg" });
			samiti.deleteChannel("#security");
			const s = samiti.stats();
			expect(s.channels).toBe(4);
			expect(s.totalMessages).toBe(0);
			expect(s.subscribers).toBe(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// MESSAGE IDS (FNV-1a)
	// ═══════════════════════════════════════════════════════════════

	describe("message IDs", () => {
		it("should generate IDs with sam- prefix", () => {
			const msg = samiti.broadcast("#security", {
				channel: "#security",
				sender: "test",
				severity: "info",
				category: "test",
				content: "Hello",
			});
			expect(msg.id).toMatch(/^sam-[0-9a-f]{8}$/);
		});

		it("should generate different IDs for different messages", () => {
			const msg1 = samiti.broadcast("#security", {
				channel: "#security",
				sender: "a",
				severity: "info",
				category: "c",
				content: "First",
			});
			// Small delay to ensure different timestamp
			const msg2 = samiti.broadcast("#security", {
				channel: "#security",
				sender: "b",
				severity: "info",
				category: "c",
				content: "Second",
			});
			// Different sender should produce different IDs even at same timestamp
			expect(msg1.id).not.toBe(msg2.id);
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// DESTROY
	// ═══════════════════════════════════════════════════════════════

	describe("destroy", () => {
		it("should throw on createChannel after destroy", () => {
			samiti.destroy();
			expect(() => samiti.createChannel("#new", "New")).toThrow("Samiti has been destroyed");
		});

		it("should throw on deleteChannel after destroy", () => {
			samiti.destroy();
			expect(() => samiti.deleteChannel("#security")).toThrow("Samiti has been destroyed");
		});

		it("should throw on subscribe after destroy", () => {
			samiti.destroy();
			expect(() => samiti.subscribe("#security", "agent")).toThrow("Samiti has been destroyed");
		});

		it("should throw on unsubscribe after destroy", () => {
			samiti.destroy();
			expect(() => samiti.unsubscribe("#security", "agent")).toThrow("Samiti has been destroyed");
		});

		it("should throw on broadcast after destroy", () => {
			samiti.destroy();
			expect(() =>
				samiti.broadcast("#security", {
					channel: "#security",
					sender: "test",
					severity: "info",
					category: "test",
					content: "Nope",
				}),
			).toThrow("Samiti has been destroyed");
		});

		it("should throw on listen after destroy", () => {
			samiti.destroy();
			expect(() => samiti.listen("#security")).toThrow("Samiti has been destroyed");
		});

		it("should throw on onMessage after destroy", () => {
			samiti.destroy();
			expect(() => samiti.onMessage("#security", vi.fn())).toThrow("Samiti has been destroyed");
		});

		it("should throw on pruneExpired after destroy", () => {
			samiti.destroy();
			expect(() => samiti.pruneExpired()).toThrow("Samiti has been destroyed");
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// EDGE CASES
	// ═══════════════════════════════════════════════════════════════

	describe("edge cases", () => {
		it("should handle empty content message", () => {
			const msg = samiti.broadcast("#security", {
				channel: "#security",
				sender: "test",
				severity: "info",
				category: "empty",
				content: "",
			});
			expect(msg.content).toBe("");
		});

		it("should handle undefined data field", () => {
			const msg = samiti.broadcast("#security", {
				channel: "#security",
				sender: "test",
				severity: "info",
				category: "test",
				content: "No data",
			});
			expect(msg.data).toBeUndefined();
		});

		it("should handle empty references array", () => {
			const msg = samiti.broadcast("#security", {
				channel: "#security",
				sender: "test",
				severity: "info",
				category: "test",
				content: "No refs",
				references: [],
			});
			expect(msg.references).toEqual([]);
		});

		it("should support channels without # prefix", () => {
			const ch = samiti.createChannel("custom-name", "No hash prefix");
			expect(ch.name).toBe("custom-name");
		});

		it("should handle listen on empty channel", () => {
			const results = samiti.listen("#security");
			expect(results).toEqual([]);
		});

		it("should handle limit larger than message count", () => {
			samiti.broadcast("#security", { channel: "#security", sender: "a", severity: "info", category: "c", content: "Only one" });
			const results = samiti.listen("#security", { limit: 100 });
			expect(results).toHaveLength(1);
		});

		it("should handle since in the future (returns nothing)", () => {
			samiti.broadcast("#security", { channel: "#security", sender: "a", severity: "info", category: "c", content: "Now" });
			const results = samiti.listen("#security", { since: Date.now() + 999999 });
			expect(results).toEqual([]);
		});

		it("should handle limit of 0", () => {
			samiti.broadcast("#security", { channel: "#security", sender: "a", severity: "info", category: "c", content: "A" });
			const results = samiti.listen("#security", { limit: 0 });
			expect(results).toHaveLength(0);
		});

		it("should allow creating a channel after deleting one at max capacity", () => {
			const s = new Samiti({ maxChannels: 6 });
			s.createChannel("#extra", "Extra");
			s.deleteChannel("#extra");
			expect(() => s.createChannel("#replacement", "Replacement")).not.toThrow();
			s.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// CONFIG CLAMPING
	// ═══════════════════════════════════════════════════════════════

	describe("config clamping", () => {
		it("should clamp maxChannels to hard ceiling", () => {
			const s = new Samiti({ maxChannels: 200 });
			// With 5 defaults, we can only add 95 more (clamped to 100)
			let created = 0;
			for (let i = 0; i < 100; i++) {
				try {
					s.createChannel(`#extra-${i}`, `Extra ${i}`);
					created++;
				} catch {
					break;
				}
			}
			expect(created).toBe(95); // 100 - 5 defaults
			s.destroy();
		});

		it("should clamp defaultMaxHistory to hard ceiling", () => {
			const s = new Samiti({ defaultMaxHistory: 50_000 });
			const ch = s.createChannel("#test", "Test");
			expect(ch.maxHistory).toBe(10_000);
			s.destroy();
		});

		it("should use defaults when no config provided", () => {
			const s = new Samiti();
			expect(s.stats().channels).toBe(5);
			s.destroy();
		});
	});
});
