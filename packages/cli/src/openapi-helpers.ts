/**
 * OpenAPI specification helpers — shared types and utility functions.
 *
 * Extracted from openapi.ts for maintainability.
 * All path builder modules import from here.
 *
 * @module openapi-helpers
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OpenAPISpec {
	openapi: string;
	info: {
		title: string;
		description: string;
		version: string;
		contact?: { name: string; url: string };
		license?: { name: string; url: string };
	};
	servers: Array<{ url: string; description: string }>;
	tags: Array<{ name: string; description: string }>;
	paths: Record<string, Record<string, PathOperation>>;
	components: {
		securitySchemes: Record<string, unknown>;
		schemas: Record<string, unknown>;
	};
	security: Array<Record<string, string[]>>;
}

export interface PathOperation {
	tags: string[];
	summary: string;
	description?: string;
	operationId: string;
	parameters?: Array<{
		name: string;
		in: string;
		required?: boolean;
		description?: string;
		schema: { type: string; default?: unknown; enum?: string[] };
	}>;
	requestBody?: {
		required?: boolean;
		content: {
			"application/json": {
				schema: unknown;
			};
		};
	};
	responses: Record<string, {
		description: string;
		content?: {
			"application/json": {
				schema: unknown;
			};
		};
	}>;
}

/** Alias for a group of OpenAPI path entries. */
export type PathEntries = Record<string, Record<string, PathOperation>>;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Create a JSON Schema $ref pointer to a component schema. */
export function ref(name: string): { $ref: string } {
	return { $ref: `#/components/schemas/${name}` };
}

/** Build a standard error response with ErrorResponse schema. */
export function errorResponse(description: string): {
	description: string;
	content: { "application/json": { schema: unknown } };
} {
	return {
		description,
		content: {
			"application/json": {
				schema: ref("ErrorResponse"),
			},
		},
	};
}

/** Build a JSON response with a custom schema. */
export function jsonResponse(description: string, schema: unknown): {
	description: string;
	content: { "application/json": { schema: unknown } };
} {
	return {
		description,
		content: {
			"application/json": { schema },
		},
	};
}

/** Standard `limit` query parameter. */
export function limitParam(): {
	name: string;
	in: string;
	required: boolean;
	description: string;
	schema: { type: string; default: number };
} {
	return {
		name: "limit",
		in: "query",
		required: false,
		description: "Maximum number of results to return",
		schema: { type: "integer", default: 20 },
	};
}

/** Standard `project` query parameter. */
export function projectParam(): {
	name: string;
	in: string;
	required: boolean;
	description: string;
	schema: { type: string };
} {
	return {
		name: "project",
		in: "query",
		required: false,
		description: "Project path scope",
		schema: { type: "string" },
	};
}
