#!/usr/bin/env node
/**
 * Launch the built darpana CLI if available.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(packageRoot, "dist/bin/darpana.js");

if (!existsSync(entry)) {
  console.error(`[darpana] Missing built entry: ${entry}`);
  console.error("[darpana] Run `pnpm -C chitragupta/packages/darpana build` first.");
  process.exit(1);
}

const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
  env: process.env,
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (error) => {
  console.error(`[darpana] Failed to launch CLI: ${String(error)}`);
  process.exit(1);
});
