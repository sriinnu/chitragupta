#!/usr/bin/env node
/**
 * Prune Chitragupta local data older than a cutoff date.
 *
 * Targets:
 * - agent.db sessions/turns + created_at-backed tables
 * - graph.db nodes/edges/pagerank
 * - vectors.db embeddings
 * - ~/.chitragupta/memory/**/*.md timestamped entries
 * - ~/.chitragupta/sessions/**/*.md dated session files
 * - ~/.chitragupta/days/YYYY-MM-DD.md day files
 *
 * Usage:
 *   node scripts/prune-before-date.mjs --cutoff 2026-03-01 --dry-run
 *   node scripts/prune-before-date.mjs --cutoff 2026-03-01 --apply
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";

const ENTRY_SEPARATOR = "\n---\n\n";

function parseArgs(argv) {
	let cutoffRaw = "2026-03-01";
	let apply = false;
	let dryRun = true;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--cutoff" && argv[i + 1]) {
			cutoffRaw = argv[++i];
			continue;
		}
		if (arg === "--apply") {
			apply = true;
			dryRun = false;
			continue;
		}
		if (arg === "--dry-run") {
			dryRun = true;
			apply = false;
			continue;
		}
		if (arg === "-h" || arg === "--help") {
			printHelp();
			process.exit(0);
		}
	}
	const cutoffIso = normalizeCutoff(cutoffRaw);
	const cutoffMs = Date.parse(cutoffIso);
	if (!Number.isFinite(cutoffMs)) {
		throw new Error(`Invalid cutoff: ${cutoffRaw}`);
	}
	return { cutoffRaw, cutoffIso, cutoffMs, apply, dryRun };
}

