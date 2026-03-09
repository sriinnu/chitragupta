import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	openSessionMock,
	showSessionMock,
	createChitraguptaMock,
} = vi.hoisted(() => ({
	openSessionMock: vi.fn(),
	showSessionMock: vi.fn(),
	createChitraguptaMock: vi.fn(),
}));

vi.mock("@chitragupta/core", () => ({
	loadGlobalSettings: () => ({
		defaultModel: "test-model",
		defaultProvider: "test-provider",
	}),
	ChitraguptaError: class ChitraguptaError extends Error {
		code: string;
		constructor(message: string, code: string) {
			super(message);
			this.code = code;
		}
	},
}));

vi.mock("@chitragupta/anina", () => ({
	SteeringManager: class SteeringManager {
		getNext() {
			return null;
		}
		clear() {}
	},
}));

vi.mock("@chitragupta/ui/ansi", () => ({
	bold: (value: string) => value,
	green: (value: string) => value,
	red: (value: string) => value,
	yellow: (value: string) => value,
	cyan: (value: string) => value,
	dim: (value: string) => value,
	gray: (value: string) => value,
}));

vi.mock("../../src/commands/run-context.js", () => ({
	buildRunContext: () => "context",
	loadMemorySnippets: () => [],
	loadSessionHistory: () => [],
}));

vi.mock("../../src/commands/run-loop.js", () => ({
	streamSingleTurn: vi.fn(async () => ({ cost: 0, text: "assistant output", aborted: false })),
	renderTurnHeader: vi.fn(),
	renderSteeringNotice: vi.fn(),
	shouldContinue: vi.fn(() => false),
	buildNextMessage: vi.fn(() => "next"),
}));

vi.mock("../../src/modes/daemon-bridge.js", () => ({
	openSession: openSessionMock,
	showSession: showSessionMock,
}));

vi.mock("../../src/api.js", () => ({
	createChitragupta: createChitraguptaMock,
}));

import { runRunCommand } from "../../src/commands/run.js";

describe("run command execution", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createChitraguptaMock.mockResolvedValue({
			stream: async function* stream() {
				yield { type: "done", data: null };
			},
			destroy: vi.fn(async () => undefined),
		});
	});

	it("opens a daemon-owned isolated CLI session for new runs", async () => {
		openSessionMock.mockResolvedValue({
			created: true,
			session: {
				meta: {
					id: "session-new",
					title: "fix login bug",
					created: "2026-03-07T10:00:00.000Z",
					updated: "2026-03-07T10:00:00.000Z",
				},
				turns: [],
			},
		});
		showSessionMock.mockResolvedValue({
			meta: {
				id: "session-new",
				title: "fix login bug",
				created: "2026-03-07T10:00:00.000Z",
				updated: "2026-03-07T10:01:00.000Z",
			},
			turns: [{ turnNumber: 1, role: "user", content: "fix login bug" }],
		});

		await runRunCommand("fix", ["login", "bug"]);

		expect(openSessionMock).toHaveBeenCalledWith(expect.objectContaining({
			project: process.cwd(),
			agent: "chitragupta",
			model: "test-model",
			provider: "test-provider",
			consumer: "chitragupta",
			surface: "cli",
			channel: "terminal",
			sessionReusePolicy: "isolated",
			tags: ["run"],
		}));
		expect(createChitraguptaMock).toHaveBeenCalledWith(expect.objectContaining({
			sessionId: "session-new",
			workingDir: process.cwd(),
			model: "test-model",
			provider: "test-provider",
		}));
	});

	it("resumes through the daemon instead of loading local session state directly", async () => {
		showSessionMock
			.mockResolvedValueOnce({
				meta: {
					id: "session-resume",
					title: "existing run",
					created: "2026-03-07T09:00:00.000Z",
					updated: "2026-03-07T09:30:00.000Z",
				},
				turns: [{ turnNumber: 1, role: "user", content: "existing task" }],
			})
			.mockResolvedValueOnce({
				meta: {
					id: "session-resume",
					title: "existing run",
					created: "2026-03-07T09:00:00.000Z",
					updated: "2026-03-07T09:35:00.000Z",
				},
				turns: [{ turnNumber: 1, role: "user", content: "existing task" }],
			});

		await runRunCommand("--resume", ["session-resume"]);

		expect(openSessionMock).not.toHaveBeenCalled();
		expect(showSessionMock).toHaveBeenCalledWith("session-resume", process.cwd());
		expect(createChitraguptaMock).toHaveBeenCalledWith(expect.objectContaining({
			sessionId: "session-resume",
		}));
	});
});
