/**
 * @chitragupta/anina/chetana — Triguna — त्रिगुण — Health Monitor.
 *
 * In Vedic philosophy, Triguna represents the three fundamental qualities
 * (gunas) of Prakriti (nature). Every system — every being — is a dynamic
 * mixture of all three:
 *
 *   - **Sattva** (सत्त्व — Harmony): clarity, balance, wisdom.
 *     The system is healthy, productive, and well-calibrated.
 *   - **Rajas** (रजस् — Activity): energy, passion, restlessness.
 *     The system is active but stressed — high throughput at cost of stability.
 *   - **Tamas** (तमस् — Inertia): darkness, confusion, stagnation.
 *     The system is stuck, degraded, or drowning in errors.
 *
 * The three gunas always sum to 1.0 — they live on the 2-simplex Δ².
 *
 * ## Estimation
 *
 * We use a **Simplex-Constrained Kalman Filter** that operates in
 * Isometric Log-Ratio (ILR) space. The ILR transform bijects the
 * 3-simplex to R², where standard Kalman predict/update applies.
 * After each update, we map back to the simplex, guaranteeing the
 * invariant sattva + rajas + tamas = 1.
 *
 * ## Observation Model
 *
 * Six normalized signals feed the filter:
 *   - errorRate      → ↑tamas
 *   - tokenVelocity  → ↑rajas
 *   - loopCount      → ↑rajas (moderate), ↑tamas (extreme)
 *   - latency        → ↑tamas
 *   - successRate    → ↑sattva
 *   - userSatisfaction → ↑sattva
 *
 * The observation function H maps these 6 signals to the 3 gunas via
 * a fixed influence matrix, then projects into ILR space.
 *
 * @packageDocumentation
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** The three fundamental qualities on the 2-simplex. */
export interface GunaState {
	/** Harmony / clarity [0, 1]. */
	sattva: number;
	/** Activity / restlessness [0, 1]. */
	rajas: number;
	/** Inertia / degradation [0, 1]. */
	tamas: number;
	// Invariant: sattva + rajas + tamas ≈ 1.0
}

/** Observation vector for a single update. All values in [0, 1]. */
export interface TrigunaObservation {
	/** Recent error frequency [0, 1]. High → ↑tamas. */
	errorRate: number;
	/** Tokens per second, normalized [0, 1]. High → ↑rajas. */
	tokenVelocity: number;
	/** Tool-use loops per turn, normalized [0, 1]. High → ↑rajas/↑tamas. */
	loopCount: number;
	/** Response latency, normalized [0, 1]. High → ↑tamas. */
	latency: number;
	/** Tool success rate [0, 1]. High → ↑sattva. */
	successRate: number;
	/** Implicit user satisfaction [0, 1]. High → ↑sattva. */
	userSatisfaction: number;
}

/** A timestamped snapshot of the guna state. */
export interface GunaSnapshot {
	state: GunaState;
	timestamp: number;
	dominant: GunaLabel;
}

/** Per-guna directional trend. */
export interface GunaTrend {
	sattva: TrendDirection;
	rajas: TrendDirection;
	tamas: TrendDirection;
}

/** Trend direction for a single guna. */
export type TrendDirection = "rising" | "falling" | "stable";

/** Label for the three gunas. */
export type GunaLabel = "sattva" | "rajas" | "tamas";

/** Triguna behavioral event types. */
export type TrigunaEventType =
	| "triguna:sattva_dominant"
	| "triguna:rajas_alert"
	| "triguna:tamas_alert"
	| "triguna:guna_shift";

/** Configuration for the Triguna health monitor. */
export interface TrigunaConfig {
	/** Initial guna state [sattva, rajas, tamas]. Must sum to 1.0. */
	initialState: [number, number, number];

	/** Process noise covariance (2x2 diagonal value). Default: 0.01. */
	processNoise: number;

	/** Measurement noise covariance (2x2 diagonal value). Default: 0.1. */
	measurementNoise: number;

	/** Sattva threshold for healthy alert. Default: 0.7. */
	sattvaThreshold: number;

	/** Rajas threshold for hyperactivity alert. Default: 0.5. */
	rajasThreshold: number;

