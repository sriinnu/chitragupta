import type { RpcRouter } from "./rpc-router.js";
import {
	type CompressionPolicyStatus,
	type CompressionRuntime,
	type CompressionRuntimeStatus,
	type PackedLiveContextResult,
	_setCompressionRuntimeForTests as setSmritiCompressionRuntimeForTests,
	autoProcessTextThroughPolicy,
	compressTextThroughPolicy,
	getCompressionPolicyStatus as getSmritiCompressionPolicyStatus,
	normalizePackedContextText,
	packLiveContextText,
	unpackPackedContextText,
} from "@chitragupta/smriti";

export type {
	CompressionPolicyStatus,
	CompressionRuntime,
	CompressionRuntimeStatus,
	PackedLiveContextResult,
} from "@chitragupta/smriti";

export function _setCompressionRuntimeForTests(runtime: CompressionRuntime | null): void {
	setSmritiCompressionRuntimeForTests(runtime);
}

export async function getCompressionPolicyStatus(): Promise<CompressionPolicyStatus> {
	return getSmritiCompressionPolicyStatus();
}

function isPackedContextText(text: string): boolean {
	const trimmed = text.trim();
	return trimmed.startsWith("pakt:") || trimmed.startsWith("[PAKT packed ");
}

export function registerCompressionMethods(router: RpcRouter): void {
	router.register("compression.status", async () => {
		const policy = await getCompressionPolicyStatus();
		return {
			contractVersion: 1,
			preferredRuntime: policy.preferredRuntime,
			defaultRuntime: policy.defaultRuntime,
			requiredTools: policy.requiredTools,
			provenanceRequired: true,
			runtimes: policy.runtimes,
			...policy.status,
		};
	}, "Inspect the engine-owned compression runtime status");

	router.register("compression.compress", async (params) => {
		const text = typeof params.text === "string" ? params.text : "";
		const format = typeof params.format === "string" ? params.format : undefined;
		if (!text.trim()) throw new Error("Missing text");
		return compressTextThroughPolicy({ text, format });
	}, "Compress text through the engine-owned PAKT runtime");

	router.register("compression.auto", async (params) => {
		const text = typeof params.text === "string" ? params.text : "";
		if (!text.trim()) throw new Error("Missing text");
		return autoProcessTextThroughPolicy({ text });
	}, "Auto-compress or decompress text through the engine-owned PAKT runtime");

	router.register("compression.normalize_context", async (params) => {
		const text = typeof params.text === "string" ? params.text : "";
		if (!text.trim()) throw new Error("Missing text");
		const normalized = await normalizePackedContextText(text);
		return {
			text: normalized,
			result: normalized,
			changed: normalized !== text,
			packed: isPackedContextText(text),
		};
	}, "Normalize packed context payloads through the engine-owned PAKT runtime");

	router.register("compression.unpack_context", async (params) => {
		const text = typeof params.text === "string" ? params.text : "";
		if (!text.trim()) throw new Error("Missing text");
		const unpacked = await unpackPackedContextText(text);
		return {
			text: unpacked,
			result: unpacked,
			unpacked: unpacked !== text,
			packed: isPackedContextText(text),
		};
	}, "Unpack packed context payloads through the engine-owned PAKT runtime");

	router.register("compression.pack_context", async (params): Promise<PackedLiveContextResult | { packed: false }> => {
		const text = typeof params.text === "string" ? params.text : "";
		if (!text.trim()) throw new Error("Missing text");
		const packed = await packLiveContextText(text);
		return packed ?? { packed: false };
	}, "Pack large live-context blocks through the engine-owned PAKT runtime");
}
