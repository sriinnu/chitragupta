import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isRetryableError,
  parseRetryAfter,
  computeDelay,
  DEFAULT_RETRY_CONFIG,
} from "@chitragupta/swara";
import type { RetryConfig } from "@chitragupta/swara";
import { ProviderError } from "@chitragupta/core";

describe("isRetryableError", () => {
  describe("ProviderError with status codes", () => {
    it("should return true for 429 (rate limit)", () => {
      const err = new ProviderError("Rate limited", "anthropic", 429);
      expect(isRetryableError(err)).toBe(true);
    });

    it("should return true for 500 (internal server error)", () => {
      const err = new ProviderError("Internal server error", "openai", 500);
      expect(isRetryableError(err)).toBe(true);
    });

    it("should return true for 502 (bad gateway)", () => {
      const err = new ProviderError("Bad gateway", "openai", 502);
      expect(isRetryableError(err)).toBe(true);
    });

    it("should return true for 503 (service unavailable)", () => {
      const err = new ProviderError("Service unavailable", "google", 503);
      expect(isRetryableError(err)).toBe(true);
    });

    it("should return true for 529 (overloaded)", () => {
      const err = new ProviderError("Overloaded", "anthropic", 529);
      expect(isRetryableError(err)).toBe(true);
    });

    it("should return false for 401 (auth error)", () => {
      const err = new ProviderError("Unauthorized", "openai", 401);
      expect(isRetryableError(err)).toBe(false);
    });

    it("should return false for 400 (bad request)", () => {
      const err = new ProviderError("Bad request", "openai", 400);
      expect(isRetryableError(err)).toBe(false);
    });

    it("should return false for 404 (not found)", () => {
      const err = new ProviderError("Not found", "openai", 404);
      expect(isRetryableError(err)).toBe(false);
    });
  });

  describe("Error with message-based detection", () => {
    it("should return true for rate limit messages", () => {
      expect(isRetryableError(new Error("Rate limit exceeded"))).toBe(true);
      expect(isRetryableError(new Error("Too many requests"))).toBe(true);
    });

    it("should return true for overloaded messages", () => {
      expect(isRetryableError(new Error("Server is overloaded"))).toBe(true);
    });

    it("should return true for service unavailable messages", () => {
      expect(isRetryableError(new Error("Service unavailable"))).toBe(true);
    });

    it("should return true for bad gateway messages", () => {
      expect(isRetryableError(new Error("Bad gateway"))).toBe(true);
    });

    it("should return true for internal server error messages", () => {
      expect(isRetryableError(new Error("Internal server error"))).toBe(true);
    });

    it("should return true for connection reset errors", () => {
      expect(isRetryableError(new Error("ECONNRESET"))).toBe(true);
    });

    it("should return true for timeout errors", () => {
      expect(isRetryableError(new Error("ETIMEDOUT"))).toBe(true);
    });

    it("should return true for socket hang up errors", () => {
      expect(isRetryableError(new Error("socket hang up"))).toBe(true);
    });

    it("should return false for unknown error messages", () => {
      expect(isRetryableError(new Error("Something weird happened"))).toBe(false);
    });

    it("should return false for non-Error values", () => {
      expect(isRetryableError("string error")).toBe(false);
      expect(isRetryableError(42)).toBe(false);
      expect(isRetryableError(null)).toBe(false);
    });
  });
});

describe("parseRetryAfter", () => {
  it("should return undefined for undefined input", () => {
    expect(parseRetryAfter(undefined)).toBeUndefined();
  });

  it("should return undefined for empty string", () => {
    expect(parseRetryAfter("")).toBeUndefined();
  });

  it("should parse integer seconds to milliseconds", () => {
    expect(parseRetryAfter("5")).toBe(5000);
    expect(parseRetryAfter("30")).toBe(30000);
    expect(parseRetryAfter("1")).toBe(1000);
  });

  it("should parse HTTP-date format", () => {
    const futureDate = new Date(Date.now() + 10000).toUTCString();
    const result = parseRetryAfter(futureDate);
    expect(result).toBeDefined();
    expect(result!).toBeGreaterThan(0);
    expect(result!).toBeLessThanOrEqual(11000);
  });

  it("should return undefined for past HTTP-dates", () => {
    const pastDate = new Date(Date.now() - 60000).toUTCString();
    const result = parseRetryAfter(pastDate);
    expect(result).toBeUndefined();
  });

  it("should return undefined for zero seconds", () => {
    expect(parseRetryAfter("0")).toBeUndefined();
  });

  it("should return undefined for negative seconds", () => {
    expect(parseRetryAfter("-5")).toBeUndefined();
  });
});

describe("computeDelay", () => {
  const config: RetryConfig = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
  };

  beforeEach(() => {
    // Mock Math.random to get deterministic results
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  it("should compute exponential backoff for attempt 0", () => {
    const delay = computeDelay(0, config);
    // 1000 * 2^0 = 1000 + 0 jitter = 1000
    expect(delay).toBe(1000);
  });

  it("should compute exponential backoff for attempt 1", () => {
    const delay = computeDelay(1, config);
    // 1000 * 2^1 = 2000 + 0 jitter = 2000
    expect(delay).toBe(2000);
  });

  it("should compute exponential backoff for attempt 2", () => {
    const delay = computeDelay(2, config);
    // 1000 * 2^2 = 4000 + 0 jitter = 4000
    expect(delay).toBe(4000);
  });

  it("should cap delay at maxDelay", () => {
    const smallMaxConfig: RetryConfig = { ...config, maxDelay: 3000 };
    const delay = computeDelay(5, smallMaxConfig);
    // exponential would be 1000 * 2^5 = 32000, capped at 3000
    expect(delay).toBeLessThanOrEqual(3000);
  });

  it("should add jitter", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const delay = computeDelay(0, config);
    // 1000 + floor(0.5 * 500) = 1000 + 250 = 1250
    expect(delay).toBe(1250);
  });

  it("should use retryAfterMs when it is larger than computed delay", () => {
    const delay = computeDelay(0, config, 10000);
    // retryAfterMs (10000) > computed (1000 + 0 jitter), so use retryAfterMs + jitter
    // min(10000 + 0, 30000) = 10000
    expect(delay).toBe(10000);
  });

  it("should ignore retryAfterMs when it is smaller than computed delay", () => {
    const delay = computeDelay(2, config, 500);
    // computed = 4000, retryAfterMs = 500, 500 < 4000 so use 4000
    expect(delay).toBe(4000);
  });
});

describe("DEFAULT_RETRY_CONFIG", () => {
  it("should have sensible defaults", () => {
    expect(DEFAULT_RETRY_CONFIG.maxRetries).toBe(3);
    expect(DEFAULT_RETRY_CONFIG.baseDelay).toBe(1000);
    expect(DEFAULT_RETRY_CONFIG.maxDelay).toBe(30000);
    expect(DEFAULT_RETRY_CONFIG.backoffMultiplier).toBe(2);
  });
});
