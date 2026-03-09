import { describe, expect, it } from "vitest";
import { normalizeProjectPath, resolveProjectKey } from "../src/services-helpers.js";

describe("services-helpers project resolution", () => {
	it("returns the stored key for an exact normalized project match", () => {
		const stored = "/tmp/chitragupta/projects/app";
		expect(resolveProjectKey(stored, [stored])).toBe(stored);
		expect(resolveProjectKey(`${stored}/`, [stored])).toBe(stored);
	});

	it("does not alias similarly named repositories by basename", () => {
		const known = [
			"/Users/test/work/alpha/api",
			"/Users/test/archive/api",
		];
		const requested = "/Users/test/other/api";
		expect(resolveProjectKey(requested, known)).toBe(normalizeProjectPath(requested));
	});

	it("does not alias by suffix across different parent trees", () => {
		const known = [
			"/Users/test/company-one/platform/web",
			"/Users/test/company-two/platform/web",
		];
		const requested = "/Users/test/company-three/platform/web";
		expect(resolveProjectKey(requested, known)).toBe(normalizeProjectPath(requested));
	});
});
