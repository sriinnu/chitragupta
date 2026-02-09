/**
 * Sthiti — Session checkpoint and recovery manager.
 * Sanskrit: Sthiti (स्थिति) = state, position, stability.
 *
 * Periodically checkpoints session state to disk so that sessions
 * can be restored after crashes without losing all progress.
 * Uses atomic writes (write-to-temp-then-rename) to prevent corruption.
 *
 * Checkpoint files are stored as JSON under:
 *   {checkpointDir}/{sessionId}/{timestamp}-{uuid}.json
 *
 * The manager keeps at most `maxCheckpoints` per session and prunes
 * older ones automatically after each save.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CheckpointConfig {
	/** Directory for checkpoint files. Default: .chitragupta/checkpoints */
	checkpointDir?: string;
	/** Auto-checkpoint interval in ms. Default: 30000 (30s) */
	interval?: number;
	/** Maximum checkpoints to keep per session. Default: 5 */
	maxCheckpoints?: number;
}

export interface Checkpoint {
	id: string;
	sessionId: string;
	timestamp: number;
	turnCount: number;
	/** Size in bytes of the checkpoint data on disk. */
	size: number;
}

export interface CheckpointData {
	version: 1;
	sessionId: string;
	turns: unknown[];
	metadata: Record<string, unknown>;
	timestamp: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_CHECKPOINT_DIR = path.join(".chitragupta", "checkpoints");
const DEFAULT_INTERVAL = 30_000;
const DEFAULT_MAX_CHECKPOINTS = 5;
const CHECKPOINT_EXT = ".json";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Parse a checkpoint filename into its constituent parts.
 * Format: `{timestamp}-{uuid}.json`
 */
function parseCheckpointFilename(
	filename: string,
): { timestamp: number; uuid: string } | null {
	if (!filename.endsWith(CHECKPOINT_EXT)) return null;
	const base = filename.slice(0, -CHECKPOINT_EXT.length);
	const dashIdx = base.indexOf("-");
	if (dashIdx === -1) return null;
	const timestamp = Number(base.slice(0, dashIdx));
	const uuid = base.slice(dashIdx + 1);
	if (Number.isNaN(timestamp) || !uuid) return null;
	return { timestamp, uuid };
}

// ─── CheckpointManager ─────────────────────────────────────────────────────

/**
 * Manages checkpoint persistence and recovery for sessions.
 *
 * @example
 * ```ts
 * const mgr = new CheckpointManager({ checkpointDir: "/tmp/cp" });
 * await mgr.save("session-1", {
 *   version: 1,
 *   sessionId: "session-1",
 *   turns: [{ role: "user", content: "hello" }],
 *   metadata: {},
 *   timestamp: Date.now(),
 * });
 * const data = await mgr.load("session-1");
 * ```
 */
export class CheckpointManager {
	private timer: ReturnType<typeof setInterval> | null = null;
	private readonly dir: string;
	private readonly interval: number;
	private readonly maxCheckpoints: number;

	constructor(config?: CheckpointConfig) {
		this.dir = config?.checkpointDir ?? DEFAULT_CHECKPOINT_DIR;
		this.interval = config?.interval ?? DEFAULT_INTERVAL;
		this.maxCheckpoints = config?.maxCheckpoints ?? DEFAULT_MAX_CHECKPOINTS;
	}

	/**
	 * Save a checkpoint atomically (write to temp file, then rename).
	 * Automatically prunes old checkpoints beyond `maxCheckpoints`.
	 */
	async save(sessionId: string, data: CheckpointData): Promise<Checkpoint> {
		const sessionDir = this.sessionDir(sessionId);
		await fs.promises.mkdir(sessionDir, { recursive: true });

		const timestamp = Date.now();
		const uuid = randomUUID().slice(0, 8);
		const filename = `${timestamp}-${uuid}${CHECKPOINT_EXT}`;
		const filePath = path.join(sessionDir, filename);
		const tmpPath = filePath + ".tmp";

		const json = JSON.stringify(data, null, 2);
		const sizeBytes = Buffer.byteLength(json, "utf-8");

		// Atomic write: write to .tmp then rename
		await fs.promises.writeFile(tmpPath, json, "utf-8");
		await fs.promises.rename(tmpPath, filePath);

		// Auto-prune after save
		await this.prune(sessionId);

		return {
			id: `${timestamp}-${uuid}`,
			sessionId,
			timestamp,
			turnCount: data.turns.length,
			size: sizeBytes,
		};
	}

