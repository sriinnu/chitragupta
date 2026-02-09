import type {
	VamshaEvent, VamshaEventType, VamshaLineage,
	EnhancedSkillManifest, AnandamayaMastery, VidyaTantraConfig,
} from "./types-v2.js";
import { DEFAULT_VIDYA_TANTRA_CONFIG } from "./types-v2.js";

const OS_SPECIFIC_BINS: Record<string, string[]> = {
	darwin: ["pbcopy", "pbpaste", "open", "say", "osascript", "defaults", "diskutil"],
	linux: ["xclip", "xdg-open", "xsel", "notify-send", "apt", "systemctl"],
	win32: ["clip", "start", "powershell", "wmic", "certutil"],
};

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export class VamshaTracker {
	private readonly lineages: Map<string, VamshaLineage>;
	private readonly maxEventsPerSkill: number;

	constructor(maxEventsPerSkill?: number) {
		this.lineages = new Map();
		this.maxEventsPerSkill = maxEventsPerSkill ?? DEFAULT_VIDYA_TANTRA_CONFIG.maxVamshaEvents;
	}

	getOrCreateLineage(skillName: string): VamshaLineage {
		let lineage = this.lineages.get(skillName);
		if (!lineage) {
			lineage = {
				skillName,
				events: [],
				variants: [],
				symbionts: [],
				ancestor: null,
			};
			this.lineages.set(skillName, lineage);
		}
		return lineage;
	}

	recordMutation(skillName: string, newVersion: string, reason: string): VamshaEvent {
		const lineage = this.getOrCreateLineage(skillName);
		const event = this.createEvent("mutation", skillName, reason, { newVersion });
		lineage.events.push(event);
		this.trimEvents(lineage);
		return event;
	}

	recordSpeciation(parentName: string, variantName: string, reason: string): VamshaEvent {
		const parentLineage = this.getOrCreateLineage(parentName);
		if (!parentLineage.variants.includes(variantName)) {
			parentLineage.variants.push(variantName);
		}

		const variantLineage = this.getOrCreateLineage(variantName);
		(variantLineage as { ancestor: string | null }).ancestor = parentName;

		const event = this.createEvent("speciation", parentName, reason, {
			variantName,
		});
		parentLineage.events.push(event);
		this.trimEvents(parentLineage);

		const variantEvent = this.createEvent("speciation", variantName, `Forked from ${parentName}: ${reason}`, {
			variantName: parentName,
		});
		variantLineage.events.push(variantEvent);
		this.trimEvents(variantLineage);

		return event;
	}

	recordSymbiosis(skillA: string, skillB: string, reason: string): VamshaEvent {
		const lineageA = this.getOrCreateLineage(skillA);
		if (!lineageA.symbionts.includes(skillB)) {
			lineageA.symbionts.push(skillB);
		}

		const lineageB = this.getOrCreateLineage(skillB);
		if (!lineageB.symbionts.includes(skillA)) {
			lineageB.symbionts.push(skillA);
		}

		const event = this.createEvent("symbiosis", skillA, reason, {
			partnerName: skillB,
		});
		lineageA.events.push(event);
		this.trimEvents(lineageA);

		return event;
	}

	recordExtinction(skillName: string, reason: string): VamshaEvent {
		const lineage = this.getOrCreateLineage(skillName);
		const event = this.createEvent("extinction", skillName, reason);
		lineage.events.push(event);
		this.trimEvents(lineage);
		return event;
	}

	recordAdaptation(skillName: string, vectorDelta: number, reason: string): VamshaEvent {
		const lineage = this.getOrCreateLineage(skillName);
		const event = this.createEvent("adaptation", skillName, reason, {
			vectorDelta,
		});
		lineage.events.push(event);
		this.trimEvents(lineage);
		return event;
	}

	getLineage(skillName: string): VamshaLineage | null {
		return this.lineages.get(skillName) ?? null;
	}

	getVariants(skillName: string): string[] {
		const lineage = this.lineages.get(skillName);
		return lineage?.variants ?? [];
	}

	getSymbionts(skillName: string): string[] {
		const lineage = this.lineages.get(skillName);
		return lineage?.symbionts ?? [];
	}

	getAncestor(skillName: string): string | null {
		const visited = new Set<string>();
		let current = skillName;
		let depth = 0;

		while (depth < 100) {
			if (visited.has(current)) {
				return null;
			}
			visited.add(current);

			const lineage = this.lineages.get(current);
			if (!lineage?.ancestor) {
				return current === skillName ? null : current;
			}

			current = lineage.ancestor;
			depth++;
		}

		return null;
	}

	detectExtinctionCandidates(
		masteryMap: Map<string, AnandamayaMastery>,
		healthMap: Map<string, number>
	): string[] {
		const candidates: string[] = [];
		const now = Date.now();

		for (const [skillName, mastery] of masteryMap) {
			const health = healthMap.get(skillName) ?? 0;
			if (health >= 0.05) continue;
			if (mastery.totalInvocations < 20) continue;

			const successRate = mastery.totalInvocations > 0
				? mastery.successCount / mastery.totalInvocations
				: 0;
			if (successRate >= 0.1) continue;

			const lastInvoked = mastery.lastInvokedAt;
			if (!lastInvoked) continue;
			const lastInvocationTime = new Date(lastInvoked).getTime();
			if (now - lastInvocationTime < NINETY_DAYS_MS) continue;

			candidates.push(skillName);
		}

		return candidates;
	}

	detectSpeciationCandidates(
		manifests: EnhancedSkillManifest[]
	): Array<{ skill: string; suggestedVariant: string; reason: string }> {
		const candidates: Array<{ skill: string; suggestedVariant: string; reason: string }> = [];

		for (const manifest of manifests) {
			const bins = manifest.requirements?.bins ?? [];
			if (bins.length === 0) continue;

			const osList = manifest.requirements?.os ?? [];
			if (osList.length <= 1) continue;

			const osMatches: Record<string, string[]> = {};
			for (const bin of bins) {
				for (const [os, osBins] of Object.entries(OS_SPECIFIC_BINS)) {
					if (osBins.includes(bin)) {
						if (!osMatches[os]) osMatches[os] = [];
						osMatches[os].push(bin);
					}
				}
			}

			const matchingOses = Object.keys(osMatches);
			if (matchingOses.length > 1) {
				for (const os of matchingOses) {
					const binList = osMatches[os].join(", ");
					candidates.push({
						skill: manifest.name,
						suggestedVariant: `${manifest.name}-${os}`,
						reason: `Uses ${os}-specific binaries: ${binList}`,
					});
				}
			}
		}

		return candidates;
	}

	detectSymbiosisCandidates(
		coOccurrences: Map<string, Map<string, number>>,
		skillSessions: Map<string, number>,
		threshold = 0.8
	): Array<{ skillA: string; skillB: string; rate: number }> {
		const candidates: Array<{ skillA: string; skillB: string; rate: number }> = [];
		const seen = new Set<string>();

		for (const [skillA, partners] of coOccurrences) {
			const sessionsA = skillSessions.get(skillA) ?? 0;
			if (sessionsA === 0) continue;

			for (const [skillB, count] of partners) {
				const key = [skillA, skillB].sort().join(":");
				if (seen.has(key)) continue;
				seen.add(key);

				const lineageA = this.lineages.get(skillA);
				if (lineageA?.symbionts.includes(skillB)) continue;

				const sessionsB = skillSessions.get(skillB) ?? 0;
				if (sessionsB === 0) continue;

				const rate = count / Math.min(sessionsA, sessionsB);
				if (rate > threshold) {
					candidates.push({ skillA, skillB, rate });
				}
			}
		}

		return candidates;
	}

	serialize(): Array<[string, VamshaLineage]> {
		return Array.from(this.lineages.entries());
	}

	deserialize(data: Array<[string, VamshaLineage]>): void {
		this.lineages.clear();
		for (const [name, lineage] of data) {
			this.lineages.set(name, lineage);
		}
	}

	private createEvent(
		type: VamshaEventType,
		skillName: string,
		reason: string,
		extra?: Partial<VamshaEvent>
	): VamshaEvent {
		return {
			type,
			skillName,
			timestamp: new Date().toISOString(),
			reason,
			...extra,
		};
	}

	private trimEvents(lineage: VamshaLineage): void {
		if (lineage.events.length > this.maxEventsPerSkill) {
			(lineage as { events: VamshaEvent[] }).events = lineage.events.slice(-this.maxEventsPerSkill);
		}
	}
}
