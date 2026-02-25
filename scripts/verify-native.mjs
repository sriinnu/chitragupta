#!/usr/bin/env node
/**
 * Postinstall verification for native modules.
 *
 * Tries to load better-sqlite3. If the binary is for the wrong platform
 * (e.g. Windows binary on WSL2/Linux → "invalid ELF header"), it
 * automatically runs `pnpm rebuild better-sqlite3` and verifies again.
 *
 * Wired as "postinstall" in root package.json.
 */

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Try loading better-sqlite3 and running a basic operation. */
function testSqlite() {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.exec('CREATE TABLE _verify(v TEXT)');
    db.prepare('INSERT INTO _verify VALUES (?)').run('ok');
    const row = db.prepare('SELECT v FROM _verify').get();
    db.close();
    return row?.v === 'ok';
  } catch (err) {
    console.error(`  [verify-native] better-sqlite3 load failed: ${err.message}`);
    return false;
  }
}

// ── Main ──────────────────────────────────────────────────────────────

console.log('  [verify-native] Checking better-sqlite3...');

if (testSqlite()) {
  console.log('  [verify-native] better-sqlite3 OK');
  process.exit(0);
}

// Binary mismatch — rebuild
console.log('  [verify-native] Rebuilding better-sqlite3 for current platform...');
try {
  execSync('pnpm rebuild better-sqlite3', {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'inherit',
    timeout: 120_000,
  });
} catch (err) {
  console.error('  [verify-native] Rebuild failed:', err.message);
  console.error('  [verify-native] You may need to install build tools (python3, make, g++).');
  process.exit(1);
}

// Verify again after rebuild
if (testSqlite()) {
  console.log('  [verify-native] better-sqlite3 OK after rebuild');
  process.exit(0);
}

console.error('  [verify-native] better-sqlite3 still broken after rebuild.');
console.error('  [verify-native] Try: rm -rf node_modules && node scripts/env-setup.mjs && pnpm install');
process.exit(1);
