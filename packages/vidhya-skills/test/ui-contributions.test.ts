import { describe, it, expect } from "vitest";
import { parseSkillMarkdown } from "../src/parser.js";
import { writeSkillMarkdown } from "../src/writer.js";
import { parseFrontmatter } from "../src/parser-yaml.js";
import type { SkillUIContributions } from "../src/ui-contribution-types.js";

// ─── Sample SKILL.md with full UI contributions ────────────────────────────

const SKILL_WITH_UI = `---
name: gcp-status
description: Google Cloud Platform status monitor
version: "1.0"
tags: [gcp, cloud, monitoring]
source:
  type: plugin
  pluginName: gcp-tools
updatedAt: 2025-06-01T00:00:00Z
ui:
  widgets:
    - id: gcp-status
      label: GCP
      position: right
      refreshMs: 30000
      script: gcloud auth list --format=json
      format: json
    - id: gcp-project
      label: Project
      position: right
      channel: "#gcp-project"
  keybinds:
    - key: ctrl+g
      description: Switch GCP project
      command: gcp_switch_project
  panels:
    - id: gcp-dashboard
      title: GCP Dashboard
      type: sidebar
      channel: "#gcp-dashboard"
      format: markdown
---

## Capabilities

### monitor / gcp-status
Monitor the current GCP project status.
`;

// ─── Parsing ────────────────────────────────────────────────────────────────

describe("UI contributions — parsing", () => {
	it("parses widgets from frontmatter", () => {
		const manifest = parseSkillMarkdown(SKILL_WITH_UI);

		expect(manifest.ui).toBeDefined();
		expect(manifest.ui!.widgets).toBeDefined();
		expect(manifest.ui!.widgets).toHaveLength(2);

		const w1 = manifest.ui!.widgets![0];
		expect(w1.id).toBe("gcp-status");
		expect(w1.label).toBe("GCP");
		expect(w1.position).toBe("right");
		expect(w1.refreshMs).toBe(30000);
		expect(w1.script).toBe("gcloud auth list --format=json");
		expect(w1.format).toBe("json");

		const w2 = manifest.ui!.widgets![1];
		expect(w2.id).toBe("gcp-project");
		expect(w2.label).toBe("Project");
		expect(w2.channel).toBe("#gcp-project");
		expect(w2.script).toBeUndefined();
	});

	it("parses keybinds from frontmatter", () => {
		const manifest = parseSkillMarkdown(SKILL_WITH_UI);

		expect(manifest.ui!.keybinds).toBeDefined();
		expect(manifest.ui!.keybinds).toHaveLength(1);

		const kb = manifest.ui!.keybinds![0];
		expect(kb.key).toBe("ctrl+g");
		expect(kb.description).toBe("Switch GCP project");
		expect(kb.command).toBe("gcp_switch_project");
		expect(kb.args).toBeUndefined();
	});

	it("parses panels from frontmatter", () => {
		const manifest = parseSkillMarkdown(SKILL_WITH_UI);

		expect(manifest.ui!.panels).toBeDefined();
		expect(manifest.ui!.panels).toHaveLength(1);

		const panel = manifest.ui!.panels![0];
		expect(panel.id).toBe("gcp-dashboard");
		expect(panel.title).toBe("GCP Dashboard");
		expect(panel.type).toBe("sidebar");
		expect(panel.channel).toBe("#gcp-dashboard");
		expect(panel.format).toBe("markdown");
	});
});

// ─── Missing / Optional Fields ──────────────────────────────────────────────

