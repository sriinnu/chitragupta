import { MemoryBridge, type MemoryBridgeConfig, type MemoryBridgePersistence } from "@chitragupta/anina";
import {
	appendMemory as appendMemoryLocal,
	type MemoryScope,
	type Session,
	type SessionOpts,
	type SessionTurn,
} from "@chitragupta/smriti";
import {
	addTurn as addTurnLocal,
	createSession as createSessionLocal,
	loadSession as loadSessionLocal,
} from "@chitragupta/smriti/session-store";

import {
	addTurn as addTurnViaDaemon,
	appendMemoryViaDaemon,
	openSession as openSessionViaDaemon,
	showSession as showSessionViaDaemon,
} from "./modes/daemon-bridge.js";
import { allowLocalRuntimeFallback } from "./runtime-daemon-proxies.js";

function buildDaemonBackedPersistence(): MemoryBridgePersistence {
	return {
		async createSession(opts: SessionOpts): Promise<Session> {
			try {
				const opened = await openSessionViaDaemon(opts as unknown as Record<string, unknown>);
				return opened.session as unknown as Session;
			} catch (error) {
				if (!allowLocalRuntimeFallback()) throw error;
				return createSessionLocal(opts);
			}
		},

		async addTurn(sessionId: string, project: string, turn: SessionTurn): Promise<void> {
			try {
				await addTurnViaDaemon(sessionId, project, turn as unknown as Record<string, unknown>);
			} catch (error) {
				if (!allowLocalRuntimeFallback()) throw error;
				await addTurnLocal(sessionId, project, turn);
			}
		},

		async loadSession(sessionId: string, project: string): Promise<Session> {
			try {
				return await showSessionViaDaemon(sessionId, project) as unknown as Session;
			} catch (error) {
				if (!allowLocalRuntimeFallback()) throw error;
				return loadSessionLocal(sessionId, project);
			}
		},

		async appendMemory(scope: MemoryScope, entry: string): Promise<void> {
			try {
				switch (scope.type) {
					case "global":
						return appendMemoryViaDaemon("global", entry);
					case "project":
						return appendMemoryViaDaemon("project", entry, scope.path);
					case "agent":
						return appendMemoryViaDaemon("agent", entry, scope.agentId);
					case "session":
						throw new Error("Session-scoped memory is stored in the session ledger, not memory files.");
				}
			} catch (error) {
				if (!allowLocalRuntimeFallback()) throw error;
				await appendMemoryLocal(scope, entry);
			}
		},
	};
}

export function createDaemonBackedMemoryBridge(
	config: Omit<MemoryBridgeConfig, "persistence">,
): MemoryBridge {
	return new MemoryBridge({
		...config,
		persistence: buildDaemonBackedPersistence(),
	});
}
