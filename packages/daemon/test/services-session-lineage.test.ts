import { describe, expect, it, vi } from "vitest";
import { RpcRouter } from "../src/rpc-router.js";
import { registerSessionMethods } from "../src/services.js";

describe("session service lineage controls", () => {
	it("merges explicit lineage controls into session metadata", async () => {
		const createSession = vi.fn(() => ({
			meta: { id: "session-2026-03-07-abcd" },
			turns: [],
		}));
		const store = {
			listSessionProjects: () => [{ project: "/tmp/project" }],
			createSession,
		};
		const router = new RpcRouter();
		registerSessionMethods(router, store as never, {} as never);

		await router.handle("session.create", {
			project: "/tmp/project",
			agent: "vaayu",
			sessionLineageKey: "vaayu:web:tab-1",
			sessionReusePolicy: "same_day",
			consumer: "vaayu",
			surface: "api",
			channel: "web",
			actorId: "vaayu:tab:1",
		});

		expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
			project: "/tmp/project",
			metadata: expect.objectContaining({
				sessionLineageKey: "vaayu:web:tab-1",
				sessionReusePolicy: "same_day",
				consumer: "vaayu",
				surface: "api",
				channel: "web",
				actorId: "vaayu:tab:1",
			}),
		}));
	});
});
