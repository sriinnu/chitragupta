/**
 * Shared SSE (Server-Sent Events) parser utility.
 *
 * Parses a streaming HTTP Response body into discrete SSE events,
 * handling the standard SSE protocol: lines delimited by `\n\n`,
 * with `event:` and `data:` fields.
 */

export interface SSEEvent {
	event?: string;
	data: string;
}

/**
 * Parse a streaming fetch Response as SSE events.
 *
 * Yields each complete SSE frame as an `{ event?, data }` object.
 * Stops when the stream ends or a `[DONE]` sentinel is encountered.
 */
export async function* parseSSEStream(
	response: Response,
): AsyncIterable<SSEEvent> {
	const body = response.body;
	if (!body) {
		return;
	}

	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });

			// SSE frames are separated by double newlines
			const frames = buffer.split("\n\n");
			// The last element is either empty or an incomplete frame
			buffer = frames.pop() ?? "";

			for (const frame of frames) {
				if (!frame.trim()) continue;

				let event: string | undefined;
				const dataLines: string[] = [];

				for (const line of frame.split("\n")) {
					if (line.startsWith("event:")) {
						event = line.slice(6).trim();
					} else if (line.startsWith("data:")) {
						const payload = line.slice(5).trim();
						dataLines.push(payload);
					} else if (line.startsWith(":")) {
						// SSE comment — ignore
					}
				}

				if (dataLines.length === 0) continue;

				const data = dataLines.join("\n");

				// [DONE] sentinel — stop iteration
				if (data === "[DONE]") {
					return;
				}

				yield { event, data };
			}
		}

		// Process any remaining data in buffer
		if (buffer.trim()) {
			let event: string | undefined;
			const dataLines: string[] = [];

			for (const line of buffer.split("\n")) {
				if (line.startsWith("event:")) {
					event = line.slice(6).trim();
				} else if (line.startsWith("data:")) {
					const payload = line.slice(5).trim();
					dataLines.push(payload);
				}
			}

			if (dataLines.length > 0) {
				const data = dataLines.join("\n");
				if (data !== "[DONE]") {
					yield { event, data };
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
}
