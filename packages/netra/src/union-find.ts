/**
 * @chitragupta/netra — Union-Find data structure and connected component labeling.
 *
 * Implements a Disjoint Set Union (Union-Find) with path compression
 * and union by rank, plus connected component labeling for grouping
 * changed pixels into rectangular bounding box regions.
 */

import type { ImageRegion } from "./types.js";

// ─── Union-Find (Disjoint Set Union) ────────────────────────────────────────

/**
 * Union-Find (Disjoint Set Union) for connected component labeling.
 *
 * Uses path compression in `find()` and union by rank in `union()`
 * for near-constant amortized time per operation.
 */
export class UnionFind {
  private parent: Int32Array;
  private rank: Int32Array;

  constructor(size: number) {
    this.parent = new Int32Array(size);
    this.rank = new Int32Array(size);
    for (let i = 0; i < size; i++) {
      this.parent[i] = i;
    }
  }

  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) {
      root = this.parent[root]!;
    }
    // Path compression
    while (this.parent[x] !== root) {
      const next = this.parent[x]!;
      this.parent[x] = root;
      x = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;

    if (this.rank[rootA]! < this.rank[rootB]!) {
      this.parent[rootA] = rootB;
    } else if (this.rank[rootA]! > this.rank[rootB]!) {
      this.parent[rootB] = rootA;
    } else {
      this.parent[rootB] = rootA;
      this.rank[rootA]!++;
    }
  }
}

// ─── Connected Component Labeling ───────────────────────────────────────────

/**
 * Group changed pixels into rectangular bounding box regions
 * using connected component labeling (4-connectivity).
 *
 * @param diffMask - A Uint8Array where 1 = changed pixel, 0 = same
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @returns An array of ImageRegion bounding boxes, sorted by area descending
 */
export function findChangedRegions(
  diffMask: Uint8Array,
  width: number,
  height: number,
): ImageRegion[] {
  const totalPixels = width * height;
  const uf = new UnionFind(totalPixels);

  // Pass 1: union adjacent changed pixels (4-connectivity)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!diffMask[idx]) continue;

      // Right neighbor
      if (x + 1 < width && diffMask[idx + 1]) {
        uf.union(idx, idx + 1);
      }
      // Bottom neighbor
      if (y + 1 < height && diffMask[idx + width]) {
        uf.union(idx, idx + width);
      }
    }
  }

  // Pass 2: collect bounding boxes per component
  const bounds = new Map<number, { minX: number; minY: number; maxX: number; maxY: number }>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!diffMask[idx]) continue;

      const root = uf.find(idx);
      const existing = bounds.get(root);

      if (existing) {
        existing.minX = Math.min(existing.minX, x);
        existing.minY = Math.min(existing.minY, y);
        existing.maxX = Math.max(existing.maxX, x);
        existing.maxY = Math.max(existing.maxY, y);
      } else {
        bounds.set(root, { minX: x, minY: y, maxX: x, maxY: y });
      }
    }
  }

  // Convert bounds to ImageRegion array
  const regions: ImageRegion[] = [];
  for (const b of bounds.values()) {
    regions.push({
      x: b.minX,
      y: b.minY,
      width: b.maxX - b.minX + 1,
      height: b.maxY - b.minY + 1,
    });
  }

  // Sort by area descending (largest regions first)
  regions.sort((a, b) => (b.width * b.height) - (a.width * a.height));

  return regions;
}
