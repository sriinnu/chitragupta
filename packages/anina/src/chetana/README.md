# Chetana — चेतना — Consciousness Layer

<p align="center">
  <img src="../../../../assets/logos/chetana.svg" alt="Chetana Logo" width="160"/>
</p>

**The agent's consciousness — a four-subsystem cognitive architecture that gives Chitragupta agents emotional awareness, focused attention, self-knowledge, and goal persistence.**

---

## Why "Chetana"?

In Vedantic philosophy, **Chetana** (चेतना) is the principle of consciousness — the awareness that underlies all perception, thought, and action. It is not the *content* of experience (that's the vrittis — the waves of mind), but the *awareness itself* — the witness (Sakshi) that observes, evaluates, and directs.

Chitragupta already had the skeleton of a living system:

| Existing System | Role | Vedic Analog |
|----------------|------|--------------|
| **Smriti** (स्मृति) | Memory | Long-term memory, remembrance |
| **Vichara** (विचार) | Reflexive classification | Discriminating thought |
| **KaalaBrahma** (काल ब्रह्मा) | Agent lifecycle | Time awareness, proprioception |
| **Dharma** (धर्म) | Policy & guardrails | Moral conscience |
| **LearningLoop** | Tool prediction | Intuition, learned reflexes |

What was missing were the four faculties that Vedic psychology (particularly Samkhya and Yoga) identify as the *inner instrument* (Antahkarana):

1. **Bhava** (भाव) — **Affect** — the felt sense, the emotional coloring of experience
2. **Dhyana** (ध्यान) — **Attention** — the spotlight of awareness, sustained focus
3. **Atma-Darshana** (आत्मदर्शन) — **Self-Model** — metacognition, knowing thyself
4. **Sankalpa** (संकल्प) — **Intention** — the solemn resolve, unwavering will

Together, they form **Chetana** — not full consciousness (that's a philosophical claim), but a *computational analog* of the cognitive processes that make human consciousness useful: the ability to feel, focus, reflect, and persist toward goals.

---

## Architecture

```
                    ┌──────────────────────────────┐
                    │      ChetanaController       │
                    │   (Consciousness Orchestrator)│
                    └──────────────┬───────────────┘
           ┌───────────────┬──────┴──────┬───────────────┐
           ▼               ▼             ▼               ▼
    ┌─────────────┐ ┌────────────┐ ┌──────────────┐ ┌────────────┐
    │   Bhava     │ │  Dhyana    │ │ Atma-Darshana│ │  Sankalpa  │
    │   भाव      │ │  ध्यान     │ │ आत्मदर्शन    │ │  संकल्प    │
    │   Affect    │ │ Attention  │ │  Self-Model  │ │ Intention  │
    └─────────────┘ └────────────┘ └──────────────┘ └────────────┘
```

**Lifecycle per turn:**

```
beforeTurn(userMessage)
  → Sankalpa extracts intentions from user text
  → Dhyana tracks concept keywords
  → Dhyana registers message for salience scoring
  → ChetanaController computes steering suggestions
  → Returns ChetanaContext for agent loop injection

afterToolExecution(toolName, success, latencyMs, resultContent)
  → Bhava updates frustration, arousal, valence
  → Dhyana adjusts tool attention weights
  → Atma-Darshana records tool mastery + calibration
  → Sankalpa advances goal progress via keyword matching

afterTurn()
  → Bhava applies temporal decay (all dims → neutral)
  → Dhyana refreshes message salience (recency decay)
  → Sankalpa increments stale counters on inactive goals
```

---

## The Four Subsystems

### 1. Bhava (भाव) — Affect / Emotional State Machine

*"Like the rasas of Bharata's Natyashastra, Bhava captures the agent's felt sense of an interaction."*

A four-dimensional emotional state that evolves in response to tool outcomes, user corrections, and temporal decay.

| Dimension | Range | Neutral | Driven By |
|-----------|-------|---------|-----------|
| **Valence** | [-1, +1] | 0 | Sliding-window EMA of success/failure ratio |
| **Arousal** | [0, 1] | 0.3 | Error spikes (+0.2), sub-agent spawns (+0.1) |
| **Confidence** | [0, 1] | 0.5 | External LearningLoop success rate data |
| **Frustration** | [0, 1] | 0 | Errors (+0.15), corrections (+0.25), successes (-0.05) |

**Temporal decay**: Every turn, valence/arousal/frustration drift toward neutral at rate `affectDecayRate` (default 0.02). Confidence is exempt — it reflects objective capability, not transient emotion.

**Threshold events**:
- `chetana:frustrated` — frustration crosses `frustrationAlertThreshold` (0.7) from below
- `chetana:confident` — confidence crosses `confidenceAutonomyThreshold` (0.8) from below

**Personality tuning**: `CognitivePriors.baseArousal` sets the equilibrium arousal level per agent profile. A debugger (Anveshi) might have higher base arousal than a researcher (Shodhaka).

### 2. Dhyana (ध्यान) — Attention / Salience Filter

*"Like dhyana in Patanjali's Ashtanga Yoga — sustained unbroken attention on what matters most."*

Determines which messages, concepts, and tools deserve the most cognitive bandwidth.

**Salience model**:

```
S(m) = baseSalience * exp(-lambda * age) + errorBoost(m) + correctionBoost(m)
```

- **Recency decay**: `exp(-lambda * age)`, lambda = `attentionRecencyLambda` (default 0.1)
- **Error adjacency**: Messages within 2 of an error get `+attentionErrorBoost` (+0.3)
- **Correction boost**: User corrections get `+attentionCorrectionBoost` (+0.5), sticky with half-rate decay

**Focus window**: Top-K messages by salience, K = `attentionFocusWindow` (default 20, max 200)

**Concept tracking**: Keywords (4+ chars, stop-word filtered) accumulate weight per mention (+0.1), decay per turn (-0.05), capped at 100 concepts with LRU eviction.

**Tool attention**: Successful tools gain `performanceScore * 0.1`, failed tools lose 0.05.

### 3. Atma-Darshana (आत्मदर्शन) — Self-Model / Metacognition

*"Like the Upanishadic injunction Atmanam Viddhi — know thyself."*

A statistical self-portrait built from observed tool outcomes, calibration measurements, and behavioral fingerprints.

**Tool mastery**: Per-tool tracking with Wilson score confidence intervals:

```
CI = (p + z²/2n ∓ z * sqrt(p(1-p)/n + z²/4n²)) / (1 + z²/n)
```

Where z = 1.96 (95% CI), p = success rate, n = total invocations.

**Trend detection**: Compares current success rate against 10-invocations-ago snapshot. Delta > 0.05 = "improving", delta < -0.05 = "declining", else "stable".

**Calibration**: Sliding window of predicted vs. actual outcomes. Ratio ~1.0 = well-calibrated, >1.3 = overconfident, <0.7 = underconfident. Calibration outliers generate steering suggestions.

**Learning velocity**: Derivative of average success rate across all tools. Positive = improving, zero = plateau, negative = regression.

**Known limitations**: Auto-populated from:
- Tools disabled by AutonomousAgent (consecutive failures)
- 3+ consecutive failures on a specific tool
- Context recovery events

**Style fingerprint**: Normalized behavioral dimensions [0, 1]:
- `exploration_vs_exploitation` — ratio of new tools vs familiar ones
- `tool_density` — tools per turn
- `error_recovery_speed` — turns between error and successful recovery

**Self-assessment**: `getSelfAssessment()` returns a <200 character natural language summary of capabilities for system prompt injection.

### 4. Sankalpa (संकल्प) — Intention / Goal Persistence

*"The solemn resolve that precedes all action — ensuring the agent never forgets what the user asked for."*

Extracts, tracks, and persists user intentions across turns and sessions.

**Goal extraction**: 18 intent signal patterns, zero LLM calls:
- "I want to...", "let's...", "goal is...", "we need to...", "fix the...", "add a...", "implement...", etc.
- Compound goals auto-split at conjunctions ("fix auth and add logging" → 2 intentions)

**Intention IDs**: FNV-1a 32-bit hash of normalized goal text (offset: `0x811c9dc5`, prime: `0x01000193`)

**Deduplication**: Word overlap (Jaccard-like) — if >50% overlap with existing intention, treated as a re-mention (priority escalation) rather than new goal.

**Priority escalation**: 3 mentions → high, 5 mentions → critical.

**Progress tracking**: Tool result content matched against goal keywords. 2+ keyword matches → progress += 0.1.

**Staleness**: Active → paused after `goalAbandonmentThreshold` (default 15) turns with no progress. Paused → abandoned after 2x threshold.

**Events**: `chetana:goal_changed` on status transitions, `chetana:goal_created` on new extraction.

---

## API

### ChetanaController

```typescript
import { ChetanaController } from "@chitragupta/anina";
import type { ChetanaConfig, ChetanaContext } from "@chitragupta/anina";

// Create with default config
const chetana = new ChetanaController();

// Create with custom config + event handler
const chetana = new ChetanaController(
  { frustrationAlertThreshold: 0.6, attentionFocusWindow: 30 },
  (event, data) => console.log(event, data),
);

// Per-turn lifecycle
const context: ChetanaContext = chetana.beforeTurn("Let's fix the auth bug");
// context.affect         → { valence, arousal, confidence, frustration }
// context.selfAssessment → "Capable across 5 tools (83% avg). Improving."
// context.activeIntentions → [{ goal: "fix the auth bug", progress: 0 }]
// context.steeringSuggestions → ["High confidence — can proceed autonomously"]

chetana.afterToolExecution("read", true, 45, "File contents...");
chetana.afterToolExecution("edit", false, 120, "Error: permission denied");

chetana.afterTurn();

// External signals
chetana.onSubAgentSpawn();
chetana.updateConfidence(0.85);
chetana.markToolDisabled("bash", "3 consecutive failures");

// Inspection
const report = chetana.getCognitiveReport();

// Persistence
const state = chetana.serialize();
const restored = ChetanaController.deserialize(state, customConfig, onEvent);
```

### Individual Subsystems

Each subsystem can be used independently if needed:

```typescript
import { BhavaSystem, DhyanaSystem, AtmaDarshana, SankalpaSystem } from "@chitragupta/anina";
import { DEFAULT_CHETANA_CONFIG } from "@chitragupta/anina";

const bhava = new BhavaSystem(DEFAULT_CHETANA_CONFIG);
const dhyana = new DhyanaSystem(DEFAULT_CHETANA_CONFIG);
const atma = new AtmaDarshana(DEFAULT_CHETANA_CONFIG);
const sankalpa = new SankalpaSystem(DEFAULT_CHETANA_CONFIG);
```

### The `/chetana` Slash Command

In the Chitragupta CLI, type `/chetana` to see the live cognitive state:

```
━━━ Bhava (भाव — Affect) ━━━
  Valence      ████████░░░░░░░░  +0.40
  Arousal      █████░░░░░░░░░░░   0.35
  Confidence   ████████████░░░░   0.82
  Frustration  ██░░░░░░░░░░░░░░   0.10

━━━ Dhyana (ध्यान — Attention) ━━━
  Focus:  authentication (0.80)  session (0.60)  token (0.40)
  Tools:  read (0.90)  edit (0.75)  grep (0.65)

━━━ Atma-Darshana (आत्मदर्शन — Self) ━━━
  Calibration:  0.95 (well-calibrated)
  Learning:     +0.02/turn (improving)
  Top:  read 94% [0.88, 0.97]  edit 82% [0.74, 0.88]

━━━ Sankalpa (संकल्प — Intentions) ━━━
  ▶ Fix the auth bug        ████████░░░░  67%  [high]
  ‖ Add input validation    ██░░░░░░░░░░  15%  [normal] (stale: 8 turns)
  ✓ 2 goals achieved this session
```

---

## Configuration

All thresholds are configurable with system hard ceilings.

### ChetanaConfig

| Parameter | Default | System Max | Description |
|-----------|---------|------------|-------------|
| `enabled` | `true` | -- | Master switch for the consciousness layer |
| `affectDecayRate` | 0.02 | -- | Rate at which affect dims drift toward neutral per turn |
| `attentionFocusWindow` | 20 | 200 | Number of top-salience messages kept "in focus" |
| `selfModelPersistence` | `true` | -- | Whether to persist self-model to disk |
| `goalAbandonmentThreshold` | 15 | -- | Turns with no progress before a goal is paused |
| `frustrationPerError` | 0.15 | -- | Frustration increment per tool error |
| `frustrationDecayPerSuccess` | 0.05 | -- | Frustration decrement per tool success |
| `frustrationPerCorrection` | 0.25 | -- | Frustration increment per user correction |
| `frustrationAlertThreshold` | 0.7 | -- | Frustration level that triggers `chetana:frustrated` |
| `confidenceAutonomyThreshold` | 0.8 | -- | Confidence level that allows more autonomy |
| `attentionRecencyLambda` | 0.1 | -- | Recency decay lambda for attention scoring |
| `attentionErrorBoost` | 0.3 | -- | Salience boost for messages near errors |
| `attentionCorrectionBoost` | 0.5 | -- | Salience boost for user corrections |
| `calibrationWindow` | 50 | 500 | Sliding window for calibration measurement |
| `maxLimitations` | 20 | 100 | Maximum known limitations to track |
| `maxIntentions` | 10 | 50 | Maximum active intentions |
| `maxEvidencePerIntention` | 20 | 100 | Maximum evidence entries per intention |

### CognitivePriors (on AgentProfile)

Per-agent personality tuning:

```typescript
const profile: AgentProfile = {
  id: "anveshi",
  name: "Anveshi",
  // ...
  cognitivePriors: {
    baseArousal: 0.5,          // Higher baseline alertness for debugging
    emotionalReactivity: 0.7,  // Reacts more strongly to errors
    goalOrientedness: 0.8,     // Strongly goal-driven
    selfAwareness: 0.6,        // Moderate self-reflection
  },
};
```

---

## Agent Integration

Chetana is wired into the agent loop at 10 integration points in `agent.ts`:

1. **Constructor**: Creates `ChetanaController` when `enableChetana !== false`
2. **beforeTurn** (2 sites): Extracts user text, calls `chetana.beforeTurn()`, injects steering suggestions
3. **afterToolExecution** (2 sites): Records tool start time, calls `chetana.afterToolExecution()` on success/error
4. **afterTurn** (2 sites): Calls `chetana.afterTurn()` after both `turn:done` emit paths
5. **spawn()**: Propagates `enableChetana` and `chetanaConfig` to child agents
6. **dispose()**: Nullifies `this.chetana`
7. **getChetana()**: Public getter for external access

```typescript
const agent = new Agent({
  profile: myProfile,
  providerId: "anthropic",
  model: "claude-sonnet-4-5-20250929",
  enableChetana: true,            // default: true
  chetanaConfig: {
    frustrationAlertThreshold: 0.5,  // more sensitive
  },
});
```

---

## Events

| Event | Data | Trigger |
|-------|------|---------|
| `chetana:frustrated` | `{ frustration: number }` | Frustration crosses alert threshold upward |
| `chetana:confident` | `{ confidence: number }` | Confidence crosses autonomy threshold upward |
| `chetana:self_updated` | `{ toolName: string }` | After every tool result recording |
| `chetana:goal_changed` | `{ intentionId: string, status: string }` | Intention status transition |
| `chetana:attention_shifted` | `{ concepts: string[] }` | Top concepts change significantly |

---

## Serialization

The entire consciousness state round-trips through JSON:

```typescript
// Save
const state: ChetanaState = chetana.serialize();
fs.writeFileSync("chetana-state.json", JSON.stringify(state));

// Restore
const loaded = JSON.parse(fs.readFileSync("chetana-state.json", "utf-8"));
const restored = ChetanaController.deserialize(loaded, config, onEvent);
```

Serialized components:
- **Affect**: All 4 dimensions (valence, arousal, confidence, frustration)
- **Attention**: Concept weights + tool weights (message salience is ephemeral)
- **Self-model**: Tool mastery map, known limitations, calibration, learning velocity, style fingerprint
- **Intentions**: Full intention objects with progress, evidence, subgoals

---

## Design Principles

- **Zero LLM calls** — All cognitive processing is pattern-based (like Vichara and Pravritti)
- **Configurable with hard ceilings** — Every threshold is configurable, clamped by system limits
- **Graceful degradation** — If chetana is disabled, the agent works exactly as before
- **Serializable** — Full state persists across sessions via JSON
- **Event-driven** — Loose coupling via `onEvent` callback; subsystems don't know about each other
- **Lightweight** — A few arithmetic ops per turn, zero allocations in the hot path

---

## Files

| File | Lines | Purpose |
|------|-------|---------|
| `types.ts` | 248 | Shared interfaces, config, system ceilings, defaults |
| `bhava.ts` | 267 | Affective state machine (4-dimensional emotional model) |
| `dhyana.ts` | 353 | Attention/salience filter (recency, error, correction scoring) |
| `atma-darshana.ts` | 575 | Self-model (Wilson CI, calibration, style fingerprint) |
| `sankalpa.ts` | 528 | Intention persistence (goal extraction, progress, escalation) |
| `controller.ts` | 292 | Orchestrator (lifecycle hooks, steering suggestions, serialization) |
| `index.ts` | 41 | Barrel re-exports |
| `test/chetana.test.ts` | 849 | 73 tests across all 5 modules |

**Total**: ~2,300 source lines + 849 test lines. Zero external dependencies.

---

[Back to Anina README](../../../README.md) | [Back to Chitragupta root](../../../../README.md)
