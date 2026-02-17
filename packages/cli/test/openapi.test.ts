/**
 * Tests for the OpenAPI 3.0 specification generator.
 *
 * Validates structure, completeness, and correctness of the generated spec.
 */

import { describe, it, expect } from "vitest";
import { generateOpenAPISpec } from "../src/openapi.js";

const spec = generateOpenAPISpec();

// ═══════════════════════════════════════════════════════════════════════════
// Structure & Metadata
// ═══════════════════════════════════════════════════════════════════════════

describe("OpenAPI Spec: Structure", () => {
	it("should be a valid OpenAPI 3.0.3 document", () => {
		expect(spec.openapi).toBe("3.0.3");
	});

	it("should have complete info block", () => {
		expect(spec.info.title).toBe("Chitragupta API");
		expect(spec.info.version).toMatch(/^\d+\.\d+\.\d+$/);
		expect(spec.info.description).toBeTruthy();
		expect(spec.info.license).toBeDefined();
		expect(spec.info.license!.name).toBe("MIT");
	});

	it("should have at least one server", () => {
		expect(spec.servers.length).toBeGreaterThanOrEqual(1);
		expect(spec.servers[0].url).toMatch(/^https?:\/\//);
		expect(spec.servers[0].description).toBeTruthy();
	});

	it("should have tags defined", () => {
		expect(spec.tags.length).toBeGreaterThanOrEqual(5);
		for (const tag of spec.tags) {
			expect(tag.name).toBeTruthy();
			expect(tag.description).toBeTruthy();
		}
	});

	it("should have security schemes", () => {
		expect(spec.components.securitySchemes).toBeDefined();
		const schemes = Object.keys(spec.components.securitySchemes);
		expect(schemes.length).toBeGreaterThanOrEqual(1);
	});

	it("should have global security requirement", () => {
		expect(spec.security).toBeDefined();
		expect(spec.security.length).toBeGreaterThanOrEqual(1);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Parameters
// ═══════════════════════════════════════════════════════════════════════════

describe("OpenAPI Spec: Parameters", () => {
	it("should allow custom version and server URL", () => {
		const custom = generateOpenAPISpec("2.0.0", "https://api.example.com");
		expect(custom.info.version).toBe("2.0.0");
		expect(custom.servers[0].url).toBe("https://api.example.com");
	});

	it("should use defaults when no parameters provided", () => {
		const defaultSpec = generateOpenAPISpec();
		expect(defaultSpec.info.version).toBe("0.5.0");
		expect(defaultSpec.servers[0].url).toContain("127.0.0.1");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Paths & Endpoints
// ═══════════════════════════════════════════════════════════════════════════

describe("OpenAPI Spec: Paths", () => {
	const paths = Object.keys(spec.paths);

	it("should define at least 20 paths", () => {
		expect(paths.length).toBeGreaterThanOrEqual(20);
	});

	it("should include core endpoints", () => {
		const coreEndpoints = ["/api/health", "/api/sessions", "/api/memory/{scope}"];
		for (const ep of coreEndpoints) {
			expect(paths).toContain(ep);
		}
	});

	it("every path operation should have an operationId", () => {
		for (const [pathStr, methods] of Object.entries(spec.paths)) {
			for (const [method, operation] of Object.entries(methods)) {
				expect(operation.operationId, `${method.toUpperCase()} ${pathStr} missing operationId`).toBeTruthy();
			}
		}
	});

	it("every path operation should have tags", () => {
		for (const [pathStr, methods] of Object.entries(spec.paths)) {
			for (const [method, operation] of Object.entries(methods)) {
				expect(operation.tags?.length, `${method.toUpperCase()} ${pathStr} missing tags`).toBeGreaterThanOrEqual(1);
			}
		}
	});

	it("every path operation should have a summary", () => {
		for (const [pathStr, methods] of Object.entries(spec.paths)) {
			for (const [method, operation] of Object.entries(methods)) {
				expect(operation.summary, `${method.toUpperCase()} ${pathStr} missing summary`).toBeTruthy();
			}
		}
	});

	it("every path operation should have at least one response", () => {
		for (const [pathStr, methods] of Object.entries(spec.paths)) {
			for (const [method, operation] of Object.entries(methods)) {
				const responseCodes = Object.keys(operation.responses);
				expect(responseCodes.length, `${method.toUpperCase()} ${pathStr} missing responses`).toBeGreaterThanOrEqual(1);
			}
		}
	});

	it("operationIds should be unique across all paths", () => {
		const ids = new Set<string>();
		for (const methods of Object.values(spec.paths)) {
			for (const operation of Object.values(methods)) {
				expect(ids.has(operation.operationId), `Duplicate operationId: ${operation.operationId}`).toBe(false);
				ids.add(operation.operationId);
			}
		}
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Schema References
// ═══════════════════════════════════════════════════════════════════════════

describe("OpenAPI Spec: Schema References", () => {
	it("should have component schemas defined", () => {
		expect(Object.keys(spec.components.schemas).length).toBeGreaterThanOrEqual(1);
	});

	it("all $ref references should point to defined schemas", () => {
		const definedSchemas = new Set(Object.keys(spec.components.schemas));
		const refs: string[] = [];

		// Recursively collect all $ref values
		function collectRefs(obj: unknown): void {
			if (obj == null || typeof obj !== "object") return;
			if (Array.isArray(obj)) {
				for (const item of obj) collectRefs(item);
				return;
			}
			const record = obj as Record<string, unknown>;
			if (typeof record.$ref === "string") {
				refs.push(record.$ref);
			}
			for (const val of Object.values(record)) {
				collectRefs(val);
			}
		}

		collectRefs(spec.paths);

		for (const ref of refs) {
			const match = ref.match(/#\/components\/schemas\/(.+)/);
			if (match) {
				expect(definedSchemas.has(match[1]), `$ref to undefined schema: ${ref}`).toBe(true);
			}
		}
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Parameters Validation
// ═══════════════════════════════════════════════════════════════════════════

describe("OpenAPI Spec: Parameter Definitions", () => {
	it("all parameters should have name, in, and schema", () => {
		for (const [pathStr, methods] of Object.entries(spec.paths)) {
			for (const [method, operation] of Object.entries(methods)) {
				if (operation.parameters) {
					for (const param of operation.parameters) {
						expect(param.name, `${method.toUpperCase()} ${pathStr} param missing name`).toBeTruthy();
						expect(param.in, `${method.toUpperCase()} ${pathStr} param "${param.name}" missing 'in'`).toBeTruthy();
						expect(param.schema, `${method.toUpperCase()} ${pathStr} param "${param.name}" missing schema`).toBeDefined();
					}
				}
			}
		}
	});

	it("path parameters should be marked as required", () => {
		for (const [pathStr, methods] of Object.entries(spec.paths)) {
			// Extract {param} names from path
			const pathParams = [...pathStr.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
			if (pathParams.length === 0) continue;

			for (const [method, operation] of Object.entries(methods)) {
				for (const paramName of pathParams) {
					const param = operation.parameters?.find((p) => p.name === paramName && p.in === "path");
					expect(param, `${method.toUpperCase()} ${pathStr} missing path param definition for {${paramName}}`).toBeDefined();
					if (param) {
						expect(param.required, `${method.toUpperCase()} ${pathStr} path param {${paramName}} should be required`).toBe(true);
					}
				}
			}
		}
	});
});
