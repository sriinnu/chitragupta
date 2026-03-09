/**
 * Tests for the RPC method router.
 */

import { describe, expect, it, vi } from "vitest";
import { RpcRouter, RpcMethodError } from "../src/rpc-router.js";
import { ErrorCode } from "../src/protocol.js";

describe("RpcRouter", () => {
	it("should have built-in methods registered", () => {
		const router = new RpcRouter();
		const methods = router.listMethods();
		const names = methods.map((m) => m.name);
		expect(names).toContain("daemon.ping");
		expect(names).toContain("daemon.health");
		expect(names).toContain("daemon.methods");
		expect(names).toContain("daemon.shutdown");
	});

	it("daemon.ping should return pong", async () => {
		const router = new RpcRouter();
		const result = await router.handle("daemon.ping", {});
		expect(result).toMatchObject({ pong: true });
	});

	it("daemon.health should return status info", async () => {
		const router = new RpcRouter();
		const result = (await router.handle("daemon.health", {})) as Record<string, unknown>;
		expect(result.status).toBe("ok");
		expect(typeof result.pid).toBe("number");
		expect(typeof result.uptime).toBe("number");
	});

	it("should register and invoke custom methods", async () => {
		const router = new RpcRouter();
		router.register("echo", async (params) => ({ echo: params.message }), "Echo back");

		const result = await router.handle("echo", { message: "hello" });
		expect(result).toEqual({ echo: "hello" });
	});

	it("should throw MethodNotFound for unknown methods", async () => {
		const router = new RpcRouter();
		await expect(router.handle("nonexistent", {})).rejects.toThrow(RpcMethodError);

		try {
			await router.handle("nonexistent", {});
		} catch (err) {
			expect((err as RpcMethodError).code).toBe(ErrorCode.MethodNotFound);
		}
	});

	it("should wrap handler errors as InternalError", async () => {
		const router = new RpcRouter();
		router.register("broken", async () => {
			throw new Error("oops");
		});

		try {
			await router.handle("broken", {});
		} catch (err) {
			expect((err as RpcMethodError).code).toBe(ErrorCode.InternalError);
			expect((err as RpcMethodError).message).toBe("oops");
		}
	});

	it("should list registered methods via daemon.methods", async () => {
		const router = new RpcRouter();
		router.register("custom.one", async () => "1", "Custom method one");

		const result = (await router.handle("daemon.methods", {})) as { methods: Array<{ name: string }> };
		const names = result.methods.map((m) => m.name);
		expect(names).toContain("custom.one");
		expect(names).toContain("daemon.ping");
	});

	it("should invoke shutdown callback on daemon.shutdown", async () => {
		vi.useFakeTimers();
		const router = new RpcRouter();
		const shutdownFn = vi.fn().mockResolvedValue(undefined);
		router.setShutdown(shutdownFn);

		const result = (await router.handle("daemon.shutdown", {})) as Record<string, unknown>;
		expect(result.shutting_down).toBe(true);

		// Shutdown is deferred via setTimeout
		vi.advanceTimersByTime(200);
		expect(shutdownFn).toHaveBeenCalled();
		vi.useRealTimers();
	});

	it("should report has() correctly", () => {
		const router = new RpcRouter();
		expect(router.has("daemon.ping")).toBe(true);
		expect(router.has("nonexistent")).toBe(false);
	});

	it("tracks connected clients and their runtime state", () => {
		const router = new RpcRouter();
		router.attachClient("client-1", { transport: "socket", connectedAt: 100 });
		router.markClientSeen("client-1", { kind: "request", transport: "socket" });
		router.updateClientPreferences("client-1", { theme: "light" });
		router.recordObservations("client-1", [
			{ type: "tool_usage", entity: "read", summary: "read used", severity: "info" },
			{ type: "tool_usage", entity: "read", summary: "read used", severity: "info" },
		]);

		const client = router.getClient("client-1");
		expect(client).toMatchObject({
			id: "client-1",
			transport: "socket",
			requestCount: 1,
			preferences: { theme: "light" },
			observationCount: 2,
		});
		expect(client?.topPatterns[0]).toMatchObject({
			type: "tool_usage",
			entity: "read",
			count: 2,
		});
	});

	it("sends notifications through the configured notifier", () => {
		const router = new RpcRouter();
		const sent: Array<{ method: string; targets?: readonly string[] }> = [];
		router.setNotifier((notification, targetClientIds) => {
			sent.push({ method: notification.method, targets: targetClientIds });
			return 1;
		});

		const delivered = router.notify("pattern.detected", { ok: true }, ["client-1"]);
		expect(delivered).toBe(1);
		expect(sent).toEqual([{ method: "pattern.detected", targets: ["client-1"] }]);
	});
});
