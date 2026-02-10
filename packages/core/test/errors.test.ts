import { describe, it, expect } from "vitest";
import {
	ChitraguptaError,
	ProviderError,
	AuthError,
	PluginError,
	ConfigError,
	ToolError,
	SessionError,
	MemoryError,
	AbortError,
	StreamError,
} from "../src/errors.js";

// ═══════════════════════════════════════════════════════════════════════════
// CHITRAGUPTA ERROR (Base)
// ═══════════════════════════════════════════════════════════════════════════

describe("ChitraguptaError", () => {
	it("should have name 'ChitraguptaError'", () => {
		const err = new ChitraguptaError("test", "TEST");
		expect(err.name).toBe("ChitraguptaError");
	});

	it("should store the message", () => {
		const err = new ChitraguptaError("something broke", "CODE");
		expect(err.message).toBe("something broke");
	});

	it("should store the code", () => {
		const err = new ChitraguptaError("msg", "MY_CODE");
		expect(err.code).toBe("MY_CODE");
	});

	it("should be an instance of Error", () => {
		const err = new ChitraguptaError("msg", "C");
		expect(err).toBeInstanceOf(Error);
	});

	it("should be an instance of ChitraguptaError", () => {
		const err = new ChitraguptaError("msg", "C");
		expect(err).toBeInstanceOf(ChitraguptaError);
	});

	it("should support cause chaining", () => {
		const cause = new Error("root cause");
		const err = new ChitraguptaError("wrapper", "WRAP", cause);
		expect(err.cause).toBe(cause);
	});

	it("should have undefined cause when not provided", () => {
		const err = new ChitraguptaError("msg", "C");
		expect(err.cause).toBeUndefined();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// PROVIDER ERROR
// ═══════════════════════════════════════════════════════════════════════════

describe("ProviderError", () => {
	it("should have name 'ProviderError'", () => {
		const err = new ProviderError("fail", "anthropic");
		expect(err.name).toBe("ProviderError");
	});

	it("should have code 'PROVIDER_ERROR'", () => {
		const err = new ProviderError("fail", "anthropic");
		expect(err.code).toBe("PROVIDER_ERROR");
	});

	it("should store the provider name", () => {
		const err = new ProviderError("fail", "openai");
		expect(err.provider).toBe("openai");
	});

	it("should store the statusCode", () => {
		const err = new ProviderError("rate limit", "anthropic", 429);
		expect(err.statusCode).toBe(429);
	});

	it("should have undefined statusCode when not provided", () => {
		const err = new ProviderError("fail", "anthropic");
		expect(err.statusCode).toBeUndefined();
	});

	it("should be an instance of ChitraguptaError", () => {
		const err = new ProviderError("fail", "anthropic");
		expect(err).toBeInstanceOf(ChitraguptaError);
	});

	it("should be an instance of Error", () => {
		const err = new ProviderError("fail", "anthropic");
		expect(err).toBeInstanceOf(Error);
	});

	it("should support cause chaining", () => {
		const cause = new Error("network");
		const err = new ProviderError("fail", "anthropic", 500, cause);
		expect(err.cause).toBe(cause);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// AUTH ERROR
// ═══════════════════════════════════════════════════════════════════════════

describe("AuthError", () => {
	it("should have name 'AuthError'", () => {
		const err = new AuthError("invalid key", "openai");
		expect(err.name).toBe("AuthError");
	});

	it("should have code 'AUTH_ERROR'", () => {
		const err = new AuthError("invalid key", "openai");
		expect(err.code).toBe("AUTH_ERROR");
	});

	it("should store the provider name", () => {
		const err = new AuthError("expired", "google");
		expect(err.provider).toBe("google");
	});

	it("should be an instance of ChitraguptaError", () => {
		const err = new AuthError("fail", "anthropic");
		expect(err).toBeInstanceOf(ChitraguptaError);
	});

	it("should be an instance of Error", () => {
		const err = new AuthError("fail", "anthropic");
		expect(err).toBeInstanceOf(Error);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// PLUGIN ERROR
// ═══════════════════════════════════════════════════════════════════════════

describe("PluginError", () => {
	it("should have name 'PluginError'", () => {
		const err = new PluginError("init failed", "my-plugin");
		expect(err.name).toBe("PluginError");
	});

	it("should have code 'PLUGIN_ERROR'", () => {
		const err = new PluginError("init failed", "my-plugin");
		expect(err.code).toBe("PLUGIN_ERROR");
	});

	it("should store the pluginName", () => {
		const err = new PluginError("crash", "fs-tools");
		expect(err.pluginName).toBe("fs-tools");
	});

	it("should be an instance of ChitraguptaError", () => {
		const err = new PluginError("fail", "p");
		expect(err).toBeInstanceOf(ChitraguptaError);
	});

	it("should be an instance of Error", () => {
		const err = new PluginError("fail", "p");
		expect(err).toBeInstanceOf(Error);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG ERROR
// ═══════════════════════════════════════════════════════════════════════════

describe("ConfigError", () => {
	it("should have name 'ConfigError'", () => {
		const err = new ConfigError("invalid JSON");
		expect(err.name).toBe("ConfigError");
	});

	it("should have code 'CONFIG_ERROR'", () => {
		const err = new ConfigError("missing file");
		expect(err.code).toBe("CONFIG_ERROR");
	});

	it("should store the message", () => {
		const err = new ConfigError("bad key");
		expect(err.message).toBe("bad key");
	});

	it("should be an instance of ChitraguptaError", () => {
		const err = new ConfigError("fail");
		expect(err).toBeInstanceOf(ChitraguptaError);
	});

	it("should be an instance of Error", () => {
		const err = new ConfigError("fail");
		expect(err).toBeInstanceOf(Error);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// TOOL ERROR
// ═══════════════════════════════════════════════════════════════════════════

describe("ToolError", () => {
	it("should have name 'ToolError'", () => {
		const err = new ToolError("file not found", "read_file");
		expect(err.name).toBe("ToolError");
	});

	it("should have code 'TOOL_ERROR'", () => {
		const err = new ToolError("fail", "run_cmd");
		expect(err.code).toBe("TOOL_ERROR");
	});

	it("should store the toolName", () => {
		const err = new ToolError("failed", "search");
		expect(err.toolName).toBe("search");
	});

	it("should support cause chaining", () => {
		const cause = new Error("ENOENT");
		const err = new ToolError("fail", "read_file", cause);
		expect(err.cause).toBe(cause);
	});

	it("should be an instance of ChitraguptaError", () => {
		const err = new ToolError("fail", "t");
		expect(err).toBeInstanceOf(ChitraguptaError);
	});

	it("should be an instance of Error", () => {
		const err = new ToolError("fail", "t");
		expect(err).toBeInstanceOf(Error);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// SESSION ERROR
// ═══════════════════════════════════════════════════════════════════════════

describe("SessionError", () => {
	it("should have name 'SessionError'", () => {
		const err = new SessionError("not found");
		expect(err.name).toBe("SessionError");
	});

	it("should have code 'SESSION_ERROR'", () => {
		const err = new SessionError("corrupted");
		expect(err.code).toBe("SESSION_ERROR");
	});

	it("should support cause chaining", () => {
		const cause = new Error("parse error");
		const err = new SessionError("corrupted", cause);
		expect(err.cause).toBe(cause);
	});

	it("should be an instance of ChitraguptaError", () => {
		const err = new SessionError("fail");
		expect(err).toBeInstanceOf(ChitraguptaError);
	});

	it("should be an instance of Error", () => {
		const err = new SessionError("fail");
		expect(err).toBeInstanceOf(Error);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// MEMORY ERROR
// ═══════════════════════════════════════════════════════════════════════════

describe("MemoryError", () => {
	it("should have name 'MemoryError'", () => {
		const err = new MemoryError("write failed");
		expect(err.name).toBe("MemoryError");
	});

	it("should have code 'MEMORY_ERROR'", () => {
		const err = new MemoryError("read failed");
		expect(err.code).toBe("MEMORY_ERROR");
	});

	it("should support cause chaining", () => {
		const cause = new Error("disk full");
		const err = new MemoryError("write failed", cause);
		expect(err.cause).toBe(cause);
	});

	it("should be an instance of ChitraguptaError", () => {
		const err = new MemoryError("fail");
		expect(err).toBeInstanceOf(ChitraguptaError);
	});

	it("should be an instance of Error", () => {
		const err = new MemoryError("fail");
		expect(err).toBeInstanceOf(Error);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// ABORT ERROR
// ═══════════════════════════════════════════════════════════════════════════

describe("AbortError", () => {
	it("should have name 'AbortError'", () => {
		const err = new AbortError();
		expect(err.name).toBe("AbortError");
	});

	it("should have code 'ABORT_ERROR'", () => {
		const err = new AbortError();
		expect(err.code).toBe("ABORT_ERROR");
	});

	it("should default message to 'Operation aborted'", () => {
		const err = new AbortError();
		expect(err.message).toBe("Operation aborted");
	});

	it("should allow custom message", () => {
		const err = new AbortError("user cancelled");
		expect(err.message).toBe("user cancelled");
	});

	it("should be an instance of ChitraguptaError", () => {
		const err = new AbortError();
		expect(err).toBeInstanceOf(ChitraguptaError);
	});

	it("should be an instance of Error", () => {
		const err = new AbortError();
		expect(err).toBeInstanceOf(Error);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// STREAM ERROR
// ═══════════════════════════════════════════════════════════════════════════

describe("StreamError", () => {
	it("should have name 'StreamError'", () => {
		const err = new StreamError("connection dropped");
		expect(err.name).toBe("StreamError");
	});

	it("should have code 'STREAM_ERROR'", () => {
		const err = new StreamError("parse failure");
		expect(err.code).toBe("STREAM_ERROR");
	});

	it("should store the message", () => {
		const err = new StreamError("disconnected");
		expect(err.message).toBe("disconnected");
	});

	it("should be an instance of ChitraguptaError", () => {
		const err = new StreamError("fail");
		expect(err).toBeInstanceOf(ChitraguptaError);
	});

	it("should be an instance of Error", () => {
		const err = new StreamError("fail");
		expect(err).toBeInstanceOf(Error);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// CROSS-CUTTING
// ═══════════════════════════════════════════════════════════════════════════

describe("cross-cutting error properties", () => {
	it("should have unique error codes across all error classes", () => {
		const codes = [
			new ProviderError("", "").code,
			new AuthError("", "").code,
			new PluginError("", "").code,
			new ConfigError("").code,
			new ToolError("", "").code,
			new SessionError("").code,
			new MemoryError("").code,
			new AbortError().code,
			new StreamError("").code,
		];
		const unique = new Set(codes);
		expect(unique.size).toBe(codes.length);
	});

	it("should have unique names across all error classes", () => {
		const names = [
			new ChitraguptaError("", "").name,
			new ProviderError("", "").name,
			new AuthError("", "").name,
			new PluginError("", "").name,
			new ConfigError("").name,
			new ToolError("", "").name,
			new SessionError("").name,
			new MemoryError("").name,
			new AbortError().name,
			new StreamError("").name,
		];
		const unique = new Set(names);
		expect(unique.size).toBe(names.length);
	});

	it("all subclasses should be instanceof ChitraguptaError", () => {
		const errors = [
			new ProviderError("", ""),
			new AuthError("", ""),
			new PluginError("", ""),
			new ConfigError(""),
			new ToolError("", ""),
			new SessionError(""),
			new MemoryError(""),
			new AbortError(),
			new StreamError(""),
		];
		for (const err of errors) {
			expect(err).toBeInstanceOf(ChitraguptaError);
		}
	});

	it("all subclasses should be instanceof Error", () => {
		const errors = [
			new ProviderError("", ""),
			new AuthError("", ""),
			new PluginError("", ""),
			new ConfigError(""),
			new ToolError("", ""),
			new SessionError(""),
			new MemoryError(""),
			new AbortError(),
			new StreamError(""),
		];
		for (const err of errors) {
			expect(err).toBeInstanceOf(Error);
		}
	});
});
