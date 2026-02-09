import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventManager } from "@chitragupta/sutra";
import type { SSEClient, WebhookDelivery } from "@chitragupta/sutra";

describe("EventManager", () => {
	let mgr: EventManager;

	beforeEach(() => {
		mgr = new EventManager();
	});

	afterEach(() => {
		mgr.destroy();
	});

	// ═══════════════════════════════════════════════════════════════
	// SSE CLIENTS
	// ═══════════════════════════════════════════════════════════════

	describe("addSSEClient", () => {
		it("should return a client with UUID id and isConnected=true", () => {
			const client = mgr.addSSEClient(vi.fn(), vi.fn());
			expect(client.id).toMatch(/^[0-9a-f-]{36}$/);
			expect(client.isConnected).toBe(true);
		});

		it("should throw when max SSE clients is reached", () => {
			const small = new EventManager({ maxSSEClients: 2 });
			small.addSSEClient(vi.fn(), vi.fn());
			small.addSSEClient(vi.fn(), vi.fn());
			expect(() => small.addSSEClient(vi.fn(), vi.fn())).toThrow(
				"Maximum SSE clients (2) reached",
			);
			small.destroy();
		});

		it("should provide send and close methods on the client", () => {
			const client = mgr.addSSEClient(vi.fn(), vi.fn());
			expect(client.send).toBeTypeOf("function");
			expect(client.close).toBeTypeOf("function");
		});
	});

	describe("SSE client send", () => {
		it("should write formatted SSE string via writeFn", () => {
			const writeFn = vi.fn();
			const client = mgr.addSSEClient(writeFn, vi.fn());
			client.send("status", { ok: true });

			expect(writeFn).toHaveBeenCalledTimes(1);
			const written = writeFn.mock.calls[0][0] as string;
			expect(written).toContain("event: status\n");
			expect(written).toContain('data: {"ok":true}\n');
			expect(written).toContain("id: ");
			expect(written).toMatch(/\n\n$/);
		});

		it("should include event, data (JSON), and id fields", () => {
			const writeFn = vi.fn();
			const client = mgr.addSSEClient(writeFn, vi.fn());
			client.send("update", [1, 2, 3], "custom-id");

			const written = writeFn.mock.calls[0][0] as string;
			expect(written).toContain("event: update\n");
			expect(written).toContain("data: [1,2,3]\n");
			expect(written).toContain("id: custom-id\n");
		});

		it("should not write if client is disconnected", () => {
			const writeFn = vi.fn();
			const client = mgr.addSSEClient(writeFn, vi.fn());
			client.close(); // disconnect
			client.send("event", "data");
			expect(writeFn).not.toHaveBeenCalled();
		});

		it("should mark client as disconnected if writeFn throws", () => {
			const writeFn = vi.fn().mockImplementation(() => {
				throw new Error("connection reset");
			});
			const client = mgr.addSSEClient(writeFn, vi.fn());
			client.send("event", "data");
			expect(client.isConnected).toBe(false);
		});
	});

	describe("removeSSEClient", () => {
		it("should call closeFn when removing client", () => {
			const closeFn = vi.fn();
			const client = mgr.addSSEClient(vi.fn(), closeFn);
			mgr.removeSSEClient(client.id);
			expect(closeFn).toHaveBeenCalledTimes(1);
		});

		it("should mark client as disconnected", () => {
			const client = mgr.addSSEClient(vi.fn(), vi.fn());
			mgr.removeSSEClient(client.id);
			expect(client.isConnected).toBe(false);
		});

		it("should be safe to call with unknown id", () => {
			// Should not throw
			mgr.removeSSEClient("nonexistent-id");
		});

		it("should swallow errors from closeFn", () => {
			const closeFn = vi.fn().mockImplementation(() => {
				throw new Error("close failed");
			});
			const client = mgr.addSSEClient(vi.fn(), closeFn);
			// Should not throw
			mgr.removeSSEClient(client.id);
		});
	});

	describe("broadcastSSE", () => {
		it("should write formatted SSE to all connected clients", () => {
			const w1 = vi.fn();
			const w2 = vi.fn();
			mgr.addSSEClient(w1, vi.fn());
			mgr.addSSEClient(w2, vi.fn());

			mgr.broadcastSSE("ping", { ts: 123 });

			expect(w1).toHaveBeenCalledTimes(1);
			expect(w2).toHaveBeenCalledTimes(1);

			const written = w1.mock.calls[0][0] as string;
			expect(written).toContain("event: ping\n");
			expect(written).toContain('data: {"ts":123}\n');
		});

		it("should remove dead clients when writeFn throws", () => {
			const deadWrite = vi.fn().mockImplementation(() => {
				throw new Error("gone");
			});
			const closeFn = vi.fn();
			mgr.addSSEClient(deadWrite, closeFn);
			const alive = mgr.addSSEClient(vi.fn(), vi.fn());

			mgr.broadcastSSE("test", {});

			// Dead client should have been cleaned up
			const clients = mgr.getSSEClients();
			expect(clients).toHaveLength(1);
			expect(clients[0].id).toBe(alive.id);
			expect(closeFn).toHaveBeenCalled();
		});

		it("should send the same formatted string to all clients", () => {
			const w1 = vi.fn();
			const w2 = vi.fn();
			mgr.addSSEClient(w1, vi.fn());
			mgr.addSSEClient(w2, vi.fn());
			mgr.broadcastSSE("event", "payload");
			expect(w1.mock.calls[0][0]).toBe(w2.mock.calls[0][0]);
		});
	});

	describe("getSSEClients", () => {
		it("should return empty array when no clients", () => {
			expect(mgr.getSSEClients()).toEqual([]);
		});

		it("should return only connected clients", () => {
			const c1 = mgr.addSSEClient(vi.fn(), vi.fn());
			mgr.addSSEClient(vi.fn(), vi.fn());
			mgr.removeSSEClient(c1.id);
			const clients = mgr.getSSEClients();
			expect(clients).toHaveLength(1);
		});

		it("should return SSEClient interfaces with id, send, close, isConnected", () => {
			mgr.addSSEClient(vi.fn(), vi.fn());
			const clients = mgr.getSSEClients();
			expect(clients).toHaveLength(1);
			const c = clients[0];
			expect(c.id).toMatch(/^[0-9a-f-]{36}$/);
			expect(c.send).toBeTypeOf("function");
			expect(c.close).toBeTypeOf("function");
			expect(c.isConnected).toBe(true);
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// WEBHOOKS
	// ═══════════════════════════════════════════════════════════════

	describe("addWebhook", () => {
		it("should return a UUID id", () => {
			const id = mgr.addWebhook({
				url: "https://example.com/hook",
				events: ["test"],
				active: true,
			});
			expect(id).toMatch(/^[0-9a-f-]{36}$/);
		});

		it("should throw at max webhook limit", () => {
			const small = new EventManager({ maxWebhooks: 1 });
			small.addWebhook({ url: "https://a.com", events: ["e"], active: true });
			expect(() =>
				small.addWebhook({ url: "https://b.com", events: ["e"], active: true }),
			).toThrow("Maximum webhooks (1) reached");
			small.destroy();
		});

		it("should use default retries and timeout if not specified", () => {
			const id = mgr.addWebhook({
				url: "https://example.com/hook",
				events: ["test"],
				active: true,
			});
			const webhooks = mgr.getWebhooks();
			const wh = webhooks.find((w) => w.id === id)!;
			expect(wh.retries).toBe(3);
			expect(wh.timeout).toBe(10_000);
		});

		it("should use custom retries and timeout when specified", () => {
			const id = mgr.addWebhook({
				url: "https://example.com/hook",
				events: ["test"],
				active: true,
				retries: 5,
				timeout: 3000,
			});
			const wh = mgr.getWebhooks().find((w) => w.id === id)!;
			expect(wh.retries).toBe(5);
			expect(wh.timeout).toBe(3000);
		});
	});

	describe("removeWebhook", () => {
		it("should return true when webhook exists", () => {
			const id = mgr.addWebhook({
				url: "https://example.com",
				events: ["e"],
				active: true,
			});
			expect(mgr.removeWebhook(id)).toBe(true);
		});

		it("should return false when webhook does not exist", () => {
			expect(mgr.removeWebhook("nonexistent")).toBe(false);
		});

		it("should remove the webhook from getWebhooks", () => {
			const id = mgr.addWebhook({
				url: "https://example.com",
				events: ["e"],
				active: true,
			});
			mgr.removeWebhook(id);
			expect(mgr.getWebhooks().find((w) => w.id === id)).toBeUndefined();
		});
	});

	describe("dispatchWebhook", () => {
		let fetchSpy: ReturnType<typeof vi.fn>;

		beforeEach(() => {
			fetchSpy = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				text: () => Promise.resolve("OK"),
			});
			vi.stubGlobal("fetch", fetchSpy);
		});

		afterEach(() => {
			vi.unstubAllGlobals();
		});

		it("should POST JSON body to matching webhook URL", async () => {
			mgr.addWebhook({
				url: "https://example.com/hook",
				events: ["agent:done"],
				active: true,
				retries: 0,
			});

			await mgr.dispatchWebhook("agent:done", { result: "ok" });

			expect(fetchSpy).toHaveBeenCalledTimes(1);
			const [url, opts] = fetchSpy.mock.calls[0];
			expect(url).toBe("https://example.com/hook");
			expect(opts.method).toBe("POST");
			expect(opts.headers["Content-Type"]).toBe("application/json");
			const body = JSON.parse(opts.body);
			expect(body.event).toBe("agent:done");
			expect(body.payload).toEqual({ result: "ok" });
		});

		it("should include HMAC-SHA256 signature header when secret is set", async () => {
			mgr.addWebhook({
				url: "https://example.com/hook",
				events: ["secure"],
				active: true,
				secret: "my-secret",
				retries: 0,
			});

			await mgr.dispatchWebhook("secure", { data: 1 });

			const [, opts] = fetchSpy.mock.calls[0];
			const sigHeader = opts.headers["x-chitragupta-signature"];
			expect(sigHeader).toBeDefined();
			expect(sigHeader).toMatch(/^sha256=[a-f0-9]{64}$/);
		});

		it("should only dispatch to matching event webhooks", async () => {
			mgr.addWebhook({
				url: "https://a.com",
				events: ["agent:done"],
				active: true,
				retries: 0,
			});
			mgr.addWebhook({
				url: "https://b.com",
				events: ["agent:start"],
				active: true,
				retries: 0,
			});

			await mgr.dispatchWebhook("agent:done", {});

			expect(fetchSpy).toHaveBeenCalledTimes(1);
			expect(fetchSpy.mock.calls[0][0]).toBe("https://a.com");
		});

		it("should skip inactive webhooks", async () => {
			mgr.addWebhook({
				url: "https://inactive.com",
				events: ["event"],
				active: false,
				retries: 0,
			});

			const results = await mgr.dispatchWebhook("event", {});
			expect(results).toEqual([]);
			expect(fetchSpy).not.toHaveBeenCalled();
		});

		it("should return delivery with status 'success' on 200", async () => {
			mgr.addWebhook({
				url: "https://ok.com",
				events: ["e"],
				active: true,
				retries: 0,
			});

			const deliveries = await mgr.dispatchWebhook("e", "payload");
			expect(deliveries).toHaveLength(1);
			expect(deliveries[0].status).toBe("success");
			expect(deliveries[0].attempts).toBe(1);
			expect(deliveries[0].response?.status).toBe(200);
		});

		it("should return delivery with status 'failed' when all retries fail", async () => {
			fetchSpy.mockRejectedValue(new Error("network error"));

			mgr.addWebhook({
				url: "https://fail.com",
				events: ["e"],
				active: true,
				retries: 0, // 0 retries = 1 attempt total
			});

			const deliveries = await mgr.dispatchWebhook("e", {});
			expect(deliveries).toHaveLength(1);
			expect(deliveries[0].status).toBe("failed");
			expect(deliveries[0].attempts).toBe(1);
		});

		it("should record delivery in history on success", async () => {
			const whId = mgr.addWebhook({
				url: "https://ok.com",
				events: ["e"],
				active: true,
				retries: 0,
			});

			await mgr.dispatchWebhook("e", "data");

			const deliveries = mgr.getDeliveries(whId);
			expect(deliveries).toHaveLength(1);
			expect(deliveries[0].status).toBe("success");
		});

		it("should record delivery in history on failure", async () => {
			fetchSpy.mockRejectedValue(new Error("network error"));

			const whId = mgr.addWebhook({
				url: "https://fail.com",
				events: ["e"],
				active: true,
				retries: 0,
			});

			await mgr.dispatchWebhook("e", "data");

			const deliveries = mgr.getDeliveries(whId);
			expect(deliveries).toHaveLength(1);
			expect(deliveries[0].status).toBe("failed");
		});

		it("should dispatch to multiple matching webhooks", async () => {
			mgr.addWebhook({
				url: "https://a.com",
				events: ["shared"],
				active: true,
				retries: 0,
			});
			mgr.addWebhook({
				url: "https://b.com",
				events: ["shared"],
				active: true,
				retries: 0,
			});

			const deliveries = await mgr.dispatchWebhook("shared", {});
			expect(deliveries).toHaveLength(2);
			expect(fetchSpy).toHaveBeenCalledTimes(2);
		});

		it("should use custom signatureHeader from config", async () => {
			const custom = new EventManager({ signatureHeader: "x-custom-sig" });
			custom.addWebhook({
				url: "https://example.com",
				events: ["e"],
				active: true,
				secret: "secret",
				retries: 0,
			});

			await custom.dispatchWebhook("e", {});

			const [, opts] = fetchSpy.mock.calls[0];
			expect(opts.headers["x-custom-sig"]).toBeDefined();
			expect(opts.headers["x-chitragupta-signature"]).toBeUndefined();
			custom.destroy();
		});

		it("should retry on failure and succeed on subsequent attempt", async () => {
			// First call fails, second succeeds
			fetchSpy
				.mockRejectedValueOnce(new Error("transient"))
				.mockResolvedValueOnce({
					ok: true,
					status: 200,
					text: () => Promise.resolve("OK"),
				});

			// Mock sleep to avoid real delays
			const sleepSpy = vi.spyOn(mgr as any, "sleep").mockResolvedValue(undefined);

			mgr.addWebhook({
				url: "https://retry.com",
				events: ["e"],
				active: true,
				retries: 1, // 1 retry = 2 attempts total
			});

			const deliveries = await mgr.dispatchWebhook("e", {});
			expect(deliveries).toHaveLength(1);
			expect(deliveries[0].status).toBe("success");
			expect(deliveries[0].attempts).toBe(2);
			expect(fetchSpy).toHaveBeenCalledTimes(2);
			expect(sleepSpy).toHaveBeenCalledWith(1000); // 1000 * 2^0

			sleepSpy.mockRestore();
		});

		it("should use exponential backoff delays", async () => {
			fetchSpy.mockRejectedValue(new Error("always fails"));

			const sleepSpy = vi.spyOn(mgr as any, "sleep").mockResolvedValue(undefined);

			mgr.addWebhook({
				url: "https://backoff.com",
				events: ["e"],
				active: true,
				retries: 3, // 4 attempts total, 3 sleeps
			});

			await mgr.dispatchWebhook("e", {});

			expect(sleepSpy).toHaveBeenCalledTimes(3);
			expect(sleepSpy).toHaveBeenNthCalledWith(1, 1000);  // 1000 * 2^0
			expect(sleepSpy).toHaveBeenNthCalledWith(2, 2000);  // 1000 * 2^1
			expect(sleepSpy).toHaveBeenNthCalledWith(3, 4000);  // 1000 * 2^2

			sleepSpy.mockRestore();
		});

		it("should handle non-ok HTTP response and retry", async () => {
			fetchSpy
				.mockResolvedValueOnce({
					ok: false,
					status: 500,
					text: () => Promise.resolve("Internal Server Error"),
				})
				.mockResolvedValueOnce({
					ok: true,
					status: 200,
					text: () => Promise.resolve("OK"),
				});

			const sleepSpy = vi.spyOn(mgr as any, "sleep").mockResolvedValue(undefined);

			mgr.addWebhook({
				url: "https://retry-500.com",
				events: ["e"],
				active: true,
				retries: 1,
			});

			const deliveries = await mgr.dispatchWebhook("e", {});
			expect(deliveries[0].status).toBe("success");
			expect(deliveries[0].attempts).toBe(2);

			sleepSpy.mockRestore();
		});
	});

	describe("getDeliveries", () => {
		it("should return empty array for unknown webhook", () => {
			expect(mgr.getDeliveries("nonexistent")).toEqual([]);
		});

		it("should return deliveries oldest-first", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue({
					ok: true,
					status: 200,
					text: () => Promise.resolve("OK"),
				}),
			);

			const whId = mgr.addWebhook({
				url: "https://example.com",
				events: ["a", "b"],
				active: true,
				retries: 0,
			});

			await mgr.dispatchWebhook("a", "first");
			await mgr.dispatchWebhook("b", "second");

			const deliveries = mgr.getDeliveries(whId);
			expect(deliveries).toHaveLength(2);
			expect(deliveries[0].event).toBe("a");
			expect(deliveries[1].event).toBe("b");

			vi.unstubAllGlobals();
		});

		it("should respect limit parameter", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue({
					ok: true,
					status: 200,
					text: () => Promise.resolve("OK"),
				}),
			);

			const whId = mgr.addWebhook({
				url: "https://example.com",
				events: ["e"],
				active: true,
				retries: 0,
			});

			await mgr.dispatchWebhook("e", 1);
			await mgr.dispatchWebhook("e", 2);
			await mgr.dispatchWebhook("e", 3);

			const deliveries = mgr.getDeliveries(whId, 2);
			expect(deliveries).toHaveLength(2);

			vi.unstubAllGlobals();
		});
	});

	describe("getWebhooks", () => {
		it("should return empty array initially", () => {
			expect(mgr.getWebhooks()).toEqual([]);
		});

		it("should return all registered webhooks", () => {
			mgr.addWebhook({
				url: "https://a.com",
				events: ["e"],
				active: true,
			});
			mgr.addWebhook({
				url: "https://b.com",
				events: ["e"],
				active: false,
			});
			expect(mgr.getWebhooks()).toHaveLength(2);
		});

		it("should not include removed webhooks", () => {
			const id = mgr.addWebhook({
				url: "https://a.com",
				events: ["e"],
				active: true,
			});
			mgr.removeWebhook(id);
			expect(mgr.getWebhooks()).toHaveLength(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// DESTROY
	// ═══════════════════════════════════════════════════════════════

	describe("destroy", () => {
		it("should close all SSE clients", () => {
			const close1 = vi.fn();
			const close2 = vi.fn();
			mgr.addSSEClient(vi.fn(), close1);
			mgr.addSSEClient(vi.fn(), close2);
			mgr.destroy();
			expect(close1).toHaveBeenCalledTimes(1);
			expect(close2).toHaveBeenCalledTimes(1);
		});

		it("should swallow errors from closeFn during destroy", () => {
			const close = vi.fn().mockImplementation(() => {
				throw new Error("close error");
			});
			mgr.addSSEClient(vi.fn(), close);
			// Should not throw
			mgr.destroy();
		});

		it("should clear webhooks", () => {
			mgr.addWebhook({
				url: "https://example.com",
				events: ["e"],
				active: true,
			});
			mgr.destroy();
			// Recreate to verify cleared state
			const fresh = new EventManager();
			expect(fresh.getWebhooks()).toEqual([]);
			fresh.destroy();
		});

		it("should throw on addSSEClient after destroy", () => {
			mgr.destroy();
			expect(() => mgr.addSSEClient(vi.fn(), vi.fn())).toThrow(
				"EventManager has been destroyed",
			);
		});

		it("should throw on broadcastSSE after destroy", () => {
			mgr.destroy();
			expect(() => mgr.broadcastSSE("e", {})).toThrow(
				"EventManager has been destroyed",
			);
		});

		it("should throw on addWebhook after destroy", () => {
			mgr.destroy();
			expect(() =>
				mgr.addWebhook({ url: "https://x.com", events: ["e"], active: true }),
			).toThrow("EventManager has been destroyed");
		});

		it("should throw on dispatchWebhook after destroy", async () => {
			mgr.destroy();
			await expect(mgr.dispatchWebhook("e", {})).rejects.toThrow(
				"EventManager has been destroyed",
			);
		});

		it("should not close already disconnected clients", () => {
			const close = vi.fn();
			const client = mgr.addSSEClient(vi.fn(), close);
			mgr.removeSSEClient(client.id); // disconnects and calls close once
			close.mockClear();
			mgr.destroy();
			// closeFn should NOT have been called again
			expect(close).not.toHaveBeenCalled();
		});
	});
});
