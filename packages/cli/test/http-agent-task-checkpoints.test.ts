import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChitraguptaAPI } from "../src/http-api.js";
import type { ChitraguptaServer } from "../src/http-server.js";

const mocks = vi.hoisted(() => ({
	listDaemonTaskCheckpoints: vi.fn(),
	getDaemonTaskCheckpoint: vi.fn(),
}));

vi.mock("../src/runtime-daemon-task-checkpoints.js", () => ({
	listDaemonTaskCheckpoints: mocks.listDaemonTaskCheckpoints,
	getDaemonTaskCheckpoint: mocks.getDaemonTaskCheckpoint,
}));

async function request(
	port: number,
	path: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
	const response = await fetch(`http://127.0.0.1:${port}${path}`);
	return {
		status: response.status,
		body: await response.json() as Record<string, unknown>,
	};
}

function makeDeps() {
	return {
		getAgent: () => null,
		getSession: () => null,
		listSessions: () => [],
		getProjectPath: () => "/repo/default",
	};
}

describe("HTTP agent task checkpoint routes", () => {
	let server: ChitraguptaServer;

	beforeEach(() => {
		mocks.listDaemonTaskCheckpoints.mockReset();
		mocks.getDaemonTaskCheckpoint.mockReset();
		server = createChitraguptaAPI(makeDeps(), { port: 0, host: "127.0.0.1" });
	});

	afterEach(async () => {
		if (server?.isRunning) {
			await server.stop();
		}
	});

	it("lists daemon-backed task checkpoints", async () => {
		mocks.listDaemonTaskCheckpoints.mockResolvedValue([
			{ taskKey: "task-1", status: "active", phase: "tool-call", resumeContext: "resume", resumePlan: { action: "resume-tool" } },
		]);

		const port = await server.start();
		const { status, body } = await request(port, "/api/agent/tasks/checkpoints?status=active&limit=10");

		expect(status).toBe(200);
		expect(mocks.listDaemonTaskCheckpoints).toHaveBeenCalledWith({
			projectPath: "/repo/default",
			status: "active",
			taskType: undefined,
			sessionId: undefined,
			limit: 10,
		});
		expect(body.ok).toBe(true);
		expect((body.data as Record<string, unknown>).checkpoints).toHaveLength(1);
	});

	it("loads one checkpoint and returns 404 when missing", async () => {
		mocks.getDaemonTaskCheckpoint.mockResolvedValueOnce({
			checkpoint: null,
			resumeContext: "",
			resumePlan: null,
		});

		const port = await server.start();
		const missing = await request(port, "/api/agent/tasks/checkpoints/task-404");
		expect(missing.status).toBe(404);
		expect(missing.body.ok).toBe(false);

		mocks.getDaemonTaskCheckpoint.mockResolvedValueOnce({
			checkpoint: { taskKey: "task-2", status: "error", phase: "subagent", resumeContext: "continue", resumePlan: { action: "resume-subagent" } },
			resumeContext: "continue",
			resumePlan: { action: "resume-subagent" },
		});

		const found = await request(port, "/api/agent/tasks/checkpoints/task-2?project=%2Frepo%2Fother");
		expect(found.status).toBe(200);
		expect(mocks.getDaemonTaskCheckpoint).toHaveBeenLastCalledWith({
			projectPath: "/repo/other",
			taskKey: "task-2",
		});
		expect(found.body.ok).toBe(true);
	});
});
