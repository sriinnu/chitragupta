export function collaborationUnavailable(feature: string) {
	return { status: 503, body: { error: `${feature} not available` } };
}

export function collaborationFailure(err: unknown) {
	return { status: 500, body: { error: `Failed: ${(err as Error).message}` } };
}

export function normalizeChannelName(name: string): string {
	return name.startsWith("#") ? name : `#${name}`;
}
