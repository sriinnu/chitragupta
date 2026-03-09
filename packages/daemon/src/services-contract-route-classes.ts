import type {
	ConsumerConstraint,
	RouteClassDescriptor,
} from "./services-contract-catalog-types.js";

const ROUTE_CLASSES: RouteClassDescriptor[] = [
	{
		id: "coding.fast-local",
		label: "Coding Fast Local",
		description: "Prefer the fastest local coding lane for lightweight patch-and-validate work.",
		capability: "coding.patch-and-validate",
		constraints: {
			preferLocal: true,
			allowCloud: false,
			maxCostClass: "medium",
			preferredCapabilityIds: ["tool.coding_agent"],
		},
		tags: ["coding", "local", "fast"],
		metadata: { owner: "chitragupta", class: "execution-lane" },
	},
	{
		id: "coding.patch-cheap",
		label: "Coding Patch Cheap",
		description: "Use the lowest-friction engine-approved lane for simple code edits.",
		capability: "coding.patch-and-validate",
		constraints: {
			preferLocal: true,
			allowCloud: false,
			maxCostClass: "medium",
			preferredCapabilityIds: ["tool.coding_agent"],
		},
		tags: ["coding", "patch", "economical"],
		metadata: { owner: "chitragupta", class: "execution-lane" },
	},
	{
		id: "coding.deep-reasoning",
		label: "Coding Deep Reasoning",
		description: "Prefer the strongest engine-approved coding lane for planning and complex review.",
		capability: "coding.review",
		constraints: {
			allowCloud: false,
			maxCostClass: "medium",
			preferredCapabilityIds: ["adapter.takumi.executor"],
		},
		tags: ["coding", "reasoning", "review"],
		metadata: { owner: "chitragupta", class: "execution-lane" },
	},
	{
		id: "coding.review.strict",
		label: "Coding Review Strict",
		description: "Route strict review work to the highest-trust reviewed coding lane.",
		capability: "coding.review",
		constraints: {
			allowCloud: false,
			requireApproval: true,
			preferredCapabilityIds: ["adapter.takumi.executor"],
		},
		tags: ["coding", "review", "strict"],
		metadata: { owner: "chitragupta", class: "execution-lane" },
	},
	{
		id: "coding.validation-high-trust",
		label: "Coding Validation High Trust",
		description: "Use the high-trust validation lane for execution-sensitive coding work.",
		capability: "coding.execute",
		constraints: {
			allowCloud: false,
			requireApproval: true,
			preferredCapabilityIds: ["adapter.takumi.executor"],
		},
		tags: ["coding", "validation", "high-trust"],
		metadata: { owner: "chitragupta", class: "execution-lane" },
	},
	{
		id: "memory.semantic-recall",
		label: "Memory Semantic Recall",
		description: "Use the engine memory lane for semantic recall and contextual retrieval.",
		capability: "memory.recall",
		constraints: {
			preferLocal: true,
			allowCloud: false,
		},
		tags: ["memory", "semantic", "recall"],
		metadata: { owner: "chitragupta", class: "memory-lane" },
	},
	{
		id: "research.bounded",
		label: "Research Bounded",
		description: "Use the bounded autoresearch workflow under explicit approval and engine policy.",
		capability: "research.autoresearch",
		constraints: {
			requireApproval: true,
		},
		tags: ["research", "bounded", "workflow"],
		metadata: { owner: "chitragupta", class: "workflow-lane" },
	},
	{
		id: "chat.local-fast",
		label: "Chat Local Fast",
		description: "Prefer the default local chat/runtime lane for fast local interaction.",
		capability: "model.local.chat",
		constraints: {
			preferLocal: true,
			allowCloud: false,
			maxCostClass: "free",
		},
		tags: ["chat", "local", "fast"],
		metadata: { owner: "chitragupta", class: "runtime-lane" },
	},
	{
		id: "chat.flex",
		label: "Chat Flex",
		description: "Use discovery-managed chat routing with engine policy over discovered model lanes.",
		capability: "model.chat",
		constraints: {
			maxCostClass: "medium",
		},
		tags: ["chat", "discovery", "flex"],
		metadata: { owner: "chitragupta", class: "runtime-lane" },
	},
	{
		id: "tool.use.flex",
		label: "Tool Use Flex",
		description: "Use discovery-managed tool-capable model routing with engine policy.",
		capability: "model.tool-use",
		constraints: {
			maxCostClass: "medium",
			requireStreaming: true,
		},
		tags: ["tools", "discovery", "flex"],
		metadata: { owner: "chitragupta", class: "runtime-lane" },
	},
];

function mergeStringArrays(
	base?: string[],
	override?: string[],
): string[] | undefined {
	if (!base && !override) return undefined;
	return [...new Set([...(base ?? []), ...(override ?? [])])];
}

export function listRouteClasses(): RouteClassDescriptor[] {
	return ROUTE_CLASSES.map((descriptor) => structuredClone(descriptor));
}

export function resolveRouteClass(id: string | null | undefined): RouteClassDescriptor | null {
	if (!id) return null;
	const normalized = id.trim();
	if (!normalized) return null;
	const descriptor = ROUTE_CLASSES.find((candidate) => candidate.id === normalized);
	return descriptor ? structuredClone(descriptor) : null;
}

export function mergeRouteClassConstraints(
	base?: ConsumerConstraint,
	override?: ConsumerConstraint,
): ConsumerConstraint | undefined {
	if (!base && !override) return undefined;
	return {
		preferLocal: override?.preferLocal ?? base?.preferLocal,
		allowCloud: override?.allowCloud ?? base?.allowCloud,
		maxCostClass: override?.maxCostClass ?? base?.maxCostClass,
		requireStreaming: override?.requireStreaming ?? base?.requireStreaming,
		requireApproval: override?.requireApproval ?? base?.requireApproval,
		trustFloor: override?.trustFloor ?? base?.trustFloor,
		hardCapabilityId: override?.hardCapabilityId ?? base?.hardCapabilityId,
		excludedCapabilityIds: mergeStringArrays(base?.excludedCapabilityIds, override?.excludedCapabilityIds),
		preferredCapabilityIds: mergeStringArrays(base?.preferredCapabilityIds, override?.preferredCapabilityIds),
	};
}
