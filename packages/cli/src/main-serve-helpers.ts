/**
 * @chitragupta/cli — Serve-mode helpers: phase module wiring,
 * TLS provisioning, server agent creation, and handler assembly.
 *
 * Extracted from main-serve-mode.ts to keep both files under 450 LOC.
 */

import type { ToolHandler } from "@chitragupta/anina";
import { createLogger } from "@chitragupta/core";
import { getAllTools } from "@chitragupta/yantra";
import path from "path";
import {
	allowLocalRuntimeFallback,
	createDaemonAkashaProxy,
	createDaemonBuddhiProxy,
	createDaemonNidraProxy,
	createDaemonSabhaProxy,
} from "./runtime-daemon-proxies.js";
import { createSabhaProvider } from "./shared-factories.js";
import {
	wireAkashaDurability, leaveAkashaTrace,
} from "./nervous-system-wiring.js";
import type { ServeCleanups, ServePhaseModules } from "./main-serve-types.js";

const log = createLogger("cli:main-serve-helpers");

export type { ServeCleanups, ServePhaseModules } from "./main-serve-types.js";
export {
	createServerAgent,
	type CreateServerAgentParams,
	type ServerAgentRefs,
} from "./main-serve-agent.js";

/** Provision TLS certificates via Kavach if enabled. */
export async function provisionTlsCerts(noTls?: boolean): Promise<import("./tls/tls-types.js").TlsCertificates | undefined> {
	if (noTls) return undefined;
	try {
		const { provisionTls } = await import("./tls/tls-store.js");
		const result = await provisionTls();
		if (result.ok && result.certs) {
			if (result.freshCA) {
				const { installCATrust } = await import("./tls/tls-trust.js");
				const tr = await installCATrust(result.certs.ca);
				log.info(tr.trusted ? "Kavach: CA trusted in system store" : "Kavach: " + tr.message);
			}
			return result.certs;
		}
		log.warn("Kavach: TLS provisioning failed", { reason: result.reason });
	} catch (err) {
		log.warn("Kavach: TLS unavailable", { error: err instanceof Error ? err.message : String(err) });
	}
	return undefined;
}

