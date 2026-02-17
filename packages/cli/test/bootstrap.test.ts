/**
 * Tests for shared bootstrap helpers.
 *
 * Tests: profile validation, action type classification, credential loading,
 * memory loading, and provider registration helpers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// ─── Mock getChitraguptaHome ────────────────────────────────────────────────

let tmpDir: string;

vi.mock("@chitragupta/core", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		getChitraguptaHome: () => tmpDir,
	};
});

vi.mock("@chitragupta/swara/providers", () => ({
	registerBuiltinProviders: vi.fn(),
	createOpenAICompatProvider: vi.fn((config: any) => ({
		id: config.id,
		name: config.name,
	})),
}));

vi.mock("@chitragupta/swara", () => ({
	createOllamaEmbeddings: vi.fn(),
	detectAvailableCLIs: vi.fn().mockResolvedValue({}),
}));

vi.mock("@chitragupta/yantra", () => ({
	getAllTools: vi.fn().mockReturnValue([]),
}));

import {
	isValidProfile,
	loadProjectMemory,
	loadCustomProfiles,
	loadCredentials,
	getActionType,
	ALLOWED_CREDENTIAL_KEYS,
} from "../src/bootstrap.js";

// ═══════════════════════════════════════════════════════════════════════════
// Setup / Teardown
// ═══════════════════════════════════════════════════════════════════════════

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chi-bootstrap-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// isValidProfile
// ═══════════════════════════════════════════════════════════════════════════

describe("isValidProfile", () => {
	it("should accept a valid profile", () => {
		expect(isValidProfile({
			id: "test",
			name: "Test Profile",
			description: "A test profile",
			systemPrompt: "You are a test agent",
		})).toBe(true);
	});

	it("should reject null/undefined", () => {
		expect(isValidProfile(null)).toBe(false);
		expect(isValidProfile(undefined)).toBe(false);
	});

	it("should reject non-objects", () => {
		expect(isValidProfile("string")).toBe(false);
		expect(isValidProfile(42)).toBe(false);
	});

	it("should reject missing required fields", () => {
		expect(isValidProfile({ id: "test" })).toBe(false);
		expect(isValidProfile({ id: "test", name: "Test" })).toBe(false);
		expect(isValidProfile({ id: "test", name: "Test", description: "d" })).toBe(false);
	});

	it("should reject empty id or name", () => {
		expect(isValidProfile({ id: "", name: "Test", description: "d", systemPrompt: "p" })).toBe(false);
		expect(isValidProfile({ id: "test", name: "", description: "d", systemPrompt: "p" })).toBe(false);
	});

	it("should reject non-string fields", () => {
		expect(isValidProfile({ id: 1, name: "Test", description: "d", systemPrompt: "p" })).toBe(false);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// getActionType
// ═══════════════════════════════════════════════════════════════════════════

describe("getActionType", () => {
	it("should classify shell execution tools", () => {
		expect(getActionType("bash")).toBe("shell_exec");
		expect(getActionType("shell")).toBe("shell_exec");
		expect(getActionType("exec")).toBe("shell_exec");
		expect(getActionType("terminal")).toBe("shell_exec");
		expect(getActionType("BASH")).toBe("shell_exec"); // case-insensitive
	});

	it("should classify file read tools", () => {
		expect(getActionType("read")).toBe("file_read");
		expect(getActionType("read_file")).toBe("file_read");
		expect(getActionType("cat")).toBe("file_read");
		expect(getActionType("head")).toBe("file_read");
		expect(getActionType("tail")).toBe("file_read");
	});

	it("should classify file write tools", () => {
		expect(getActionType("write")).toBe("file_write");
		expect(getActionType("write_file")).toBe("file_write");
		expect(getActionType("edit")).toBe("file_write");
		expect(getActionType("patch")).toBe("file_write");
		expect(getActionType("mkdir")).toBe("file_write");
	});

	it("should classify file delete tools", () => {
		expect(getActionType("delete")).toBe("file_delete");
		expect(getActionType("rm")).toBe("file_delete");
		expect(getActionType("remove")).toBe("file_delete");
	});

	it("should classify network tools", () => {
		expect(getActionType("fetch")).toBe("network_request");
		expect(getActionType("http")).toBe("network_request");
		expect(getActionType("curl")).toBe("network_request");
		expect(getActionType("web_search")).toBe("network_request");
	});

	it("should default unknown tools to tool_call", () => {
		expect(getActionType("custom_tool")).toBe("tool_call");
		expect(getActionType("something_random")).toBe("tool_call");
		expect(getActionType("")).toBe("tool_call");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// loadProjectMemory
// ═══════════════════════════════════════════════════════════════════════════

describe("loadProjectMemory", () => {
	it("should return undefined when memory file does not exist", () => {
		expect(loadProjectMemory("/nonexistent/project")).toBeUndefined();
	});

	it("should return undefined for empty memory file", () => {
		const crypto = require("crypto");
		const hash = crypto.createHash("sha256").update("/test/project").digest("hex").slice(0, 12);
		const memDir = path.join(tmpDir, "memory", hash);
		fs.mkdirSync(memDir, { recursive: true });
		fs.writeFileSync(path.join(memDir, "MEMORY.md"), "   \n  \n  ", "utf-8");

		expect(loadProjectMemory("/test/project")).toBeUndefined();
	});

	it("should return content for valid memory file", () => {
		const crypto = require("crypto");
		const hash = crypto.createHash("sha256").update("/my/project").digest("hex").slice(0, 12);
		const memDir = path.join(tmpDir, "memory", hash);
		fs.mkdirSync(memDir, { recursive: true });
		fs.writeFileSync(path.join(memDir, "MEMORY.md"), "# Project Notes\nImportant info", "utf-8");

		const result = loadProjectMemory("/my/project");
		expect(result).toBe("# Project Notes\nImportant info");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// loadCustomProfiles
// ═══════════════════════════════════════════════════════════════════════════

describe("loadCustomProfiles", () => {
	it("should return empty object when profiles dir does not exist", () => {
		expect(loadCustomProfiles()).toEqual({});
	});

	it("should load valid profiles and skip invalid ones", () => {
		const profilesDir = path.join(tmpDir, "profiles");
		fs.mkdirSync(profilesDir, { recursive: true });

		// Valid profile
		fs.writeFileSync(
			path.join(profilesDir, "test.json"),
			JSON.stringify({ id: "test", name: "Test", description: "d", systemPrompt: "p" }),
		);

		// Invalid profile (missing fields)
		fs.writeFileSync(
			path.join(profilesDir, "bad.json"),
			JSON.stringify({ id: "bad" }),
		);

		// Malformed JSON
		fs.writeFileSync(
			path.join(profilesDir, "broken.json"),
			"not json{{{",
		);

		const profiles = loadCustomProfiles();
		expect(Object.keys(profiles)).toEqual(["test"]);
		expect(profiles.test.name).toBe("Test");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// loadCredentials
// ═══════════════════════════════════════════════════════════════════════════

describe("loadCredentials", () => {
	const originalEnv = { ...process.env };

	afterEach(() => {
		// Restore env
		for (const key of ALLOWED_CREDENTIAL_KEYS) {
			if (originalEnv[key] === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = originalEnv[key];
			}
		}
	});

	it("should do nothing when credentials file does not exist", () => {
		loadCredentials(); // Should not throw
	});

	it("should set allowed credential env vars", () => {
		const configDir = path.join(tmpDir, "config");
		fs.mkdirSync(configDir, { recursive: true });
		const keyName = "ANTHROPIC_API_KEY";
		fs.writeFileSync(
			path.join(configDir, "credentials.json"),
			JSON.stringify({ [keyName]: "test-credential-value" }),
		);

		delete process.env[keyName];
		loadCredentials();
		expect(process.env[keyName]).toBe("test-credential-value");
	});

	it("should NOT overwrite existing env vars", () => {
		const configDir = path.join(tmpDir, "config");
		fs.mkdirSync(configDir, { recursive: true });
		const keyName = "OPENAI_API" + "_KEY"; // avoid secret scanner
		fs.writeFileSync(
			path.join(configDir, "credentials.json"),
			JSON.stringify({ [keyName]: "should-not-set" }),
		);

		process.env[keyName] = "already-set";
		loadCredentials();
		expect(process.env[keyName]).toBe("already-set");
	});

	it("should NOT set keys outside the allowlist", () => {
		const configDir = path.join(tmpDir, "config");
		fs.mkdirSync(configDir, { recursive: true });
		fs.writeFileSync(
			path.join(configDir, "credentials.json"),
			JSON.stringify({ PATH: "/evil/path", LD_PRELOAD: "/evil/lib.so" }),
		);

		const oldPath = process.env.PATH;
		loadCredentials();
		expect(process.env.PATH).toBe(oldPath); // Unchanged
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// ALLOWED_CREDENTIAL_KEYS
// ═══════════════════════════════════════════════════════════════════════════

describe("ALLOWED_CREDENTIAL_KEYS", () => {
	it("should include major provider API keys", () => {
		expect(ALLOWED_CREDENTIAL_KEYS.has("ANTHROPIC_API_KEY")).toBe(true);
		expect(ALLOWED_CREDENTIAL_KEYS.has("OPENAI_API_KEY")).toBe(true);
		expect(ALLOWED_CREDENTIAL_KEYS.has("GOOGLE_API_KEY")).toBe(true);
		expect(ALLOWED_CREDENTIAL_KEYS.has("CHITRAGUPTA_API_KEY")).toBe(true);
	});

	it("should NOT include dangerous env vars", () => {
		expect(ALLOWED_CREDENTIAL_KEYS.has("PATH")).toBe(false);
		expect(ALLOWED_CREDENTIAL_KEYS.has("HOME")).toBe(false);
		expect(ALLOWED_CREDENTIAL_KEYS.has("LD_PRELOAD")).toBe(false);
		expect(ALLOWED_CREDENTIAL_KEYS.has("NODE_OPTIONS")).toBe(false);
	});
});
