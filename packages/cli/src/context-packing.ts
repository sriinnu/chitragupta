import {
	autoProcessTextThroughPolicy,
	packLiveContextText,
	type PackedLiveContextResult,
} from "@chitragupta/smriti";
import {
	autoProcessContextViaDaemon,
	packContextViaDaemon,
} from "./modes/daemon-bridge-sessions.js";
import { allowLocalRuntimeFallback } from "./runtime-daemon-proxies.js";

const DAEMON_UNAVAILABLE_CODES = new Set(["ECONNREFUSED", "ENOENT", "EACCES"]);

function shouldFallbackToLocalPacking(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException | undefined)?.code;
	if (typeof code === "string" && DAEMON_UNAVAILABLE_CODES.has(code)) return true;
	if (!(error instanceof Error)) return false;
	return /daemon unavailable|connect econnrefused|enoent|eacces|socket hang up|socket closed/i.test(
		error.message.toLowerCase(),
	);
}

export async function packContextWithFallback(
	text: string,
): Promise<PackedLiveContextResult | null> {
	const canFallback = allowLocalRuntimeFallback();
	try {
		const daemonPacked = await packContextViaDaemon(text);
		if (daemonPacked && "runtime" in daemonPacked) return daemonPacked;
		if (daemonPacked && "packed" in daemonPacked && daemonPacked.packed === false) return null;
		if (!canFallback) return null;
	} catch (error) {
		if (!canFallback || !shouldFallbackToLocalPacking(error)) return null;
	}

	try {
		return await packLiveContextText(text);
	} catch {
		return null;
	}
}

function extractPackedPayload(text: string): string {
	if (text.startsWith("[PAKT packed ")) {
		const newline = text.indexOf("\n");
		if (newline >= 0) {
			const payload = text.slice(newline + 1).trim();
			if (payload) return payload;
		}
	}
	return text;
}

function looksPacked(text: string): boolean {
	const payload = extractPackedPayload(text).trim();
	return payload.startsWith("pakt:");
}

export async function autoProcessContextWithFallback(text: string): Promise<Record<string, unknown> | null> {
	const payload = extractPackedPayload(text);
	if (!payload.trim()) return null;
	const canFallback = allowLocalRuntimeFallback();
	try {
		return await autoProcessContextViaDaemon(payload);
	} catch (error) {
		if (!canFallback || !shouldFallbackToLocalPacking(error)) return null;
	}
	try {
		return await autoProcessTextThroughPolicy({ text: payload });
	} catch {
		return null;
	}
}

export async function normalizeContextForReuse(text: string): Promise<string> {
	if (!looksPacked(text)) return text;
	const processed = await autoProcessContextWithFallback(text);
	if (!processed) return text;
	return typeof processed.result === "string" && processed.result.trim()
		? processed.result
		: text;
}