describe("UI contributions — missing / optional fields", () => {
	it("returns no ui when frontmatter has no ui section", () => {
		const noUI = `---
name: basic-skill
description: No UI
version: "1.0"
tags: []
source:
  type: manual
  filePath: /test
updatedAt: 2025-01-01T00:00:00Z
---
`;
		const manifest = parseSkillMarkdown(noUI);
		expect(manifest.ui).toBeUndefined();
	});

	it("handles ui section with only widgets", () => {
		const onlyWidgets = `---
name: widgets-only
description: Only widgets
version: "1.0"
tags: []
source:
  type: manual
  filePath: /test
updatedAt: 2025-01-01T00:00:00Z
ui:
  widgets:
    - id: status
      label: Status
---
`;
		const manifest = parseSkillMarkdown(onlyWidgets);
		expect(manifest.ui).toBeDefined();
		expect(manifest.ui!.widgets).toHaveLength(1);
		expect(manifest.ui!.keybinds).toBeUndefined();
		expect(manifest.ui!.panels).toBeUndefined();
	});

	it("handles ui section with only keybinds", () => {
		const onlyKeybinds = `---
name: keybinds-only
description: Only keybinds
version: "1.0"
tags: []
source:
  type: manual
  filePath: /test
updatedAt: 2025-01-01T00:00:00Z
ui:
  keybinds:
    - key: ctrl+k
      description: Quick action
      command: do_thing
---
`;
		const manifest = parseSkillMarkdown(onlyKeybinds);
		expect(manifest.ui).toBeDefined();
		expect(manifest.ui!.keybinds).toHaveLength(1);
		expect(manifest.ui!.widgets).toBeUndefined();
		expect(manifest.ui!.panels).toBeUndefined();
	});

	it("handles ui section with only panels", () => {
		const onlyPanels = `---
name: panels-only
description: Only panels
version: "1.0"
tags: []
source:
  type: manual
  filePath: /test
updatedAt: 2025-01-01T00:00:00Z
ui:
  panels:
    - id: info
      title: Info Panel
      type: modal
---
`;
		const manifest = parseSkillMarkdown(onlyPanels);
		expect(manifest.ui).toBeDefined();
		expect(manifest.ui!.panels).toHaveLength(1);
		expect(manifest.ui!.panels![0].type).toBe("modal");
		expect(manifest.ui!.widgets).toBeUndefined();
		expect(manifest.ui!.keybinds).toBeUndefined();
	});

	it("skips invalid widgets missing required fields", () => {
		const invalidWidget = `---
name: bad-widget
description: Widget without label
version: "1.0"
tags: []
source:
  type: manual
  filePath: /test
updatedAt: 2025-01-01T00:00:00Z
ui:
  widgets:
    - id: no-label
---
`;
		const manifest = parseSkillMarkdown(invalidWidget);
		// Widget has id but no label -- should be skipped
		expect(manifest.ui).toBeUndefined();
	});

	it("skips invalid keybinds missing required fields", () => {
		const invalidKeybind = `---
name: bad-keybind
description: Keybind without command
version: "1.0"
tags: []
source:
  type: manual
  filePath: /test
updatedAt: 2025-01-01T00:00:00Z
ui:
  keybinds:
    - key: ctrl+x
      description: Missing command
---
`;
		const manifest = parseSkillMarkdown(invalidKeybind);
		expect(manifest.ui).toBeUndefined();
	});

	it("skips invalid panels with bad type", () => {
		const badPanelType = `---
name: bad-panel
description: Panel with invalid type
version: "1.0"
tags: []
source:
  type: manual
  filePath: /test
updatedAt: 2025-01-01T00:00:00Z
ui:
  panels:
    - id: bad
      title: Bad Panel
      type: drawer
---
`;
		const manifest = parseSkillMarkdown(badPanelType);
		// "drawer" is not a valid panel type
		expect(manifest.ui).toBeUndefined();
	});
});

// ─── Widget Variants ────────────────────────────────────────────────────────

describe("UI contributions — widget variants", () => {
	it("handles widget with script (polling model)", () => {
		const manifest = parseSkillMarkdown(SKILL_WITH_UI);
		const w = manifest.ui!.widgets![0];
		expect(w.script).toBe("gcloud auth list --format=json");
		expect(w.refreshMs).toBe(30000);
		expect(w.channel).toBeUndefined();
	});

	it("handles widget with channel (push model)", () => {
		const manifest = parseSkillMarkdown(SKILL_WITH_UI);
		const w = manifest.ui!.widgets![1];
		expect(w.channel).toBe("#gcp-project");
		expect(w.script).toBeUndefined();
		expect(w.refreshMs).toBeUndefined();
	});
});

