/**
 * OpenAPI component schemas for reusable data models.
 * @module openapi-schemas
 */

/** Build the `components` section of the OpenAPI spec (security schemes + schemas). */
export function buildComponents(): {
	securitySchemes: Record<string, unknown>;
	schemas: Record<string, unknown>;
} {
	return {
		securitySchemes: {
			bearerAuth: {
				type: "http",
				scheme: "bearer",
				bearerFormat: "JWT",
				description: "JWT obtained from /api/auth/token or legacy bearer token",
			},
			apiKeyAuth: {
				type: "apiKey",
				in: "header",
				name: "X-API-Key",
				description: "API key authentication",
			},
		},
		schemas: {
			ErrorResponse: {
				type: "object",
				properties: {
					error: { type: "string", description: "Error message" },
					requestId: { type: "string", description: "Request trace ID" },
				},
				required: ["error"],
			},
			SamitiChannelSummary: {
				type: "object",
				properties: {
					name: { type: "string" },
					description: { type: "string" },
					maxHistory: { type: "integer" },
					subscribers: { type: "array", items: { type: "string" } },
					messageCount: { type: "integer" },
					createdAt: { type: "integer" },
				},
			},
			SamitiStats: {
				type: "object",
				properties: {
					channels: { type: "integer" },
					totalMessages: { type: "integer" },
					subscribers: { type: "integer" },
				},
			},
			SamitiMessage: {
				type: "object",
				properties: {
					id: { type: "string" },
					channel: { type: "string" },
					sender: { type: "string" },
					severity: { type: "string", enum: ["info", "warning", "critical"] },
					category: { type: "string" },
					content: { type: "string" },
					data: { type: "object" },
					timestamp: { type: "integer" },
					ttl: { type: "integer" },
					references: { type: "array", items: { type: "string" } },
				},
			},
			StigmergicTrace: {
				type: "object",
				properties: {
					id: { type: "string" },
					agentId: { type: "string" },
					traceType: { type: "string", enum: ["solution", "warning", "shortcut", "pattern", "correction", "preference"] },
					topic: { type: "string" },
					content: { type: "string" },
					strength: { type: "number", minimum: 0, maximum: 1 },
					reinforcements: { type: "integer" },
					metadata: { type: "object" },
					createdAt: { type: "integer" },
					lastReinforcedAt: { type: "integer" },
				},
			},
			Finding: {
				type: "object",
				properties: {
					id: { type: "string" },
					guardianId: { type: "string" },
					domain: { type: "string", enum: ["security", "performance", "correctness"] },
					severity: { type: "string", enum: ["info", "warning", "critical"] },
					title: { type: "string" },
					description: { type: "string" },
					location: { type: "string" },
					suggestion: { type: "string" },
					confidence: { type: "number", minimum: 0, maximum: 1 },
					autoFixable: { type: "boolean" },
					timestamp: { type: "integer" },
				},
			},
			KartavyaSummary: {
				type: "object",
				properties: {
					id: { type: "string" },
					name: { type: "string" },
					status: { type: "string", enum: ["proposed", "approved", "active", "paused", "completed", "failed", "retired"] },
					triggerType: { type: "string", enum: ["cron", "event", "threshold", "pattern"] },
					triggerCondition: { type: "string" },
					confidence: { type: "number" },
					successCount: { type: "integer" },
					failureCount: { type: "integer" },
					lastExecuted: { type: "integer", nullable: true },
				},
			},
		},
	};
}
