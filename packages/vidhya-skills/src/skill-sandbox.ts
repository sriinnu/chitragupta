/**
 * SkillSandbox (Kshetra-Vidya) — Quarantine for skill learning.
 *
 * All skill mutations (creation, evolution, fusion) pass through the sandbox.
 * Skills are validated, tested in isolation, and only promoted to the
 * live registry after passing health checks.
 *
 * Security-first: "the strength of Hanuman" — skills prove themselves worthy
 * before entering the ecosystem.
 *
 * @packageDocumentation
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SandboxConfig {
	/** Max time (ms) a skill can stay in quarantine before auto-rejection. Default: 300000 (5 min) */
	quarantineTimeoutMs?: number;
	/** Minimum health score (0-1) required for promotion. Default: 0.6 */
	minHealthScore?: number;
	/** Maximum number of skills in quarantine simultaneously. Default: 20 */
	maxQuarantineSize?: number;
	/** Whether to auto-promote skills that pass all checks. Default: false (manual approval) */
	autoPromote?: boolean;
	/** Allowed capabilities for sandboxed skills. Skills requesting disallowed caps are rejected. */
	allowedCapabilities?: string[];
	/** Blocked patterns in skill content (security). Regex patterns for injection prevention. */
	blockedPatterns?: RegExp[];
}

export interface QuarantinedSkill {
	/** Unique quarantine entry ID */
	id: string;
	/** The skill data being quarantined */
	skill: { name: string; description: string; tags: string[]; capabilities?: string[]; content?: string };
	/** Why this skill is in quarantine (new, evolved, fused) */
	reason: "new" | "evolved" | "fused" | "external";
	/** Timestamp when entered quarantine */
	enteredAt: number;
	/** Validation results from security checks */
	validationResults: SandboxValidationResult[];
	/** Health score computed from validation (0-1) */
	healthScore: number;
	/** Current status */
	status: "pending" | "validated" | "approved" | "rejected" | "expired";
	/** Suraksha scan result (attached by pipeline if scanner is used). */
	scanResult?: import("./suraksha.js").SurakshaScanResult;
	/** Path to the staging directory (set by Pratiksha when staged). */
	stagingPath?: string;
}

/**
 * Result of a single validation check within the sandbox.
 *
 * Named `SandboxValidationResult` to avoid collision with the
 * manifest-level `ValidationResult` in types.ts.
 */
export interface SandboxValidationResult {
	check: string;
	passed: boolean;
	message: string;
	severity: "info" | "warning" | "critical";
}

// ─── Default Blocked Patterns ────────────────────────────────────────────────