// ─── Panel Types ────────────────────────────────────────────────────────────

describe("UI contributions — panel types", () => {
	const makePanelMd = (type: string) => `---
name: panel-test
description: Panel type test
version: "1.0"
tags: []
source:
  type: manual
  filePath: /test
updatedAt: 2025-01-01T00:00:00Z
ui:
  panels:
    - id: test-panel
      title: Test
      type: ${type}
---
`;

	for (const panelType of ["sidebar", "modal", "overlay", "tab"]) {
		it(`accepts panel type "${panelType}"`, () => {
			const manifest = parseSkillMarkdown(makePanelMd(panelType));
			expect(manifest.ui).toBeDefined();
			expect(manifest.ui!.panels![0].type).toBe(panelType);
		});
	}
});

// ─── Writing ────────────────────────────────────────────────────────────────

describe("UI contributions — writing", () => {
	it("serializes ui section in output", () => {
		const manifest = parseSkillMarkdown(SKILL_WITH_UI);
		const written = writeSkillMarkdown(manifest);

		expect(written).toContain("ui:");
		expect(written).toContain("widgets:");
		expect(written).toContain("keybinds:");
		expect(written).toContain("panels:");
		expect(written).toContain("id: gcp-status");
		expect(written).toContain("label: GCP");
		expect(written).toContain("key: ctrl+g");
		expect(written).toContain("id: gcp-dashboard");
	});

	it("omits ui section when not present", () => {
		const noUI = `---
name: no-ui
description: No UI
version: "1.0"
tags: []
source:
  type: manual
  filePath: /test
updatedAt: 2025-01-01T00:00:00Z
---
`;
		const manifest = parseSkillMarkdown(noUI);
		const written = writeSkillMarkdown(manifest);
		expect(written).not.toContain("ui:");
	});
});

// ─── Round-Trip ─────────────────────────────────────────────────────────────

describe("UI contributions — round-trip (parse -> write -> parse)", () => {
	it("preserves all UI contribution data through round-trip", () => {
		const original = parseSkillMarkdown(SKILL_WITH_UI);
		const written = writeSkillMarkdown(original);
		const reparsed = parseSkillMarkdown(written);

		// Widgets
		expect(reparsed.ui).toBeDefined();
		expect(reparsed.ui!.widgets).toHaveLength(original.ui!.widgets!.length);
		for (let i = 0; i < original.ui!.widgets!.length; i++) {
			expect(reparsed.ui!.widgets![i].id).toBe(original.ui!.widgets![i].id);
			expect(reparsed.ui!.widgets![i].label).toBe(original.ui!.widgets![i].label);
			expect(reparsed.ui!.widgets![i].position).toBe(original.ui!.widgets![i].position);
		}

		// First widget details
		expect(reparsed.ui!.widgets![0].refreshMs).toBe(original.ui!.widgets![0].refreshMs);
		expect(reparsed.ui!.widgets![0].format).toBe(original.ui!.widgets![0].format);

		// Keybinds
		expect(reparsed.ui!.keybinds).toHaveLength(original.ui!.keybinds!.length);
		expect(reparsed.ui!.keybinds![0].key).toBe(original.ui!.keybinds![0].key);
		expect(reparsed.ui!.keybinds![0].command).toBe(original.ui!.keybinds![0].command);

		// Panels
		expect(reparsed.ui!.panels).toHaveLength(original.ui!.panels!.length);
		expect(reparsed.ui!.panels![0].id).toBe(original.ui!.panels![0].id);
		expect(reparsed.ui!.panels![0].type).toBe(original.ui!.panels![0].type);
		expect(reparsed.ui!.panels![0].format).toBe(original.ui!.panels![0].format);
	});

	it("round-trips a widget with channel correctly", () => {
		const original = parseSkillMarkdown(SKILL_WITH_UI);
		const written = writeSkillMarkdown(original);
		const reparsed = parseSkillMarkdown(written);

		const w2 = reparsed.ui!.widgets![1];
		expect(w2.channel).toBe("#gcp-project");
	});
});
