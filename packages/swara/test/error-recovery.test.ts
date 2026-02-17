import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	CircuitBreaker,
	parseProviderError,
	toChitraguptaError,
	DEFAULT_CIRCUIT_BREAKER_CONFIG,
	type ParsedProviderError,
} from "../src/error-recovery.js";
import { ProviderError } from "@chitragupta/core";

describe("parseProviderError", () => {
	it("should parse a rate limit error by status code", () => {
		const err = new ProviderError("Too Many Requests", "anthropic", 429);
		const parsed = parseProviderError(err, "anthropic");
		expect(parsed.errorType).toBe("rate_limit");
		expect(parsed.retryable).toBe(true);
		expect(parsed.provider).toBe("anthropic");
		expect(parsed.statusCode).toBe(429);
	});

	it("should extract retry-after from the message", () => {
		const err = new ProviderError("rate limited. retry-after: 30", "openai", 429);
		const parsed = parseProviderError(err, "openai");
		expect(parsed.retryAfterMs).toBe(30_000);
	});

	it("should parse auth errors (401, 403)", () => {
		const err401 = new ProviderError("Unauthorized", "openai", 401);
		const parsed401 = parseProviderError(err401, "openai");
		expect(parsed401.errorType).toBe("auth");
		expect(parsed401.retryable).toBe(false);

		const err403 = new ProviderError("Forbidden", "openai", 403);
		const parsed403 = parseProviderError(err403, "openai");
		expect(parsed403.errorType).toBe("auth");
	});

	it("should parse context length errors (400 with context)", () => {
		const err = new ProviderError("context length exceeded, max token limit", "anthropic", 400);
		const parsed = parseProviderError(err, "anthropic");
		expect(parsed.errorType).toBe("context_length");
		expect(parsed.retryable).toBe(false);
	});

	it("should parse content filter errors (400 with filter)", () => {
		const err = new ProviderError("content filter triggered", "openai", 400);
		const parsed = parseProviderError(err, "openai");
		expect(parsed.errorType).toBe("content_filter");
		expect(parsed.retryable).toBe(false);
	});

	it("should parse server errors (500, 502, 503)", () => {
		const err = new ProviderError("internal server error", "google", 500);
		const parsed = parseProviderError(err, "google");
		expect(parsed.errorType).toBe("server_error");
		expect(parsed.retryable).toBe(true);
	});

	it("should parse overloaded errors (529)", () => {
		const err = new ProviderError("overloaded", "anthropic", 529);
		const parsed = parseProviderError(err, "anthropic");
		expect(parsed.errorType).toBe("overloaded");
		expect(parsed.retryable).toBe(true);
	});

	it("should detect network errors from message when no status code", () => {
		const err = new Error("ECONNREFUSED: connection refused");
		const parsed = parseProviderError(err, "ollama");
		expect(parsed.errorType).toBe("network");
		expect(parsed.retryable).toBe(true);
	});

	it("should detect timeout errors from message when no status code", () => {
		const err = new Error("request timed out");
		const parsed = parseProviderError(err, "ollama");
		expect(parsed.errorType).toBe("timeout");
		expect(parsed.retryable).toBe(true);
	});

	it("should detect rate limit from message when no status code", () => {
		const err = new Error("too many requests, slow down");
		const parsed = parseProviderError(err, "openai");
		expect(parsed.errorType).toBe("rate_limit");
		expect(parsed.retryable).toBe(true);
	});

	it("should classify unknown errors as unknown", () => {
		const err = new Error("something completely unexpected");
		const parsed = parseProviderError(err, "unknown");
		expect(parsed.errorType).toBe("unknown");
		expect(parsed.retryable).toBe(false);
	});

	it("should handle non-Error objects", () => {
		const parsed = parseProviderError("string error", "test");
		expect(parsed.rawMessage).toBe("string error");
	});
});

describe("toChitraguptaError", () => {
	it("should convert rate_limit to a ProviderError with retry info", () => {
		const parsed: ParsedProviderError = {
			original: new Error("429"),
			provider: "anthropic",
			statusCode: 429,
			errorType: "rate_limit",
			retryable: true,
			retryAfterMs: 5000,
			rawMessage: "429",
		};
		const err = toChitraguptaError(parsed);
		expect(err.message).toContain("Rate limited");
		expect(err.message).toContain("anthropic");
	});

	it("should convert auth to a ProviderError with API key hint", () => {
		const parsed: ParsedProviderError = {
			original: new Error("401"),
			provider: "openai",
			statusCode: 401,
			errorType: "auth",
			retryable: false,
			rawMessage: "401",
		};
		const err = toChitraguptaError(parsed);
		expect(err.message).toContain("Authentication failed");
		expect(err.message).toContain("API key");
	});

	it("should convert network errors to StreamError", () => {
		const parsed: ParsedProviderError = {
			original: new Error("ECONNREFUSED"),
			provider: "ollama",
			errorType: "network",
			retryable: true,
			rawMessage: "ECONNREFUSED",
		};
		const err = toChitraguptaError(parsed);
		expect(err.message).toContain("Network error");
	});
});