	/** Tamas threshold for degradation alert. Default: 0.4. */
	tamasThreshold: number;

	/** Maximum history snapshots to retain. Default: 100. */
	maxHistory: number;

	/** Minimum guna value to prevent log(0) in ILR. Default: 1e-6. */
	simplexFloor: number;

	/** Number of recent snapshots for trend detection. Default: 5. */
	trendWindow: number;

	/** Minimum absolute change over trend window to count as rising/falling. Default: 0.05. */
	trendThreshold: number;
}

/** System ceiling: maximum history snapshots. */
export const SYSTEM_MAX_TRIGUNA_HISTORY = 1000;

/** Default Triguna configuration. */
export const DEFAULT_TRIGUNA_CONFIG: TrigunaConfig = {
	initialState: [0.6, 0.3, 0.1],
	processNoise: 0.01,
	measurementNoise: 0.1,
	sattvaThreshold: 0.7,
	rajasThreshold: 0.5,
	tamasThreshold: 0.4,
	maxHistory: 100,
	simplexFloor: 1e-6,
	trendWindow: 5,
	trendThreshold: 0.05,
};

// ─── ILR Transform ───────────────────────────────────────────────────────────

/**
 * Isometric Log-Ratio (ILR) transform for 3-compositions.
 *
 * The ILR transform is an isometry from the D-part simplex to R^(D-1).
 * For D=3 (our case), the Helmert sub-matrix basis gives:
 *
 *   y₁ = (1/√2) * ln(x₁ / x₂)
 *   y₂ = (1/√6) * ln(x₁ * x₂ / x₃²)
 *
 * This is the standard ILR with the Helmert basis:
 *   Ψ = [ 1/√2, -1/√2,  0    ]
 *       [ 1/√6,  1/√6, -2/√6 ]
 *
 * Reference: Egozcue et al. (2003), "Isometric Logratio Transformations
 * for Compositional Data Analysis", Mathematical Geology 35(3).
 */

const SQRT2 = Math.sqrt(2);
const SQRT6 = Math.sqrt(6);
const INV_SQRT2 = 1 / SQRT2;
const INV_SQRT6 = 1 / SQRT6;

/**
 * Forward ILR: simplex [x₁, x₂, x₃] → R² [y₁, y₂].
 *
 * Precondition: all xᵢ > 0 and sum ≈ 1.
 */
export function ilrForward(x1: number, x2: number, x3: number): [number, number] {
	const y1 = INV_SQRT2 * Math.log(x1 / x2);
	const y2 = INV_SQRT6 * Math.log((x1 * x2) / (x3 * x3));
	return [y1, y2];
}

/**
 * Inverse ILR: R² [y₁, y₂] → simplex [x₁, x₂, x₃].
 *
 * Computes the exp of the inverse Helmert transform, then normalizes
 * to the simplex (closure operation).
 *
 * From the Helmert basis:
 *   ln(x₁) ∝  y₁/√2 + y₂/√6
 *   ln(x₂) ∝ -y₁/√2 + y₂/√6
 *   ln(x₃) ∝         - 2y₂/√6
 */
export function ilrInverse(y1: number, y2: number): [number, number, number] {
	// Back-project from ILR coordinates to clr (centered log-ratio) coordinates
	const z1 = y1 * INV_SQRT2 + y2 * INV_SQRT6;
	const z2 = -y1 * INV_SQRT2 + y2 * INV_SQRT6;
	const z3 = -2 * y2 * INV_SQRT6;

	// Exponentiate and normalize (softmax-like closure)
	const e1 = Math.exp(z1);
	const e2 = Math.exp(z2);
	const e3 = Math.exp(z3);
	const total = e1 + e2 + e3;

	return [e1 / total, e2 / total, e3 / total];
}

// ─── 2x2 Matrix Ops ─────────────────────────────────────────────────────────

/** A 2x2 matrix stored as [a, b, c, d] for [[a, b], [c, d]]. */
type Mat2 = [number, number, number, number];

/** A 2-vector. */
type Vec2 = [number, number];

/** 2x2 matrix addition. */
function mat2Add(A: Mat2, B: Mat2): Mat2 {
	return [A[0] + B[0], A[1] + B[1], A[2] + B[2], A[3] + B[3]];
}

