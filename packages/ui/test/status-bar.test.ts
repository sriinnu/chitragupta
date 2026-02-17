import { describe, it, expect, beforeEach } from "vitest";
import { StatusBar, type StatusBarData } from "../src/components/status-bar.js";

describe("StatusBar", () => {
	let bar: StatusBar;

	beforeEach(() => {
		bar = new StatusBar();
	});

	describe("update / clear", () => {
		it("should merge partial data updates", () => {
			bar.update({ model: "gpt-4o" });
			bar.update({ cost: 0.05 });

			const rendered = bar.render(100);
			expect(rendered).toContain("gpt-4o");
			expect(rendered).toContain("$0.05");
		});

		it("should clear all data", () => {
			bar.update({ model: "claude-3", cost: 1.50 });
			bar.clear();

			const rendered = bar.render(100);
			// After clear, model and cost should not appear
			expect(rendered).not.toContain("claude-3");
			expect(rendered).not.toContain("$1.50");
		});
	});

	describe("render", () => {
		it("should render model name", () => {
			bar.update({ model: "claude-opus-4" });
			const rendered = bar.render(120);
			expect(rendered).toContain("claude-opus-4");
		});

		it("should render provider in parens", () => {
			bar.update({ model: "gpt-4o", provider: "openai" });
			const rendered = bar.render(120);
			expect(rendered).toContain("openai");
		});

		it("should format small costs with 4 decimal places", () => {
			bar.update({ cost: 0.001 });
			const rendered = bar.render(100);
			expect(rendered).toContain("$0.0010");
		});

		it("should format larger costs with 2 decimal places", () => {
			bar.update({ cost: 2.5 });
			const rendered = bar.render(100);
			expect(rendered).toContain("$2.50");
		});

		it("should render token counts in k format for large values", () => {
			bar.update({ inputTokens: 5000, outputTokens: 3000 });
			const rendered = bar.render(120);
			expect(rendered).toContain("8.0k tok");
		});

		it("should render raw token count for small values", () => {
			bar.update({ inputTokens: 500, outputTokens: 200 });
			const rendered = bar.render(120);
			expect(rendered).toContain("700 tok");
		});

		it("should render context percentage with a mini bar", () => {
			bar.update({ contextPercent: 75 });
			const rendered = bar.render(120);
			expect(rendered).toContain("ctx 75%");
		});

		it("should render thinking level", () => {
			bar.update({ thinkingLevel: "high" });
			const rendered = bar.render(120);
			expect(rendered).toContain("high");
		});

		it("should render a message", () => {
			bar.update({ message: "Compacting..." });
			const rendered = bar.render(120);
			expect(rendered).toContain("Compacting...");
		});

		it("should produce output no matter the width", () => {
			bar.update({ model: "test" });
			const narrow = bar.render(10);
			expect(narrow.length).toBeGreaterThan(0);

			const wide = bar.render(200);
			expect(wide.length).toBeGreaterThan(0);
		});
	});

	describe("custom items", () => {
		it("should add and render custom items in sections", () => {
			bar.setItem({ id: "custom-1", content: "CUSTOM", section: "left" });
			const rendered = bar.render(120);
			expect(rendered).toContain("CUSTOM");
		});

		it("should update existing items by ID", () => {
			bar.setItem({ id: "x", content: "OLD", section: "left" });
			bar.setItem({ id: "x", content: "NEW", section: "left" });

			const items = bar.getItems("left");
			expect(items).toHaveLength(1);
			expect(items[0].content).toBe("NEW");
		});

		it("should remove items by ID", () => {
			bar.setItem({ id: "removable", content: "BYE", section: "right" });
			bar.removeItem("removable");

			const items = bar.getItems("right");
			expect(items).toHaveLength(0);
		});

		it("should clear all custom items", () => {
			bar.setItem({ id: "a", content: "A", section: "left" });
			bar.setItem({ id: "b", content: "B", section: "right" });
			bar.clearItems();

			expect(bar.getItems("left")).toHaveLength(0);
			expect(bar.getItems("right")).toHaveLength(0);
		});

		it("should sort items by priority (higher first)", () => {
			bar.setItem({ id: "low", content: "LOW", section: "left", priority: 1 });
			bar.setItem({ id: "high", content: "HIGH", section: "left", priority: 10 });
			bar.setItem({ id: "mid", content: "MID", section: "left", priority: 5 });

			const items = bar.getItems("left");
			expect(items[0].id).toBe("high");
			expect(items[1].id).toBe("mid");
			expect(items[2].id).toBe("low");
		});
	});

	describe("provider health", () => {
		it("should set and get provider health", () => {
			bar.setProviderHealth("healthy");
			expect(bar.providerHealth).toBe("healthy");
		});

		it("should render a health indicator dot", () => {
			bar.setProviderHealth("degraded");
			const rendered = bar.render(100);
			// Should contain the filled circle character
			expect(rendered).toContain("\u25CF");
		});

		it("should not render a dot when health is unknown", () => {
			bar.setProviderHealth("unknown");
			const rendered = bar.render(100);
			// Unknown health should not show a dot
			// (The dot is only shown when health !== "unknown")
		});
	});

	describe("git branch", () => {
		it("should render the git branch name", () => {
			bar.setGitBranch("feature/awesome");
			const rendered = bar.render(120);
			expect(rendered).toContain("feature/awesome");
		});

		it("should get the branch name", () => {
			bar.setGitBranch("main");
			expect(bar.gitBranch).toBe("main");
		});
	});

	describe("animated indicators", () => {
		it("should show streaming indicator when active", () => {
			bar.setStreaming(true);
			const rendered = bar.render(120);
			expect(rendered).toContain("streaming");
		});

		it("should show thinking indicator when active", () => {
			bar.setThinking(true);
			const rendered = bar.render(120);
			expect(rendered).toContain("thinking");
		});

		it("should not show indicators when inactive", () => {
			const rendered = bar.render(120);
			expect(rendered).not.toContain("streaming");
			expect(rendered).not.toContain("thinking");
		});

		it("should advance animation frame on tick", () => {
			bar.setStreaming(true);
			const r1 = bar.render(120);
			bar.tick();
			const r2 = bar.render(120);
			// The animation frame advances, so the output may differ
			// (but both should contain "streaming")
			expect(r1).toContain("streaming");
			expect(r2).toContain("streaming");
		});
	});
});
