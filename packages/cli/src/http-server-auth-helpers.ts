import { timingSafeEqual } from "node:crypto";

export function safeCompare(a: string, b: string): boolean {
	const bufA = Buffer.from(a, "utf-8");
	const bufB = Buffer.from(b, "utf-8");
	if (bufA.length !== bufB.length) {
		timingSafeEqual(bufA, bufA);
		return false;
	}
	return timingSafeEqual(bufA, bufB);
}

export function isPairingBootstrapPath(rawPath: string): boolean {
	return rawPath === "/api/pair/challenge"
		|| rawPath === "/api/pair/verify"
		|| rawPath === "/api/pair/refresh";
}