/** 2x2 matrix-vector multiply: Ax. */
function mat2MulVec(A: Mat2, x: Vec2): Vec2 {
	return [
		A[0] * x[0] + A[1] * x[1],
		A[2] * x[0] + A[3] * x[1],
	];
}

/** 2x2 matrix multiply: AB. */
function mat2Mul(A: Mat2, B: Mat2): Mat2 {
	return [
		A[0] * B[0] + A[1] * B[2],
		A[0] * B[1] + A[1] * B[3],
		A[2] * B[0] + A[3] * B[2],
		A[2] * B[1] + A[3] * B[3],
	];
}

/** 2x2 matrix transpose. */
function mat2Transpose(A: Mat2): Mat2 {
	return [A[0], A[2], A[1], A[3]];
}

/** 2x2 matrix inverse (returns null if singular). */
function mat2Inverse(A: Mat2): Mat2 | null {
	const det = A[0] * A[3] - A[1] * A[2];
	if (Math.abs(det) < 1e-15) return null;
	const invDet = 1 / det;
	return [A[3] * invDet, -A[1] * invDet, -A[2] * invDet, A[0] * invDet];
}

/** 2x2 identity matrix. */
const IDENTITY_2: Mat2 = [1, 0, 0, 1];

/** Create a 2x2 diagonal matrix. */
function mat2Diag(d: number): Mat2 {
	return [d, 0, 0, d];
}

/** Subtract two 2-vectors. */
function vec2Sub(a: Vec2, b: Vec2): Vec2 {
	return [a[0] - b[0], a[1] - b[1]];
}

/** Add two 2-vectors. */
function vec2Add(a: Vec2, b: Vec2): Vec2 {
	return [a[0] + b[0], a[1] + b[1]];
}

/** Subtract B from A (matrix). */
function mat2Sub(A: Mat2, B: Mat2): Mat2 {
	return [A[0] - B[0], A[1] - B[1], A[2] - B[2], A[3] - B[3]];
}

// ─── Observation → Guna Mapping ──────────────────────────────────────────────

/**
 * Influence matrix: maps 6 observation signals to 3 guna affinities.
 *
 * Each row is a guna [sattva, rajas, tamas].
 * Each column is an observation signal.
 * Positive = observation pushes guna up, negative = pushes down.
 *
 * Columns: errorRate, tokenVelocity, loopCount, latency, successRate, userSatisfaction
 *
 * After multiplication, we get raw guna affinities which we project
 * onto the simplex via softmax.
 */
const INFLUENCE_MATRIX: [
	[number, number, number, number, number, number],
	[number, number, number, number, number, number],
	[number, number, number, number, number, number],
] = [
	// sattva: boosted by success + satisfaction, hurt by errors + latency
	[-0.8, -0.1,  -0.2,  -0.3,   0.9,   0.8],
	// rajas: boosted by token velocity + loop count, moderate error
	[ 0.0,  0.8,   0.6,   0.1,  -0.1,  -0.2],
	// tamas: boosted by errors + latency + extreme loops, hurt by success
	[ 0.9,  -0.1,  0.4,   0.8,  -0.7,  -0.5],
];

/**
 * Map a TrigunaObservation to a measured guna composition on the simplex.
 *
 * 1. Multiply the influence matrix by the observation vector.
 * 2. Apply softmax to project onto the simplex.
 */
function observationToGuna(obs: TrigunaObservation): [number, number, number] {
	const signals = [
		obs.errorRate,
		obs.tokenVelocity,
		obs.loopCount,
		obs.latency,
		obs.successRate,
		obs.userSatisfaction,
	];

	// Matrix-vector product: affinities[i] = sum_j INFLUENCE_MATRIX[i][j] * signals[j]
	const affinities: [number, number, number] = [0, 0, 0];
	for (let i = 0; i < 3; i++) {
		let sum = 0;
		for (let j = 0; j < 6; j++) {
			sum += INFLUENCE_MATRIX[i][j] * signals[j];
		}
		affinities[i] = sum;
	}

	// Softmax for simplex projection
	const maxAff = Math.max(affinities[0], affinities[1], affinities[2]);
	const e0 = Math.exp(affinities[0] - maxAff);
	const e1 = Math.exp(affinities[1] - maxAff);
	const e2 = Math.exp(affinities[2] - maxAff);
	const total = e0 + e1 + e2;

	return [e0 / total, e1 / total, e2 / total];
}

