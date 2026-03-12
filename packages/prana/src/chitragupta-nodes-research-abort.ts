export function researchCancellationError(
	reason: string | null = "operator-interrupt",
): Error & { cancelled: true } {
	return Object.assign(new Error(reason ?? "operator-interrupt"), { cancelled: true as const });
}

export function closureBudgetExceededError(label: string): Error {
	return new Error(`${label} exceeded the remaining overnight loop budget`);
}

export function throwIfResearchAborted(signal?: AbortSignal | null): void {
	if (!signal?.aborted) return;
	const reason = signal.reason;
	if (reason instanceof Error) throw reason;
	if (typeof reason === "string" && reason.trim()) {
		throw researchCancellationError(reason.trim());
	}
	throw researchCancellationError();
}