describe("CircuitBreaker", () => {
	let breaker: CircuitBreaker;

	beforeEach(() => {
		breaker = new CircuitBreaker("test-provider", {
			failureThreshold: 3,
			cooldownMs: 1000,
			successThreshold: 2,
		});
	});

	describe("initial state", () => {
		it("should start in closed state", () => {
			expect(breaker.getState()).toBe("closed");
		});

		it("should allow requests in closed state", () => {
			expect(breaker.allowRequest()).toBe(true);
		});

		it("should report the correct provider ID", () => {
			expect(breaker.getProviderId()).toBe("test-provider");
		});
	});

	describe("closed -> open transition", () => {
		it("should open after reaching failure threshold", () => {
			breaker.recordFailure();
			breaker.recordFailure();
			expect(breaker.getState()).toBe("closed");

			breaker.recordFailure(); // Threshold = 3
			expect(breaker.getState()).toBe("open");
		});

		it("should block requests when open", () => {
			breaker.recordFailure();
			breaker.recordFailure();
			breaker.recordFailure();

			expect(breaker.allowRequest()).toBe(false);
		});

		it("should have remaining cooldown when open", () => {
			breaker.recordFailure();
			breaker.recordFailure();
			breaker.recordFailure();

			expect(breaker.getRemainingCooldown()).toBeGreaterThan(0);
		});
	});

	describe("open -> half-open transition", () => {
		it("should transition to half-open after cooldown", () => {
			breaker.recordFailure();
			breaker.recordFailure();
			breaker.recordFailure();
			expect(breaker.getState()).toBe("open");

			// Simulate cooldown elapsing by using a breaker with 0ms cooldown
			const fastBreaker = new CircuitBreaker("fast", {
				failureThreshold: 1,
				cooldownMs: 0,
				successThreshold: 1,
			});
			fastBreaker.recordFailure();
			expect(fastBreaker.getState()).toBe("open");

			// allowRequest should transition to half-open since cooldown = 0ms
			expect(fastBreaker.allowRequest()).toBe(true);
			expect(fastBreaker.getState()).toBe("half-open");
		});
	});

	describe("half-open -> closed transition", () => {
		it("should close after enough successes in half-open", () => {
			const fastBreaker = new CircuitBreaker("fast", {
				failureThreshold: 1,
				cooldownMs: 0,
				successThreshold: 2,
			});
			fastBreaker.recordFailure();
			fastBreaker.allowRequest(); // Transition to half-open

			fastBreaker.recordSuccess();
			expect(fastBreaker.getState()).toBe("half-open");

			fastBreaker.recordSuccess();
			expect(fastBreaker.getState()).toBe("closed");
		});
	});

	describe("half-open -> open transition", () => {
		it("should reopen on any failure in half-open state", () => {
			const fastBreaker = new CircuitBreaker("fast", {
				failureThreshold: 1,
				cooldownMs: 0,
				successThreshold: 2,
			});
			fastBreaker.recordFailure();
			fastBreaker.allowRequest(); // half-open
			expect(fastBreaker.getState()).toBe("half-open");

			fastBreaker.recordFailure();
			expect(fastBreaker.getState()).toBe("open");
		});
	});

	describe("success resets consecutive failures", () => {
		it("should reset consecutive failures on success in closed state", () => {
			breaker.recordFailure();
			breaker.recordFailure();
			breaker.recordSuccess(); // Reset

			// Two more failures should not open (need 3 consecutive)
			breaker.recordFailure();
			breaker.recordFailure();
			expect(breaker.getState()).toBe("closed");
		});
	});

	describe("reset", () => {
		it("should reset to closed state", () => {
			breaker.recordFailure();
			breaker.recordFailure();
			breaker.recordFailure();
			expect(breaker.getState()).toBe("open");

			breaker.reset();
			expect(breaker.getState()).toBe("closed");
			expect(breaker.allowRequest()).toBe(true);
			expect(breaker.getRemainingCooldown()).toBe(0);
		});
	});

	describe("getRemainingCooldown", () => {
		it("should return 0 when not in open state", () => {
			expect(breaker.getRemainingCooldown()).toBe(0);
		});
	});
});
