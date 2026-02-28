import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSkillRegistry, mockGetUIExtensionRegistry } = vi.hoisted(() => ({
	mockGetSkillRegistry: vi.fn(),
	mockGetUIExtensionRegistry: vi.fn(),
}));

vi.mock("../src/modes/mcp-subsystems.js", () => ({
	getSkillRegistry: mockGetSkillRegistry,
}));

vi.mock("../src/modes/mcp-tools-plugins.js", () => ({
	getUIExtensionRegistry: mockGetUIExtensionRegistry,
}));

import { createPluginEcosystemResource } from "../src/modes/mcp-resources.js";

describe("createPluginEcosystemResource", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("includes UI contribution summaries from the UI extension registry", async () => {
		mockGetSkillRegistry.mockResolvedValue({
			getAll: () => [{
				name: "alpha-skill",
				description: "Alpha plugin skill",
				tags: ["alpha"],
				capabilities: ["analyze"],
			}],
		});

		mockGetUIExtensionRegistry.mockReturnValue({
			getAvailableUIExtensions: () => [{
				skillName: "alpha-skill",
				widgets: [{ id: "alpha.widget" }],
				keybinds: [{ key: "ctrl+a" }],
				panels: [{ id: "alpha.panel" }],
			}],
		});

		const resource = createPluginEcosystemResource();
		const result = await resource.read("chitragupta://ecosystem/plugins");
		const first = result[0];
		const payload = JSON.parse(first?.type === "text" ? first.text : "{}") as {
			count: number;
			uiExtensionCount: number;
			plugins: Array<{
				name: string;
				uiContributions?: {
					source: string;
					widgetCount: number;
					keybindCount: number;
					panelCount: number;
				};
			}>;
		};

		expect(payload.count).toBe(1);
		expect(payload.uiExtensionCount).toBe(1);
		expect(payload.plugins[0]?.name).toBe("alpha-skill");
		expect(payload.plugins[0]?.uiContributions).toEqual({
			source: "ui-extension-registry",
			widgets: ["alpha.widget"],
			keybinds: ["ctrl+a"],
			panels: ["alpha.panel"],
			widgetCount: 1,
			keybindCount: 1,
			panelCount: 1,
		});
	});

	it("falls back to skill-manifest UI summaries when registry extension is absent", async () => {
		mockGetSkillRegistry.mockResolvedValue({
			getAll: () => [{
				name: "beta-skill",
				description: "Beta plugin skill",
				tags: ["beta"],
				capabilities: [{ name: "inspect" }],
				ui: {
					widgets: [{ id: "beta.widget" }],
					keybinds: [{ key: "ctrl+b" }],
					panels: [{ id: "beta.panel" }],
				},
			}],
		});

		mockGetUIExtensionRegistry.mockReturnValue({
			getAvailableUIExtensions: () => [],
		});

		const resource = createPluginEcosystemResource();
		const result = await resource.read("chitragupta://ecosystem/plugins");
		const first = result[0];
		const payload = JSON.parse(first?.type === "text" ? first.text : "{}") as {
			count: number;
			plugins: Array<{
				name: string;
				uiContributions?: {
					source: string;
					widgetCount: number;
					keybindCount: number;
					panelCount: number;
				};
			}>;
		};

		expect(payload.count).toBe(1);
		expect(payload.plugins[0]?.name).toBe("beta-skill");
		expect(payload.plugins[0]?.uiContributions).toEqual({
			source: "skill-manifest",
			widgets: ["beta.widget"],
			keybinds: ["ctrl+b"],
			panels: ["beta.panel"],
			widgetCount: 1,
			keybindCount: 1,
			panelCount: 1,
		});
	});
});