	/**
	 * Load the most recent valid checkpoint for a session.
	 * Returns null if no checkpoints exist or all are corrupted.
	 */
	async load(sessionId: string): Promise<CheckpointData | null> {
		const checkpoints = this.list(sessionId);
		if (checkpoints.length === 0) return null;

		// Sorted descending by timestamp — try newest first
		for (const cp of checkpoints) {
			try {
				const filePath = this.checkpointPath(sessionId, cp);
				const raw = await fs.promises.readFile(filePath, "utf-8");
				const data = JSON.parse(raw) as CheckpointData;

				// Basic validity check
				if (data.version === 1 && data.sessionId === sessionId) {
					return data;
				}
			} catch {
				// Corrupted file — try the next one
				continue;
			}
		}

		return null;
	}

	/**
	 * List all checkpoints for a session, sorted by timestamp descending
	 * (newest first).
	 */
	list(sessionId: string): Checkpoint[] {
		const sessionDir = this.sessionDir(sessionId);
		if (!fs.existsSync(sessionDir)) return [];

		let entries: string[];
		try {
			entries = fs.readdirSync(sessionDir);
		} catch {
			return [];
		}

		const checkpoints: Checkpoint[] = [];

		for (const entry of entries) {
			if (entry.endsWith(".tmp")) continue;
			const parsed = parseCheckpointFilename(entry);
			if (!parsed) continue;

			const filePath = path.join(sessionDir, entry);
			let size = 0;
			let turnCount = 0;
			try {
				const stat = fs.statSync(filePath);
				size = stat.size;
				// Read turn count without fully parsing JSON:
				// lightweight peek at the file header
				const fd = fs.openSync(filePath, "r");
				const buf = Buffer.alloc(Math.min(size, 512));
				fs.readSync(fd, buf, 0, buf.length, 0);
				fs.closeSync(fd);
				const snippet = buf.toString("utf-8");
				const turnMatch = snippet.match(/"turns"\s*:\s*\[/);
				if (turnMatch) {
					// Rough count: parse the whole file (only for small ones)
					if (size < 1_048_576) {
						try {
							const full = fs.readFileSync(filePath, "utf-8");
							const obj = JSON.parse(full) as { turns?: unknown[] };
							turnCount = obj.turns?.length ?? 0;
						} catch {
							// Leave turnCount as 0
						}
					}
				}
			} catch {
				// Stat or read failed — skip this entry
				continue;
			}

			checkpoints.push({
				id: `${parsed.timestamp}-${parsed.uuid}`,
				sessionId,
				timestamp: parsed.timestamp,
				turnCount,
				size,
			});
		}

		// Sort newest first
		checkpoints.sort((a, b) => b.timestamp - a.timestamp);
		return checkpoints;
	}

	/**
	 * Delete old checkpoints beyond `maxCheckpoints` limit.
	 *
	 * @returns The number of checkpoints pruned.
	 */
	async prune(sessionId: string): Promise<number> {
		const all = this.list(sessionId);
		if (all.length <= this.maxCheckpoints) return 0;

		const toRemove = all.slice(this.maxCheckpoints);
		let removed = 0;

		for (const cp of toRemove) {
			try {
				const filePath = this.checkpointPath(sessionId, cp);
				await fs.promises.unlink(filePath);
				removed++;
			} catch {
				// Best-effort deletion
			}
		}

		return removed;
	}

	/**
	 * Start auto-checkpointing on a recurring interval.
	 * The provided `saveFn` is called each interval to obtain the data
	 * to checkpoint.
	 */
	startAutoCheckpoint(sessionId: string, saveFn: () => CheckpointData): void {
		this.stopAutoCheckpoint();
		this.timer = setInterval(() => {
			try {
				const data = saveFn();
				void this.save(sessionId, data);
			} catch {
				// Swallow errors — auto-checkpoint is best-effort
			}
		}, this.interval);

		// Allow the process to exit even if timer is active
		if (this.timer && typeof this.timer === "object" && "unref" in this.timer) {
			this.timer.unref();
		}
	}

	/**
	 * Stop auto-checkpointing.
	 */
	stopAutoCheckpoint(): void {
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	/**
	 * Delete all checkpoints for a session.
	 */
	async deleteAll(sessionId: string): Promise<void> {
		const sessionDir = this.sessionDir(sessionId);
		if (!fs.existsSync(sessionDir)) return;

		try {
			await fs.promises.rm(sessionDir, { recursive: true, force: true });
		} catch {
			// Best-effort deletion
		}
	}

	// ─── Private ──────────────────────────────────────────────────────────────

	private sessionDir(sessionId: string): string {
		return path.join(this.dir, sessionId);
	}

	private checkpointPath(sessionId: string, cp: Checkpoint): string {
		return path.join(this.sessionDir(sessionId), `${cp.id}${CHECKPOINT_EXT}`);
	}
}
