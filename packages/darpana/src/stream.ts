/**
 * SSE stream transformer — converts upstream SSE chunks to Anthropic format on-the-fly.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AnthropicSSEEvent, OpenAIStreamChunk, GeminiResponse, ConverterType } from "./types.js";
import { createStreamState, processOpenAIChunk } from "./converters/openai.js";
import { createGeminiStreamState, processGeminiChunk } from "./converters/google.js";

/**
 * Write an Anthropic SSE event to the client response.
 */
function writeSSE(res: ServerResponse, event: AnthropicSSEEvent): void {
	res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

/**
 * Pipe an upstream SSE stream through a converter and write Anthropic SSE events to the client.
 */
export function pipeStream(
	upstream: IncomingMessage,
	clientRes: ServerResponse,
	converterType: ConverterType,
	requestModel: string,
): void {
	clientRes.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "keep-alive",
		"x-accel-buffering": "no",
	});

	if (converterType === "passthrough") {
		// Zero transformation — pipe raw bytes
		upstream.on("data", (chunk: Buffer) => clientRes.write(chunk));
		upstream.on("end", () => clientRes.end());
		upstream.on("error", () => clientRes.end());
		return;
	}

	if (converterType === "openai-compat") {
		pipeOpenAIStream(upstream, clientRes, requestModel);
	} else if (converterType === "google") {
		pipeGeminiStream(upstream, clientRes, requestModel);
	}
}

function pipeOpenAIStream(upstream: IncomingMessage, clientRes: ServerResponse, requestModel: string): void {
	const state = createStreamState(requestModel);
	let buffer = "";

	upstream.on("data", (chunk: Buffer) => {
		buffer += chunk.toString();
		const lines = buffer.split("\n");
		// Keep last partial line in buffer
		buffer = lines.pop() ?? "";

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith(":")) continue;

			if (trimmed.startsWith("data: ")) {
				const data = trimmed.slice(6);
				if (data === "[DONE]") continue;

				try {
					const parsed = JSON.parse(data) as OpenAIStreamChunk;
					const events = processOpenAIChunk(parsed, state);
					for (const event of events) writeSSE(clientRes, event);
				} catch {
					// Skip malformed chunks
				}
			}
		}
	});

	upstream.on("end", () => {
		// If stream ended without finish_reason, emit closing events
		if (state.started && (state.inTextBlock || state.inToolBlock)) {
			writeSSE(clientRes, { type: "content_block_stop", index: state.contentBlockIndex });
			writeSSE(clientRes, {
				type: "message_delta",
				delta: { stop_reason: "end_turn" },
				usage: { output_tokens: state.usage.output_tokens },
			});
			writeSSE(clientRes, { type: "message_stop" });
		}
		clientRes.end();
	});

	upstream.on("error", () => {
		writeSSE(clientRes, {
			type: "error",
			error: { type: "upstream_error", message: "Connection to upstream provider lost" },
		});
		clientRes.end();
	});
}

function pipeGeminiStream(upstream: IncomingMessage, clientRes: ServerResponse, requestModel: string): void {
	const state = createGeminiStreamState(requestModel);
	let buffer = "";

	upstream.on("data", (chunk: Buffer) => {
		buffer += chunk.toString();
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith(":")) continue;

			if (trimmed.startsWith("data: ")) {
				const data = trimmed.slice(6);
				if (data === "[DONE]") continue;

				try {
					const parsed = JSON.parse(data) as GeminiResponse;
					const events = processGeminiChunk(parsed, state);
					for (const event of events) writeSSE(clientRes, event);
				} catch {
					// Skip malformed chunks
				}
			}
		}
	});

	upstream.on("end", () => {
		if (state.started && (state.inTextBlock || state.inToolBlock)) {
			writeSSE(clientRes, { type: "content_block_stop", index: state.contentBlockIndex });
			writeSSE(clientRes, {
				type: "message_delta",
				delta: { stop_reason: "end_turn" },
				usage: { output_tokens: state.usage.output_tokens },
			});
			writeSSE(clientRes, { type: "message_stop" });
		}
		clientRes.end();
	});

	upstream.on("error", () => {
		writeSSE(clientRes, {
			type: "error",
			error: { type: "upstream_error", message: "Connection to upstream provider lost" },
		});
		clientRes.end();
	});
}
