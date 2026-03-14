import type { AgentProfile } from "@chitragupta/core";
import type { MemoryBridge } from "./memory-bridge.js";

type DebugLogger = {
	debug(message: string, fields?: Record<string, unknown>): void;
};

export function buildDefaultSystemPrompt(profile: AgentProfile): string {
	const parts: string[] = [`You are ${profile.name}.`];
	if (profile.personality) parts.push(profile.personality);
	if (profile.expertise.length > 0) parts.push(`Your areas of expertise: ${profile.expertise.join(", ")}.`);
	if (profile.voice === "custom" && profile.customVoice) parts.push(profile.customVoice);
	return parts.join("\n\n");
}

export async function loadMemoryPromptContext(args: {
	memoryBridge: MemoryBridge | null;
	project: string;
	agentId: string;
	cachedMemoryPromptContext: string | null;
	logger: DebugLogger;
	setCachedMemoryPromptContext: (value: string | null) => void;
}): Promise<string> {
	if (!args.memoryBridge) return "";

	try {
		const memCtx = await args.memoryBridge.loadMemoryContext(args.project, args.agentId);
		args.setCachedMemoryPromptContext(memCtx);
		return memCtx;
	} catch (error) {
		args.logger.debug("memory context refresh failed", { error: String(error) });
		return args.cachedMemoryPromptContext ?? "";
	}
}

export async function loadSoulPrompt(): Promise<string> {
	try {
		const { SoulManager } = await import("./agent-soul.js");
		const mgr = new SoulManager({ persist: true });
		const souls = mgr.getAll();
		if (!souls[0]) return "";
		return mgr.buildSoulPrompt(souls[0].id) ?? "";
	} catch {
		return "";
	}
}

export async function buildDynamicSystemPrompt(args: {
	baseSystemPrompt: string;
	taskCheckpointResumeContext?: string;
	memoryBridge: MemoryBridge | null;
	project: string;
	agentId: string;
	cachedMemoryPromptContext: string | null;
	logger: DebugLogger;
	setCachedMemoryPromptContext: (value: string | null) => void;
}): Promise<string> {
	const parts: string[] = [args.baseSystemPrompt];
	if (typeof args.taskCheckpointResumeContext === "string" && args.taskCheckpointResumeContext.trim()) {
		parts.push(args.taskCheckpointResumeContext.trim());
	}
	const memCtx = await loadMemoryPromptContext({
		memoryBridge: args.memoryBridge,
		project: args.project,
		agentId: args.agentId,
		cachedMemoryPromptContext: args.cachedMemoryPromptContext,
		logger: args.logger,
		setCachedMemoryPromptContext: args.setCachedMemoryPromptContext,
	});
	if (memCtx) parts.push(memCtx);
	const soulPrompt = await loadSoulPrompt();
	if (soulPrompt) parts.push(soulPrompt);
	return parts.join("\n\n");
}