// ─── Clamp to Simplex ────────────────────────────────────────────────────────

/** Ensure all components are >= floor and sum to 1. */
function clampToSimplex(
	x1: number, x2: number, x3: number, floor: number,
): [number, number, number] {
	let s = Math.max(x1, floor);
	let r = Math.max(x2, floor);
	let t = Math.max(x3, floor);
	const sum = s + r + t;
	s /= sum;
	r /= sum;
	t /= sum;
	return [s, r, t];
}

// ─── Triguna Class ───────────────────────────────────────────────────────────

/**
 * Simplex-constrained Kalman filter for system health monitoring.
 *
 * Tracks the three gunas (sattva, rajas, tamas) as a composition on
 * the 2-simplex, using ILR coordinates for Kalman updates and mapping
 * back to the simplex after each step.
 */
export class Triguna {
	private config: TrigunaConfig;
	private onEvent?: (event: string, data: unknown) => void;

	// ─── Kalman State (in ILR space R²) ──────────────────────────────────

	/** State estimate in ILR coordinates. */
	private xHat: Vec2;

	/** Error covariance in ILR coordinates (2x2). */
	private P: Mat2;

	/** Process noise covariance Q (2x2 diagonal). */
	private Q: Mat2;

	/** Measurement noise covariance R (2x2 diagonal). */
	private R: Mat2;

	// ─── Simplex State ───────────────────────────────────────────────────

	/** Current guna state on the simplex. */
	private gunaState: GunaState;

	/** Previous dominant guna (for shift detection). */
	private prevDominant: GunaLabel;

	// ─── History ─────────────────────────────────────────────────────────

	/** Ring buffer of recent guna snapshots. */
	private history: GunaSnapshot[] = [];

	constructor(
		config?: Partial<TrigunaConfig>,
		onEvent?: (event: string, data: unknown) => void,
	) {
		this.config = { ...DEFAULT_TRIGUNA_CONFIG, ...config };
		this.onEvent = onEvent;

		// Clamp maxHistory to system ceiling
		this.config.maxHistory = Math.min(
			this.config.maxHistory,
			SYSTEM_MAX_TRIGUNA_HISTORY,
		);

		// Initialize simplex state
		const [s, r, t] = clampToSimplex(
			this.config.initialState[0],
			this.config.initialState[1],
			this.config.initialState[2],
			this.config.simplexFloor,
		);
		this.gunaState = { sattva: s, rajas: r, tamas: t };

		// Initialize ILR coordinates from the initial simplex state
		this.xHat = ilrForward(s, r, t);

		// Initialize covariance as identity (unit uncertainty in ILR space)
		this.P = IDENTITY_2;

		// Process and measurement noise
		this.Q = mat2Diag(this.config.processNoise);
		this.R = mat2Diag(this.config.measurementNoise);

		// Initial dominant
		this.prevDominant = this.computeDominant();

		// Record initial snapshot
		this.recordSnapshot();
	}

	// ─── Public API ──────────────────────────────────────────────────────

