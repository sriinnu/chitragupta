import fs from "node:fs";
import net from "node:net";
import { createLogger } from "@chitragupta/core";
import { isWindows } from "./paths.js";

const log = createLogger("daemon:server");

/** Bind server to socket path safely. */
export async function bindServerSocket(server: net.Server, socketPath: string): Promise<void> {
	let staleUnlinked = false;
	for (;;) {
		try {
			await listenOnce(server, socketPath);
			return;
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code !== "EADDRINUSE") throw err;
			const live = await isSocketLive(socketPath);
			if (live) {
				throw new Error(`Socket already in use by a live daemon: ${socketPath}`);
			}
			if (staleUnlinked) {
				throw new Error(`Failed to recover stale socket: ${socketPath}`);
			}
			if (isWindows()) {
				throw new Error(`Named pipe in use but daemon not responding: ${socketPath}`);
			}
			try {
				fs.unlinkSync(socketPath);
				staleUnlinked = true;
				log.warn("Removed stale socket file before retrying bind", { socket: socketPath });
			} catch (unlinkErr) {
				if ((unlinkErr as NodeJS.ErrnoException).code !== "ENOENT") throw unlinkErr;
				staleUnlinked = true;
			}
		}
	}
}

function listenOnce(server: net.Server, socketPath: string): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const onError = (err: unknown) => {
			server.off("listening", onListening);
			reject(err);
		};
		const onListening = () => {
			server.off("error", onError);
			resolve();
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(socketPath);
	});
}

function isSocketLive(socketPath: string): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const probe = net.createConnection(socketPath);
		let settled = false;
		const finish = (live: boolean) => {
			if (settled) return;
			settled = true;
			probe.destroy();
			resolve(live);
		};
		probe.once("connect", () => finish(true));
		probe.once("error", () => finish(false));
		probe.setTimeout(250, () => finish(false));
	});
}
