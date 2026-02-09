/**
 * .env Fortress Tests
 *
 * Verifies that credential files, API keys, and sensitive paths
 * are blocked from agent access across all tools.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

import { bashTool } from "../src/bash.js";
import { grepTool } from "../src/grep.js";
import { findTool } from "../src/find.js";
import { lsTool } from "../src/ls.js";
import { readTool } from "../src/read.js";
import { writeTool } from "../src/write.js";
import { editTool } from "../src/edit.js";
import type { ToolContext } from "../src/types.js";

function makeContext(workingDir?: string): ToolContext {
	return {
		sessionId: "test-fortress",
		workingDirectory: workingDir ?? process.cwd(),
	};
}

describe("Environment Fortress", () => {
	// ─── Bash Tool: Credential Stripping ─────────────────────────────────

	describe("bash tool — env sanitization", () => {
		const originalEnv: Record<string, string | undefined> = {};
		const testKeys = [
			"ANTHROPIC_API_KEY",
			"OPENAI_API_KEY",
			"GOOGLE_API_KEY",
			"XAI_API_KEY",
			"GROQ_API_KEY",
			"DEEPSEEK_API_KEY",
			"CHITRAGUPTA_API_KEY",
			"MY_CUSTOM_SECRET_VALUE",
			"AUTH_TOKEN",
			"DB_PASSWORD_MAIN",
		];

		beforeEach(() => {
			for (const key of testKeys) {
				originalEnv[key] = process.env[key];
				process.env[key] = "LEAKED_" + key;
			}
		});

		afterEach(() => {
			for (const key of testKeys) {
				if (originalEnv[key] !== undefined) {
					process.env[key] = originalEnv[key];
				} else {
					delete process.env[key];
				}
			}
		});

		it("should NOT expose ANTHROPIC_API_KEY to child processes", async () => {
			const result = await bashTool.execute(
				{ command: "echo $ANTHROPIC_API_KEY" },
				makeContext(),
			);
			expect(result.content).not.toContain("LEAKED_ANTHROPIC_API_KEY");
		});

		it("should NOT expose OPENAI_API_KEY to child processes", async () => {
			const result = await bashTool.execute(
				{ command: "echo $OPENAI_API_KEY" },
				makeContext(),
			);
			expect(result.content).not.toContain("LEAKED_OPENAI_API_KEY");
		});

		it("should NOT expose any *_API_KEY variables", async () => {
			const result = await bashTool.execute(
				{ command: "env" },
				makeContext(),
			);
			for (const key of testKeys) {
				if (key.endsWith("_API_KEY")) {
					expect(result.content).not.toContain(`LEAKED_${key}`);
				}
			}
		});

		it("should NOT expose *_SECRET* variables", async () => {
			const result = await bashTool.execute(
				{ command: "echo $MY_CUSTOM_SECRET_VALUE" },
				makeContext(),
			);
			expect(result.content).not.toContain("LEAKED_MY_CUSTOM_SECRET_VALUE");
		});

		it("should NOT expose *_TOKEN variables", async () => {
			const result = await bashTool.execute(
				{ command: "echo $AUTH_TOKEN" },
				makeContext(),
			);
			expect(result.content).not.toContain("LEAKED_AUTH_TOKEN");
		});

		it("should NOT expose *_PASSWORD* variables", async () => {
			const result = await bashTool.execute(
				{ command: "echo $DB_PASSWORD_MAIN" },
				makeContext(),
			);
			expect(result.content).not.toContain("LEAKED_DB_PASSWORD_MAIN");
		});

		it("should still pass PATH to child processes", async () => {
			const result = await bashTool.execute(
				{ command: "echo $PATH" },
				makeContext(),
			);
			expect(result.content).toContain("/");
		});

		it("should still pass HOME to child processes", async () => {
			const result = await bashTool.execute(
				{ command: "echo $HOME" },
				makeContext(),
			);
			expect(result.content.trim()).toContain(os.homedir());
		});
	});

	describe("bash tool — command blocking", () => {
		it("should block commands that reference credentials.json", async () => {
			const result = await bashTool.execute(
				{ command: "cat ~/.chitragupta/config/credentials.json" },
				makeContext(),
			);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("sensitive path denied");
		});

		it("should block commands referencing .chitragupta/config", async () => {
			const result = await bashTool.execute(
				{ command: "ls ~/.chitragupta/config/" },
				makeContext(),
			);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("sensitive path denied");
		});

		it("should block commands referencing .ssh/", async () => {
			const result = await bashTool.execute(
				{ command: "cat ~/.ssh/id_rsa" },
				makeContext(),
			);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("sensitive path denied");
		});

		it("should block commands referencing .gnupg/", async () => {
			const result = await bashTool.execute(
				{ command: "ls ~/.gnupg/" },
				makeContext(),
			);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("sensitive path denied");
		});

		it("should allow normal commands", async () => {
			const result = await bashTool.execute(
				{ command: "echo hello" },
				makeContext(),
			);
			expect(result.isError).toBeFalsy();
			expect(result.content).toContain("hello");
		});
	});

	// ─── Read Tool: .env blocking ────────────────────────────────────────

	describe("read tool — .env blocking", () => {
		it("should block reading .env files", async () => {
			const result = await readTool.execute(
				{ path: ".env" },
				makeContext(),
			);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("sensitive path denied");
		});

		it("should block reading .env.local", async () => {
			const result = await readTool.execute(
				{ path: ".env.local" },
				makeContext(),
			);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("sensitive path denied");
		});

		it("should block reading .ssh keys", async () => {
			const result = await readTool.execute(
				{ path: path.join(os.homedir(), ".ssh/id_rsa") },
				makeContext(),
			);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("sensitive path denied");
		});
	});

	// ─── Write/Edit Tool: .env blocking ──────────────────────────────────

	describe("write tool — .env blocking", () => {
		it("should block writing .env files", async () => {
			const result = await writeTool.execute(
				{ path: ".env", content: "SECRET=bad" },
				makeContext(),
			);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("sensitive path denied");
		});
	});

	describe("edit tool — .env blocking", () => {
		it("should block editing .env files", async () => {
			const result = await editTool.execute(
				{ path: ".env", edits: [{ find: "old", replace: "new" }] },
				makeContext(),
			);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("sensitive path denied");
		});
	});

	// ─── Grep Tool: sensitive path blocking ──────────────────────────────

	describe("grep tool — sensitive path blocking", () => {
		it("should block searching .env files directly", async () => {
			const result = await grepTool.execute(
				{ pattern: "API_KEY", path: ".env" },
				makeContext(),
			);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("sensitive path denied");
		});

		it("should block searching credentials.json", async () => {
			const result = await grepTool.execute(
				{ pattern: "key", path: path.join(os.homedir(), ".chitragupta/config/credentials.json") },
				makeContext(),
			);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("sensitive path denied");
		});

		it("should block searching .ssh directory", async () => {
			const result = await grepTool.execute(
				{ pattern: "BEGIN", path: path.join(os.homedir(), ".ssh/id_rsa") },
				makeContext(),
			);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("sensitive path denied");
		});
	});

	// ─── LS Tool: sensitive directory blocking ───────────────────────────

	describe("ls tool — sensitive directory blocking", () => {
		it("should block listing .ssh directory", async () => {
			const result = await lsTool.execute(
				{ path: path.join(os.homedir(), ".ssh") },
				makeContext(),
			);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("sensitive path denied");
		});

		it("should block listing .gnupg directory", async () => {
			const result = await lsTool.execute(
				{ path: path.join(os.homedir(), ".gnupg") },
				makeContext(),
			);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("sensitive path denied");
		});

		it("should block listing .chitragupta/config", async () => {
			const result = await lsTool.execute(
				{ path: path.join(os.homedir(), ".chitragupta/config") },
				makeContext(),
			);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("sensitive path denied");
		});
	});

	// ─── Find Tool: sensitive file filtering ─────────────────────────────

	describe("find tool — sensitive file filtering", () => {
		let tmpDir: string;

		beforeEach(() => {
			tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-fortress-"));
			// Create test files including sensitive ones
			fs.writeFileSync(path.join(tmpDir, "normal.ts"), "export const x = 1;");
			fs.writeFileSync(path.join(tmpDir, ".env"), "SECRET=bad");
			fs.writeFileSync(path.join(tmpDir, "credentials.json"), '{"key": "bad"}');
			fs.mkdirSync(path.join(tmpDir, ".ssh"), { recursive: true });
			fs.writeFileSync(path.join(tmpDir, ".ssh", "id_rsa"), "private key");
		});

		afterEach(() => {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		});

		it("should find normal files but not .env or credentials.json", async () => {
			const result = await findTool.execute(
				{ patterns: ["*"], path: tmpDir },
				makeContext(tmpDir),
			);
			expect(result.content).toContain("normal.ts");
			expect(result.content).not.toContain("credentials.json");
			// .env is blocked by the SENSITIVE_PATH_FRAGMENTS check
		});

		it("should not traverse .ssh directories", async () => {
			const result = await findTool.execute(
				{ patterns: ["**/*"], path: tmpDir },
				makeContext(tmpDir),
			);
			expect(result.content).not.toContain("id_rsa");
		});
	});
});
