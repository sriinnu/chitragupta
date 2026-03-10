import type { RpcRouter } from "./rpc-router.js";

/** Write methods that enforce single-writer through daemon. */
export function registerWriteMethods(router: RpcRouter): void {
	router.register("memory.update", async (params) => {
		const { parseMemoryScope, resolveMemoryScope } = await import("./services-read.js");
		const scope = parseMemoryScope(params);
		const content = String(params.content ?? "");
		const { updateMemory } = await import("@chitragupta/smriti/memory-store");
		await updateMemory(scope, content);
		return {
			updated: true,
			scope: resolveMemoryScope(scope),
			timestamp: new Date().toISOString(),
		};
	}, "Overwrite memory content for a global, project, or agent scope");

	router.register("memory.delete", async (params) => {
		const { parseMemoryScope, resolveMemoryScope } = await import("./services-read.js");
		const scope = parseMemoryScope(params);
		const { deleteMemory } = await import("@chitragupta/smriti/memory-store");
		deleteMemory(scope);
		return {
			deleted: true,
			scope: resolveMemoryScope(scope),
			timestamp: new Date().toISOString(),
		};
	}, "Delete memory for a global, project, or agent scope");

	router.register("fact.extract", async (params) => {
		let projectPath = typeof params.projectPath === "string" ? params.projectPath : undefined;
		const text = String(params.text ?? "");
		if (!text) throw new Error("Missing text");
		if (projectPath) {
			const { normalizeProjectPath } = await import("./services-helpers.js");
			projectPath = normalizeProjectPath(projectPath);
		}

		const { getFactExtractor } = await import("@chitragupta/smriti/fact-extractor");
		const extractor = getFactExtractor();
		const facts = await extractor.extractAndSave(
			text,
			{ type: "global" },
			projectPath ? { type: "project", path: projectPath } : undefined,
		);
		return { extracted: facts.length, facts };
	}, "Extract and save facts from text (single-writer)");
}
