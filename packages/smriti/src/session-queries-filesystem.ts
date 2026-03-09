import fs from "fs";
import path from "path";
import type { SessionMeta } from "./types.js";
import { parseSessionMarkdown } from "./markdown-parser.js";
import { getProjectSessionDir, getSessionsRoot } from "./session-db.js";

/** Legacy filesystem scan fallback used when SQLite is unavailable or empty. */
export function listSessionsFromFilesystem(project?: string): SessionMeta[] {
	const sessionsRoot = getSessionsRoot();
	if (!fs.existsSync(sessionsRoot)) return [];

	const results: SessionMeta[] = [];
	if (project) {
		const projectDir = getProjectSessionDir(project);
		if (!fs.existsSync(projectDir)) return [];
		results.push(...scanDirRecursive(projectDir));
	} else {
		const projectDirs = fs.readdirSync(sessionsRoot, { withFileTypes: true });
		for (const entry of projectDirs) {
			if (entry.isDirectory()) {
				results.push(...scanDirRecursive(path.join(sessionsRoot, entry.name)));
			}
		}
	}

	results.sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
	return results;
}

function scanDirRecursive(dir: string): SessionMeta[] {
	const metas: SessionMeta[] = [];
	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				metas.push(...scanDirRecursive(fullPath));
			} else if (entry.name.endsWith(".md")) {
				try {
					const content = fs.readFileSync(fullPath, "utf-8");
					const session = parseSessionMarkdown(content);
					metas.push(session.meta);
				} catch (err: unknown) {
					process.stderr.write(
						`[smriti:session-queries] skip unparseable file ${fullPath}: ${err instanceof Error ? err.message : String(err)}\n`,
					);
				}
			}
		}
	} catch (err: unknown) {
		process.stderr.write(
			`[smriti:session-queries] directory scan failed for ${dir}: ${err instanceof Error ? err.message : String(err)}\n`,
		);
	}
	return metas;
}
