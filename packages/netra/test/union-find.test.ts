import { describe, it, expect } from "vitest";
import { UnionFind, findChangedRegions } from "@chitragupta/netra";

// ═══════════════════════════════════════════════════════════════════════════
// UnionFind
// ═══════════════════════════════════════════════════════════════════════════

describe("UnionFind", () => {
	// ─── Constructor ────────────────────────────────────────────────────

	describe("constructor", () => {
		it("should initialize each element as its own root", () => {
			const uf = new UnionFind(5);
			for (let i = 0; i < 5; i++) {
				expect(uf.find(i)).toBe(i);
			}
		});

		it("should handle size 0 without error", () => {
			const uf = new UnionFind(0);
			expect(uf).toBeDefined();
		});

		it("should handle size 1", () => {
			const uf = new UnionFind(1);
			expect(uf.find(0)).toBe(0);
		});
	});

	// ─── find ───────────────────────────────────────────────────────────

	describe("find", () => {
		it("should return self for fresh elements", () => {
			const uf = new UnionFind(10);
			for (let i = 0; i < 10; i++) {
				expect(uf.find(i)).toBe(i);
			}
		});

		it("should apply path compression", () => {
			const uf = new UnionFind(5);
			// Create a chain: 0 <- 1 <- 2 <- 3 <- 4
			uf.union(0, 1);
			uf.union(1, 2);
			uf.union(2, 3);
			uf.union(3, 4);

			// After find(4), path compression should flatten the tree
			const root = uf.find(4);
			// All elements should point directly to the root
			expect(uf.find(0)).toBe(root);
			expect(uf.find(1)).toBe(root);
			expect(uf.find(2)).toBe(root);
			expect(uf.find(3)).toBe(root);
			expect(uf.find(4)).toBe(root);
		});
	});

	// ─── union ──────────────────────────────────────────────────────────

	describe("union", () => {
		it("should merge two disjoint sets", () => {
			const uf = new UnionFind(4);
			uf.union(0, 1);
			expect(uf.find(0)).toBe(uf.find(1));
		});

		it("should be a no-op when both elements are already in the same set", () => {
			const uf = new UnionFind(3);
			uf.union(0, 1);
			const rootBefore = uf.find(0);
			uf.union(0, 1); // Same set — no change
			expect(uf.find(0)).toBe(rootBefore);
			expect(uf.find(1)).toBe(rootBefore);
		});

		it("should use union by rank for balanced trees", () => {
			const uf = new UnionFind(6);
			// Build two trees of rank 1
			uf.union(0, 1); // {0,1}
			uf.union(2, 3); // {2,3}
			// Merge them → one tree of rank 2
			uf.union(0, 2);
			// All four should share the same root
			const root = uf.find(0);
			expect(uf.find(1)).toBe(root);
			expect(uf.find(2)).toBe(root);
			expect(uf.find(3)).toBe(root);
		});

		it("should handle chained unions", () => {
			const uf = new UnionFind(5);
			uf.union(0, 1);
			uf.union(1, 2);
			uf.union(2, 3);
			uf.union(3, 4);
			const root = uf.find(0);
			for (let i = 1; i < 5; i++) {
				expect(uf.find(i)).toBe(root);
			}
		});
	});

	// ─── Connected (via find) ───────────────────────────────────────────

	describe("connectivity", () => {
		it("should report elements as disconnected initially", () => {
			const uf = new UnionFind(4);
			expect(uf.find(0)).not.toBe(uf.find(1));
			expect(uf.find(2)).not.toBe(uf.find(3));
		});

		it("should report elements as connected after union", () => {
			const uf = new UnionFind(4);
			uf.union(0, 1);
			expect(uf.find(0)).toBe(uf.find(1));
		});

		it("should handle transitivity", () => {
			const uf = new UnionFind(4);
			uf.union(0, 1);
			uf.union(1, 2);
			// 0 and 2 should be connected transitively
			expect(uf.find(0)).toBe(uf.find(2));
		});

		it("should keep separate components distinct", () => {
			const uf = new UnionFind(4);
			uf.union(0, 1);
			uf.union(2, 3);
			expect(uf.find(0)).not.toBe(uf.find(2));
		});
	});

	// ─── Large scale ────────────────────────────────────────────────────

	describe("large scale", () => {
		it("should handle 10000 elements efficiently", () => {
			const n = 10000;
			const uf = new UnionFind(n);
			// Union all even elements together
			for (let i = 2; i < n; i += 2) {
				uf.union(0, i);
			}
			// Union all odd elements together
			for (let i = 3; i < n; i += 2) {
				uf.union(1, i);
			}
			// Verify: all even share a root, all odd share a root
			const evenRoot = uf.find(0);
			const oddRoot = uf.find(1);
			expect(evenRoot).not.toBe(oddRoot);
			expect(uf.find(100)).toBe(evenRoot);
			expect(uf.find(101)).toBe(oddRoot);
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// findChangedRegions
// ═══════════════════════════════════════════════════════════════════════════

describe("findChangedRegions", () => {
	/** Helper to create a mask from a 2D boolean pattern. */
	function makeMask(pattern: number[][], width: number, height: number): Uint8Array {
		const mask = new Uint8Array(width * height);
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				mask[y * width + x] = pattern[y]![x]!;
			}
		}
		return mask;
	}

	// ─── Empty mask ─────────────────────────────────────────────────────

	it("should return no regions for an all-zero mask", () => {
		const mask = new Uint8Array(20); // 5x4, all zeros
		const regions = findChangedRegions(mask, 5, 4);
		expect(regions).toEqual([]);
	});

	// ─── Single pixel ───────────────────────────────────────────────────

	it("should return one region with area 1x1 for a single pixel", () => {
		const mask = makeMask([
			[0, 0, 0],
			[0, 1, 0],
			[0, 0, 0],
		], 3, 3);
		const regions = findChangedRegions(mask, 3, 3);
		expect(regions).toHaveLength(1);
		expect(regions[0]).toEqual({ x: 1, y: 1, width: 1, height: 1 });
	});

	// ─── Rectangular block ──────────────────────────────────────────────

	it("should return one region for a contiguous rectangular block", () => {
		const mask = makeMask([
			[0, 0, 0, 0, 0],
			[0, 1, 1, 1, 0],
			[0, 1, 1, 1, 0],
			[0, 0, 0, 0, 0],
		], 5, 4);
		const regions = findChangedRegions(mask, 5, 4);
		expect(regions).toHaveLength(1);
		expect(regions[0]).toEqual({ x: 1, y: 1, width: 3, height: 2 });
	});

	// ─── Multiple separate regions ──────────────────────────────────────

	it("should return multiple regions sorted by bounding-box area descending", () => {
		const mask = makeMask([
			[1, 1, 0, 0, 1],
			[1, 1, 0, 0, 0],
			[0, 0, 0, 0, 0],
			[0, 0, 0, 1, 0],
		], 5, 4);
		const regions = findChangedRegions(mask, 5, 4);
		expect(regions).toHaveLength(3);
		// 2x2 block (area 4), 1x1 pixel top-right (area 1), 1x1 pixel bottom (area 1)
		expect(regions[0]!.width * regions[0]!.height).toBeGreaterThanOrEqual(
			regions[1]!.width * regions[1]!.height,
		);
		expect(regions[1]!.width * regions[1]!.height).toBeGreaterThanOrEqual(
			regions[2]!.width * regions[2]!.height,
		);
	});

	// ─── L-shaped region ────────────────────────────────────────────────

	it("should connect L-shaped pixels via 4-connectivity", () => {
		const mask = makeMask([
			[1, 0, 0],
			[1, 0, 0],
			[1, 1, 1],
		], 3, 3);
		const regions = findChangedRegions(mask, 3, 3);
		// All pixels are 4-connected → one region
		expect(regions).toHaveLength(1);
		expect(regions[0]).toEqual({ x: 0, y: 0, width: 3, height: 3 });
	});

	// ─── Full mask ──────────────────────────────────────────────────────

	it("should return one region covering the entire image for a full mask", () => {
		const width = 4;
		const height = 3;
		const mask = new Uint8Array(width * height).fill(1);
		const regions = findChangedRegions(mask, width, height);
		expect(regions).toHaveLength(1);
		expect(regions[0]).toEqual({ x: 0, y: 0, width: 4, height: 3 });
	});

	// ─── Diagonal pixels ────────────────────────────────────────────────

	it("should NOT connect diagonally adjacent pixels (4-connectivity)", () => {
		const mask = makeMask([
			[1, 0, 0],
			[0, 1, 0],
			[0, 0, 1],
		], 3, 3);
		const regions = findChangedRegions(mask, 3, 3);
		// Diagonal pixels are not 4-connected → 3 separate regions
		expect(regions).toHaveLength(3);
		for (const region of regions) {
			expect(region.width).toBe(1);
			expect(region.height).toBe(1);
		}
	});

	// ─── Horizontal line ────────────────────────────────────────────────

	it("should connect a horizontal line into one region", () => {
		const mask = makeMask([
			[0, 0, 0, 0, 0],
			[1, 1, 1, 1, 1],
			[0, 0, 0, 0, 0],
		], 5, 3);
		const regions = findChangedRegions(mask, 5, 3);
		expect(regions).toHaveLength(1);
		expect(regions[0]).toEqual({ x: 0, y: 1, width: 5, height: 1 });
	});

	// ─── Vertical line ──────────────────────────────────────────────────

	it("should connect a vertical line into one region", () => {
		const mask = makeMask([
			[0, 1, 0],
			[0, 1, 0],
			[0, 1, 0],
			[0, 1, 0],
		], 3, 4);
		const regions = findChangedRegions(mask, 3, 4);
		expect(regions).toHaveLength(1);
		expect(regions[0]).toEqual({ x: 1, y: 0, width: 1, height: 4 });
	});

	// ─── Two touching regions ───────────────────────────────────────────

	it("should merge two blocks that touch horizontally", () => {
		const mask = makeMask([
			[1, 1, 1, 0],
			[0, 0, 1, 0],
			[0, 0, 1, 1],
		], 4, 3);
		const regions = findChangedRegions(mask, 4, 3);
		expect(regions).toHaveLength(1);
	});

	// ─── 1x1 image ──────────────────────────────────────────────────────

	it("should handle a 1x1 image with a changed pixel", () => {
		const mask = new Uint8Array([1]);
		const regions = findChangedRegions(mask, 1, 1);
		expect(regions).toHaveLength(1);
		expect(regions[0]).toEqual({ x: 0, y: 0, width: 1, height: 1 });
	});

	it("should handle a 1x1 image with no changes", () => {
		const mask = new Uint8Array([0]);
		const regions = findChangedRegions(mask, 1, 1);
		expect(regions).toHaveLength(0);
	});
});
