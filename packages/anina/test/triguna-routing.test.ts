import { describe, expect, it } from "vitest";
import { deriveTrigunaRoutingInfluence } from "../src/triguna-routing.js";

describe("deriveTrigunaRoutingInfluence", () => {
	it("raises the routing floor when tamas is dominant", () => {
		const influence = deriveTrigunaRoutingInfluence({
			sattva: 0.1,
			rajas: 0.15,
			tamas: 0.75,
		});

		expect(influence).toMatchObject({
			dominant: "tamas",
			costWeightBias: -0.35,
			minimumTier: "sonnet",
			minimumComplexity: "complex",
			avoidSkipLLM: true,
		});
	});

	it("biases toward lighter routing when rajas is dominant", () => {
		const influence = deriveTrigunaRoutingInfluence({
			sattva: 0.1,
			rajas: 0.8,
			tamas: 0.1,
		});

		expect(influence).toMatchObject({
			dominant: "rajas",
			costWeightBias: 0.2,
			maximumTier: "sonnet",
			avoidSkipLLM: false,
		});
	});

	it("stays neutral when no guna is clearly dominant", () => {
		expect(deriveTrigunaRoutingInfluence({
			sattva: 0.34,
			rajas: 0.33,
			tamas: 0.33,
		})).toBeUndefined();
	});
});
