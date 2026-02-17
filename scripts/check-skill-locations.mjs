#!/usr/bin/env node

// CI guard: Ensure SKILL.md files only exist in approved locations.
//
// Approved locations (relative to repo root):
//   skills-core/*/SKILL.md          — first-party built-in skills
//   skills/_template/SKILL.md       — template (not a real skill)
//
// Skills for ecosystem/ live in a separate repo and are checked there.

import { readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".tmp"]);

function findSkillMds(dir, results = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      findSkillMds(full, results);
    } else if (entry.name === "SKILL.md") {
      results.push(full);
    }
  }
  return results;
}

const files = findSkillMds(repoRoot);
const violations = [];

for (const file of files) {
  const rel = relative(repoRoot, file);

  // Allow: skills-core/*/SKILL.md
  if (/^skills-core\/[^/]+\/SKILL\.md$/.test(rel)) continue;

  // Allow: skills/_template/SKILL.md
  if (rel === "skills/_template/SKILL.md") continue;

  // Allow: test fixtures
  if (/\/(tests?|__tests__|fixtures)\//.test(rel)) continue;

  violations.push(rel);
}

if (violations.length > 0) {
  console.error("❌ SKILL.md files found in unauthorized locations:\n");
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  console.error("\nApproved locations:");
  console.error("  - skills-core/*/SKILL.md");
  console.error("  - skills/_template/SKILL.md");
  console.error("\nMove skills to skills-core/ (first-party) or ecosystem repo (community/lab).");
  process.exit(1);
}

console.log("✅ All SKILL.md files are in approved locations.");
