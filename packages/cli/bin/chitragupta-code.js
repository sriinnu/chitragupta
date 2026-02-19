#!/usr/bin/env node
import { runBuiltEntry } from "./run-built-entry.js";

runBuiltEntry("dist/code-entry.js", "pnpm -C chitragupta/packages/cli build");
