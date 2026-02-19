/**
 * @chitragupta/anina — Self-Discovery (Atma-Bodha)
 *
 * "Atma-Bodha" (आत्मबोध) — "self-knowledge" in Sanskrit.
 *
 * At daemon startup, scans the runtime environment to discover what
 * capabilities are available: providers, skills, memory state, and
 * system resources. Emits a `capabilities-discovered` event with a
 * full manifest that downstream systems use for adaptive behavior.
 */

import { EventEmitter } from "node:events";
import os from "node:os";

// ─── Types ──────────────────────────────────────────────────────────────────

/** A discovered LLM provider with availability status. */
export interface DiscoveredProvider {
	id: string;
	name: string;
	available: boolean;
}

/** Summary of skill registry contents. */
export interface SkillSummary {
	totalSkills: number;
	categories: string[];
}

/** Summary of memory subsystem state. */
export interface MemorySummary {
	sessionCount: number;
	graphNodeCount: number;
	ruleCount: number;
}

/** System resource snapshot. */
export interface SystemResources {
	totalMemoryMb: number;
	freeMemoryMb: number;
	cpuCount: number;
	platform: string;
	uptimeSeconds: number;
}

/** Full capability manifest produced by self-discovery. */
export interface CapabilityManifest {
	providers: DiscoveredProvider[];
	skills: SkillSummary;
	memory: MemorySummary;
	resources: SystemResources;
	discoveredAt: string;
	durationMs: number;
}

// ─── SelfDiscovery ──────────────────────────────────────────────────────────

/**
 * SelfDiscovery — daemon capability scanner.
 *
 * @example
 * ```ts
 * const discovery = new SelfDiscovery();
 * discovery.on("capabilities-discovered", (manifest) => {
 *   console.log(`Found ${manifest.providers.length} providers`);
 * });
 * await discovery.scan();
 * ```
 */
export class SelfDiscovery extends EventEmitter {
	private lastManifest: CapabilityManifest | null = null;

	/** Get the last scan result, or null if never scanned. */
	getManifest(): CapabilityManifest | null {
		return this.lastManifest;
	}

	/**
	 * Scan the runtime environment and discover available capabilities.
	 * Emits `capabilities-discovered` with the full manifest.
	 */
	async scan(): Promise<CapabilityManifest> {
		const start = performance.now();

		const [providers, skills, memory, resources] = await Promise.all([
			this.discoverProviders(),
			this.discoverSkills(),
			this.discoverMemory(),
			this.discoverResources(),
		]);

		const manifest: CapabilityManifest = {
			providers,
			skills,
			memory,
			resources,
			discoveredAt: new Date().toISOString(),
			durationMs: performance.now() - start,
		};

		this.lastManifest = manifest;
		this.emit("capabilities-discovered", manifest);
		return manifest;
	}

	/** Discover available LLM providers by probing known endpoints. */
	private async discoverProviders(): Promise<DiscoveredProvider[]> {
		const providers: DiscoveredProvider[] = [];

		// Check API key-based providers
		const keyProviders: Array<{ id: string; name: string; envKey: string }> = [
			{ id: "anthropic", name: "Anthropic", envKey: "ANTHROPIC_API_KEY" },
			{ id: "openai", name: "OpenAI", envKey: "OPENAI_API_KEY" },
			{ id: "google", name: "Google AI", envKey: "GOOGLE_API_KEY" },
			{ id: "gemini", name: "Gemini", envKey: "GEMINI_API_KEY" },
		];

		for (const p of keyProviders) {
			providers.push({
				id: p.id,
				name: p.name,
				available: !!process.env[p.envKey],
			});
		}

		// Check Ollama availability
		try {
			const host = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
			const resp = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(2000) });
			providers.push({ id: "ollama", name: "Ollama", available: resp.ok });
		} catch {
			providers.push({ id: "ollama", name: "Ollama", available: false });
		}

		return providers;
	}

	/** Discover skill registry state. */
	private async discoverSkills(): Promise<SkillSummary> {
		try {
			const { SkillRegistry } = await import("@chitragupta/vidhya-skills");
			const reg = new SkillRegistry();
			const all = reg.getAll();
			const categories = [...new Set(all.flatMap((s) => s.tags))];
			return { totalSkills: all.length, categories };
		} catch {
			return { totalSkills: 0, categories: [] };
		}
	}

	/** Discover memory subsystem state from SQLite. */
	private async discoverMemory(): Promise<MemorySummary> {
		try {
			const { DatabaseManager } = await import("@chitragupta/smriti");
			const db = DatabaseManager.instance();
			const agentDb = db.get("agent");

			const sessionRow = agentDb.prepare("SELECT COUNT(*) as cnt FROM sessions").get() as { cnt: number } | undefined;
			const ruleRow = agentDb.prepare("SELECT COUNT(*) as cnt FROM consolidation_rules").get() as { cnt: number } | undefined;

			let graphNodeCount = 0;
			try {
				const graphDb = db.get("graph");
				const nodeRow = graphDb.prepare("SELECT COUNT(*) as cnt FROM nodes").get() as { cnt: number } | undefined;
				graphNodeCount = nodeRow?.cnt ?? 0;
			} catch { /* graph DB may not exist */ }

			return {
				sessionCount: sessionRow?.cnt ?? 0,
				graphNodeCount,
				ruleCount: ruleRow?.cnt ?? 0,
			};
		} catch {
			return { sessionCount: 0, graphNodeCount: 0, ruleCount: 0 };
		}
	}

	/** Discover system resources. */
	private async discoverResources(): Promise<SystemResources> {
		return {
			totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
			freeMemoryMb: Math.round(os.freemem() / 1024 / 1024),
			cpuCount: os.cpus().length,
			platform: os.platform(),
			uptimeSeconds: Math.round(os.uptime()),
		};
	}
}
