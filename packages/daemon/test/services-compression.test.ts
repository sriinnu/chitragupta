import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RpcRouter } from "../src/rpc-router.js";
import {
	type CompressionRuntime,
	_setCompressionRuntimeForTests,
	registerCompressionMethods,
} from "../src/services-compression.js";

describe("compression services", () => {
	let router: RpcRouter;
	let runtime: CompressionRuntime;

	beforeEach(() => {
		runtime = {
			name: "pakt-core",
			status: vi.fn(async () => ({
				runtime: "pakt-core",
				transport: "inproc",
				available: true,
				command: "@sriinnu/pakt",
				args: [],
				connected: true,
				tools: ["pakt_compress", "pakt_auto"],
			})),
			compress: vi.fn(async ({ text, format }: { text: string; format?: string }) => ({
				runtime: "pakt-core",
				action: "compressed",
				compressed: `pakt:${format ?? "auto"}:${text.length}`,
				savings: 37,
				format: format ?? "json",
			})),
			auto: vi.fn(async ({ text }: { text: string }) => ({
				runtime: "pakt-core",
				action: text.startsWith("pakt:") ? "decompressed" : "compressed",
				result: text,
			})),
		};
		_setCompressionRuntimeForTests(runtime);
		router = new RpcRouter();
		registerCompressionMethods(router);
	});

	afterEach(() => {
		_setCompressionRuntimeForTests(null);
	});

	it("reports engine-owned compression runtime status", async () => {
		const status = await router.handle("compression.status", {}) as {
			contractVersion: number;
			preferredRuntime: string;
			defaultRuntime: string;
			requiredTools: string[];
			provenanceRequired: boolean;
			runtime: string;
			transport: string;
			available: boolean;
			tools: string[];
			runtimes: Array<{ runtime: string }>;
		};

		expect(status).toMatchObject({
			contractVersion: 1,
			preferredRuntime: "pakt-core",
			defaultRuntime: "pakt-core",
			provenanceRequired: true,
			runtime: "pakt-core",
			transport: "inproc",
			available: true,
		});
		expect(status.requiredTools).toEqual(["pakt_compress", "pakt_auto"]);
		expect(status.tools).toEqual(["pakt_compress", "pakt_auto"]);
		expect(status.runtimes.map((runtime) => runtime.runtime)).toEqual(["pakt-core"]);
	});

	it("compresses text through the normalized engine-owned runtime", async () => {
		const result = await router.handle("compression.compress", {
			text: "{\"hello\":\"world\"}",
			format: "json",
		}) as Record<string, unknown>;

		expect(runtime.compress).toHaveBeenCalledWith({
			text: "{\"hello\":\"world\"}",
			format: "json",
		});
		expect(result).toMatchObject({
			runtime: "pakt-core",
			action: "compressed",
			format: "json",
			savings: 37,
		});
	});

	it("routes auto-processing through the runtime without exposing raw MCP tool names", async () => {
		const result = await router.handle("compression.auto", {
			text: "pakt:demo",
		}) as Record<string, unknown>;

		expect(runtime.auto).toHaveBeenCalledWith({
			text: "pakt:demo",
		});
		expect(result).toMatchObject({
			runtime: "pakt-core",
			action: "decompressed",
		});
	});

	it("normalizes packed context through the engine-owned runtime", async () => {
		const result = await router.handle("compression.normalize_context", {
			text: "pakt:demo",
		}) as { text: string; changed: boolean; packed: boolean };

		expect(runtime.auto).toHaveBeenCalledWith({ text: "pakt:demo" });
		expect(result).toEqual({
			text: "pakt:demo",
			changed: false,
			packed: true,
		});
	});

	it("unpacks packed context through the engine-owned runtime", async () => {
		const result = await router.handle("compression.unpack_context", {
			text: "pakt:demo",
		}) as { text: string; unpacked: boolean; packed: boolean };

		expect(runtime.auto).toHaveBeenCalledWith({ text: "pakt:demo" });
		expect(result).toEqual({
			text: "pakt:demo",
			unpacked: false,
			packed: true,
		});
	});

	it("recognizes wrapped packed context blocks", async () => {
		const wrapped = "[PAKT packed via pakt-core]\npakt:demo";
		const normalized = await router.handle("compression.normalize_context", {
			text: wrapped,
		}) as { text: string; changed: boolean; packed: boolean };
		const unpacked = await router.handle("compression.unpack_context", {
			text: wrapped,
		}) as { text: string; unpacked: boolean; packed: boolean };

		expect(runtime.auto).toHaveBeenCalledWith({ text: "pakt:demo" });
		expect(normalized.packed).toBe(true);
		expect(unpacked.packed).toBe(true);
	});

	it("does not unpack on the normalize path when auto returns decompressed text", async () => {
		runtime.auto = vi.fn(async () => ({
			runtime: "pakt-core",
			action: "decompressed",
			result: "expanded plain text",
		}));

		const wrapped = "[PAKT packed via pakt-core]\npakt:demo";
		const normalized = await router.handle("compression.normalize_context", {
			text: wrapped,
		}) as { text: string; changed: boolean; packed: boolean };
		const unpacked = await router.handle("compression.unpack_context", {
			text: wrapped,
		}) as { text: string; unpacked: boolean; packed: boolean };

		expect(normalized).toEqual({
			text: "pakt:demo",
			changed: true,
			packed: true,
		});
		expect(unpacked).toEqual({
			text: "expanded plain text",
			unpacked: true,
			packed: true,
		});
	});

	it("rejects empty compression input", async () => {
		await expect(router.handle("compression.compress", { text: "   " })).rejects.toThrow("Missing text");
		await expect(router.handle("compression.auto", { text: "" })).rejects.toThrow("Missing text");
		await expect(router.handle("compression.normalize_context", { text: "" })).rejects.toThrow("Missing text");
		await expect(router.handle("compression.unpack_context", { text: "" })).rejects.toThrow("Missing text");
	});

	it("does not overclaim PAKT when the runtime is unavailable", async () => {
		_setCompressionRuntimeForTests({
			name: "pakt",
			status: vi.fn(async () => ({
				runtime: "pakt",
				transport: "stdio",
				available: false,
				command: "pakt",
				args: ["serve", "--stdio"],
				connected: false,
				tools: [],
				missingTools: ["pakt_compress", "pakt_auto"],
				error: "pakt not installed",
			})),
			compress: vi.fn(async () => ({ runtime: "pakt" })),
			auto: vi.fn(async () => ({ runtime: "pakt" })),
		});

		const status = await router.handle("compression.status", {}) as {
			preferredRuntime: string;
			defaultRuntime: string | null;
			available: boolean;
			missingTools?: string[];
			error?: string;
		};

		expect(status.preferredRuntime).toBe("pakt-core");
		expect(status.defaultRuntime).toBeNull();
		expect(status.available).toBe(false);
		expect(status.missingTools).toEqual(["pakt_compress", "pakt_auto"]);
		expect(status.error).toBe("pakt not installed");
	});
});
