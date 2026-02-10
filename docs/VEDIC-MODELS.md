# Vedic Cognitive Models

Chitragupta maps 17 Vedic cognitive models to computational modules. The internal Sanskrit carries the dharma. Each model has a source text, a computational mapping, and a concrete implementation.

---

## The 17 Models

| # | Model | Sanskrit Source | What It Computes | Module |
|---|-------|---------------|-----------------|--------|
| I | **Antahkarana Chatushthaya** | Vivekachudamani, Gita 3.42 | Complete cognitive pipeline: Indriyas -> Manas -> Buddhi -> Ahamkara + Chitta | Yantra -> pre-classifier -> Buddhi -> Atma-Darshana + Smriti |
| II | **Vasana-Samskara-Karma** | Yoga Sutras 2.12-15 | Infinite self-evolution loop: action -> result -> impression -> tendency -> action | Chetana + Samskaara + Vasana Engine |
| III | **Chaturavastha** | Mandukya Upanishad 3-7 | Four states of consciousness: waking, dream, deep sleep, witness | Jagrat (active) / Svapna (consolidation) / Sushupti (archive) / Turiya (meta-observer) |
| IV | **Pancha Pramana** | Nyaya Sutras 1.1.3-7 | Epistemological confidence: how knowledge was acquired | 6-type Pramana classification on graph edges |
| V | **Pancha Vritti** | Yoga Sutras 1.5-11 | Data classification: valid / error / hypothetical / absence / memory | Vritti tagging on knowledge nodes |
| VI | **Triguna** | Bhagavad Gita Ch. 14 | System health as 3-vector: clarity, agitation, stagnation | Kalman filter tracking [sattva, rajas, tamas] |
| VII | **Nava Rasa** | Natyashastra (Bharata Muni) | 9 contextual emotional modes driving behavioral adaptation | Extended Bhava (Chetana) affect system |
| VIII | **Nyaya Panchavayava** | Nyaya Sutras 1.1.32-39 | Explainable reasoning via 5-step syllogism | Buddhi decision framework + Sabha deliberation |
| IX | **Kala Chakra** | Surya Siddhanta, Yoga Sutras 3.52 | Multi-scale temporal awareness: instant -> session -> day -> sprint -> year | Bi-temporal edges + multi-scale consolidation |
| X | **Sabha and Samiti** | Rig Veda 10.191.2-4, Arthashastra | Dual assembly: ambient channel + formal council | Sutra pub/sub + Sabha protocol |
| XI | **Lokapala** | Rig Veda (directional guardians) | Domain guardian agents: security, performance, correctness, convention, stability | 5 specialized always-on agents |
| XII | **Rta** | Rig Veda (cosmic order) | Invariant laws that nothing can override, separate from contextual Dharma | Rta invariant layer in Dharma |
| XIII | **Pratyabhijna** | Kashmir Shaivism (Utpaladeva) | Self-recognition: continuous identity across discrete sessions | Identity reconstruction on session start |
| XIV | **Viveka** | Vivekachudamani | Hallucination grounding: nitya (real) / anitya (provisional) / mithya (apparent but false) | Ontological classification on claims |
| XV | **Ishvara Pranidhana** | Yoga Sutras 2.45 | Principled deference: the agent knows when NOT to act | Guna + Pramana + competence boundary checks |
| XVI | **Akasha** | Vaisheshika school (Kanada) | Stigmergic shared knowledge field: agents leave traces others perceive | Graph-based pheromone traces |
| XVII | **Kartavya** | Dharmashastra | Predictive auto-execution: impression -> tendency -> rule -> duty | Samskara -> Vasana -> Niyama -> Kartavya pipeline |

---

## Naming Philosophy

Every package is named after a concept from Vedic Sanskrit — not arbitrarily, but because each word captures the *essence* of what that package does. If you understand the name, you understand the architecture.

> In Vedic tradition, naming is not labeling — it is *defining the nature of a thing*. The name carries the dharma (purpose) of what it represents.

| Layer | Language | Example |
|-------|----------|---------|
| Internal modules, types, algorithms | Sanskrit | `antahkarana.process()`, `samskaara.sanskriti()` |
| Public API, CLI commands, docs, errors | English | `agent.think()`, `memory.search("auth")` |

The Sanskrit carries the dharma internally. The English carries communication externally.