/** Wire all phase modules for serve mode. */
export async function wireServePhaseModules(
	projectPath: string,
): Promise<{ modules: ServePhaseModules; cleanups: ServeCleanups }> {
	const m: ServePhaseModules = {
		vasanaEngine: undefined,
		vidhiEngine: undefined,
		servNidraDaemon: undefined,
		servTriguna: undefined,
		servRtaEngine: undefined,
		servBuddhi: undefined,
		servDatabase: undefined,
		servSamiti: undefined,
		servSabhaEngine: undefined,
		servLokapala: undefined,
		servAkasha: undefined,
		servKartavyaEngine: undefined,
		servKalaChakra: undefined,
		servVidyaOrchestrator: undefined,
	};
	const c: ServeCleanups = { skillWatcherCleanups: [] };

	// Phase 1: Self-Evolution
	try {
		const { VasanaEngine, VidhiEngine } = await import("@chitragupta/smriti");
		m.vasanaEngine = new VasanaEngine();
		m.vidhiEngine = new VidhiEngine({ project: projectPath });
	} catch (e) {
		log.debug("Self-evolution modules unavailable", { error: String(e) });
	}
	try {
		m.servNidraDaemon = createDaemonNidraProxy();
		const { getNidraStatusViaDaemon } = await import("./modes/daemon-bridge.js");
		await getNidraStatusViaDaemon();
		log.info("Serve mode using daemon-backed Nidra proxy");
	} catch (e) {
		if (!allowLocalRuntimeFallback()) {
			log.warn("Daemon-backed Nidra startup probe failed; keeping deferred daemon proxy", { error: String(e) });
		} else {
			try {
				const { NidraDaemon: N } = await import("@chitragupta/anina");
				m.servNidraDaemon = new N({
					idleTimeoutMs: 300_000,
					dreamDurationMs: 600_000,
					deepSleepDurationMs: 1_800_000,
					project: projectPath,
				});
				(m.servNidraDaemon as { start: () => void }).start();
			} catch (inner) {
				log.debug("NidraDaemon unavailable", { error: String(inner) });
			}
		}
	}

	// Phase 2: Intelligence Layer
	try {
		const { Triguna } = await import("@chitragupta/anina");
		m.servTriguna = new Triguna();
	} catch (e) {
		log.debug("Triguna unavailable", { error: String(e) });
	}
	try {
		const { RtaEngine } = await import("@chitragupta/dharma");
		m.servRtaEngine = new RtaEngine();
	} catch (e) {
		log.debug("RtaEngine unavailable", { error: String(e) });
	}
	try {
		m.servBuddhi = createDaemonBuddhiProxy();
		const { listBuddhiDecisionsViaDaemon } = await import("./modes/daemon-bridge.js");
		await listBuddhiDecisionsViaDaemon({ limit: 1 });
		log.info("Serve mode using daemon-backed Buddhi proxy");
	} catch (e) {
		if (!allowLocalRuntimeFallback()) {
			log.warn("Daemon-backed Buddhi startup probe failed; keeping deferred daemon proxy", { error: String(e) });
		} else {
			try {
				const { Buddhi } = await import("@chitragupta/anina");
				m.servBuddhi = new Buddhi();
			} catch (inner) {
				log.debug("Buddhi unavailable", { error: String(inner) });
			}
		}
	}
	try {
		const { DatabaseManager } = await import("@chitragupta/smriti");
		m.servDatabase = DatabaseManager.instance();
	} catch (e) {
		log.debug("DatabaseManager unavailable", { error: String(e) });
	}

	// Phase 3: Collaboration
	try {
		const { Samiti } = await import("@chitragupta/sutra");
		m.servSamiti = new Samiti();
		m.servSabhaEngine = createDaemonSabhaProxy();
	} catch (e) {
		log.debug("Collaboration modules unavailable", { error: String(e) });
	}
	try {
		const { LokapalaController } = await import("@chitragupta/anina");
		m.servLokapala = new LokapalaController();
	} catch (e) {
		log.debug("LokapalaController unavailable", { error: String(e) });
	}
	try {
		m.servAkasha = createDaemonAkashaProxy();
		await (m.servAkasha as { stats: () => Promise<unknown> }).stats();
		log.info("Serve mode using daemon-backed Akasha proxy");
	} catch (e) {
		if (!allowLocalRuntimeFallback()) {
			log.warn("Daemon-backed Akasha startup probe failed; keeping deferred daemon proxy", { error: String(e) });
			if (!m.servAkasha) {
				m.servAkasha = createDaemonAkashaProxy();
			}
		} else {
			try {
				const { getAkasha } = await import("./modes/mcp-subsystems.js");
				m.servAkasha = await getAkasha();
				if (await wireAkashaDurability(m.servAkasha)) {
					log.info("Akasha durability wired for serve mode");
				} else {
					log.info("Serve mode using daemon-backed/shared Akasha");
				}
			} catch (inner) {
				log.debug("AkashaField unavailable", { error: String(inner) });
			}
		}
	}

		// Wire Lokapala findings → Akasha deposit (warning/critical only)
		if (m.servLokapala && m.servAkasha) {
			try {
				type LF = { domain: string; severity: string; title: string; description: string; location?: string; confidence: number };
				const lok = m.servLokapala as { onFinding(h: (f: LF) => void): () => void };
				c.lokapalaUnsub = lok.onFinding((f) => {
					if (f.severity === "info") return;
					leaveAkashaTrace(m.servAkasha, {
						agentId: "lokapala",
						type: "warning",
						topic: f.domain,
						content: `[${f.severity}] ${f.title}: ${f.description}${f.location ? ` (${f.location})` : ""}`,
						metadata: {
							title: f.title,
							severity: f.severity,
							location: f.location,
							confidence: f.confidence,
						},
					});
				});
				log.info("Lokapala → Akasha trace wired");
			} catch { /* best-effort */ }
		}

	// Phase 4: Autonomy
	const toolHandlers = new Map<string, ToolHandler>(getAllTools().map((t) => [t.definition.name, t]));
	const toolExecutor = async (toolName: string, toolArgs: Record<string, unknown>) => {
		const handler = toolHandlers.get(toolName);
		if (!handler) return { success: false, error: `Unknown tool: ${toolName}` };
		try {
			const result = await handler.execute(toolArgs ?? {}, {
				sessionId: "kartavya-dispatcher",
				workingDirectory: projectPath,
			});
			return result.isError
				? { success: false, error: result.content || `Tool "${toolName}" returned error` }
				: { success: true, output: result.content ?? "ok" };
		} catch (err) {
			return { success: false, error: err instanceof Error ? err.message : String(err) };
		}
	};
	try {
		const { KartavyaEngine } = await import("@chitragupta/niyanta");
		// Wire 8: Sabha risk gate — KartavyaEngine routes high-confidence
		// niyama proposals through Sabha LLM deliberation before approval.
		const sabhaProvider = await createSabhaProvider();
		m.servKartavyaEngine = new KartavyaEngine(
			sabhaProvider ? { sabhaProvider } as Partial<ConstructorParameters<typeof KartavyaEngine>[0]> : undefined,
		);
		if (sabhaProvider) log.info("Wire 8: Sabha risk gate active for KartavyaEngine");
		try {
			const { KartavyaDispatcher } = await import("@chitragupta/niyanta");
			const d = new KartavyaDispatcher(
				m.servKartavyaEngine as InstanceType<typeof KartavyaEngine>,
				m.servSamiti as unknown as ConstructorParameters<typeof KartavyaDispatcher>[1],
				m.servRtaEngine as unknown as ConstructorParameters<typeof KartavyaDispatcher>[2],
				{
					enableCommandActions: false,
					workingDirectory: projectPath,
					project: projectPath,
					toolExecutor,
					vidhiEngine: m.vidhiEngine as import("@chitragupta/niyanta").DispatcherVidhiEngine | undefined,
				},
			);
			d.start();
			c.servKartavyaDispatcher = d;
		} catch {
			/* best-effort */
		}
	} catch (e) {
		log.debug("KartavyaEngine unavailable", { error: String(e) });
	}
	try {
		const { KalaChakra } = await import("@chitragupta/smriti");
		m.servKalaChakra = new KalaChakra();
	} catch (e) {
		log.debug("KalaChakra unavailable", { error: String(e) });
	}

	// Vidya Orchestrator
	try {
		const {
			SkillRegistry,
			VidyaBridge,
			SurakshaScanner,
			SkillPipeline,
			SkillSandbox,
			PratikshaManager,
			ShikshaController,
			VidyaOrchestrator,
		} = await import("@chitragupta/vidhya-skills");
		const reg = new SkillRegistry();
		const bridge = new VidyaBridge(reg);
		bridge.registerToolsAsSkills(
			getAllTools().map((t) => ({
				name: (t as unknown as Record<string, Record<string, string>>).definition?.name,
				description: (t as unknown as Record<string, Record<string, string>>).definition?.description,
				inputSchema: ((t as unknown as Record<string, Record<string, unknown>>).definition?.inputSchema ??
					{}) as Record<string, unknown>,
			})),
		);
		try {
			const { loadSkillTiers } = await import("./shared-factories.js");
			const r = await loadSkillTiers({ projectPath, skillRegistry: reg });
			c.skillWatcherCleanups.push(...r.watcherCleanups);
		} catch (e) {
			log.debug("Agent skill loading failed", { error: String(e) });
		}
		let scanner: InstanceType<typeof SurakshaScanner> | undefined;
		let shiksha: InstanceType<typeof ShikshaController> | undefined;
		try {
			scanner = new SurakshaScanner();
			const sandbox = new SkillSandbox();
			const staging = new PratikshaManager();
			const pipeline = new SkillPipeline({ scanner, sandbox, staging, registry: reg });
			shiksha = new ShikshaController({ registry: reg, pipeline, scanner });
		} catch (e) {
			log.warn("Suraksha/Shiksha pipeline unavailable; autonomous learning disabled", { error: String(e) });
		}
		const stateDir = path.join(projectPath, ".chitragupta");
		m.servVidyaOrchestrator = new VidyaOrchestrator(
			{
				registry: reg,
				bridge,
				scanner: scanner as ConstructorParameters<typeof VidyaOrchestrator>[0]["scanner"],
				shiksha: shiksha as ConstructorParameters<typeof VidyaOrchestrator>[0]["shiksha"],
			},
			{
				persistPath: `${stateDir}/vidya-state.json`,
				enableAutoLearn: Boolean(shiksha),
				enableAutoComposition: true,
			},
		);
		await (m.servVidyaOrchestrator as { initialize: () => Promise<void> }).initialize();
	} catch (e) {
		log.debug("VidyaOrchestrator unavailable", { error: String(e) });
	}

	return { modules: m, cleanups: c };
}
