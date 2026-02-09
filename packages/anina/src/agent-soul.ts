/**
 * Atman — The agent's persistent identity and self-model.
 *
 * Each agent carries an AgentSoul: an archetype-driven personality
 * with a confidence model that evolves through experience. The soul
 * influences temperature, prompt construction, and task routing.
 *
 * Sanskrit: Atman (आत्मन्) = the true self, the eternal essence.
 */

// ─── Archetype Types ────────────────────────────────────────────────────────

export interface AgentArchetype {
	id: string;
	name: string;
	traits: string[];
	strengths: string[];
	weaknesses: string[];
	/** Temperature bias: meticulous agents skew lower, creative agents higher */
	temperatureBias: number;
}

export const ARCHETYPES: Record<string, AgentArchetype> = {
	"meticulous-craftsman": {
		id: "meticulous-craftsman",
		name: "Meticulous Craftsman",
		traits: ["precise", "thorough", "detail-oriented", "methodical"],
		strengths: ["code quality", "testing", "documentation", "debugging"],
		weaknesses: ["speed", "creative solutions", "risk-taking"],
		temperatureBias: -0.15,
	},
	"curious-scholar": {
		id: "curious-scholar",
		name: "Curious Scholar",
		traits: ["inquisitive", "analytical", "patient", "systematic"],
		strengths: ["research", "analysis", "learning", "explanation"],
		weaknesses: ["decisive action", "shortcuts", "time management"],
		temperatureBias: 0.0,
	},
	"vigilant-guardian": {
		id: "vigilant-guardian",
		name: "Vigilant Guardian",
		traits: ["cautious", "protective", "security-minded", "skeptical"],
		strengths: ["security", "error handling", "edge cases", "review"],
		weaknesses: ["speed", "innovation", "user experience"],
		temperatureBias: -0.1,
	},
	"creative-explorer": {
		id: "creative-explorer",
		name: "Creative Explorer",
		traits: ["inventive", "bold", "lateral-thinking", "adaptable"],
		strengths: ["novel solutions", "prototyping", "brainstorming", "refactoring"],
		weaknesses: ["consistency", "documentation", "test coverage"],
		temperatureBias: 0.2,
	},
	"wise-mediator": {
		id: "wise-mediator",
		name: "Wise Mediator",
		traits: ["balanced", "empathetic", "diplomatic", "holistic"],
		strengths: ["architecture", "code review", "mentoring", "integration"],
		weaknesses: ["deep specialization", "aggressive optimization"],
		temperatureBias: 0.05,
	},
};

// ─── Soul Types ─────────────────────────────────────────────────────────────

export interface AgentSoul {
	/** Persistent identity across sessions */
	id: string;
	/** Display name */
	name: string;
	/** Selected archetype */
	archetype: AgentArchetype;
	/** Purpose statement (why this agent exists) */
	purpose: string;
	/** Learned personality traits (evolves over time) */
	learnedTraits: string[];
	/** Confidence model: task domain -> confidence [0, 1] */
	confidenceModel: Map<string, number>;
	/** Core values derived from experience */
	values: string[];
	/** Creation timestamp */
	createdAt: number;
	/** Last active timestamp */
	lastActiveAt: number;
}

// ─── Soul Manager ───────────────────────────────────────────────────────────

export class SoulManager {
	private souls = new Map<string, AgentSoul>();

	/** Create a new soul for an agent. */
	create(config: {
		id: string;
		name: string;
		archetype?: string;
		purpose: string;
	}): AgentSoul {
		const archetypeId = config.archetype ?? "curious-scholar";
		const archetype =
			ARCHETYPES[archetypeId] ?? ARCHETYPES["curious-scholar"];

		const soul: AgentSoul = {
			id: config.id,
			name: config.name,
			archetype,
			purpose: config.purpose,
			learnedTraits: [],
			confidenceModel: new Map(),
			values: [],
			createdAt: Date.now(),
			lastActiveAt: Date.now(),
		};
		this.souls.set(config.id, soul);
		return soul;
	}

	/** Get soul by agent ID. */
	get(agentId: string): AgentSoul | undefined {
		return this.souls.get(agentId);
	}

