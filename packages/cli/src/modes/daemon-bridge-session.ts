/**
 * @chitragupta/cli — Session payload normalization helpers for daemon-bridge.
 *
 * Keeps MCP session metadata enrichment isolated from transport/recovery logic
 * in daemon-bridge.ts so the large bridge file can be decomposed safely.
 */

const MCP_CLIENT_KEY_ENV_VARS = [
	"CHITRAGUPTA_CLIENT_KEY",
	"CODEX_THREAD_ID",
	"CLAUDE_CODE_SESSION_ID",
	"CLAUDE_SESSION_ID",
] as const;

function deriveMcpClientKey(env: NodeJS.ProcessEnv): string | undefined {
	for (const key of MCP_CLIENT_KEY_ENV_VARS) {
		const value = env[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	const head = (env.PATH ?? "").split(":")[0] ?? "";
	const match = head.match(/\/tmp\/arg0\/([^/:]+)$/);
	return match?.[1];
}

function cloneMetadata(value: unknown): Record<string, unknown> {
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		return { ...(value as Record<string, unknown>) };
	}
	return {};
}

/**
 * Normalize MCP metadata for session.create payloads.
 *
 * Mirrors the previous inline behavior from daemon-bridge.ts:
 * - fills clientKey/sessionLineageKey/sessionReusePolicy/surface/channel
 * - mirrors metadata fields to top-level payload fields when absent
 * - leaves non-MCP payloads untouched
 */
export function enrichMcpSessionCreateOpts(
	opts: Record<string, unknown>,
	env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
	const next = { ...opts };
	if (next.agent !== "mcp") return next;

	const metadata = cloneMetadata(next.metadata);

	if (typeof metadata.clientKey !== "string" || !metadata.clientKey.trim()) {
		const key = deriveMcpClientKey(env);
		if (key) metadata.clientKey = key;
	}

	if (typeof metadata.sessionLineageKey !== "string" || !metadata.sessionLineageKey.trim()) {
		const key = typeof metadata.clientKey === "string" && metadata.clientKey.trim()
			? metadata.clientKey.trim()
			: deriveMcpClientKey(env);
		if (key) metadata.sessionLineageKey = key;
	}

	if (typeof metadata.sessionReusePolicy !== "string" || !metadata.sessionReusePolicy.trim()) {
		metadata.sessionReusePolicy = typeof metadata.sessionLineageKey === "string" && metadata.sessionLineageKey.trim()
			? "same_day"
			: "isolated";
	}

	if (typeof metadata.surface !== "string" || !metadata.surface.trim()) metadata.surface = "mcp";
	if (typeof metadata.channel !== "string" || !metadata.channel.trim()) metadata.channel = "mcp";

	if (typeof next.clientKey !== "string" && typeof metadata.clientKey === "string") next.clientKey = metadata.clientKey;
	if (typeof next.sessionLineageKey !== "string" && typeof metadata.sessionLineageKey === "string") {
		next.sessionLineageKey = metadata.sessionLineageKey;
	}
	if (typeof next.sessionReusePolicy !== "string" && typeof metadata.sessionReusePolicy === "string") {
		next.sessionReusePolicy = metadata.sessionReusePolicy;
	}
	if (typeof next.surface !== "string" && typeof metadata.surface === "string") next.surface = metadata.surface;
	if (typeof next.channel !== "string" && typeof metadata.channel === "string") next.channel = metadata.channel;

	if (Object.keys(metadata).length > 0) next.metadata = metadata;
	return next;
}
