import fs from "fs";

const FALLBACK_VERSION = "0.0.0";

function readCliPackageVersion(): string {
	try {
		const raw = fs.readFileSync(new URL("../package.json", import.meta.url), "utf-8");
		const parsed = JSON.parse(raw) as { version?: unknown };
		if (typeof parsed.version === "string" && parsed.version.trim().length > 0) {
			return parsed.version;
		}
	} catch {
		// Keep CLI startup resilient if package.json cannot be read.
	}
	return FALLBACK_VERSION;
}

export const CLI_PACKAGE_VERSION = readCliPackageVersion();
