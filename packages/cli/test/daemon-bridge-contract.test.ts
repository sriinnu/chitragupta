/**
 * Daemon Bridge — Fallback contract tests.
 *
 * Verifies:
 * 1. isDaemonUnavailable classifies all connectivity error types
 * 2. daemonCall routes to directFallback when daemon is unreachable
 * 3. Write operations throw in direct/fallback mode
 * 4. All FALLBACK_METHODS entries have concrete switch cases
 * 5. getDaemonClient disposes previous client on reconnect
 *
 * These tests read source code to verify structural contracts,
 * not runtime behavior (which requires a real daemon socket).
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";

const bridgeSource = fs.readFileSync(
	new URL("../src/modes/daemon-bridge.ts", import.meta.url),
	"utf-8",
);

const fallbackSource = fs.readFileSync(
	new URL("../src/modes/daemon-bridge-fallback.ts", import.meta.url),
	"utf-8",
);

describe("daemon-bridge fallback contract", () => {
	// ─── Error Classification ────────────────────────────────────────────────

	describe("isDaemonUnavailable classifier", () => {
		it("exists as a function", () => {
			expect(bridgeSource).toContain("function isDaemonUnavailable(err: unknown): boolean");
		});

		it("checks DaemonUnavailableError", () => {
			expect(bridgeSource).toContain("err instanceof DaemonUnavailableError");
		});

		it("covers ECONNREFUSED, ENOENT, and EACCES", () => {
			const codesMatch = bridgeSource.match(/DAEMON_DOWN_CODES\s*=\s*new Set\(\[([^\]]+)\]\)/);
			expect(codesMatch).toBeTruthy();
			const codes = codesMatch![1];
			expect(codes).toContain('"ECONNREFUSED"');
			expect(codes).toContain('"ENOENT"');
			expect(codes).toContain('"EACCES"');
		});

		it("is used in daemonCall catch block", () => {
			expect(bridgeSource).toContain("if (isDaemonUnavailable(err))");
		});
	});

	// ─── Connect Error Normalization ─────────────────────────────────────────

	describe("getDaemonClient error normalization", () => {
		it("wraps connect errors in DaemonUnavailableError", () => {
			// getDaemonClient must catch connect() errors and wrap them
			const connectBlock = bridgeSource.match(
				/await sharedClient\.connect\(\)[\s\S]*?catch\s*\(err\)/,
			);
			expect(connectBlock).toBeTruthy();
			expect(bridgeSource).toContain(
				"new DaemonUnavailableError(err instanceof Error ? err.message : String(err))",
			);
		});

		it("disposes previous client before creating new one", () => {
			const disposeBlock = bridgeSource.match(
				/if \(sharedClient\)\s*\{[\s\S]*?sharedClient\.dispose\(\)/,
			);
			expect(disposeBlock).toBeTruthy();
		});
	});

	// ─── Fallback Method Coverage ────────────────────────────────────────────

	describe("fallback method completeness", () => {
		/** Extract the FALLBACK_METHODS set entries from the fallback module. */
		function extractFallbackMethods(): string[] {
			const match = fallbackSource.match(/FALLBACK_METHODS\s*=\s*new Set\(\[([^\]]+)\]\)/s);
			if (!match) return [];
			return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
		}

		/** Extract case labels from the directFallback switch. */
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

		it("includes session read methods", () => {
			const methods = extractFallbackMethods();
			expect(methods).toContain("session.list");
			expect(methods).toContain("session.show");
			expect(methods).toContain("session.dates");
			expect(methods).toContain("session.projects");
			expect(methods).toContain("session.modified_since");
		});

		it("includes memory/day/context/recall read-through methods", () => {
			const methods = extractFallbackMethods();
			expect(methods).toContain("memory.file_search");
			expect(methods).toContain("memory.scopes");
			expect(methods).toContain("memory.unified_recall");
			expect(methods).toContain("day.show");
			expect(methods).toContain("day.list");
			expect(methods).toContain("day.search");
			expect(methods).toContain("context.load");
		});

		it("includes turn read methods", () => {
			const methods = extractFallbackMethods();
			expect(methods).toContain("turn.list");
			expect(methods).toContain("turn.since");
			expect(methods).toContain("turn.max_number");
		});

		it("includes daemon introspection methods", () => {
			const methods = extractFallbackMethods();
			expect(methods).toContain("daemon.ping");
			expect(methods).toContain("daemon.health");
		});

		it("includes vidhi read methods", () => {
			const methods = extractFallbackMethods();
			expect(methods).toContain("vidhi.list");
			expect(methods).toContain("vidhi.match");
		});

		it("excludes consolidation write method", () => {
			const methods = extractFallbackMethods();
			expect(methods).not.toContain("consolidation.run");
		});
	});

	// ─── Write Rejection ─────────────────────────────────────────────────────

	describe("write rejection in fallback mode", () => {
		it("write methods are NOT in FALLBACK_METHODS", () => {
			const match = fallbackSource.match(/FALLBACK_METHODS\s*=\s*new Set\(\[([^\]]+)\]\)/s);
			expect(match).toBeTruthy();
			const methods = match![1];
			// These write methods must never appear in fallback
			expect(methods).not.toContain('"turn.add"');
			expect(methods).not.toContain('"session.create"');
			expect(methods).not.toContain('"session.delete"');
			expect(methods).not.toContain('"memory.append"');
			expect(methods).not.toContain('"fact.extract"');
		});

		it("non-fallback methods throw DaemonUnavailableError", () => {
			expect(fallbackSource).toContain(
				"throw new DaemonUnavailableError(",
			);
			expect(fallbackSource).toContain(
				`Operation '${"\u0024"}{method}' requires daemon`,
			);
		});
	});

	// ─── Mode Transition ─────────────────────────────────────────────────────

	describe("mode transitions", () => {
		it("switches to direct mode on daemon DEAD state", () => {
			expect(bridgeSource).toContain('if (to === HealthState.DEAD)');
			expect(bridgeSource).toContain('currentMode = "direct"');
		});

		it("switches back to daemon mode on HEALTHY recovery", () => {
			expect(bridgeSource).toContain(
				'to === HealthState.HEALTHY && currentMode === "direct"',
			);
		});

		it("daemonCall checks currentMode before attempting daemon", () => {
			const callFn = bridgeSource.indexOf("export async function daemonCall");
			expect(callFn).toBeGreaterThan(-1);
			const modeCheck = bridgeSource.indexOf('currentMode === "direct"', callFn);
			expect(modeCheck).toBeGreaterThan(callFn);
		});

		it("circuit breaker reset restores daemon mode", () => {
			expect(bridgeSource).toContain("export function resetDaemonCircuit");
			const resetFn = bridgeSource.indexOf("resetDaemonCircuit");
			const modeReset = bridgeSource.indexOf('currentMode = "daemon"', resetFn);
			expect(modeReset).toBeGreaterThan(resetFn);
		});
	});

	// ─── Default Case Safety ─────────────────────────────────────────────────

	describe("default case safety", () => {
		it("default case throws, does not return empty object", () => {
			const fnStart = fallbackSource.indexOf("async function directFallback");
			const fnBody = fallbackSource.slice(fnStart);
			const defaultCase = fnBody.indexOf("default:");
			expect(defaultCase).toBeGreaterThan(-1);

			const afterDefault = fnBody.slice(defaultCase, defaultCase + 200);
			expect(afterDefault).toContain("throw new DaemonUnavailableError");
			expect(afterDefault).not.toContain("return {} as T");
		});
	});

	// ─── Bridge imports fallback module ──────────────────────────────────────

	describe("module wiring", () => {
		it("daemon-bridge imports directFallback from fallback module", () => {
			expect(bridgeSource).toContain('import { directFallback } from "./daemon-bridge-fallback.js"');
		});

		it("daemonCall uses directFallback", () => {
			expect(bridgeSource).toContain("directFallback<T>(method, params)");
		});
	});
});
