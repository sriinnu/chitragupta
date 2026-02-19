#!/usr/bin/env node
import { runBuiltEntry } from "./run-built-entry.js";

runBuiltEntry("dist/cli.js", "pnpm -C chitragupta/packages/cli build");
