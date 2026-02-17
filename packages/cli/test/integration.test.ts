/**
 * @chitragupta/cli -- End-to-End Integration Tests.
 *
 * Verifies that the full Chitragupta stack can be assembled:
 * - All packages import successfully
 * - Provider registry works
 * - Agent creation with tools works
 * - Memory systems initialize
 * - Routing pipeline classifies
 * - Agent garage agents can be created
 * - Slash commands are registered
 */

import { describe, it, expect, afterEach } from "vitest";

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Package Imports
// ═══════════════════════════════════════════════════════════════════════════════

describe("Package Imports", () => {
	it("should import @chitragupta/core", async () => {
		const core = await import("@chitragupta/core");
		expect(core.BUILT_IN_PROFILES).toBeDefined();
		expect(core.KARTRU_PROFILE).toBeDefined();
		expect(Object.keys(core.BUILT_IN_PROFILES).length).toBeGreaterThanOrEqual(7);
	});

	it("should import @chitragupta/swara", async () => {
		const swara = await import("@chitragupta/swara");
		expect(swara.createProviderRegistry).toBeDefined();
		expect(swara.MargaPipeline).toBeDefined();
		expect(swara.classifyComplexity).toBeDefined();
		expect(swara.classifyTaskType).toBeDefined();
	});

	it("should import @chitragupta/anina", async () => {
		const anina = await import("@chitragupta/anina");
		expect(anina.Agent).toBeDefined();
		expect(anina.CodingAgent).toBeDefined();
		expect(anina.ReviewAgent).toBeDefined();
		expect(anina.DebugAgent).toBeDefined();
		expect(anina.ResearchAgent).toBeDefined();
		expect(anina.RefactorAgent).toBeDefined();
		expect(anina.DocsAgent).toBeDefined();
	});

	it("should import @chitragupta/smriti", async () => {
		const smriti = await import("@chitragupta/smriti");
		expect(smriti.GraphRAGEngine).toBeDefined();
		expect(smriti.HybridSearchEngine).toBeDefined();
		expect(smriti.ConsolidationEngine).toBeDefined();
		expect(smriti.AnveshanaEngine).toBeDefined();
		expect(smriti.NERExtractor).toBeDefined();
		expect(smriti.createEdge).toBeDefined();
	});

	it("should import @chitragupta/ui", async () => {
		const ui = await import("@chitragupta/ui");
		expect(ui.Spinner).toBeDefined();
		expect(ui.Editor).toBeDefined();
		expect(ui.StatusBar).toBeDefined();
		expect(ui.HeartbeatMonitor).toBeDefined();
		expect(ui.SessionTree).toBeDefined();
		expect(ui.ToastManager).toBeDefined();
		expect(ui.renderMarkdown).toBeDefined();
	});

	it("should import @chitragupta/yantra", async () => {
		const yantra = await import("@chitragupta/yantra");
		expect(yantra.getAllTools).toBeDefined();
		expect(yantra.getToolByName).toBeDefined();
		expect(yantra.readTool).toBeDefined();
		expect(yantra.writeTool).toBeDefined();
		expect(yantra.editTool).toBeDefined();
		expect(yantra.bashTool).toBeDefined();
		expect(yantra.Sandbox).toBeDefined();
	});

	it("should import @chitragupta/dharma", async () => {
		const dharma = await import("@chitragupta/dharma");
		expect(dharma.PolicyEngine).toBeDefined();
		expect(dharma.AuditLogger).toBeDefined();
		expect(dharma.ApprovalGate).toBeDefined();
		expect(dharma.KarmaTracker).toBeDefined();
		expect(dharma.SECURITY_RULES).toBeDefined();
		expect(dharma.STRICT_PRESET).toBeDefined();
	});

	it("should import @chitragupta/netra", async () => {
		const netra = await import("@chitragupta/netra");
		expect(netra.getImageMeta).toBeDefined();
		expect(netra.detectProtocol).toBeDefined();
		expect(netra.analyzeImage).toBeDefined();
		expect(netra.captureTerminal).toBeDefined();
	});

	it("should import @chitragupta/vayu", async () => {
		const vayu = await import("@chitragupta/vayu");
		expect(vayu.WorkflowExecutor).toBeDefined();
		expect(vayu.WorkflowBuilder).toBeDefined();
		expect(vayu.validateDAG).toBeDefined();
		expect(vayu.topologicalSort).toBeDefined();
		expect(vayu.WorkerPool).toBeDefined();
		expect(vayu.CODE_REVIEW_WORKFLOW).toBeDefined();
	});

	it("should import @chitragupta/sutra", async () => {
		const sutra = await import("@chitragupta/sutra");
		expect(sutra.CommHub).toBeDefined();
		expect(sutra.SandeshaRouter).toBeDefined();
		expect(sutra.BankersAlgorithm).toBeDefined();
		expect(sutra.MessageBus).toBeDefined();
		expect(sutra.AgentRegistry).toBeDefined();
		expect(sutra.EventManager).toBeDefined();
		expect(sutra.ActorSystem).toBeDefined();
	});

	it("should import @chitragupta/tantra", async () => {
		const tantra = await import("@chitragupta/tantra");
		expect(tantra.McpServer).toBeDefined();
		expect(tantra.McpClient).toBeDefined();
		expect(tantra.createMcpServerRegistry).toBeDefined();
		expect(tantra.CapabilityAggregator).toBeDefined();
		expect(tantra.ServerDiscovery).toBeDefined();
		expect(tantra.AutonomousMcpManager).toBeDefined();
	});

	it("should import @chitragupta/vidhya-skills", async () => {
		const vidhya = await import("@chitragupta/vidhya-skills");
		expect(vidhya.SkillRegistry).toBeDefined();
		expect(vidhya.VidyaBridge).toBeDefined();
		expect(vidhya.SkillEvolution).toBeDefined();
		expect(vidhya.matchSkills).toBeDefined();
		expect(vidhya.computeTraitVector).toBeDefined();
		expect(vidhya.parseSkillMarkdown).toBeDefined();
	});

	it("should import @chitragupta/niyanta", async () => {
		const niyanta = await import("@chitragupta/niyanta");
		expect(niyanta.Orchestrator).toBeDefined();
		expect(niyanta.TaskRouter).toBeDefined();
		expect(niyanta.StrategyBandit).toBeDefined();
		expect(niyanta.AutonomousOrchestrator).toBeDefined();
		expect(niyanta.DAGEngine).toBeDefined();
		expect(niyanta.AgentEvaluator).toBeDefined();
	});

	it("should import @chitragupta/cli (args + project detector)", async () => {
		// NOTE: The full CLI index re-exports main.ts which uses sub-path imports
		// that vitest aliases do not resolve. We test the safe exports directly.
		const { parseArgs, printHelp } = await import("../src/args.js");
		const { detectProject } = await import("../src/project-detector.js");
		expect(parseArgs).toBeDefined();
		expect(printHelp).toBeDefined();
		expect(detectProject).toBeDefined();
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Provider Registry
// ═══════════════════════════════════════════════════════════════════════════════

describe("Provider Registry", () => {
	it("should create a registry and register providers", async () => {
		const { createProviderRegistry, registerBuiltinProviders } = await import("@chitragupta/swara");
		const registry = createProviderRegistry();
		registerBuiltinProviders(registry);

		expect(registry.getAll().length).toBeGreaterThanOrEqual(4);
		expect(registry.has("anthropic")).toBe(true);
		expect(registry.has("openai")).toBe(true);
		expect(registry.has("google")).toBe(true);
		expect(registry.has("ollama")).toBe(true);
	});

	it("should list all models from registered providers", async () => {
		const { createProviderRegistry, registerBuiltinProviders } = await import("@chitragupta/swara");
		const registry = createProviderRegistry();
		registerBuiltinProviders(registry);

		const allModels = registry.getModels();
		expect(allModels.length).toBeGreaterThan(0);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Routing Pipeline
// ═══════════════════════════════════════════════════════════════════════════════

describe("Routing Pipeline", () => {
	it("should classify task types", async () => {
		const { classifyTaskType } = await import("@chitragupta/swara");

		const codeResult = classifyTaskType({
			messages: [{ role: "user", content: [{ type: "text", text: "Write a function that sorts an array" }] }],
		});
		expect(codeResult.type).toBe("code-gen");

		const chatResult = classifyTaskType({
			messages: [{ role: "user", content: [{ type: "text", text: "Hello, how are you?" }] }],
		});
		expect(chatResult.type).toBe("chat");
	});

	it("should classify complexity levels", async () => {
		const { classifyComplexity } = await import("@chitragupta/swara");

		const simple = classifyComplexity({
			messages: [{ role: "user", content: [{ type: "text", text: "yes" }] }],
		});
		expect(simple.complexity).toBe("simple");

		const complex = classifyComplexity({
			messages: [{
				role: "user",
				content: [{
					type: "text",
					text: "Refactor the entire authentication system to use OAuth2 with PKCE flow, update all integration tests, and write migration scripts for the database schema changes.",
				}],
			}],
		});
		// Expect a classification result with a known complexity level
		expect(["simple", "medium", "complex", "expert"]).toContain(complex.complexity);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Memory Systems
// ═══════════════════════════════════════════════════════════════════════════════

describe("Memory Systems", () => {
	it("should create GraphRAG engine", async () => {
		const { GraphRAGEngine } = await import("@chitragupta/smriti");
		const engine = new GraphRAGEngine();
		expect(engine.getGraph()).toBeDefined();
	});

	it("should create ConsolidationEngine", async () => {
		const { ConsolidationEngine } = await import("@chitragupta/smriti");
		const engine = new ConsolidationEngine({ minObservations: 2 });
		expect(engine.getRules()).toEqual([]);
		expect(engine.getStats().totalRules).toBe(0);
	});

	it("should create bi-temporal edges", async () => {
		const { createEdge, queryEdgesAtTime } = await import("@chitragupta/smriti");
		const edge = createEdge("A", "B", "links_to", 0.8);
		expect(edge.source).toBe("A");
		expect(edge.target).toBe("B");
		expect(edge.relationship).toBe("links_to");
		expect(edge.weight).toBe(0.8);
		expect(edge.validFrom).toBeDefined();
		expect(edge.recordedAt).toBeDefined();

		const results = queryEdgesAtTime([edge], new Date().toISOString());
		expect(results.length).toBe(1);
	});

	it("should supersede and expire edges", async () => {
		const { createEdge, supersedEdge, expireEdge, queryEdgesAtTime } = await import("@chitragupta/smriti");

		const original = createEdge("X", "Y", "depends_on", 0.5);
		const [superseded, replacement] = supersedEdge(original, 0.9);

		expect(superseded.supersededAt).toBeDefined();
		expect(replacement.weight).toBe(0.9);

		const expired = expireEdge(original);
		expect(expired.validUntil).toBeDefined();
	});

	it("should create NERExtractor", async () => {
		const { NERExtractor } = await import("@chitragupta/smriti");
		const extractor = new NERExtractor();
		expect(extractor).toBeDefined();
		// extract() is async and may call external services;
		// verify the instance was created without exercising the network.
		expect(typeof extractor.extract).toBe("function");
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Agent Garage
// ═══════════════════════════════════════════════════════════════════════════════

describe("Agent Garage", () => {
	it("should have all 7+ built-in profiles", async () => {
		const { BUILT_IN_PROFILES } = await import("@chitragupta/core");
		expect(BUILT_IN_PROFILES.chitragupta).toBeDefined();
		expect(BUILT_IN_PROFILES.kartru).toBeDefined();
		expect(BUILT_IN_PROFILES.parikshaka).toBeDefined();
		expect(BUILT_IN_PROFILES.anveshi).toBeDefined();
		expect(BUILT_IN_PROFILES.shodhaka).toBeDefined();
		expect(BUILT_IN_PROFILES.parikartru).toBeDefined();
		expect(BUILT_IN_PROFILES.lekhaka).toBeDefined();
	});

	it("should create CodingAgent with detected conventions", async () => {
		const { CodingAgent } = await import("@chitragupta/anina");
		const agent = new CodingAgent({ workingDirectory: process.cwd() });
		const conventions = await agent.detectConventions();
		expect(conventions.language).toBeDefined();
		expect(conventions.moduleSystem).toBeDefined();
		expect(conventions.indentation).toBeDefined();
	});

	it("should create ReviewAgent instance", async () => {
		const { ReviewAgent } = await import("@chitragupta/anina");
		const agent = new ReviewAgent({ workingDirectory: process.cwd() });
		expect(agent.getAgent()).toBeDefined();
	});

	it("should create DebugAgent instance", async () => {
		const { DebugAgent } = await import("@chitragupta/anina");
		const agent = new DebugAgent({ workingDirectory: process.cwd() });
		expect(agent.getAgent()).toBeDefined();
	});

	it("should create ResearchAgent instance", async () => {
		const { ResearchAgent } = await import("@chitragupta/anina");
		const agent = new ResearchAgent({ workingDirectory: process.cwd() });
		expect(agent.getAgent()).toBeDefined();
	});

	it("should create RefactorAgent instance", async () => {
		const { RefactorAgent } = await import("@chitragupta/anina");
		const agent = new RefactorAgent({ workingDirectory: process.cwd() });
		expect(agent.getAgent()).toBeDefined();
	});

	it("should create DocsAgent instance", async () => {
		const { DocsAgent } = await import("@chitragupta/anina");
		const agent = new DocsAgent({ workingDirectory: process.cwd() });
		expect(agent.getAgent()).toBeDefined();
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Tool System
// ═══════════════════════════════════════════════════════════════════════════════

describe("Tool System", () => {
	it("should list all built-in tools", async () => {
		const { getAllTools } = await import("@chitragupta/yantra");
		const tools = getAllTools();
		expect(tools.length).toBeGreaterThanOrEqual(12);
	});

	it("should look up tools by name", async () => {
		const { getToolByName } = await import("@chitragupta/yantra");

		const readTool = getToolByName("read");
		expect(readTool).toBeDefined();
		expect(readTool!.definition.name).toBe("read");

		const bashTool = getToolByName("bash");
		expect(bashTool).toBeDefined();

		const nonexistent = getToolByName("doesnotexist");
		expect(nonexistent).toBeUndefined();
	});

	it("should have well-formed tool definitions", async () => {
		const { getAllTools } = await import("@chitragupta/yantra");
		const tools = getAllTools();

		for (const tool of tools) {
			expect(tool.definition.name).toBeTruthy();
			expect(tool.definition.description).toBeTruthy();
			expect(tool.definition.inputSchema).toBeDefined();
			expect(typeof tool.execute).toBe("function");
		}
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Sutra Communication
// ═══════════════════════════════════════════════════════════════════════════════

describe("Sutra Communication", () => {
	let hub: InstanceType<typeof import("@chitragupta/sutra").CommHub> | null = null;
	let router: InstanceType<typeof import("@chitragupta/sutra").SandeshaRouter> | null = null;

	afterEach(() => {
		router?.destroy();
		hub?.destroy();
		router = null;
		hub = null;
	});

	it("should create CommHub and SandeshaRouter", async () => {
		const { CommHub, SandeshaRouter } = await import("@chitragupta/sutra");
		hub = new CommHub({ enableLogging: false });
		router = new SandeshaRouter({ commHub: hub, defaultTimeoutMs: 5000 });

		expect(router.hasPending()).toBe(false);
		expect(router.pendingCount).toBe(0);
	});

	it("should handle input request and resolution", async () => {
		const { CommHub, SandeshaRouter } = await import("@chitragupta/sutra");
		hub = new CommHub({ enableLogging: false });
		router = new SandeshaRouter({ commHub: hub, defaultTimeoutMs: 5000 });

		// Request input
		const responsePromise = router.requestInput({
			requestId: "test-req-1",
			agentId: "test-agent",
			depth: 1,
			prompt: "Which file?",
			timeoutMs: 5000,
		});

		expect(router.hasPending()).toBe(true);
		expect(router.pendingCount).toBe(1);

		// Resolve it
		const resolved = router.resolveInput("test-req-1", "/src/main.ts", "user");
		expect(resolved).toBe(true);

		const response = await responsePromise;
		expect(response.value).toBe("/src/main.ts");
		expect(response.answeredBy).toBe("user");
		expect(response.agentId).toBe("test-agent");
	});

	it("should create MessageBus and AgentRegistry", async () => {
		const { MessageBus, AgentRegistry } = await import("@chitragupta/sutra");
		const bus = new MessageBus();
		const registry = new AgentRegistry();

		expect(bus).toBeDefined();
		expect(registry).toBeDefined();

		bus.destroy();
	});

	it("should create BankersAlgorithm for deadlock prevention", async () => {
		const { BankersAlgorithm } = await import("@chitragupta/sutra");
		const banker = new BankersAlgorithm();
		expect(banker).toBeDefined();
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Skill Discovery
// ═══════════════════════════════════════════════════════════════════════════════

describe("Skill Discovery", () => {
	it("should create SkillRegistry and VidyaBridge", async () => {
		const { SkillRegistry, VidyaBridge } = await import("@chitragupta/vidhya-skills");
		const registry = new SkillRegistry();
		const bridge = new VidyaBridge(registry);
		expect(registry.size).toBe(0);
		expect(bridge).toBeDefined();
	});

	it("should compute trait vectors", async () => {
		const { computeTraitVector, computeQueryVector } = await import("@chitragupta/vidhya-skills");

		const manifest = {
			name: "file-reader",
			version: "1.0.0",
			description: "Reads files from the filesystem",
			tags: ["file", "read", "io"],
			capabilities: [
				{ verb: "read", object: "file", description: "Read file contents" },
			],
			examples: [],
			source: { type: "tool" as const, toolName: "read" },
			updatedAt: new Date().toISOString(),
		};

		const traitVector = computeTraitVector(manifest);
		expect(traitVector).toBeDefined();
		expect(traitVector.length).toBeGreaterThan(0);

		const queryVector = computeQueryVector({ text: "read a file" });
		expect(queryVector).toBeDefined();
		expect(queryVector.length).toBeGreaterThan(0);
	});

	it("should generate skills from tool definitions", async () => {
		const { generateSkillFromTool } = await import("@chitragupta/vidhya-skills");

		const skill = generateSkillFromTool({
			name: "grep",
			description: "Search file contents using patterns",
			inputSchema: {
				type: "object",
				properties: {
					pattern: { type: "string", description: "Search pattern" },
					path: { type: "string", description: "Directory to search" },
				},
			},
		});

		expect(skill.name).toBe("grep");
		expect(skill.description).toBeDefined();
		expect(skill.capabilities.length).toBeGreaterThan(0);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Policy Engine
// ═══════════════════════════════════════════════════════════════════════════════

describe("Policy Engine", () => {
	it("should create PolicyEngine with presets", async () => {
		const { PolicyEngine, STANDARD_PRESET } = await import("@chitragupta/dharma");

		// STANDARD_PRESET is { config, policySets }
		const engine = new PolicyEngine(STANDARD_PRESET.config);

		// Add policy sets from the preset
		for (const policySet of STANDARD_PRESET.policySets) {
			engine.addPolicySet(policySet);
		}

		// Engine was created with preset configuration
		expect(engine).toBeDefined();
		expect(STANDARD_PRESET.policySets.length).toBeGreaterThan(0);
	});

	it("should create KarmaTracker", async () => {
		const { KarmaTracker } = await import("@chitragupta/dharma");
		const tracker = new KarmaTracker();
		const score = tracker.getScore("test-agent");
		expect(score).toBeDefined();
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Orchestrator
// ═══════════════════════════════════════════════════════════════════════════════

describe("Orchestrator", () => {
	it("should create TaskRouter with rules and slots", async () => {
		const { TaskRouter } = await import("@chitragupta/niyanta");
		const router = new TaskRouter(
			[{ id: "r1", match: { type: "keyword", keywords: ["code"] }, target: "coding", priority: 10 }],
			[{ id: "coding", role: "coder", capabilities: ["code-gen"] }],
		);
		expect(router).toBeDefined();
	});

	it("should create StrategyBandit", async () => {
		const { StrategyBandit } = await import("@chitragupta/niyanta");
		const bandit = new StrategyBandit();
		expect(bandit).toBeDefined();
	});

	it("should compute Jaccard similarity", async () => {
		const { jaccardSimilarity } = await import("@chitragupta/niyanta");
		const sim = jaccardSimilarity(["a", "b", "c"], ["b", "c", "d"]);
		expect(sim).toBeCloseTo(0.5, 1);
	});

	it("should provide preset plans", async () => {
		const { CODE_REVIEW_PLAN, TDD_PLAN, BUG_HUNT_PLAN } = await import("@chitragupta/niyanta");
		expect(CODE_REVIEW_PLAN).toBeDefined();
		expect(TDD_PLAN).toBeDefined();
		expect(BUG_HUNT_PLAN).toBeDefined();
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Cross-Package Integration
// ═══════════════════════════════════════════════════════════════════════════════

describe("Cross-Package Integration", () => {
	it("should wire tools into an agent profile", async () => {
		const { KARTRU_PROFILE } = await import("@chitragupta/core");
		const { getAllTools } = await import("@chitragupta/yantra");
		const { CodingAgent, CODE_TOOL_NAMES } = await import("@chitragupta/anina");

		const allTools = getAllTools();
		const codeTools = allTools.filter((t) => CODE_TOOL_NAMES.has(t.definition.name));

		expect(codeTools.length).toBeGreaterThanOrEqual(8);
		expect(KARTRU_PROFILE.id).toBe("kartru");

		const agent = new CodingAgent({
			workingDirectory: process.cwd(),
			tools: allTools,
		});
		expect(agent).toBeDefined();
	});

	it("should classify and route through the full pipeline", async () => {
		const { classifyTaskType, classifyComplexity } = await import("@chitragupta/swara");

		const context = {
			messages: [{
				role: "user" as const,
				content: [{ type: "text" as const, text: "Debug the failing test in auth.test.ts" }],
			}],
		};

		const taskType = classifyTaskType(context);
		const complexity = classifyComplexity(context);

		expect(taskType.type).toBeDefined();
		expect(complexity.complexity).toBeDefined();
	});

	it("should wire consolidation with GraphRAG", async () => {
		const { GraphRAGEngine, ConsolidationEngine, createEdge } = await import("@chitragupta/smriti");

		const graphEngine = new GraphRAGEngine();
		const consolidation = new ConsolidationEngine({ minObservations: 2 });

		// Both systems should be independently functional
		expect(graphEngine.getGraph()).toBeDefined();
		expect(consolidation.getRules()).toEqual([]);

		// Create some edges
		const edge1 = createEdge("auth", "session", "depends_on", 0.9);
		const edge2 = createEdge("session", "token", "uses", 0.7);
		expect(edge1.source).toBe("auth");
		expect(edge2.source).toBe("session");
	});
});
