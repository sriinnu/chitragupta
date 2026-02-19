#!/usr/bin/env node
/**
 * Execute a built CLI entrypoint from dist/.
 * Keeps workspace bin links stable before build output exists.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Run the given built script with current CLI arguments.
 * @param {string} entryRelPath - Path inside dist/ relative to package root.
 * @param {string} buildHint - User-facing build command hint.
 */
export function runBuiltEntry(entryRelPath, buildHint) {
  const binDir = dirname(fileURLToPath(import.meta.url));
  const packageRoot = resolve(binDir, "..");
  const entry = resolve(packageRoot, entryRelPath);
  if (!existsSync(entry)) {
    console.error(`[chitragupta] Missing built entry: ${entry}`);
    console.error(`[chitragupta] Run \`${buildHint}\` first.`);
    process.exit(1);
  }

  const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
    env: process.env,
    stdio: "inherit",
  });
  child.on("exit", (code) => process.exit(code ?? 1));
  child.on("error", (error) => {
    console.error(`[chitragupta] Failed to launch ${entryRelPath}: ${String(error)}`);
    process.exit(1);
  });
}
