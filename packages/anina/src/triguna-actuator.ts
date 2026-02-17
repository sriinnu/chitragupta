/**
 * @chitragupta/anina — TrigunaActuator — Triguna Event → System Actuation.
 *
 * Listens to Triguna health events and actuates via KaalaBrahma + Samiti.
 * This wires the detection layer (Triguna Kalman filter) to the actuation
 * layer (KaalaBrahma tree healing, Samiti broadcasts, config adjustments).
 *
 * Events handled:
 *   triguna:tamas_alert     → healTree, reduce maxSubAgents, broadcast degradation warning
 *   triguna:rajas_alert     → reduce maxSubAgents, broadcast hyperactivity warning
 *   triguna:sattva_dominant → relax maxSubAgents, broadcast health confirmation
 *   triguna:guna_shift      → broadcast for observability
 */

import type { KaalaLifecycle } from "./types.js";

/** Duck-typed Samiti interface to avoid hard sutra dependency. */
interface SamitiLike {
	broadcast(
		channel: string,
		message: {
			sender: string;
			severity: "info" | "warning" | "critical";
			category: string;
			content: string;
			data?: unknown;
			ttl?: number;
		},
	): unknown;
}

/** Configuration for the TrigunaActuator. */
export interface TrigunaActuatorConfig {
	/** Max sub-agents when healthy (sattva dominant). Default: 8. */
	normalMaxSubAgents: number;
	/** Max sub-agents when degraded (tamas/rajas alert). Default: 4. */
	degradedMaxSubAgents: number;
}

const DEFAULT_ACTUATOR_CONFIG: TrigunaActuatorConfig = {
	normalMaxSubAgents: 8,
	degradedMaxSubAgents: 4,
};

/**
 * TrigunaActuator — bridges Triguna health events to system actuation.
 *
 * Pass `handleEvent` as the Triguna `onEvent` callback.
 */
export class TrigunaActuator {
	private readonly kaala: KaalaLifecycle | null;
	private readonly samiti: SamitiLike | null;
	private readonly config: TrigunaActuatorConfig;

	constructor(
		kaala: KaalaLifecycle | null,
		samiti: SamitiLike | null,
		config?: Partial<TrigunaActuatorConfig>,
	) {
		this.kaala = kaala;
		this.samiti = samiti;
		this.config = { ...DEFAULT_ACTUATOR_CONFIG, ...config };
	}

	/**
	 * Handle a Triguna event. Pass this as the `onEvent` callback to Triguna.
	 */
	handleEvent = (event: string, data: unknown): void => {
		switch (event) {
			case "triguna:tamas_alert":
				this.onTamasAlert(data as { tamas: number; message: string });
				break;
			case "triguna:rajas_alert":
				this.onRajasAlert(data as { rajas: number; message: string });
				break;
			case "triguna:sattva_dominant":
				this.onSattvaDominant(data as { sattva: number; message: string });
				break;
			case "triguna:guna_shift":
				this.onGunaShift(data as { from: string; to: string; state: unknown });
				break;
		}
	};

	// ─── Event Handlers ──────────────────────────────────────────────────

	private onTamasAlert(data: { tamas: number; message: string }): void {
		// Heal stale/dead agents
		if (this.kaala) {
			try { this.kaala.healTree(); } catch { /* best-effort */ }
		}

		// Reduce agent spawning capacity
		this.setMaxSubAgents(this.config.degradedMaxSubAgents);

		// Broadcast degradation warning
		this.broadcast(
			"#health",
			`[Triguna] Tamas alert (${(data.tamas * 100).toFixed(0)}%): ${data.message}. Healing tree and reducing agent capacity.`,
			"warning",
		);
	}

	private onRajasAlert(data: { rajas: number; message: string }): void {
		// Reduce agent spawning to cool down hyperactivity
		this.setMaxSubAgents(this.config.degradedMaxSubAgents);

		// Broadcast hyperactivity warning
		this.broadcast(
			"#health",
			`[Triguna] Rajas alert (${(data.rajas * 100).toFixed(0)}%): ${data.message}. Reducing agent capacity.`,
			"warning",
		);
	}

	private onSattvaDominant(data: { sattva: number; message: string }): void {
		// Restore normal agent capacity
		this.setMaxSubAgents(this.config.normalMaxSubAgents);

		// Broadcast health confirmation
		this.broadcast(
			"#health",
			`[Triguna] Sattva dominant (${(data.sattva * 100).toFixed(0)}%): ${data.message}. System healthy.`,
			"info",
		);
	}

	private onGunaShift(data: { from: string; to: string; state: unknown }): void {
		this.broadcast(
			"#health",
			`[Triguna] Guna shift: ${data.from} → ${data.to}`,
			"info",
		);
	}

	// ─── Helpers ─────────────────────────────────────────────────────────

	private setMaxSubAgents(max: number): void {
		if (!this.kaala) return;
		try {
			const kaalaAny = this.kaala as unknown as { setConfig(c: { maxSubAgents: number }): void };
			if (typeof kaalaAny.setConfig === "function") {
				kaalaAny.setConfig({ maxSubAgents: max });
			}
		} catch { /* best-effort */ }
	}

	private broadcast(channel: string, content: string, severity: "info" | "warning" | "critical"): void {
		if (!this.samiti) return;
		try {
			this.samiti.broadcast(channel, {
				sender: "triguna-actuator",
				severity,
				category: "health",
				content,
			});
		} catch { /* best-effort */ }
	}
}