	/**
	 * Update confidence for a task domain using exponential moving average.
	 * Alpha = 0.15 gives a smooth learning curve: recent outcomes matter
	 * but history is not forgotten.
	 */
	updateConfidence(agentId: string, domain: string, success: boolean): void {
		const soul = this.souls.get(agentId);
		if (!soul) return;

		const current = soul.confidenceModel.get(domain) ?? 0.5;
		const alpha = 0.15;
		const target = success ? 1 : 0;
		const updated = current + alpha * (target - current);
		soul.confidenceModel.set(domain, Math.max(0, Math.min(1, updated)));
		soul.lastActiveAt = Date.now();
	}

	/** Record a learned trait (deduplicated). */
	addTrait(agentId: string, trait: string): void {
		const soul = this.souls.get(agentId);
		if (soul && !soul.learnedTraits.includes(trait)) {
			soul.learnedTraits.push(trait);
		}
	}

	/** Add a core value (deduplicated). */
	addValue(agentId: string, value: string): void {
		const soul = this.souls.get(agentId);
		if (soul && !soul.values.includes(value)) {
			soul.values.push(value);
		}
	}

	/**
	 * Get effective temperature for an agent.
	 * Combines base temperature with archetype bias, clamped to [0, 2].
	 */
	getEffectiveTemperature(agentId: string, baseTemperature: number): number {
		const soul = this.souls.get(agentId);
		if (!soul) return baseTemperature;
		return Math.max(0, Math.min(2, baseTemperature + soul.archetype.temperatureBias));
	}

	/**
	 * Build a soul-aware system prompt addition.
	 * This is injected into the agent's system prompt so the LLM
	 * understands its own identity and capabilities.
	 */
	buildSoulPrompt(agentId: string): string {
		const soul = this.souls.get(agentId);
		if (!soul) return "";

		const lines: string[] = [];
		lines.push(`## Agent Identity: ${soul.name}`);
		lines.push(`Archetype: ${soul.archetype.name}`);
		lines.push(`Purpose: ${soul.purpose}`);

		const allTraits = [...soul.archetype.traits, ...soul.learnedTraits];
		lines.push(`Traits: ${allTraits.join(", ")}`);
		lines.push(`Strengths: ${soul.archetype.strengths.join(", ")}`);

		if (soul.values.length > 0) {
			lines.push(`Values: ${soul.values.join(", ")}`);
		}

		// Surface confidence hints so the agent can self-regulate
		const confident = [...soul.confidenceModel.entries()]
			.filter(([, v]) => v > 0.7)
			.map(([k]) => k);
		const uncertain = [...soul.confidenceModel.entries()]
			.filter(([, v]) => v < 0.4)
			.map(([k]) => k);

		if (confident.length > 0) {
			lines.push(`High confidence in: ${confident.join(", ")}`);
		}
		if (uncertain.length > 0) {
			lines.push(`Still learning: ${uncertain.join(", ")}`);
		}

		return lines.join("\n");
	}

	/** Serialize all souls for persistence. */
	serialize(): string {
		const data: Record<string, unknown>[] = [];
		for (const soul of this.souls.values()) {
			data.push({
				...soul,
				confidenceModel: Object.fromEntries(soul.confidenceModel),
			});
		}
		return JSON.stringify(data);
	}

	/** Restore souls from serialized JSON. */
	deserialize(json: string): void {
		const data = JSON.parse(json) as Array<Record<string, unknown>>;
		for (const entry of data) {
			const raw = entry as unknown as Omit<AgentSoul, "confidenceModel"> & {
				confidenceModel?: Record<string, number>;
			};
			const soul: AgentSoul = {
				id: raw.id,
				name: raw.name,
				archetype: raw.archetype,
				purpose: raw.purpose,
				learnedTraits: raw.learnedTraits,
				values: raw.values,
				createdAt: raw.createdAt,
				lastActiveAt: raw.lastActiveAt,
				confidenceModel: new Map(
					Object.entries(raw.confidenceModel ?? {}),
				),
			};
			this.souls.set(soul.id, soul);
		}
	}

	/** Remove a soul. */
	remove(agentId: string): boolean {
		return this.souls.delete(agentId);
	}

	/** Get all souls. */
	getAll(): AgentSoul[] {
		return [...this.souls.values()];
	}
}
