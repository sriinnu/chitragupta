/**
 * @chitragupta/cli — Shared types for serve-mode wiring.
 */

/** Phase modules wired for serve mode. All fields are optional/unknown since each is best-effort. */
export interface ServePhaseModules {
	vasanaEngine: unknown;
	vidhiEngine: unknown;
	servNidraDaemon: unknown;
	servTriguna: unknown;
	servRtaEngine: unknown;
	servBuddhi: unknown;
	servDatabase: unknown;
	servSamiti: unknown;
	servSabhaEngine: unknown;
	servLokapala: unknown;
	servAkasha: unknown;
	servKartavyaEngine: unknown;
	servKalaChakra: unknown;
	servVidyaOrchestrator: unknown;
}

export interface ServeCleanups {
	skillWatcherCleanups: Array<() => void>;
	servKartavyaDispatcher?: { start(): void; stop(): void };
	lokapalaUnsub?: () => void;
}
