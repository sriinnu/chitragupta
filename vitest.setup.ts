import fs from "node:fs";
import path from "node:path";

// Keep test database writes inside the workspace so tests are hermetic and
// do not depend on host-level ~/.chitragupta permissions.
const testHome = path.resolve(process.cwd(), ".tmp", "chitragupta-test-home");
fs.mkdirSync(testHome, { recursive: true });
process.env.CHITRAGUPTA_HOME = testHome;
