import fs from "fs";
import { renameSync as nodeRenameSync } from "node:fs";
import path from "path";
import { SessionError } from "@chitragupta/core";
import type { SessionOpts, SessionTurn } from "./types.js";
import { stripAnsi } from "./provider-labels.js";
import { hashProject, getProjectSessionDir } from "./session-db.js";

export function atomicRename(tmpPath: string, targetPath: string): void {
	try {
		nodeRenameSync(tmpPath, targetPath);
	} catch (err: unknown) {
		if (!process.env.VITEST) {
			process.stderr.write(`[smriti:session-store] atomic rename failed, using direct write: ${err instanceof Error ? err.message : String(err)}\n`);
		}
		fs.writeFileSync(targetPath, fs.readFileSync(tmpPath, "utf-8"), "utf-8");
		try { fs.unlinkSync(tmpPath); } catch { /* intentional: orphan tmp cleanup is best-effort */ }
	}
}

export function localDateString(now: Date = new Date()): string {
	const yyyy = now.getFullYear().toString();
	const mm = (now.getMonth() + 1).toString().padStart(2, "0");
	const dd = now.getDate().toString().padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

export function readMetadataString(
	metadata: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = metadata?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function resolveMcpClientKey(opts: SessionOpts): string | undefined {
	if ((opts.agent ?? "chitragupta") !== "mcp") return undefined;
	if (typeof opts.clientKey === "string" && opts.clientKey.trim()) return opts.clientKey.trim();
	const fromMetadata = opts.metadata?.clientKey;
	if (typeof fromMetadata === "string" && fromMetadata.trim()) return fromMetadata.trim();
	for (const key of [
		"CHITRAGUPTA_CLIENT_KEY",
		"CODEX_THREAD_ID",
		"CLAUDE_CODE_SESSION_ID",
		"CLAUDE_SESSION_ID",
	]) {
		const value = process.env[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

export function resolveSessionLineageKey(
	opts: SessionOpts,
	clientKey?: string,
): string | undefined {
	return (typeof opts.sessionLineageKey === "string" && opts.sessionLineageKey.trim())
		? opts.sessionLineageKey.trim()
		: readMetadataString(opts.metadata, "sessionLineageKey")
			?? readMetadataString(opts.metadata, "clientKey")
			?? clientKey;
}

export function resolveSessionReusePolicy(
	opts: SessionOpts,
	lineageKey?: string,
): "isolated" | "same_day" {
	if (opts.sessionReusePolicy === "same_day") return lineageKey ? "same_day" : "isolated";
	if (opts.sessionReusePolicy === "isolated") return "isolated";
	const raw = readMetadataString(opts.metadata, "sessionReusePolicy")?.toLowerCase();
	if (raw === "same_day" || raw === "same-day" || raw === "same_day_lineage") {
		return lineageKey ? "same_day" : "isolated";
	}
	if (raw === "isolated" || raw === "always_new") return "isolated";
	return (opts.agent ?? "chitragupta") === "mcp" && lineageKey ? "same_day" : "isolated";
}

export function generateSessionId(project: string): { id: string; filePath: string } {
	const now = new Date();
	const yyyy = now.getFullYear().toString();
	const mm = (now.getMonth() + 1).toString().padStart(2, "0");
	const dateStr = localDateString(now);
	const projHash = hashProject(project).slice(0, 8);
	const baseId = `session-${dateStr}-${projHash}`;

	const projectDir = getProjectSessionDir(project);
	const yearMonthDir = path.join(projectDir, yyyy, mm);
	fs.mkdirSync(yearMonthDir, { recursive: true });

	const basePath = path.join(yearMonthDir, `${baseId}.md`);
	if (!fs.existsSync(basePath)) {
		return {
			id: baseId,
			filePath: path.join("sessions", hashProject(project), yyyy, mm, `${baseId}.md`),
		};
	}

	let counter = 2;
	while (fs.existsSync(path.join(yearMonthDir, `${baseId}-${counter}.md`))) counter++;
	const id = `${baseId}-${counter}`;
	return {
		id,
		filePath: path.join("sessions", hashProject(project), yyyy, mm, `${id}.md`),
	};
}

export function resolveSessionPath(id: string, project: string): string {
	const projectDir = getProjectSessionDir(project);
	const dateMatch = id.match(/^session-(\d{4})-(\d{2})-\d{2}/);
	if (dateMatch) {
		const newPath = path.join(projectDir, dateMatch[1], dateMatch[2], `${id}.md`);
		if (fs.existsSync(newPath)) return newPath;
	}

	const oldPath = path.join(projectDir, `${id}.md`);
	if (fs.existsSync(oldPath)) return oldPath;
	return dateMatch
		? path.join(projectDir, dateMatch[1], dateMatch[2], `${id}.md`)
		: oldPath;
}

export function patchFrontmatterUpdated(content: string, updatedIso: string): string {
	const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (!fmMatch) return content;

	const frontmatter = fmMatch[1];
	if (!/^updated:\s/m.test(frontmatter)) return content;

	const patchedFrontmatter = frontmatter.replace(
		/^updated:\s.*$/m,
		`updated: ${updatedIso}`,
	);
	if (patchedFrontmatter === frontmatter) return content;
	return `---\n${patchedFrontmatter}\n---${content.slice(fmMatch[0].length)}`;
}

export function sanitizeTurnForPersistence(turn: SessionTurn): SessionTurn {
	const cleanedContent = stripAnsi(turn.content)
		.replace(/\r\n/g, "\n")
		.replace(/\u0000/g, "")
		.replace(/[ \t]+$/gm, "")
		.trim();
	if (!cleanedContent) throw new SessionError("Turn content is empty after normalization.");

	const cleanedToolCalls = turn.toolCalls?.map((tc) => ({
		...tc,
		input: stripAnsi(tc.input).replace(/\u0000/g, "").trim(),
		result: stripAnsi(tc.result).replace(/\u0000/g, "").trim(),
	}));

	return {
		...turn,
		content: cleanedContent,
		toolCalls: cleanedToolCalls,
	};
}