	/**
	 * Update the Triguna state with a new observation.
	 *
	 * Runs one predict/update cycle of the simplex Kalman filter.
	 * Returns the updated guna state. Guaranteed <1ms.
	 */
	update(observation: TrigunaObservation): GunaState {
		// 1. Map observation to a guna composition on the simplex
		const [zS, zR, zT] = observationToGuna(observation);

		// 2. Clamp measurement to avoid log(0)
		const [mS, mR, mT] = clampToSimplex(
			zS, zR, zT, this.config.simplexFloor,
		);

		// 3. Convert measurement to ILR space
		const zIlr = ilrForward(mS, mR, mT);

		// 4. Kalman predict step
		//    State transition is identity (random walk model):
		//    x̂⁻ = F * x̂  where F = I
		//    P⁻  = F * P * F' + Q = P + Q
		const xPred = this.xHat; // F = I, so no change
		const pPred = mat2Add(this.P, this.Q);

		// 5. Kalman update step
		//    Observation model: z = H * x + v  where H = I (direct observation in ILR)
		//    Innovation: ỹ = z - H * x̂⁻ = z - x̂⁻
		const innovation = vec2Sub(zIlr, xPred);

		//    Innovation covariance: S = H * P⁻ * H' + R = P⁻ + R
		const S = mat2Add(pPred, this.R);

		//    Kalman gain: K = P⁻ * H' * S⁻¹ = P⁻ * S⁻¹
		const sInv = mat2Inverse(S);
		if (sInv === null) {
			// Singular — skip this update (should be astronomically rare)
			return this.getState();
		}
		const K = mat2Mul(pPred, sInv);

		//    Updated state: x̂ = x̂⁻ + K * ỹ
		this.xHat = vec2Add(xPred, mat2MulVec(K, innovation));

		//    Updated covariance: P = (I - K*H) * P⁻ = (I - K) * P⁻
		//    Using Joseph form for numerical stability:
		//    P = (I - KH)P⁻(I - KH)' + KRK'
		const ImKH = mat2Sub(IDENTITY_2, K);
		const ImKHT = mat2Transpose(ImKH);
		const KT = mat2Transpose(K);
		this.P = mat2Add(
			mat2Mul(mat2Mul(ImKH, pPred), ImKHT),
			mat2Mul(mat2Mul(K, this.R), KT),
		);

		// 6. Map back to simplex
		const [newS, newR, newT] = ilrInverse(this.xHat[0], this.xHat[1]);
		const [cs, cr, ct] = clampToSimplex(newS, newR, newT, this.config.simplexFloor);

		this.gunaState = { sattva: cs, rajas: cr, tamas: ct };

		// 7. Record snapshot and check thresholds
		this.recordSnapshot();
		this.checkThresholds();

		return this.getState();
	}

	/** Get the current guna state (frozen copy). */
	getState(): GunaState {
		return { ...this.gunaState };
	}

	/** Get the dominant guna. */
	getDominant(): GunaLabel {
		return this.computeDominant();
	}

	/** Get the recent state history. */
	getHistory(limit?: number): GunaSnapshot[] {
		const n = limit ?? this.history.length;
		return this.history.slice(-n).map((snap) => ({
			state: { ...snap.state },
			timestamp: snap.timestamp,
			dominant: snap.dominant,
		}));
	}

	/**
	 * Compute the directional trend for each guna over the recent window.
	 *
	 * Uses simple linear regression slope over the last `trendWindow`
	 * snapshots. If the absolute change exceeds `trendThreshold`, the
	 * guna is "rising" or "falling"; otherwise "stable".
	 */
	getTrend(): GunaTrend {
		const window = this.config.trendWindow;
		const threshold = this.config.trendThreshold;
		const recent = this.history.slice(-window);

		if (recent.length < 2) {
			return { sattva: "stable", rajas: "stable", tamas: "stable" };
		}

		return {
			sattva: computeTrendDirection(recent, "sattva", threshold),
			rajas: computeTrendDirection(recent, "rajas", threshold),
			tamas: computeTrendDirection(recent, "tamas", threshold),
		};
	}

	/** Reset to initial state. Clears history. */
	reset(): void {
		const [s, r, t] = clampToSimplex(
			this.config.initialState[0],
			this.config.initialState[1],
			this.config.initialState[2],
			this.config.simplexFloor,
		);
		this.gunaState = { sattva: s, rajas: r, tamas: t };
		this.xHat = ilrForward(s, r, t);
		this.P = IDENTITY_2;
		this.history = [];
		this.prevDominant = this.computeDominant();
		this.recordSnapshot();
	}

	// ─── Serialization ──────────────────────────────────────────────────

	/** Serialize the Triguna state for persistence. */
	serialize(): TrigunaSerializedState {
		return {
			gunaState: { ...this.gunaState },
			xHat: [...this.xHat],
			P: [...this.P],
			prevDominant: this.prevDominant,
			history: this.history.map((snap) => ({
				state: { ...snap.state },
				timestamp: snap.timestamp,
				dominant: snap.dominant,
			})),
		};
	}

