import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SharedMemoryManager } from "../src/hub-memory.js";
import type { RegionChangeHandler } from "../src/hub-memory.js";

describe("SharedMemoryManager", () => {
	let mgr: SharedMemoryManager;
	const log = vi.fn();

	beforeEach(() => {
		vi.restoreAllMocks();
		log.mockClear();
		mgr = new SharedMemoryManager(log);
	});

	// ═══════════════════════════════════════════════════════════════
	// REGIONS — create
	// ═══════════════════════════════════════════════════════════════

	describe("createRegion", () => {
		it("should return a region with correct structure and version 0", () => {
			const region = mgr.createRegion("workspace", "agent-a");
			expect(region.id).toMatch(/^[0-9a-f-]{36}$/);
			expect(region.name).toBe("workspace");
			expect(region.owner).toBe("agent-a");
			expect(region.data).toEqual({});
			expect(region.version).toBe(0);
			expect(region.accessList).toEqual(["*"]);
			expect(region.createdAt).toBeTypeOf("number");
			expect(region.updatedAt).toBeTypeOf("number");
		});

		it("should use the provided accessList", () => {
			const region = mgr.createRegion("private", "owner", ["agent-a", "agent-b"]);
			expect(region.accessList).toEqual(["agent-a", "agent-b"]);
		});

		it("should throw when creating a duplicate region", () => {
			mgr.createRegion("dup", "owner");
			expect(() => mgr.createRegion("dup", "other")).toThrow(
				'Region "dup" already exists.',
			);
		});

		it("should log the creation", () => {
			mgr.createRegion("logged", "agent-x");
			expect(log).toHaveBeenCalledWith("[region:create] logged owner=agent-x");
		});

		it("should allow creating regions with different names", () => {
			const r1 = mgr.createRegion("alpha", "owner");
			const r2 = mgr.createRegion("beta", "owner");
			expect(r1.id).not.toBe(r2.id);
			expect(mgr.regionCount).toBe(2);
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// REGIONS — get
	// ═══════════════════════════════════════════════════════════════

	describe("getRegion", () => {
		it("should return the region by name", () => {
			const created = mgr.createRegion("zone", "owner");
			const fetched = mgr.getRegion("zone");
			expect(fetched).toBe(created);
		});

		it("should return undefined for nonexistent region", () => {
			expect(mgr.getRegion("no-such-region")).toBeUndefined();
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// REGIONS — read
	// ═══════════════════════════════════════════════════════════════

	describe("read", () => {
		it("should throw for nonexistent region", () => {
			expect(() => mgr.read("ghost", "key")).toThrow(
				'Region "ghost" does not exist.',
			);
		});

		it("should return undefined for unset key in existing region", () => {
			mgr.createRegion("r", "owner");
			expect(mgr.read("r", "missing")).toBeUndefined();
		});

		it("should return stored value after write", () => {
			mgr.createRegion("r", "owner");
			mgr.write("r", "k", 42, "agent");
			expect(mgr.read("r", "k")).toBe(42);
		});

		it("should return complex objects", () => {
			mgr.createRegion("r", "owner");
			const obj = { nested: { value: [1, 2, 3] } };
			mgr.write("r", "complex", obj, "agent");
			expect(mgr.read("r", "complex")).toBe(obj);
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// REGIONS — write
	// ═══════════════════════════════════════════════════════════════

	describe("write", () => {
		it("should throw for nonexistent region", () => {
			expect(() => mgr.write("ghost", "k", "v", "agent")).toThrow(
				'Region "ghost" does not exist.',
			);
		});

		it("should throw for unauthorized agent when accessList is specific", () => {
			mgr.createRegion("private", "owner", ["agent-a"]);
			expect(() => mgr.write("private", "k", "v", "agent-b")).toThrow(
				'Agent "agent-b" does not have write access to region "private".',
			);
		});

		it("should succeed for wildcard accessList", () => {
			mgr.createRegion("public", "owner", ["*"]);
			mgr.write("public", "k", "v", "any-agent");
			expect(mgr.read("public", "k")).toBe("v");
		});

		it("should succeed for named agent in accessList", () => {
			mgr.createRegion("restricted", "owner", ["agent-x"]);
			mgr.write("restricted", "k", "val", "agent-x");
			expect(mgr.read("restricted", "k")).toBe("val");
		});

		it("should increment version on each write", () => {
			const region = mgr.createRegion("versioned", "owner");
			expect(region.version).toBe(0);
			mgr.write("versioned", "a", 1, "agent");
			expect(region.version).toBe(1);
			mgr.write("versioned", "b", 2, "agent");
			expect(region.version).toBe(2);
			mgr.write("versioned", "a", 3, "agent");
			expect(region.version).toBe(3);
		});

		it("should update updatedAt timestamp", () => {
			const region = mgr.createRegion("ts", "owner");
			const before = region.updatedAt;
			// Small delay to ensure timestamp changes
			mgr.write("ts", "k", "v", "agent");
			expect(region.updatedAt).toBeGreaterThanOrEqual(before);
		});

		it("should throw when maxSize is reached for new keys", () => {
			const region = mgr.createRegion("small", "owner");
			region.maxSize = 2;
			mgr.write("small", "a", 1, "agent");
			mgr.write("small", "b", 2, "agent");
			expect(() => mgr.write("small", "c", 3, "agent")).toThrow(
				'Region "small" has reached its max size of 2 entries.',
			);
		});

		it("should allow overwriting existing key even at maxSize", () => {
			const region = mgr.createRegion("overwrite", "owner");
			region.maxSize = 1;
			mgr.write("overwrite", "k", 1, "agent");
			// Overwrite same key — should not throw
			mgr.write("overwrite", "k", 2, "agent");
			expect(mgr.read("overwrite", "k")).toBe(2);
		});

		it("should log the write with version and agent", () => {
			mgr.createRegion("logged", "owner");
			mgr.write("logged", "key", "val", "agent-z");
			expect(log).toHaveBeenCalledWith(
				"[region:write] logged.key v1 by agent-z",
			);
		});

		it("should notify watchers on write", () => {
			mgr.createRegion("watched", "owner");
			const handler = vi.fn();
			mgr.watchRegion("watched", handler);
			mgr.write("watched", "k", "v", "agent");
			expect(handler).toHaveBeenCalledWith("k", "v", 1);
		});

		it("should swallow errors thrown by watchers", () => {
			mgr.createRegion("err-watch", "owner");
			const badHandler: RegionChangeHandler = () => {
				throw new Error("watcher explosion");
			};
			mgr.watchRegion("err-watch", badHandler);
			// Should not throw
			mgr.write("err-watch", "k", "v", "agent");
			expect(mgr.read("err-watch", "k")).toBe("v");
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// REGIONS — delete
	// ═══════════════════════════════════════════════════════════════

	describe("deleteRegion", () => {
		it("should throw for nonexistent region", () => {
			expect(() => mgr.deleteRegion("ghost", "agent")).toThrow(
				'Region "ghost" does not exist.',
			);
		});

		it("should throw if agent is not the owner", () => {
			mgr.createRegion("owned", "owner-a");
			expect(() => mgr.deleteRegion("owned", "intruder")).toThrow(
				'Agent "intruder" is not the owner of region "owned"',
			);
		});

		it("should succeed for the owner", () => {
			mgr.createRegion("to-delete", "owner");
			mgr.deleteRegion("to-delete", "owner");
			expect(mgr.getRegion("to-delete")).toBeUndefined();
			expect(mgr.regionCount).toBe(0);
		});

		it("should remove associated watchers", () => {
			mgr.createRegion("watched-del", "owner");
			const handler = vi.fn();
			mgr.watchRegion("watched-del", handler);
			mgr.deleteRegion("watched-del", "owner");
			// Re-create and write — old handler should NOT fire
			mgr.createRegion("watched-del", "owner");
			mgr.write("watched-del", "k", "v", "agent");
			expect(handler).not.toHaveBeenCalled();
		});

		it("should log the deletion", () => {
			mgr.createRegion("log-del", "agent-d");
			log.mockClear();
			mgr.deleteRegion("log-del", "agent-d");
			expect(log).toHaveBeenCalledWith("[region:delete] log-del by agent-d");
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// REGIONS — watchRegion
	// ═══════════════════════════════════════════════════════════════

	describe("watchRegion", () => {
		it("should throw for nonexistent region", () => {
			expect(() => mgr.watchRegion("ghost", vi.fn())).toThrow(
				'Region "ghost" does not exist.',
			);
		});

		it("should invoke handler on each write", () => {
			mgr.createRegion("w", "owner");
			const handler = vi.fn();
			mgr.watchRegion("w", handler);
			mgr.write("w", "a", 1, "agent");
			mgr.write("w", "b", 2, "agent");
			expect(handler).toHaveBeenCalledTimes(2);
			expect(handler).toHaveBeenNthCalledWith(1, "a", 1, 1);
			expect(handler).toHaveBeenNthCalledWith(2, "b", 2, 2);
		});

		it("should return an unwatch function that stops notifications", () => {
			mgr.createRegion("unwatched", "owner");
			const handler = vi.fn();
			const unwatch = mgr.watchRegion("unwatched", handler);
			mgr.write("unwatched", "a", 1, "agent");
			expect(handler).toHaveBeenCalledTimes(1);
			unwatch();
			mgr.write("unwatched", "b", 2, "agent");
			expect(handler).toHaveBeenCalledTimes(1); // No additional call
		});

		it("should support multiple watchers on the same region", () => {
			mgr.createRegion("multi-w", "owner");
			const h1 = vi.fn();
			const h2 = vi.fn();
			mgr.watchRegion("multi-w", h1);
			mgr.watchRegion("multi-w", h2);
			mgr.write("multi-w", "k", "v", "agent");
			expect(h1).toHaveBeenCalledTimes(1);
			expect(h2).toHaveBeenCalledTimes(1);
		});

		it("should handle unwatch when watcher set is already deleted", () => {
			mgr.createRegion("edge", "owner");
			const handler = vi.fn();
			const unwatch = mgr.watchRegion("edge", handler);
			mgr.deleteRegion("edge", "owner");
			// Should not throw
			unwatch();
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// REGIONS — cleanupRegions
	// ═══════════════════════════════════════════════════════════════

	describe("cleanupRegions", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("should remove expired regions", () => {
			vi.setSystemTime(1000);
			const region = mgr.createRegion("ephemeral", "owner");
			region.ttl = 5000; // expires at 6000
			expect(mgr.regionCount).toBe(1);

			vi.setSystemTime(5999);
			mgr.cleanupRegions();
			expect(mgr.regionCount).toBe(1); // Not yet expired

			vi.setSystemTime(6000);
			mgr.cleanupRegions();
			expect(mgr.regionCount).toBe(0);
		});

		it("should not remove regions without TTL", () => {
			mgr.createRegion("permanent", "owner");
			vi.advanceTimersByTime(999_999);
			mgr.cleanupRegions();
			expect(mgr.regionCount).toBe(1);
		});

		it("should remove watchers of expired regions", () => {
			vi.setSystemTime(1000);
			const region = mgr.createRegion("ttl-watched", "owner");
			region.ttl = 100;
			const handler = vi.fn();
			mgr.watchRegion("ttl-watched", handler);

			vi.setSystemTime(1100);
			mgr.cleanupRegions();
			expect(mgr.regionCount).toBe(0);

			// Re-create and verify old watcher not called
			mgr.createRegion("ttl-watched", "owner");
			mgr.write("ttl-watched", "k", "v", "agent");
			expect(handler).not.toHaveBeenCalled();
		});

		it("should keep non-expired regions intact", () => {
			vi.setSystemTime(1000);
			const r1 = mgr.createRegion("soon", "owner");
			r1.ttl = 100;
			mgr.createRegion("forever", "owner");

			vi.setSystemTime(1100);
			mgr.cleanupRegions();
			expect(mgr.regionCount).toBe(1);
			expect(mgr.getRegion("forever")).toBeDefined();
			expect(mgr.getRegion("soon")).toBeUndefined();
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// REGIONS — regionCount and clear
	// ═══════════════════════════════════════════════════════════════

	describe("regionCount", () => {
		it("should be 0 initially", () => {
			expect(mgr.regionCount).toBe(0);
		});

		it("should track creates", () => {
			mgr.createRegion("a", "owner");
			mgr.createRegion("b", "owner");
			expect(mgr.regionCount).toBe(2);
		});

		it("should track deletes", () => {
			mgr.createRegion("a", "owner");
			mgr.createRegion("b", "owner");
			mgr.deleteRegion("a", "owner");
			expect(mgr.regionCount).toBe(1);
		});
	});

	describe("clear", () => {
		it("should reset all regions, watchers, and collectors", () => {
			mgr.createRegion("r1", "owner");
			mgr.createRegion("r2", "owner");
			mgr.watchRegion("r1", vi.fn());
			mgr.createCollector(3);
			mgr.clear();
			expect(mgr.regionCount).toBe(0);
			expect(mgr.collectorCount).toBe(0);
			expect(mgr.getRegion("r1")).toBeUndefined();
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// RESULT COLLECTORS
	// ═══════════════════════════════════════════════════════════════

	describe("createCollector", () => {
		it("should return a collector with UUID id", () => {
			const collector = mgr.createCollector(3);
			expect(collector.id).toMatch(/^[0-9a-f-]{36}$/);
		});

		it("should set expected, empty results, empty errors, empty resolvers", () => {
			const collector = mgr.createCollector(5);
			expect(collector.expected).toBe(5);
			expect(collector.results.size).toBe(0);
			expect(collector.errors.size).toBe(0);
			expect(collector.resolvers).toEqual([]);
		});

		it("should increment collectorCount", () => {
			expect(mgr.collectorCount).toBe(0);
			mgr.createCollector(1);
			expect(mgr.collectorCount).toBe(1);
			mgr.createCollector(2);
			expect(mgr.collectorCount).toBe(2);
		});

		it("should log the creation", () => {
			const c = mgr.createCollector(4);
			expect(log).toHaveBeenCalledWith(
				`[collector:create] ${c.id} expected=4`,
			);
		});
	});

	describe("submitResult", () => {
		it("should store the result in the collector", () => {
			const c = mgr.createCollector<string>(2);
			mgr.submitResult(c.id, "agent-a", "done");
			expect(c.results.get("agent-a")).toBe("done");
		});

		it("should throw for unknown collector", () => {
			expect(() => mgr.submitResult("fake-id", "agent", "val")).toThrow(
				'Collector "fake-id" does not exist.',
			);
		});

		it("should log result submission with counts", () => {
			const c = mgr.createCollector(3);
			log.mockClear();
			mgr.submitResult(c.id, "agent-a", "ok");
			expect(log).toHaveBeenCalledWith(
				expect.stringContaining("[collector:result] agent-a"),
			);
		});
	});

	describe("submitError", () => {
		it("should store the error in the collector", () => {
			const c = mgr.createCollector(2);
			const err = new Error("fail");
			mgr.submitError(c.id, "agent-b", err);
			expect(c.errors.get("agent-b")).toBe(err);
		});

		it("should throw for unknown collector", () => {
			expect(() =>
				mgr.submitError("fake-id", "agent", new Error("x")),
			).toThrow('Collector "fake-id" does not exist.');
		});
	});

	describe("waitForAll", () => {
		it("should resolve immediately when already complete", async () => {
			const c = mgr.createCollector<string>(2);
			mgr.submitResult(c.id, "a", "r1");
			mgr.submitResult(c.id, "b", "r2");
			const results = await mgr.waitForAll<string>(c.id);
			expect(results.size).toBe(2);
			expect(results.get("a")).toBe("r1");
		});

		it("should resolve when errors fill remaining slots", async () => {
			const c = mgr.createCollector<string>(2);
			mgr.submitResult(c.id, "a", "ok");
			mgr.submitError(c.id, "b", new Error("fail"));
			const results = await mgr.waitForAll<string>(c.id);
			expect(results.size).toBe(1);
		});

		it("should resolve when the last result arrives", async () => {
			const c = mgr.createCollector<number>(2);
			const promise = mgr.waitForAll<number>(c.id);
			mgr.submitResult(c.id, "a", 1);
			mgr.submitResult(c.id, "b", 2);
			const results = await promise;
			expect(results.size).toBe(2);
			expect(results.get("b")).toBe(2);
		});

		it("should reject on timeout", async () => {
			vi.useFakeTimers();
			try {
				const c = mgr.createCollector(3);
				const promise = mgr.waitForAll(c.id, 5000);
				mgr.submitResult(c.id, "a", "ok");
				// Only 1 of 3, advance past timeout
				vi.advanceTimersByTime(5001);
				await expect(promise).rejects.toThrow("timed out after 5000ms");
			} finally {
				vi.useRealTimers();
			}
		});

		it("should throw for unknown collector", () => {
			expect(() => mgr.waitForAll("fake-id")).toThrow(
				'Collector "fake-id" does not exist.',
			);
		});

		it("should clear resolvers after resolution", async () => {
			const c = mgr.createCollector<string>(1);
			const promise = mgr.waitForAll<string>(c.id);
			mgr.submitResult(c.id, "a", "done");
			await promise;
			expect(c.resolvers).toEqual([]);
		});
	});

	describe("collectorCount", () => {
		it("should be 0 initially", () => {
			expect(mgr.collectorCount).toBe(0);
		});

		it("should track active collectors", () => {
			mgr.createCollector(1);
			mgr.createCollector(2);
			expect(mgr.collectorCount).toBe(2);
		});

		it("should decrease after clear", () => {
			mgr.createCollector(1);
			mgr.clear();
			expect(mgr.collectorCount).toBe(0);
		});
	});
});
