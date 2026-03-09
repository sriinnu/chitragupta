export interface PendingRequest {
	resolve: (result: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

export type NotificationHandler = (params: Record<string, unknown>, method: string) => void;

export class DaemonUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DaemonUnavailableError";
	}
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