	/** Restore a Triguna from serialized state. */
	static deserialize(
		state: TrigunaSerializedState,
		config?: Partial<TrigunaConfig>,
		onEvent?: (event: string, data: unknown) => void,
	): Triguna {
		const instance = new Triguna(config, onEvent);

		instance.gunaState = { ...state.gunaState };
		instance.xHat = [state.xHat[0], state.xHat[1]];
		instance.P = [state.P[0], state.P[1], state.P[2], state.P[3]];
		instance.prevDominant = state.prevDominant;
		instance.history = state.history.map((snap) => ({
			state: { ...snap.state },
			timestamp: snap.timestamp,
			dominant: snap.dominant,
		}));

		return instance;
	}

	// ─── Internal ────────────────────────────────────────────────────────

	/** Determine which guna currently dominates. */
	private computeDominant(): GunaLabel {
		const { sattva, rajas, tamas } = this.gunaState;
		if (sattva >= rajas && sattva >= tamas) return "sattva";
		if (rajas >= sattva && rajas >= tamas) return "rajas";
		return "tamas";
	}

	/** Record a snapshot into the history ring buffer. */
	private recordSnapshot(): void {
		this.history.push({
			state: { ...this.gunaState },
			timestamp: Date.now(),
			dominant: this.computeDominant(),
		});

		// Trim to maxHistory
		if (this.history.length > this.config.maxHistory) {
			this.history.splice(0, this.history.length - this.config.maxHistory);
		}
	}

	/** Check behavioral thresholds and emit events. */
	private checkThresholds(): void {
		const { sattva, rajas, tamas } = this.gunaState;
		const dominant = this.computeDominant();

		// Guna shift detection
		if (dominant !== this.prevDominant && this.onEvent) {
			this.onEvent("triguna:guna_shift", {
				from: this.prevDominant,
				to: dominant,
				state: this.getState(),
			});
		}

		// Threshold events
		if (sattva > this.config.sattvaThreshold && this.onEvent) {
			this.onEvent("triguna:sattva_dominant", {
				sattva,
				message: "System healthy — clarity and balance prevail",
			});
		}

		if (rajas > this.config.rajasThreshold && this.onEvent) {
			this.onEvent("triguna:rajas_alert", {
				rajas,
				message: "System hyperactive — consider reducing parallelism",
			});
		}

		if (tamas > this.config.tamasThreshold && this.onEvent) {
			this.onEvent("triguna:tamas_alert", {
				tamas,
				message: "System degraded — suggest recovery actions",
			});
		}

		this.prevDominant = dominant;
	}
}

// ─── Serialization Types ─────────────────────────────────────────────────────

/** Serializable state for the Triguna system. */
export interface TrigunaSerializedState {
	gunaState: GunaState;
	xHat: [number, number];
	P: [number, number, number, number];
	prevDominant: GunaLabel;
	history: GunaSnapshot[];
}

// ─── Trend Computation ───────────────────────────────────────────────────────

/**
 * Compute a simple OLS slope over the guna values in the snapshot window,
 * then classify as rising/falling/stable.
 *
 * Uses the standard formula:
 *   slope = (n * Σ(xy) - Σx * Σy) / (n * Σ(x²) - (Σx)²)
 *
 * where x is the index (0, 1, 2, ...) and y is the guna value.
 */
function computeTrendDirection(
	snapshots: GunaSnapshot[],
	guna: keyof GunaState,
	threshold: number,
): TrendDirection {
	const n = snapshots.length;
	if (n < 2) return "stable";

	// Use centered X coordinates for numerical stability at large n
	const meanX = (n - 1) / 2;
	let meanY = 0;
	for (let i = 0; i < n; i++) meanY += snapshots[i].state[guna];
	meanY /= n;

	let slopeNum = 0;
	let slopeDen = 0;
	for (let i = 0; i < n; i++) {
		const dx = i - meanX;
		const dy = snapshots[i].state[guna] - meanY;
		slopeNum += dx * dy;
		slopeDen += dx * dx;
	}

	if (Math.abs(slopeDen) < 1e-15) return "stable";

	const slope = slopeNum / slopeDen;

	// Scale slope by window size to get total change over window
	const totalChange = slope * (n - 1);

	if (totalChange > threshold) return "rising";
	if (totalChange < -threshold) return "falling";
	return "stable";
}
