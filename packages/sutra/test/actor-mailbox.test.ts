import { describe, it, expect, beforeEach } from "vitest";
import { ActorMailbox } from "../src/mesh/actor-mailbox.js";
import type { MeshEnvelope, MeshPriority } from "../src/mesh/types.js";

function makeEnvelope(overrides: Partial<MeshEnvelope> = {}): MeshEnvelope {
	return {
		id: overrides.id ?? crypto.randomUUID(),
		from: overrides.from ?? "sender",
		to: overrides.to ?? "receiver",
		type: overrides.type ?? "tell",
		payload: overrides.payload ?? "hello",
		priority: overrides.priority ?? 1,
		timestamp: overrides.timestamp ?? Date.now(),
		ttl: overrides.ttl ?? 30_000,
		hops: overrides.hops ?? ["sender"],
		topic: overrides.topic,
		correlationId: overrides.correlationId,
	};
}

describe("ActorMailbox", () => {
	let mailbox: ActorMailbox;

	beforeEach(() => {
		mailbox = new ActorMailbox(100);
	});

	describe("initial state", () => {
		it("should start empty", () => {
			expect(mailbox.isEmpty).toBe(true);
			expect(mailbox.size).toBe(0);
			expect(mailbox.isFull).toBe(false);
		});

		it("should use default maxSize of 10000 when not specified", () => {
			const defaultMailbox = new ActorMailbox();
			for (let i = 0; i < 10_000; i++) {
				defaultMailbox.push(makeEnvelope({ id: `msg-${i}` }));
			}
			expect(defaultMailbox.isFull).toBe(true);
			expect(defaultMailbox.push(makeEnvelope({ id: "overflow" }))).toBe(false);
		});

		it("should respect custom maxSize", () => {
			const small = new ActorMailbox(3);
			expect(small.push(makeEnvelope())).toBe(true);
			expect(small.push(makeEnvelope())).toBe(true);
			expect(small.push(makeEnvelope())).toBe(true);
			expect(small.isFull).toBe(true);
			expect(small.push(makeEnvelope())).toBe(false);
		});
	});

	describe("push", () => {
		it("should accept an envelope and increase size", () => {
			const result = mailbox.push(makeEnvelope());
			expect(result).toBe(true);
			expect(mailbox.size).toBe(1);
			expect(mailbox.isEmpty).toBe(false);
		});

		it("should accept envelopes across all priority lanes", () => {
			for (const p of [0, 1, 2, 3] as MeshPriority[]) {
				expect(mailbox.push(makeEnvelope({ priority: p }))).toBe(true);
			}
			expect(mailbox.size).toBe(4);
		});

		it("should return false when mailbox is full", () => {
			const tiny = new ActorMailbox(2);
			expect(tiny.push(makeEnvelope())).toBe(true);
			expect(tiny.push(makeEnvelope())).toBe(true);
			expect(tiny.push(makeEnvelope())).toBe(false);
			expect(tiny.size).toBe(2);
		});

		it("should handle rapid sequential pushes", () => {
			for (let i = 0; i < 50; i++) {
				expect(mailbox.push(makeEnvelope({ id: `msg-${i}` }))).toBe(true);
			}
			expect(mailbox.size).toBe(50);
		});
	});

	describe("pop", () => {
		it("should return undefined when empty", () => {
			expect(mailbox.pop()).toBeUndefined();
		});

		it("should dequeue a single message", () => {
			const env = makeEnvelope({ payload: "only-one" });
			mailbox.push(env);
			const popped = mailbox.pop();
			expect(popped).toBeDefined();
			expect(popped!.payload).toBe("only-one");
			expect(mailbox.isEmpty).toBe(true);
		});

		it("should always dequeue the highest priority first", () => {
			mailbox.push(makeEnvelope({ priority: 0, payload: "low" }));
			mailbox.push(makeEnvelope({ priority: 1, payload: "normal" }));
			mailbox.push(makeEnvelope({ priority: 2, payload: "high" }));
			mailbox.push(makeEnvelope({ priority: 3, payload: "critical" }));

			expect(mailbox.pop()!.payload).toBe("critical");
			expect(mailbox.pop()!.payload).toBe("high");
			expect(mailbox.pop()!.payload).toBe("normal");
			expect(mailbox.pop()!.payload).toBe("low");
		});

		it("should maintain FIFO within the same priority lane", () => {
			mailbox.push(makeEnvelope({ priority: 2, payload: "first" }));
			mailbox.push(makeEnvelope({ priority: 2, payload: "second" }));
			mailbox.push(makeEnvelope({ priority: 2, payload: "third" }));

			expect(mailbox.pop()!.payload).toBe("first");
			expect(mailbox.pop()!.payload).toBe("second");
			expect(mailbox.pop()!.payload).toBe("third");
		});

		it("should interleave priorities correctly", () => {
			mailbox.push(makeEnvelope({ priority: 1, payload: "n1" }));
			mailbox.push(makeEnvelope({ priority: 3, payload: "c1" }));
			mailbox.push(makeEnvelope({ priority: 0, payload: "l1" }));
			mailbox.push(makeEnvelope({ priority: 2, payload: "h1" }));
			mailbox.push(makeEnvelope({ priority: 3, payload: "c2" }));

			expect(mailbox.pop()!.payload).toBe("c1");
			expect(mailbox.pop()!.payload).toBe("c2");
			expect(mailbox.pop()!.payload).toBe("h1");
			expect(mailbox.pop()!.payload).toBe("n1");
			expect(mailbox.pop()!.payload).toBe("l1");
		});

		it("should decrement size on pop", () => {
			mailbox.push(makeEnvelope());
			mailbox.push(makeEnvelope());
			expect(mailbox.size).toBe(2);
			mailbox.pop();
			expect(mailbox.size).toBe(1);
			mailbox.pop();
			expect(mailbox.size).toBe(0);
		});
	});

	describe("peek", () => {
		it("should return undefined when empty", () => {
			expect(mailbox.peek()).toBeUndefined();
		});

		it("should return the highest-priority message without removing it", () => {
			mailbox.push(makeEnvelope({ priority: 1, payload: "normal" }));
			mailbox.push(makeEnvelope({ priority: 3, payload: "critical" }));

			const peeked = mailbox.peek();
			expect(peeked!.payload).toBe("critical");
			expect(mailbox.size).toBe(2);
		});

		it("should return same message on consecutive peeks", () => {
			mailbox.push(makeEnvelope({ priority: 2, payload: "high" }));
			expect(mailbox.peek()!.payload).toBe("high");
			expect(mailbox.peek()!.payload).toBe("high");
			expect(mailbox.size).toBe(1);
		});
	});

	describe("drain", () => {
		it("should return empty array when mailbox is empty", () => {
			expect(mailbox.drain()).toEqual([]);
		});

		it("should return all envelopes in priority order (highest lane first)", () => {
			mailbox.push(makeEnvelope({ priority: 0, payload: "low" }));
			mailbox.push(makeEnvelope({ priority: 2, payload: "high" }));
			mailbox.push(makeEnvelope({ priority: 1, payload: "normal" }));

			const drained = mailbox.drain();
			expect(drained).toHaveLength(3);
			expect(drained[0].payload).toBe("high");
			expect(drained[1].payload).toBe("normal");
			expect(drained[2].payload).toBe("low");
		});

		it("should empty the mailbox after drain", () => {
			mailbox.push(makeEnvelope());
			mailbox.push(makeEnvelope());
			mailbox.drain();
			expect(mailbox.isEmpty).toBe(true);
			expect(mailbox.size).toBe(0);
		});

		it("should handle draining when only one lane has messages", () => {
			mailbox.push(makeEnvelope({ priority: 3, payload: "a" }));
			mailbox.push(makeEnvelope({ priority: 3, payload: "b" }));
			const drained = mailbox.drain();
			expect(drained).toHaveLength(2);
			expect(drained[0].payload).toBe("a");
			expect(drained[1].payload).toBe("b");
		});
	});

	describe("edge cases", () => {
		it("should allow push after pop frees space", () => {
			const tiny = new ActorMailbox(1);
			expect(tiny.push(makeEnvelope({ payload: "first" }))).toBe(true);
			expect(tiny.push(makeEnvelope({ payload: "second" }))).toBe(false);
			tiny.pop();
			expect(tiny.push(makeEnvelope({ payload: "third" }))).toBe(true);
			expect(tiny.pop()!.payload).toBe("third");
		});

		it("should allow push after drain frees space", () => {
			const tiny = new ActorMailbox(2);
			tiny.push(makeEnvelope());
			tiny.push(makeEnvelope());
			expect(tiny.isFull).toBe(true);
			tiny.drain();
			expect(tiny.isEmpty).toBe(true);
			expect(tiny.push(makeEnvelope())).toBe(true);
		});

		it("should handle maxSize of 0 (always full)", () => {
			const zero = new ActorMailbox(0);
			expect(zero.isEmpty).toBe(true);
			expect(zero.isFull).toBe(true);
			expect(zero.push(makeEnvelope())).toBe(false);
		});

		it("should handle multiple pops on empty mailbox gracefully", () => {
			expect(mailbox.pop()).toBeUndefined();
			expect(mailbox.pop()).toBeUndefined();
			expect(mailbox.pop()).toBeUndefined();
			expect(mailbox.size).toBe(0);
		});

		it("should handle alternating push/pop cycles", () => {
			for (let i = 0; i < 20; i++) {
				mailbox.push(makeEnvelope({ payload: `msg-${i}` }));
				const popped = mailbox.pop();
				expect(popped!.payload).toBe(`msg-${i}`);
			}
			expect(mailbox.isEmpty).toBe(true);
		});
	});
});