/** Security patterns that indicate potentially dangerous skill content. */
const DEFAULT_BLOCKED_PATTERNS: RegExp[] = [
	/eval\s*\(/i,
	/Function\s*\(/i,
	/require\s*\(/i,
	/import\s*\(/i,
	/child_process/i,
	/execSync/i,
	/spawn\s*\(/i,
	/rm\s+-rf/i,
	/__proto__/i,
	/constructor\s*\[/i,
	/process\.env/i,
];

// ─── SkillSandbox ────────────────────────────────────────────────────────────

/**
 * Quarantine system for skill mutations.
 *
 * Every skill creation, evolution, or fusion event flows through the sandbox.
 * The sandbox validates skills against security policies, checks structural
 * health, and gates promotion to the live registry behind explicit approval
 * (or auto-promotion when configured).
 */
export class SkillSandbox {
	private quarantine: Map<string, QuarantinedSkill> = new Map();
	private config: Required<SandboxConfig>;
	private idCounter = 0;

	constructor(config?: SandboxConfig) {
		this.config = {
			quarantineTimeoutMs: config?.quarantineTimeoutMs ?? 300_000,
			minHealthScore: config?.minHealthScore ?? 0.6,
			maxQuarantineSize: config?.maxQuarantineSize ?? 20,
			autoPromote: config?.autoPromote ?? false,
			allowedCapabilities: config?.allowedCapabilities ?? [
				"read", "write", "search", "analyze", "transform", "generate",
			],
			blockedPatterns: config?.blockedPatterns ?? DEFAULT_BLOCKED_PATTERNS,
		};
	}

	/**
	 * Submit a skill for quarantine and validation.
	 * Returns the quarantine entry ID.
	 */
	submit(
		skill: QuarantinedSkill["skill"],
		reason: QuarantinedSkill["reason"],
	): string {
		// Expire stale entries first to free capacity
		this.expireStale();

		if (this.quarantine.size >= this.config.maxQuarantineSize) {
			throw new Error(
				`Quarantine full (${this.config.maxQuarantineSize} max). ` +
				"Reject or promote existing skills first.",
			);
		}

		const id = `qs_${Date.now()}_${this.idCounter++}`;
		const validationResults = this.validate(skill);
		const healthScore = this.computeHealthScore(validationResults);

		const entry: QuarantinedSkill = {
			id,
			skill,
			reason,
			enteredAt: Date.now(),
			validationResults,
			healthScore,
			status: "pending",
		};

		// Auto-reject if critical security violation
		const hasCritical = validationResults.some(
			(r) => !r.passed && r.severity === "critical",
		);
		if (hasCritical) {
			entry.status = "rejected";
		} else {
			entry.status = "validated";
			// Auto-promote if enabled and health score meets threshold
			if (this.config.autoPromote && healthScore >= this.config.minHealthScore) {
				entry.status = "approved";
			}
		}

		this.quarantine.set(id, entry);
		return id;
	}

	/**
	 * Manually approve a quarantined skill for promotion.
	 */
	approve(id: string): QuarantinedSkill {
		const entry = this.quarantine.get(id);
		if (!entry) throw new Error(`Quarantine entry "${id}" not found`);
		if (entry.status === "rejected") {
			throw new Error(`Cannot approve rejected skill "${id}"`);
		}
		entry.status = "approved";
		return entry;
	}

	/**
	 * Reject a quarantined skill.
	 */
	reject(id: string, reason?: string): void {
		const entry = this.quarantine.get(id);
		if (!entry) throw new Error(`Quarantine entry "${id}" not found`);
		entry.status = "rejected";
		if (reason) {
			entry.validationResults.push({
				check: "manual_rejection",
				passed: false,
				message: reason,
				severity: "critical",
			});
		}
	}

	/**
	 * Get all skills approved for promotion to the live registry.
	 * Removes them from quarantine.
	 */
	drainApproved(): QuarantinedSkill[] {
		const approved: QuarantinedSkill[] = [];
		for (const [id, entry] of this.quarantine) {
			if (entry.status === "approved") {
				approved.push(entry);
				this.quarantine.delete(id);
			}
		}
		return approved;
	}

	/**
	 * Get quarantine status summary.
	 */
	getStats(): {
		total: number;
		pending: number;
		validated: number;
		approved: number;
		rejected: number;
		expired: number;
	} {
		const stats = { total: 0, pending: 0, validated: 0, approved: 0, rejected: 0, expired: 0 };
		for (const entry of this.quarantine.values()) {
			stats.total++;
			stats[entry.status]++;
		}
		return stats;
	}

	/**
	 * Get a specific quarantine entry.
	 */
	get(id: string): QuarantinedSkill | undefined {
		return this.quarantine.get(id);
	}

	/**
	 * List all quarantined skills.
	 */
	list(): QuarantinedSkill[] {
		return [...this.quarantine.values()];
	}

	// ─── Internal Validation ──────────────────────────────────────────

	private validate(skill: QuarantinedSkill["skill"]): SandboxValidationResult[] {
		const results: SandboxValidationResult[] = [];

		// 1. Name validation — must be non-empty, alphanumeric + hyphens
		const nameValid = /^[a-z][a-z0-9-]*$/.test(skill.name);
		results.push({
			check: "name_format",
			passed: nameValid,
			message: nameValid ? "Name format valid" : `Invalid skill name: "${skill.name}"`,
			severity: nameValid ? "info" : "warning",
		});

		// 2. Description check — must be non-empty and substantive
		const hasDesc = (skill.description?.length ?? 0) > 10;
		results.push({
			check: "description_present",
			passed: hasDesc,
			message: hasDesc ? "Description present" : "Missing or too short description",
			severity: hasDesc ? "info" : "warning",
		});

		// 3. Tags check — must have at least one tag
		const hasTags = (skill.tags?.length ?? 0) > 0;
		results.push({
			check: "tags_present",
			passed: hasTags,
			message: hasTags ? `${skill.tags.length} tag(s)` : "No tags provided",
			severity: hasTags ? "info" : "warning",
		});

		// 4. Capability whitelist check
		if (skill.capabilities) {
			const disallowed = skill.capabilities.filter(
				(c) => !this.config.allowedCapabilities.includes(c),
			);
			const capsOk = disallowed.length === 0;
			results.push({
				check: "capability_whitelist",
				passed: capsOk,
				message: capsOk
					? "All capabilities allowed"
					: `Disallowed capabilities: ${disallowed.join(", ")}`,
				severity: capsOk ? "info" : "critical",
			});
		}

		// 5. Content security scan — check for injection patterns
		if (skill.content) {
			for (const pattern of this.config.blockedPatterns) {
				const match = pattern.test(skill.content);
				results.push({
					check: `security_scan:${pattern.source}`,
					passed: !match,
					message: match
						? `Blocked pattern detected: ${pattern.source}`
						: `Pattern clean: ${pattern.source}`,
					severity: match ? "critical" : "info",
				});
			}
		}

		// 6. Size check — skill content shouldn't be excessively large
		const contentLen = skill.content?.length ?? 0;
		const sizeOk = contentLen < 50_000;
		results.push({
			check: "content_size",
			passed: sizeOk,
			message: sizeOk ? `Content size OK (${contentLen} chars)` : `Content too large (${contentLen} chars)`,
			severity: sizeOk ? "info" : "warning",
		});

		return results;
	}

	private computeHealthScore(results: SandboxValidationResult[]): number {
		if (results.length === 0) return 0;

		let score = 1.0;
		for (const r of results) {
			if (!r.passed) {
				switch (r.severity) {
					case "critical": score -= 0.5; break;
					case "warning": score -= 0.15; break;
					case "info": score -= 0.05; break;
				}
			}
		}
		return Math.max(0, Math.min(1, score));
	}

	private expireStale(): void {
		const now = Date.now();
		for (const [id, entry] of this.quarantine) {
			if (
				entry.status !== "approved" &&
				entry.status !== "rejected" &&
				now - entry.enteredAt > this.config.quarantineTimeoutMs
			) {
				entry.status = "expired";
				this.quarantine.delete(id);
			}
		}
	}
}
