export type CapabilityKind = "llm" | "cli" | "embedding" | "tool" | "adapter" | "local-model";
export type TrustLevel = "local" | "sandboxed" | "cloud" | "privileged";
export type CapabilityHealthState = "healthy" | "degraded" | "down" | "unknown";
export type CostClass = "free" | "low" | "medium" | "high";

export interface CapabilityDescriptor {
	id: string;
	kind: CapabilityKind;
	label: string;
	capabilities: string[];
	costClass: CostClass;
	trust: TrustLevel;
	health: CapabilityHealthState;
	invocation: {
		id: string;
		transport: "socket" | "stdio" | "mcp" | "inproc" | "http";
		entrypoint: string;
		requestShape: string;
		responseShape: string;
		timeoutMs: number;
		streaming: boolean;
		requiresApproval?: boolean;
	};
	tags: string[];
	priority?: number;
	routable?: boolean;
	metadata?: Record<string, unknown>;
}

export interface ConsumerConstraint {
	preferLocal?: boolean;
	allowCloud?: boolean;
	maxCostClass?: CostClass;
	requireStreaming?: boolean;
	requireApproval?: boolean;
	trustFloor?: TrustLevel;
	excludedCapabilityIds?: string[];
	preferredCapabilityIds?: string[];
	hardCapabilityId?: string;
}

export interface RouteDiscoveryBindingPolicy {
	capability: string;
	mode?: string;
	role?: string;
	preferLocalProviders?: boolean;
	allowCrossProvider?: boolean;
}

export interface RouteExecutionBinding {
	source: "engine" | "kosha-discovery";
	kind: "executor" | "model";
	query?: {
		capability: string;
		mode?: string;
		role?: string;
	};
	selectedModelId?: string;
	selectedProviderId?: string;
	candidateModelIds?: string[];
	preferredModelIds?: string[];
	preferredProviderIds?: string[];
	preferLocalProviders?: boolean;
	allowCrossProvider?: boolean;
}

export interface RouteClassDescriptor {
	id: string;
	label: string;
	description: string;
	capability: string;
	constraints?: ConsumerConstraint;
	tags: string[];
	discoveryBinding?: RouteDiscoveryBindingPolicy;
	metadata?: Record<string, unknown>;
}

export interface RoutingRequest {
	consumer: string;
	sessionId: string;
	capability: string;
	routeClass?: string;
	constraints?: ConsumerConstraint;
	context?: Record<string, unknown>;
}
