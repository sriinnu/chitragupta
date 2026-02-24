/**
 * Tests for the Hub signal modules (auth, budget computed values).
 *
 * Validates token management, auth header generation, computed
 * budget formatters, and device ID persistence behaviour.
 * @module test/signals
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetStorage } from "./setup.js";

// ── Tests: Auth signals ─────────────────────────────────────────

describe("signals/auth", () => {
	beforeEach(() => {
		resetStorage();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("setToken stores and exposes the JWT", async () => {
		const { token, setToken, clearToken } = await import("../src/signals/auth.js");

		setToken("my-jwt-token");
		expect(token.value).toBe("my-jwt-token");
		expect(localStorage.getItem("chitragupta_hub_token")).toBe("my-jwt-token");

		// Clean up
		clearToken();
	});

	it("clearToken removes the JWT from signal and storage", async () => {
		const { token, setToken, clearToken } = await import("../src/signals/auth.js");

		setToken("some-token");
		expect(token.value).toBe("some-token");

		clearToken();
		expect(token.value).toBeNull();
		expect(localStorage.getItem("chitragupta_hub_token")).toBeNull();
	});

	it("isAuthenticated is true when token is set", async () => {
		const { isAuthenticated, setToken, clearToken } = await import("../src/signals/auth.js");

		setToken("jwt-abc");
		expect(isAuthenticated.value).toBe(true);

		clearToken();
		expect(isAuthenticated.value).toBe(false);
	});

	it("getAuthHeaders returns Bearer header when authenticated", async () => {
		const { getAuthHeaders, setToken, clearToken } = await import("../src/signals/auth.js");

		setToken("bearer-token-xyz");
		const headers = getAuthHeaders();
		expect(headers).toEqual({ Authorization: "Bearer bearer-token-xyz" });

		// When cleared, should return empty object
		clearToken();
		const emptyHeaders = getAuthHeaders();
		expect(emptyHeaders).toEqual({});
	});

	it("deviceId is generated and persisted", async () => {
		const { deviceId } = await import("../src/signals/auth.js");

		// Should have a non-empty device ID
		expect(deviceId.value).toBeTruthy();
		expect(typeof deviceId.value).toBe("string");
		expect(deviceId.value.length).toBeGreaterThan(0);
	});
});

// ── Tests: Budget computed signals ──────────────────────────────

describe("signals/budget computed values", () => {
	beforeEach(() => {
		resetStorage();
	});

	it("dailyCostFormatted defaults to $0.0000", async () => {
		const { dailyCostFormatted, budgetStatus } = await import("../src/signals/budget.js");

		// Before any data is loaded, should show zero
		budgetStatus.value = null;
		expect(dailyCostFormatted.value).toBe("$0.0000");
	});

	it("dailyCostFormatted reflects budget status", async () => {
		const { dailyCostFormatted, budgetStatus } = await import("../src/signals/budget.js");

		budgetStatus.value = {
			sessionCost: 0.005,
			dailyCost: 0.1234,
			sessionLimit: 1.0,
			dailyLimit: 5.0,
			sessionWarning: false,
			sessionExceeded: false,
			dailyWarning: false,
			dailyExceeded: false,
			canProceed: { allowed: true },
		};

		expect(dailyCostFormatted.value).toBe("$0.1234");

		// Clean up
		budgetStatus.value = null;
	});

	it("sessionCostFormatted reflects budget status", async () => {
		const { sessionCostFormatted, budgetStatus } = await import("../src/signals/budget.js");

		budgetStatus.value = {
			sessionCost: 0.0567,
			dailyCost: 0.1,
			sessionLimit: 1.0,
			dailyLimit: 5.0,
			sessionWarning: false,
			sessionExceeded: false,
			dailyWarning: false,
			dailyExceeded: false,
			canProceed: { allowed: true },
		};

		expect(sessionCostFormatted.value).toBe("$0.0567");

		// Clean up
		budgetStatus.value = null;
	});

	it("sessionWarning reflects budget status flag", async () => {
		const { sessionWarning, budgetStatus } = await import("../src/signals/budget.js");

		budgetStatus.value = null;
		expect(sessionWarning.value).toBe(false);

		budgetStatus.value = {
			sessionCost: 0.9,
			dailyCost: 0.1,
			sessionLimit: 1.0,
			dailyLimit: 5.0,
			sessionWarning: true,
			sessionExceeded: false,
			dailyWarning: false,
			dailyExceeded: false,
			canProceed: { allowed: true },
		};

		expect(sessionWarning.value).toBe(true);

		// Clean up
		budgetStatus.value = null;
	});
});
