import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	SessionTree,
	type SessionTreeNode,
} from "../src/components/session-tree.js";
import type { KeyEvent } from "../src/keys.js";

function makeKey(name: string, extra: Partial<KeyEvent> = {}): KeyEvent {
	return {
		name,
		sequence: "",
		ctrl: false,
		meta: false,
		shift: false,
		...extra,
	} as KeyEvent;
}

function makeNode(id: string, title: string, children?: SessionTreeNode[]): SessionTreeNode {
	return { id, title, children };
}

describe("SessionTree", () => {
	let tree: SessionTree;

	const sampleTree: SessionTreeNode[] = [
		makeNode("s1", "First session", [
			makeNode("s1-1", "Branch A"),
			makeNode("s1-2", "Branch B", [
				makeNode("s1-2-1", "Deep branch"),
			]),
		]),
		makeNode("s2", "Second session"),
		makeNode("s3", "Third session"),
	];

	beforeEach(() => {
		tree = new SessionTree(sampleTree, { title: "Test Tree" });
	});

	describe("initial state", () => {
		it("should flatten nodes correctly", () => {
			const output = tree.render(80, 20);
			// Should contain all 6 nodes
			expect(output.join("\n")).toContain("First session");
			expect(output.join("\n")).toContain("Branch A");
			expect(output.join("\n")).toContain("Branch B");
			expect(output.join("\n")).toContain("Deep branch");
			expect(output.join("\n")).toContain("Second session");
			expect(output.join("\n")).toContain("Third session");
		});

		it("should select the first node by default", () => {
			expect(tree.selected).toBeDefined();
			expect(tree.selected!.id).toBe("s1");
		});
	});

	describe("render", () => {
		it("should include the title", () => {
			const output = tree.render(80, 20);
			expect(output[0]).toContain("Test Tree");
		});

		it("should show 'No sessions' when empty", () => {
			const emptyTree = new SessionTree([]);
			const output = emptyTree.render(80, 20);
			expect(output.join("\n")).toContain("No sessions");
		});

		it("should include node IDs in brackets", () => {
			const output = tree.render(80, 20);
			const joined = output.join("\n");
			expect(joined).toContain("[s1]");
			expect(joined).toContain("[s2]");
		});

		it("should show tree connector characters", () => {
			const output = tree.render(80, 20);
			const joined = output.join("\n");
			// Should use theme branch symbols
			expect(joined).toMatch(/[\u2500\u2502\u251C\u2514]/); // ─│├└
		});

		it("should show active indicator for active sessions", () => {
			const nodes: SessionTreeNode[] = [
				{ id: "active", title: "Active one", active: true },
			];
			const activeTree = new SessionTree(nodes);
			const output = activeTree.render(80, 20);
			// Should contain the active dot indicator
			expect(output.join("\n")).toContain("\u25CF"); // ●
		});

		it("should show turn count and date in metadata", () => {
			const nodes: SessionTreeNode[] = [
				{ id: "meta", title: "With metadata", date: "2026-01-15", turnCount: 42 },
			];
			const metaTree = new SessionTree(nodes);
			const output = metaTree.render(80, 20);
			const joined = output.join("\n");
			expect(joined).toContain("2026-01-15");
			expect(joined).toContain("42 turns");
		});

		it("should show footer with navigation hints", () => {
			const output = tree.render(80, 20);
			const last = output[output.length - 1];
			expect(last).toContain("Enter");
			expect(last).toContain("navigate");
		});

		it("should truncate long titles", () => {
			const longTitle = "A".repeat(200);
			const nodes: SessionTreeNode[] = [
				{ id: "long", title: longTitle },
			];
			const longTree = new SessionTree(nodes);
			const output = longTree.render(60, 20);
			const joined = output.join("\n");
			// Should contain ellipsis character
			expect(joined).toContain("\u2026");
		});
	});

	describe("navigation", () => {
		it("should move down on down arrow", () => {
			tree.handleKey(makeKey("down"));
			expect(tree.selected!.id).toBe("s1-1"); // First child of s1
		});

		it("should move up on up arrow", () => {
			tree.handleKey(makeKey("down"));
			tree.handleKey(makeKey("down"));
			tree.handleKey(makeKey("up"));
			expect(tree.selected!.id).toBe("s1-1");
		});

		it("should not move above the first item", () => {
			tree.handleKey(makeKey("up"));
			expect(tree.selected!.id).toBe("s1");
		});

		it("should not move below the last item", () => {
			// Move to the very last node
			for (let i = 0; i < 10; i++) tree.handleKey(makeKey("down"));
			expect(tree.selected!.id).toBe("s3");
			tree.handleKey(makeKey("down"));
			expect(tree.selected!.id).toBe("s3");
		});

		it("should jump to start on Home", () => {
			tree.handleKey(makeKey("down"));
			tree.handleKey(makeKey("down"));
			tree.handleKey(makeKey("home"));
			expect(tree.selected!.id).toBe("s1");
		});

		it("should jump to end on End", () => {
			tree.handleKey(makeKey("end"));
			expect(tree.selected!.id).toBe("s3");
		});
	});

	describe("collapse / expand", () => {
		it("should collapse a parent node on Enter", () => {
			// Select s1 (which has children) and press Enter -> collapse
			tree.handleKey(makeKey("return"));

			const output = tree.render(80, 20);
			const joined = output.join("\n");
			// Children should not be visible
			expect(joined).not.toContain("Branch A");
			expect(joined).not.toContain("Branch B");
			// Collapse icon should be present
			expect(joined).toContain("\u25B6"); // ▶ (collapsed indicator)
		});

		it("should expand a collapsed node on Enter", () => {
			// Collapse
			tree.handleKey(makeKey("return"));
			// Expand
			tree.handleKey(makeKey("return"));

			const output = tree.render(80, 20);
			const joined = output.join("\n");
			expect(joined).toContain("Branch A");
		});

		it("should collapse on left arrow", () => {
			tree.handleKey(makeKey("left"));

			const output = tree.render(80, 20);
			expect(output.join("\n")).not.toContain("Branch A");
		});

		it("should expand on right arrow when collapsed", () => {
			tree.handleKey(makeKey("left")); // collapse
			tree.handleKey(makeKey("right")); // expand

			const output = tree.render(80, 20);
			expect(output.join("\n")).toContain("Branch A");
		});

		it("should move to parent on left arrow when at a leaf or already collapsed", () => {
			// Navigate to Branch A (child of s1)
			tree.handleKey(makeKey("down")); // s1-1
			expect(tree.selected!.id).toBe("s1-1");

			// Left arrow on a leaf -> move to parent
			tree.handleKey(makeKey("left"));
			expect(tree.selected!.id).toBe("s1");
		});
	});

	describe("selection handler", () => {
		it("should call onSelect when pressing Enter on a leaf node", () => {
			const handler = vi.fn();
			tree.onSelect(handler);

			// Navigate to Branch A (a leaf)
			tree.handleKey(makeKey("down")); // s1-1
			tree.handleKey(makeKey("return"));

			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({ id: "s1-1" }),
			);
		});

		it("should call onSelect when pressing Space", () => {
			const handler = vi.fn();
			tree.onSelect(handler);

			tree.handleKey(makeKey(" ", { sequence: " " }));
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({ id: "s1" }),
			);
		});
	});

	describe("setNodes", () => {
		it("should replace the tree data", () => {
			tree.setNodes([
				makeNode("new-1", "Replaced"),
			]);

			expect(tree.selected!.id).toBe("new-1");
			const output = tree.render(80, 20);
			expect(output.join("\n")).toContain("Replaced");
			expect(output.join("\n")).not.toContain("First session");
		});
	});

	describe("scrolling", () => {
		it("should scroll when there are more items than fit in the viewport", () => {
			const manyNodes: SessionTreeNode[] = [];
			for (let i = 0; i < 50; i++) {
				manyNodes.push(makeNode(`n${i}`, `Session ${i}`));
			}
			const bigTree = new SessionTree(manyNodes);

			// Navigate to the bottom
			for (let i = 0; i < 49; i++) bigTree.handleKey(makeKey("down"));

			const output = bigTree.render(80, 10);
			const joined = output.join("\n");
			// Should show a "more above" indicator
			expect(joined).toContain("more above");
		});
	});
});
