/**
 * Daemon Data-Plane Audit — structural + behavioral tests.
 *
 * Covers all 5 audit findings:
 *   1. Single-writer guarantee (no direct smriti in MCP tool handlers)
 *   2. Conversation capture (onToolCall + record_conversation wiring)
 *   3. Eager daemon warm-up on MCP startup
 *   4. Numeric parameter validation in services.ts
 *   5. Fallback runtime behavior (rejects writes, handles reads)
 *
 * Uses source-code scanning for structural contracts + runtime tests
 * for the fallback module.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";

// ─── Source files under test ─────────────────────────────────────────────────

const readSource = (rel: string) =>
	fs.readFileSync(new URL(rel, import.meta.url), "utf-8");

const syncToolsSource = readSource("../src/modes/mcp-tools-sync.ts");
const mcpServerSource = readSource("../src/modes/mcp-server.ts");
const mcpDaemonWiringSource = (() => { try { return readSource("../src/modes/mcp-daemon-wiring.ts"); } catch { return ""; } })();
const mcpSessionSource = readSource("../src/modes/mcp-session.ts");
const mcpSessionHelpersSource = readSource("../src/modes/mcp-session-helpers.ts");
const servicesSource = readSource("../../daemon/src/services.ts");
const servicesReadSource = readSource("../../daemon/src/services-read.ts");
const allServicesSource = servicesSource + servicesReadSource;
const servicesHelpersSource = readSource("../../daemon/src/services-helpers.ts");
const fallbackSource = readSource("../src/modes/daemon-bridge-fallback.ts");
const bridgeSource = readSource("../src/modes/daemon-bridge.ts");

// ─── Issue 1: Single-Writer Guarantee ───────────────────────────────────────

describe("Issue 1: Single-writer guarantee", () => {
	describe("mcp-tools-sync.ts has no direct smriti bypass", () => {
		it("does not import VidhiEngine directly", () => {
			expect(syncToolsSource).not.toContain("import { VidhiEngine");
			expect(syncToolsSource).not.toContain("from \"@chitragupta/smriti\"");
		});

		it("does not import ConsolidationEngine directly", () => {
			expect(syncToolsSource).not.toContain("import { ConsolidationEngine");
		});

		it("vidhis tool uses bridge.listVidhisViaDaemon", () => {
			expect(syncToolsSource).toContain("bridge.listVidhisViaDaemon");
		});

		it("vidhis search uses bridge.matchVidhiViaDaemon", () => {
			expect(syncToolsSource).toContain("bridge.matchVidhiViaDaemon");
		});

		it("consolidate tool uses bridge.runConsolidationViaDaemon", () => {
			expect(syncToolsSource).toContain("bridge.runConsolidationViaDaemon");
		});

		it("recall tool uses bridge.unifiedRecall", () => {
			expect(syncToolsSource).toContain("bridge.unifiedRecall");
		});
	});

	describe("daemon services.ts runs VidhiEngine/ConsolidationEngine", () => {
		it("registers vidhi.list method", () => {
			expect(servicesSource).toContain('"vidhi.list"');
		});

		it("registers vidhi.match method", () => {
			expect(servicesSource).toContain('"vidhi.match"');
		});

		it("registers consolidation.run method", () => {
			expect(servicesSource).toContain('"consolidation.run"');
		});

		it("consolidation.run calls consolidator.save() inside daemon process", () => {
			const consolRunIdx = servicesSource.indexOf('"consolidation.run"');
			const saveIdx = servicesSource.indexOf("consolidator.save()", consolRunIdx);
			expect(saveIdx).toBeGreaterThan(consolRunIdx);
		});

		it("session.create forwards metadata/client key fields to session-store", () => {
			const createIdx = servicesSource.indexOf('"session.create"');
			const nextIdx = servicesSource.indexOf("router.register", createIdx + 1);
			const body = servicesSource.slice(createIdx, nextIdx);
			expect(body).toContain("metadata:");
			expect(body).toContain("parentSessionId:");
		});
	});

	describe("write operations excluded from fallback", () => {
		it("consolidation.run is NOT in FALLBACK_METHODS", () => {
			expect(fallbackSource).not.toContain('"consolidation.run"');
		});

		it("turn.add is NOT in FALLBACK_METHODS", () => {
			expect(fallbackSource).not.toContain('"turn.add"');
		});

		it("session.create is NOT in FALLBACK_METHODS", () => {
			expect(fallbackSource).not.toContain('"session.create"');
		});

		it("fact.extract is NOT in FALLBACK_METHODS", () => {
			expect(fallbackSource).not.toContain('"fact.extract"');
		});

		it("memory.append is NOT in FALLBACK_METHODS", () => {
			expect(fallbackSource).not.toContain('"memory.append"');
		});
	});

	describe("vidhi reads have fallback support", () => {
		it("vidhi.list is in FALLBACK_METHODS", () => {
			const methods = fallbackSource.match(/FALLBACK_METHODS\s*=\s*new Set\(\[([^\]]+)\]\)/s);
			expect(methods).toBeTruthy();
			expect(methods![1]).toContain('"vidhi.list"');
		});

		it("vidhi.match is in FALLBACK_METHODS", () => {
			const methods = fallbackSource.match(/FALLBACK_METHODS\s*=\s*new Set\(\[([^\]]+)\]\)/s);
			expect(methods).toBeTruthy();
			expect(methods![1]).toContain('"vidhi.match"');
		});

		it("vidhi.list has a switch case", () => {
			expect(fallbackSource).toContain('case "vidhi.list"');
		});

		it("vidhi.match has a switch case", () => {
			expect(fallbackSource).toContain('case "vidhi.match"');
		});
	});
});

// ─── Issue 2: Conversation Capture ──────────────────────────────────────────

describe("Issue 2: Conversation capture wiring", () => {
	it("MCP server wires onToolCall to recorder", () => {
		expect(mcpServerSource).toContain("onToolCall:");
		expect(mcpServerSource).toContain("recorder.recordToolCall");
	});

	it("recorder is created from McpSessionRecorder", () => {
		expect(mcpServerSource).toContain("new McpSessionRecorder(projectPath)");
	});

	it("record_conversation tool is registered on the server", () => {
		expect(mcpServerSource).toContain("recorder.createRecordConversationTool()");
	});

	it("McpSessionRecorder has recordToolCall method", () => {
		expect(mcpSessionSource).toContain("async recordToolCall(info:");
	});

	it("record_conversation records each turn via bridge.addTurn", () => {
		expect(mcpSessionSource).toContain("bridge.addTurn(sid, this.projectPath");
	});

	it("record_conversation extracts facts from user turns", () => {
		expect(mcpSessionSource).toContain("bridge.extractFacts(t.content, this.projectPath)");
	});

	it("tool calls record semantic content, not raw JSON", () => {
		expect(mcpSessionSource).toContain("extractSemanticContent(");
		expect(mcpSessionSource).not.toContain("[tool:${info.tool}] ${JSON.stringify");
	});

	it("ANSI stripping is applied to results", () => {
		expect(mcpSessionHelpersSource).toContain("function stripAnsi(text: string)");
	});

	it("autoExtractEvents persists coding_agent results to project memory", () => {
		expect(mcpSessionSource).toContain('info.tool === "coding_agent"');
		expect(mcpSessionSource).toContain("bridge.appendMemoryViaDaemon");
	});
});

// ─── Issue 3: Eager Daemon Warm-up ──────────────────────────────────────────

describe("Issue 3: Eager daemon warm-up", () => {
	it("MCP server eagerly warms daemon RPC bridge after start", () => {
		// setImmediate(() => getDaemonClient({ autoStart: true }))
		expect(mcpServerSource).toContain("getDaemonClient({ autoStart: true })");
	});

	it("warm-up runs after server.start() not before", () => {
		const startIdx = mcpServerSource.indexOf("await server.start()");
		const warmIdx = mcpServerSource.indexOf("getDaemonClient({ autoStart: true })");
		expect(startIdx).toBeGreaterThan(-1);
		expect(warmIdx).toBeGreaterThan(startIdx);
	});

	it("warm-up failure does not crash the server", () => {
		// catch block must exist around warm-up (error is swallowed gracefully)
		const warmIdx = mcpServerSource.indexOf("getDaemonClient({ autoStart: true })");
		const nearbySource = mcpServerSource.slice(warmIdx - 200, warmIdx + 300);
		expect(nearbySource).toContain("catch");
	});

	it("DaemonManager auto-starts in background", () => {
		const combined = mcpServerSource + mcpDaemonWiringSource;
		expect(combined).toContain("daemonManager.start().catch");
	});
});

// ─── Issue 4: Numeric Parameter Validation ──────────────────────────────────

describe("Issue 4: Numeric parameter validation", () => {
	it("parseNonNegativeInt helper exists", () => {
		expect(servicesHelpersSource).toContain("function parseNonNegativeInt(value: unknown, field: string");
	});

	it("parseLimit helper exists", () => {
		expect(servicesHelpersSource).toContain("function parseLimit(value: unknown");
	});

	it("parseNonNegativeInt rejects NaN", () => {
		expect(servicesHelpersSource).toContain("!Number.isFinite(parsed)");
	});

	it("parseLimit caps at max", () => {
		expect(servicesHelpersSource).toContain("Math.min(max, Math.trunc(parsed))");
	});

	describe("all numeric RPC params use validators", () => {
		it("session.modified_since uses parseNonNegativeInt for sinceMs", () => {
			const methodIdx = servicesSource.indexOf('"session.modified_since"');
			const nextMethodIdx = servicesSource.indexOf("router.register", methodIdx + 1);
			const methodBody = servicesSource.slice(methodIdx, nextMethodIdx);
			expect(methodBody).toContain("parseNonNegativeInt(params.sinceMs");
		});

		it("turn.since uses parseNonNegativeInt for sinceTurnNumber", () => {
			const methodIdx = servicesSource.indexOf('"turn.since"');
			const nextMethodIdx = servicesSource.indexOf("router.register", methodIdx + 1);
			const methodBody = servicesSource.slice(methodIdx, nextMethodIdx);
			expect(methodBody).toContain("parseNonNegativeInt(params.sinceTurnNumber");
		});

		it("memory.search uses parseLimit", () => {
			const methodIdx = servicesSource.indexOf('"memory.search"');
			const nextMethodIdx = servicesSource.indexOf("router.register", methodIdx + 1);
			const methodBody = servicesSource.slice(methodIdx, nextMethodIdx);
			expect(methodBody).toContain("parseLimit(params.limit");
		});

		it("memory.recall uses parseLimit", () => {
			const methodIdx = servicesSource.indexOf('"memory.recall"');
			const nextMethodIdx = servicesSource.indexOf("router.register", methodIdx + 1);
			const methodBody = servicesSource.slice(methodIdx, nextMethodIdx);
			expect(methodBody).toContain("parseLimit(params.limit");
		});

		it("memory.unified_recall uses parseLimit", () => {
			const methodIdx = allServicesSource.indexOf('"memory.unified_recall"');
			const nextMethodIdx = allServicesSource.indexOf("router.register", methodIdx + 1);
			const methodBody = allServicesSource.slice(methodIdx, nextMethodIdx);
			expect(methodBody).toContain("parseLimit(params.limit");
		});

		it("day.search uses parseLimit", () => {
			const methodIdx = allServicesSource.indexOf('"day.search"');
			const nextMethodIdx = allServicesSource.indexOf("router.register", methodIdx + 1);
			const methodBody = allServicesSource.slice(methodIdx, nextMethodIdx);
			expect(methodBody).toContain("parseLimit(params.limit");
		});

		it("vidhi.list uses parseLimit", () => {
			const methodIdx = servicesSource.indexOf('"vidhi.list"');
			const nextMethodIdx = servicesSource.indexOf("router.register", methodIdx + 1);
			const methodBody = servicesSource.slice(methodIdx, nextMethodIdx);
			expect(methodBody).toContain("parseLimit(params.limit");
		});

		it("consolidation.run uses parseLimit for sessionCount", () => {
			const methodIdx = servicesSource.indexOf('"consolidation.run"');
			const nextMethodIdx = servicesSource.indexOf("router.register", methodIdx + 1);
			const methodBody = servicesSource.slice(methodIdx, nextMethodIdx > -1 ? nextMethodIdx : undefined);
			expect(methodBody).toContain("parseLimit(params.sessionCount");
		});
	});
});

// ─── Issue 5: Fallback Runtime Behavior ─────────────────────────────────────

describe("Issue 5: Fallback runtime behavior", () => {
	describe("directFallback rejects write operations", () => {
		it("throws DaemonUnavailableError for unknown methods", async () => {
			const { directFallback } = await import("../src/modes/daemon-bridge-fallback.js");

			await expect(
				directFallback("turn.add", { sessionId: "test", turn: {} }),
			).rejects.toThrow("requires daemon");
		});

		it("throws DaemonUnavailableError for session.create", async () => {
			const { directFallback } = await import("../src/modes/daemon-bridge-fallback.js");

			await expect(
				directFallback("session.create", { project: "/test" }),
			).rejects.toThrow("requires daemon");
		});

		it("throws DaemonUnavailableError for fact.extract", async () => {
			const { directFallback } = await import("../src/modes/daemon-bridge-fallback.js");

			await expect(
				directFallback("fact.extract", { text: "test" }),
			).rejects.toThrow("requires daemon");
		});

		it("throws DaemonUnavailableError for memory.append", async () => {
			const { directFallback } = await import("../src/modes/daemon-bridge-fallback.js");

			await expect(
				directFallback("memory.append", { entry: "test" }),
			).rejects.toThrow("requires daemon");
		});

		it("throws DaemonUnavailableError for consolidation.run", async () => {
			const { directFallback } = await import("../src/modes/daemon-bridge-fallback.js");

			await expect(
				directFallback("consolidation.run", { project: "/test" }),
			).rejects.toThrow("requires daemon");
		});
	});

	describe("directFallback accepts read operations", () => {
		it("daemon.ping returns false in fallback mode", async () => {
			const { directFallback } = await import("../src/modes/daemon-bridge-fallback.js");

			const result = await directFallback<{ pong: boolean; mode: string }>("daemon.ping");
			expect(result.pong).toBe(false);
			expect(result.mode).toBe("direct-fallback");
		});

		it("daemon.health returns degraded in fallback mode", async () => {
			const { directFallback } = await import("../src/modes/daemon-bridge-fallback.js");

			const result = await directFallback<{ status: string; mode: string }>("daemon.health");
			expect(result.status).toBe("degraded");
			expect(result.mode).toBe("direct-fallback");
		});
	});

	describe("FALLBACK_METHODS ↔ switch case contract", () => {
		function extractFallbackMethods(): string[] {
			const match = fallbackSource.match(/FALLBACK_METHODS\s*=\s*new Set\(\[([^\]]+)\]\)/s);
			if (!match) return [];
			return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
		}

		function extractSwitchCases(): string[] {
			const fnStart = fallbackSource.indexOf("async function directFallback");
			if (fnStart === -1) return [];
			const switchStart = fallbackSource.indexOf("switch (method)", fnStart);
			if (switchStart === -1) return [];
			const switchEnd = fallbackSource.indexOf("}", fallbackSource.indexOf("default:", switchStart));
			const switchBody = fallbackSource.slice(switchStart, switchEnd);
			return [...switchBody.matchAll(/case "([^"]+)":/g)].map((m) => m[1]);
		}

		it("every FALLBACK_METHODS entry has a switch case", () => {
			const methods = extractFallbackMethods();
			const cases = extractSwitchCases();
			expect(methods.length).toBeGreaterThan(0);
			const missing = methods.filter((m) => !cases.includes(m));
			expect(missing).toEqual([]);
		});

		it("no switch case exists without a FALLBACK_METHODS entry", () => {
			const methods = new Set(extractFallbackMethods());
			const cases = extractSwitchCases();
			const orphan = cases.filter((c) => !methods.has(c));
			expect(orphan).toEqual([]);
		});

		it("total fallback methods count is 19", () => {
			const methods = extractFallbackMethods();
			expect(methods.length).toBe(19);
		});
	});

	describe("bridge wiring", () => {
		it("bridge imports directFallback from fallback module", () => {
			expect(bridgeSource).toContain('import { directFallback } from "./daemon-bridge-fallback.js"');
		});

		it("daemonCall routes to directFallback in direct mode", () => {
			expect(bridgeSource).toContain("directFallback<T>(method, params)");
		});

		it("bridge exports vidhi proxy methods", () => {
			expect(bridgeSource).toContain("export async function listVidhisViaDaemon");
			expect(bridgeSource).toContain("export async function matchVidhiViaDaemon");
		});

		it("bridge exports consolidation proxy method", () => {
			expect(bridgeSource).toContain("export async function runConsolidationViaDaemon");
		});
	});
});
