import { packLiveContextText, type PackedLiveContextResult } from "@chitragupta/smriti";
import { packContextViaDaemon } from "./modes/daemon-bridge-sessions.js";
import { allowLocalRuntimeFallback } from "./runtime-daemon-proxies.js";

export async function packContextWithFallback(
	text: string,
): Promise<PackedLiveContextResult | null> {
	const canFallback = allowLocalRuntimeFallback();
	try {
		const daemonPacked = await packContextViaDaemon(text);
		if (daemonPacked && "runtime" in daemonPacked) return daemonPacked;
		if (daemonPacked && "packed" in daemonPacked && daemonPacked.packed === false) return null;
		if (!canFallback) return null;
	} catch {
		if (!canFallback) return null;
	}

	try {
		return await packLiveContextText(text);
	} catch {
		return null;
	}
}
