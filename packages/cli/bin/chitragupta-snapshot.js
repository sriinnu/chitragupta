#!/usr/bin/env node
import { runBuiltEntry } from "./run-built-entry.js";

runBuiltEntry("dist/bin/chitragupta-snapshot.js", "pnpm -C chitragupta/packages/cli build");
