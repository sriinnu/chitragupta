import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExistsSync = vi.fn<(path: string) => boolean>();
const mockDiscoverFromDirectory = vi.fn<(path: string) => Promise<Array<Record<string, unknown>>>>();
const mockUiRegister = vi.fn();

vi.mock("node:fs", () => ({
	existsSync: (path: string) => mockExistsSync(path),
}));

vi.mock("@chitragupta/core", () => ({
	getChitraguptaHome: () => "/tmp/chitra-home",
}));

vi.mock("../src/modes/mcp-tools-plugins.js", () => ({
	getUIExtensionRegistry: () => ({
		register: mockUiRegister,
	}),
}));

vi.mock("@chitragupta/vidhya-skills", () => {
	class MockSkillRegistry {
		private readonly skills = new Map<string, Record<string, unknown>>();

		register(manifest: Record<string, unknown>): void {
			this.skills.set(String(manifest.name ?? ""), manifest);
		}

		getByName(name: string): Record<string, unknown> | undefined {
			return this.skills.get(name);
		}

		getByTag(tag: string): Array<Record<string, unknown>> {
			return [...this.skills.values()].filter((s) =>
				Array.isArray(s.tags) && (s.tags as string[]).includes(tag),
			);
		}

		getByVerb(verb: string): Array<Record<string, unknown>> {
			return [...this.skills.values()].filter((s) =>
				Array.isArray(s.capabilities) &&
				(s.capabilities as Array<Record<string, unknown>>).some((cap) =>
					String(cap.verb ?? cap.name ?? "") === verb,
				),
			);
		}

		getAll(): Array<Record<string, unknown>> {
			return [...this.skills.values()];
		}

		get size(): number {
			return this.skills.size;
		}
	}

	class MockSkillDiscovery {
		discoverFromDirectory(path: string): Promise<Array<Record<string, unknown>>> {
			return mockDiscoverFromDirectory(path);
		}
	}

	return {
		SkillRegistry: MockSkillRegistry,
		SkillDiscovery: MockSkillDiscovery,
	};
});

describe("mcp-subsystems getSkillRegistry bootstrap", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
		mockExistsSync.mockImplementation((scanPath) => String(scanPath).includes(".codex/skills"));
		mockDiscoverFromDirectory.mockImplementation(async (scanPath) => {
			if (!String(scanPath).includes(".codex/skills")) return [];
			return [{
				name: "sample-skill",
				version: "1.2.3",
				description: "Sample",
				tags: ["sample"],
				capabilities: [{ verb: "read", object: "file", description: "read files" }],
				ui: {
					widgets: [{ id: "sample.widget", label: "Sample Widget", format: "json" }],
				},
			}];
		});
	});

	it("discovers skills from known paths and registers UI contributions best-effort", async () => {
		const prevHome = process.env.HOME;
		process.env.HOME = "/Users/tester";
		try {
			const { getSkillRegistry } = await import("../src/modes/mcp-subsystems.js");
			const registry = await getSkillRegistry();

			expect(mockDiscoverFromDirectory).toHaveBeenCalledWith("/Users/tester/.codex/skills");
			expect(registry.size).toBe(1);
			expect(registry.getByName("sample-skill")).toBeDefined();
			expect(mockUiRegister).toHaveBeenCalledWith(
				expect.objectContaining({
					skillName: "sample-skill",
					version: "1.2.3",
				}),
			);
		} finally {
			process.env.HOME = prevHome;
		}
	});
});
