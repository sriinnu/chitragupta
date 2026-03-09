# Research Anchors and Validation

This document maps published research to Chitragupta subsystems.

It should be read as a traceability map, not a blanket derivation claim. Some rows point to direct algorithmic anchors, some to heuristic influences, and some to survey or validation literature that supports the architectural shape.

## How to read this document

| Relation | Meaning in this repo |
| --- | --- |
| Direct algorithmic anchor | The repo implements the named algorithm or a close mathematical primitive directly |
| Heuristic adaptation | The paper informs a heuristic, scoring method, or subsystem design, but the implementation is repo-specific |
| Architecture reference | The paper provides a design analogy, taxonomy, or systems pattern used to frame the subsystem |
| Survey / validation | The paper is mainly used to validate that the subsystem shape matches active research directions |

## Lineage boundary

Chitragupta shares some ecosystem-level concerns with adjacent agent platforms, including CLI, session, and operator-workflow patterns that also appear in projects such as pi-mono.

That does not make the Sanskrit cognitive stack a derivative of pi-mono. Smriti, Akasha, Lucy, Scarlett, Nidra, Buddhi, and related subsystem compositions are Chitragupta-native, while the papers below provide external grounding for parts of the design space.

---

## Memory and Consolidation

| Paper | Year | Key Insight | Module | Relation |
|-------|------|-------------|--------|----------|
| MemEvolve (2512.18746) | 2025 | Dynamic memory evolution with self-reflection | Vasana Engine | Heuristic adaptation |
| MemGAS (2505.19549) | 2025 | Generalization-aware memory selection | Swapna Recombination | Heuristic adaptation |
| Self-Evolving Agents (2409.00872) | 2024 | Continuous self-improvement from experience | Karma-Samskara-Vasana loop | Architecture reference |
| AI Hippocampus (2601.09113) | 2026 | Comprehensive memory taxonomy | 3-type memory separation | Survey / validation |
| Memory in Age of AI Agents (2512.13564) | 2025 | Survey: implicit/explicit/agentic memory | Architecture validation | Survey / validation |
| G-Memory (2506.07398) | 2025 | Hierarchical insight graphs for multi-agent | Akasha shared field | Architecture reference |
| SEDM (2509.09498) | 2025 | Self-evolving distributed memory with verification | Samiti + Sabha | Architecture reference |
| Emergent Collective Memory (2512.10166) | 2025 | Environmental traces -> group intelligence | Stigmergic traces | Architecture reference |
| AriGraph (2407.04363) | 2024 | Unified semantic + episodic graph | GraphRAG | Architecture reference |
| SEEM (2601.06411) | 2026 | Graph + episodic with cognitive frames | Procedural memory | Architecture reference |
| Memp (2508.06433) | 2025 | Distill trajectories into instructions | Vidhi extraction | Heuristic adaptation |
| ReMe (2512.10696) | 2025 | Context-adaptive reuse + utility refinement | Vasana valence | Heuristic adaptation |
| LatentMem (2602.03036) | 2026 | Learnable agent-specific memory | Pratyabhijna | Architecture reference |

---

## Metacognition and Self-Awareness

| Paper | Year | Key Insight | Module | Relation |
|-------|------|-------------|--------|----------|
| KnowSelf (2504.03553) | 2025 | Agents know when they know vs need tools | Viveka grounding | Architecture reference |
| MetaMind (2505.18943) | 2025 | Multi-agent Theory of Mind | Sabha deliberation | Architecture reference |
| ReMA (2503.09501) | 2025 | Decoupled strategic + detailed reasoning | Buddhi framework | Heuristic adaptation |
| Metacognition taxonomy (2504.20084) | 2025 | Self-awareness, social awareness | Triguna + Nava Rasa | Survey / validation |

---

## Proactive and Predictive Agents

| Paper | Year | Key Insight | Module | Relation |
|-------|------|-------------|--------|----------|
| Proactive Agent (2410.12361) | 2024 | Anticipate user needs from patterns | Kartavya pipeline | Architecture reference |
| ContextAgent (2505.14668) | 2025 | Context-aware proactive execution | Niyama promotion | Architecture reference |

---

## Model Routing and Cost Optimization

| Paper | Year | Key Insight | Module | Relation |
|-------|------|-------------|--------|----------|
| LLM Bandit (2502.02743) | 2025 | Contextual bandits for model selection, 40-70% cost reduction | Turiya router | Direct algorithmic anchor |
| Universal Model Routing (2502.08773) | 2025 | Task-feature routing across model families | Turiya context vector | Heuristic adaptation |
| PILOT (2508.21141) | 2025 | Cost-optimized routing with quality guarantees | Turiya constraints | Heuristic adaptation |

---

## Tool and Skill Evolution

| Paper | Year | Key Insight | Module | Relation |
|-------|------|-------------|--------|----------|
| SkillWeaver (2504.07079) | 2025 | Autonomous skill synthesis as APIs | Vidhi + Vidhya | Architecture reference |
| SAGE (2512.17102) | 2025 | RL-driven self-improvement | Vasana reinforcement | Heuristic adaptation |
| Yunjue Agent (2601.18226) | 2026 | Zero-start self-evolving tool creation | Samskaara -> tool pipeline | Architecture reference |

---

## Safety and Guardrails

| Paper | Year | Key Insight | Module | Relation |
|-------|------|-------------|--------|----------|
| AgentDoG (2601.18491) | 2026 | Diagnostic guardrail with root cause analysis | Lokapala + Rta | Architecture reference |
| ShieldAgent (2503.22738) | 2025 | Logical reasoning + probabilistic rule circuits | Dharma extension | Architecture reference |
| WALL-E 2.0 (2504.15785) | 2025 | NeuroSymbolic world model | Causal dependency graph | Architecture reference |

---

## Neuroscience-Inspired

| Paper | Year | Key Insight | Module | Relation |
|-------|------|-------------|--------|----------|
| Hippocampal pattern separation (2504.10739) | 2025 | Pattern separation + completion | Swapna replay | Heuristic adaptation |
| Multi-timescale memory (2508.10824) | 2025 | Surprise-gated updates | Surprise scoring (Phase 1) | Heuristic adaptation |
| Compressed replay (1910.02509) | 2019 | Prevent catastrophic forgetting | Swapna compress | Architecture reference |
| Dual-speed learning (2011.05438) | 2020 | Fast trace + slow integration | Session buffer -> long-term graph | Architecture reference |

---

## Causal and World Models

| Paper | Year | Key Insight | Module | Relation |
|-------|------|-------------|--------|----------|
| Code World Model (2510.02387) | 2025 | Causal models of codebases | Causal dependency graph | Architecture reference |
| Lifelong Learning (2501.07278) | 2025 | Continuous learning without forgetting | Anadi (beginningless) loop | Architecture reference |