function normalizeCutoff(raw) {
	const trimmed = String(raw).trim();
	if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T00:00:00.000Z`;
	const parsed = Date.parse(trimmed);
	if (!Number.isFinite(parsed)) throw new Error(`Invalid cutoff date/time: ${raw}`);
	return new Date(parsed).toISOString();
}

function printHelp() {
	process.stdout.write(
		"Usage: node scripts/prune-before-date.mjs [--cutoff YYYY-MM-DD|ISO] [--dry-run|--apply]\n" +
			"Default cutoff: 2026-03-01\n" +
			"Default mode: --dry-run\n",
	);
}

function getHomeDir() {
	const override = process.env.CHITRAGUPTA_HOME?.trim();
	if (override) return override;
	return path.join(process.env.HOME || process.env.USERPROFILE || "~", ".chitragupta");
}

function walkFiles(rootDir, filterFn, out = []) {
	if (!fs.existsSync(rootDir)) return out;
	for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
		const fullPath = path.join(rootDir, entry.name);
		if (entry.isDirectory()) walkFiles(fullPath, filterFn, out);
		else if (entry.isFile() && filterFn(fullPath)) out.push(fullPath);
	}
	return out;
}

function parseSessionDateFromFilename(filePath) {
	const base = path.basename(filePath);
	const match = base.match(/^session-(\d{4}-\d{2}-\d{2})-/);
	if (!match) return null;
	const ms = Date.parse(`${match[1]}T00:00:00.000Z`);
	return Number.isFinite(ms) ? ms : null;
}

function pruneMemoryFile(content, cutoffMs) {
	const parts = content.split(ENTRY_SEPARATOR);
	if (parts.length <= 1) return { next: content, totalEntries: 0, removedEntries: 0 };

	const header = parts[0];
	let totalEntries = 0;
	let removedEntries = 0;
	const kept = [];

	for (let i = 1; i < parts.length; i++) {
		const entry = parts[i];
		const tsMatch = entry.match(/^\*([^*]+)\*/m);
		if (!tsMatch) {
			kept.push(entry);
			continue;
		}
		const ts = Date.parse(tsMatch[1].trim());
		if (!Number.isFinite(ts)) {
			kept.push(entry);
			continue;
		}
		totalEntries++;
		if (ts < cutoffMs) removedEntries++;
		else kept.push(entry);
	}

	const next =
		kept.length > 0
			? `${header}${ENTRY_SEPARATOR}${kept.join(ENTRY_SEPARATOR)}`
			: header.endsWith("\n")
				? header
				: `${header}\n`;
	return { next, totalEntries, removedEntries };
}

function cleanupEmptyDirs(startDir, stopDir) {
	let dir = startDir;
	while (dir.startsWith(stopDir) && dir.length > stopDir.length) {
		try {
			if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
				fs.rmdirSync(dir);
				dir = path.dirname(dir);
				continue;
			}
		} catch {
			// Best-effort cleanup only.
		}
		break;
	}
}

function tableHasColumn(db, tableName, columnName) {
	try {
		const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
		return cols.some((c) => String(c.name) === columnName);
	} catch {
		return false;
	}
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const home = getHomeDir();

	const report = {
		mode: args.apply ? "apply" : "dry-run",
		cutoff: args.cutoffIso,
		home,
		agent: {},
		graph: {},
		vectors: {},
		files: {
			memory: { files: 0, removedEntries: 0, totalEntries: 0, changedFiles: 0 },
			sessionMarkdown: { scanned: 0, removed: 0 },
			dayFiles: { scanned: 0, removed: 0 },
		},
	};

	// ── agent.db ────────────────────────────────────────────────────────────
	const agentPath = path.join(home, "agent.db");
	if (fs.existsSync(agentPath)) {
		const db = new Database(agentPath);
		db.pragma("busy_timeout = 10000");
		db.pragma("foreign_keys = ON");

		const oldSessions = db
			.prepare("SELECT id, file_path FROM sessions WHERE created_at < ?")
			.all(args.cutoffMs);
		const oldTurns = db.prepare("SELECT COUNT(*) AS c FROM turns WHERE created_at < ?").get(args.cutoffMs).c;
		const allSessions = db.prepare("SELECT COUNT(*) AS c FROM sessions").get().c;
		const allTurns = db.prepare("SELECT COUNT(*) AS c FROM turns").get().c;

		const createdAtTables = db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
			.all()
			.map((r) => String(r.name))
			.filter((name) => !name.startsWith("turns_fts"))
			.filter((name) => name !== "_schema_versions")
			.filter((name) => name !== "sessions")
			.filter((name) => name !== "turns")
			.filter((name) => tableHasColumn(db, name, "created_at"));

		const tableCounts = {};
		for (const tableName of createdAtTables) {
			const c = db
				.prepare(`SELECT COUNT(*) AS c FROM ${tableName} WHERE created_at < ?`)
				.get(args.cutoffMs).c;
			tableCounts[tableName] = Number(c);
		}

		report.agent = {
			sessionsOld: oldSessions.length,
			sessionsAll: Number(allSessions),
			turnsOld: Number(oldTurns),
			turnsAll: Number(allTurns),
			otherTablesOld: tableCounts,
			ftsOrphansRemoved: 0,
		};

		if (args.apply) {
			const tx = db.transaction(() => {
				for (const row of oldSessions) {
					db.prepare("DELETE FROM sessions WHERE id = ?").run(String(row.id));
				}
				db.prepare("DELETE FROM turns WHERE created_at < ?").run(args.cutoffMs);

				for (const tableName of createdAtTables) {
					db.prepare(`DELETE FROM ${tableName} WHERE created_at < ?`).run(args.cutoffMs);
				}

				const ftsRemoved = db
					.prepare("DELETE FROM turns_fts WHERE rowid NOT IN (SELECT id FROM turns)")
					.run().changes;
				report.agent.ftsOrphansRemoved = Number(ftsRemoved);

				db.prepare(
					"UPDATE sessions SET turn_count = (SELECT COUNT(*) FROM turns WHERE turns.session_id = sessions.id)",
				).run();
			});
			tx();
		}

		db.close();

		// Delete session markdown files listed by deleted session rows.
		if (args.apply) {
			for (const row of oldSessions) {
				const rel = String(row.file_path ?? "");
				if (!rel) continue;
				const abs = path.join(home, rel);
				if (!fs.existsSync(abs)) continue;
				try {
					fs.unlinkSync(abs);
					report.files.sessionMarkdown.removed++;
					cleanupEmptyDirs(path.dirname(abs), path.join(home, "sessions"));
				} catch {
					// Best-effort delete.
				}
			}
		}
	}

	// ── graph.db ────────────────────────────────────────────────────────────
	const graphPath = path.join(home, "graph.db");
	if (fs.existsSync(graphPath)) {
		const db = new Database(graphPath);
		db.pragma("busy_timeout = 10000");
		const oldNodes = db.prepare("SELECT COUNT(*) AS c FROM nodes WHERE created_at < ?").get(args.cutoffMs).c;
		const oldEdges = db.prepare("SELECT COUNT(*) AS c FROM edges WHERE recorded_at < ?").get(args.cutoffMs).c;
		report.graph = { nodesOld: Number(oldNodes), edgesOld: Number(oldEdges), orphansRemoved: 0 };

		if (args.apply) {
			const tx = db.transaction(() => {
				db.prepare("DELETE FROM nodes WHERE created_at < ?").run(args.cutoffMs);
				db.prepare("DELETE FROM edges WHERE recorded_at < ?").run(args.cutoffMs);
				const orphanEdges = db
					.prepare("DELETE FROM edges WHERE source NOT IN (SELECT id FROM nodes) OR target NOT IN (SELECT id FROM nodes)")
					.run().changes;
				report.graph.orphansRemoved = Number(orphanEdges);
				db.prepare("DELETE FROM pagerank WHERE node_id NOT IN (SELECT id FROM nodes)").run();
			});
			tx();
		}
		db.close();
	}

	// ── vectors.db ──────────────────────────────────────────────────────────
	const vectorsPath = path.join(home, "vectors.db");
	if (fs.existsSync(vectorsPath)) {
		const db = new Database(vectorsPath);
		db.pragma("busy_timeout = 10000");
		const oldEmbeddings = db
			.prepare("SELECT COUNT(*) AS c FROM embeddings WHERE created_at < ?")
			.get(args.cutoffMs).c;
		report.vectors = { embeddingsOld: Number(oldEmbeddings) };
		if (args.apply) {
			db.prepare("DELETE FROM embeddings WHERE created_at < ?").run(args.cutoffMs);
		}
		db.close();
	}

	// ── memory markdown ─────────────────────────────────────────────────────
	const memoryRoot = path.join(home, "memory");
	const memoryFiles = walkFiles(memoryRoot, (p) => p.endsWith(".md"));
	report.files.memory.files = memoryFiles.length;
	for (const file of memoryFiles) {
		const before = fs.readFileSync(file, "utf-8");
		const pruned = pruneMemoryFile(before, args.cutoffMs);
		report.files.memory.totalEntries += pruned.totalEntries;
		report.files.memory.removedEntries += pruned.removedEntries;
		if (before !== pruned.next) {
			report.files.memory.changedFiles++;
			if (args.apply) fs.writeFileSync(file, pruned.next, "utf-8");
		}
	}

	// ── dated session markdown fallback cleanup ────────────────────────────
	const sessionsRoot = path.join(home, "sessions");
	const sessionMdFiles = walkFiles(sessionsRoot, (p) => p.endsWith(".md"));
	report.files.sessionMarkdown.scanned = sessionMdFiles.length;
	for (const file of sessionMdFiles) {
		const ms = parseSessionDateFromFilename(file);
		if (ms === null || ms >= args.cutoffMs) continue;
		if (args.apply) {
			try {
				fs.unlinkSync(file);
				report.files.sessionMarkdown.removed++;
				cleanupEmptyDirs(path.dirname(file), sessionsRoot);
			} catch {
				// Best-effort.
			}
		}
	}

	// ── day files ───────────────────────────────────────────────────────────
	const daysRoot = path.join(home, "days");
	const dayFiles = walkFiles(daysRoot, (p) => /^\d{4}-\d{2}-\d{2}\.md$/.test(path.basename(p)));
	report.files.dayFiles.scanned = dayFiles.length;
	for (const file of dayFiles) {
		const day = path.basename(file, ".md");
		const ms = Date.parse(`${day}T00:00:00.000Z`);
		if (!Number.isFinite(ms) || ms >= args.cutoffMs) continue;
		if (args.apply) {
			try {
				fs.unlinkSync(file);
				report.files.dayFiles.removed++;
			} catch {
				// Best-effort.
			}
		}
	}

	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

try {
	main();
} catch (err) {
	process.stderr.write(`prune-before-date failed: ${err instanceof Error ? err.message : String(err)}\n`);
	process.exit(1);
}

