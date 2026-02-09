import { describe, it, expect } from "vitest";
import { parseSSEStream, type SSEEvent } from "../src/sse.js";

/**
 * Helper to create a mock Response with a readable stream from raw SSE text.
 */
function mockResponse(rawText: string): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encoder.encode(rawText));
			controller.close();
		},
	});
	return { body: stream } as unknown as Response;
}

/**
 * Helper to create a mock Response that streams chunks with delays.
 */
function mockChunkedResponse(chunks: string[]): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
			controller.close();
		},
	});
	return { body: stream } as unknown as Response;
}

async function collectEvents(response: Response): Promise<SSEEvent[]> {
	const events: SSEEvent[] = [];
	for await (const event of parseSSEStream(response)) {
		events.push(event);
	}
	return events;
}

describe("parseSSEStream", () => {
	it("should parse a single data event", async () => {
		const response = mockResponse("data: hello world\n\n");
		const events = await collectEvents(response);

		expect(events).toHaveLength(1);
		expect(events[0].data).toBe("hello world");
		expect(events[0].event).toBeUndefined();
	});

	it("should parse events with event type", async () => {
		const response = mockResponse(
			"event: message\ndata: {\"text\": \"hi\"}\n\n",
		);
		const events = await collectEvents(response);

		expect(events).toHaveLength(1);
		expect(events[0].event).toBe("message");
		expect(events[0].data).toBe("{\"text\": \"hi\"}");
	});

	it("should handle multiple events", async () => {
		const response = mockResponse(
			"data: first\n\ndata: second\n\ndata: third\n\n",
		);
		const events = await collectEvents(response);

		expect(events).toHaveLength(3);
		expect(events[0].data).toBe("first");
		expect(events[1].data).toBe("second");
		expect(events[2].data).toBe("third");
	});

	it("should handle multiline data", async () => {
		const response = mockResponse(
			"data: line one\ndata: line two\ndata: line three\n\n",
		);
		const events = await collectEvents(response);

		expect(events).toHaveLength(1);
		expect(events[0].data).toBe("line one\nline two\nline three");
	});

	it("should ignore SSE comments (lines starting with :)", async () => {
		const response = mockResponse(
			": this is a comment\ndata: actual data\n\n",
		);
		const events = await collectEvents(response);

		expect(events).toHaveLength(1);
		expect(events[0].data).toBe("actual data");
	});

	it("should handle empty frames (keep-alive) by skipping them", async () => {
		const response = mockResponse(
			"\n\ndata: real event\n\n\n\n",
		);
		const events = await collectEvents(response);

		expect(events).toHaveLength(1);
		expect(events[0].data).toBe("real event");
	});

	it("should stop on [DONE] sentinel", async () => {
		const response = mockResponse(
			"data: first\n\ndata: second\n\ndata: [DONE]\n\ndata: should not appear\n\n",
		);
		const events = await collectEvents(response);

		expect(events).toHaveLength(2);
		expect(events[0].data).toBe("first");
		expect(events[1].data).toBe("second");
	});

	it("should return no events for a body-less response", async () => {
		const response = { body: null } as unknown as Response;
		const events = await collectEvents(response);
		expect(events).toHaveLength(0);
	});

	it("should handle frames without data lines (only event)", async () => {
		const response = mockResponse(
			"event: ping\n\n",
		);
		const events = await collectEvents(response);

		// Frame has event but no data lines -> should be skipped
		expect(events).toHaveLength(0);
	});

	it("should handle chunked delivery where frames span multiple chunks", async () => {
		// Frame split across two chunks
		const response = mockChunkedResponse([
			"data: hel",
			"lo world\n\ndata: second\n\n",
		]);
		const events = await collectEvents(response);

		expect(events).toHaveLength(2);
		expect(events[0].data).toBe("hello world");
		expect(events[1].data).toBe("second");
	});

	it("should process remaining buffer data after stream ends", async () => {
		// Incomplete frame (no trailing \n\n) should still be processed
		const response = mockResponse("data: final");
		const events = await collectEvents(response);

		expect(events).toHaveLength(1);
		expect(events[0].data).toBe("final");
	});

	it("should handle event type in the remaining buffer", async () => {
		const response = mockResponse("event: complete\ndata: last item");
		const events = await collectEvents(response);

		expect(events).toHaveLength(1);
		expect(events[0].event).toBe("complete");
		expect(events[0].data).toBe("last item");
	});

	it("should handle [DONE] in remaining buffer", async () => {
		const response = mockResponse("data: first\n\ndata: [DONE]");
		const events = await collectEvents(response);

		expect(events).toHaveLength(1);
		expect(events[0].data).toBe("first");
	});

	it("should trim whitespace from event and data values", async () => {
		const response = mockResponse("event:   message  \ndata:   payload  \n\n");
		const events = await collectEvents(response);

		expect(events).toHaveLength(1);
		expect(events[0].event).toBe("message");
		expect(events[0].data).toBe("payload");
	});

	it("should handle JSON data in SSE events", async () => {
		const json = '{"id":"1","model":"gpt-4","choices":[{"delta":{"content":"Hello"}}]}';
		const response = mockResponse(`data: ${json}\n\n`);
		const events = await collectEvents(response);

		expect(events).toHaveLength(1);
		const parsed = JSON.parse(events[0].data);
		expect(parsed.id).toBe("1");
		expect(parsed.model).toBe("gpt-4");
	});
});
