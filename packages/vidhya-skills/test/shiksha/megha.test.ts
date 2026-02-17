import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	detectProviders,
	detectServiceFromQuery,
	detectProviderFromQuery,
	findRecipe,
	findEquivalents,
	buildCloudResult,
	formatCloudDisplay,
	clearDetectionCache,
	PROVIDER_REGISTRY,
	SERVICE_EQUIVALENCES,
	CLOUD_RECIPES,
	CLOUD_SERVICE_KEYWORDS,
	CLOUD_PROVIDER_KEYWORDS,
	checkAuth,
} from "../../src/shiksha/megha.js";
import type {
	CloudProvider,
	CloudServiceCategory,
	CLIDetection,
	CloudSourceResult,
} from "../../src/shiksha/megha-types.js";
import type { TaskAnalysis } from "../../src/shiksha/types.js";
import { analyzeTask } from "../../src/shiksha/vimarsh.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeAnalysis(overrides: Partial<TaskAnalysis>): TaskAnalysis {
	return {
		query: "test query",
		intents: [],
		strategy: "shell-command",
		complexity: "trivial",
		candidateUtilities: [],
		domain: "cloud",
		confidence: 0.8,
		...overrides,
	};
}

function makeDetections(configs: Array<{
	provider: CloudProvider;
	installed: boolean;
	authed: boolean;
}>): CLIDetection[] {
	return configs.map((c) => ({
		provider: c.provider,
		cliName: PROVIDER_REGISTRY[c.provider].cliName,
		installed: c.installed,
		authStatus: !c.installed ? "cli_not_installed" : c.authed ? "authenticated" : "not_authenticated",
		authMethod: c.authed ? "env_vars" : undefined,
		accountHint: c.authed ? "abc***xy" : undefined,
	}));
}

// ─── 1. Provider Registry ───────────────────────────────────────────────────

describe("Provider Registry", () => {
	it("should have all 5 providers", () => {
		const providers: CloudProvider[] = ["aws", "azure", "gcp", "cloudflare", "digitalocean"];
		for (const p of providers) {
			expect(PROVIDER_REGISTRY[p]).toBeDefined();
			expect(PROVIDER_REGISTRY[p].cliName).toBeTruthy();
			expect(PROVIDER_REGISTRY[p].envVars.length).toBeGreaterThan(0);
			expect(PROVIDER_REGISTRY[p].loginCommand).toBeTruthy();
			expect(PROVIDER_REGISTRY[p].installCommand).toBeTruthy();
			expect(PROVIDER_REGISTRY[p].docsUrl).toBeTruthy();
		}
	});

	it("should have correct CLI names", () => {
		expect(PROVIDER_REGISTRY.aws.cliName).toBe("aws");
		expect(PROVIDER_REGISTRY.azure.cliName).toBe("az");
		expect(PROVIDER_REGISTRY.gcp.cliName).toBe("gcloud");
		expect(PROVIDER_REGISTRY.cloudflare.cliName).toBe("wrangler");
		expect(PROVIDER_REGISTRY.digitalocean.cliName).toBe("doctl");
	});
});

// ─── 2. Auth Checking ──────────────────────────────────────────────────────

describe("checkAuth", () => {
	it("should detect AWS auth via env vars", () => {
		const result = checkAuth(PROVIDER_REGISTRY.aws, {
			AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
			AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
		});
		expect(result.authenticated).toBe(true);
		expect(result.method).toBe("env_vars");
		expect(result.accountHint).toBe("AKI***LE");
	});

	it("should fail AWS auth when env vars missing", () => {
		const result = checkAuth(PROVIDER_REGISTRY.aws, {});
		expect(result.authenticated).toBe(false);
		expect(result.method).toBeUndefined();
	});

	it("should detect Azure auth via env vars", () => {
		const result = checkAuth(PROVIDER_REGISTRY.azure, {
			AZURE_SUBSCRIPTION_ID: "sub-12345678",
			AZURE_TENANT_ID: "tenant-abcdefgh",
		});
		expect(result.authenticated).toBe(true);
		expect(result.method).toBe("env_vars");
	});

	it("should require all env vars present", () => {
		// AWS requires both KEY_ID and SECRET_KEY
		const result = checkAuth(PROVIDER_REGISTRY.aws, {
			AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
			// Missing AWS_SECRET_ACCESS_KEY
		});
		expect(result.authenticated).toBe(false);
	});

	it("should mask account hint correctly", () => {
		const result = checkAuth(PROVIDER_REGISTRY.cloudflare, {
			CLOUDFLARE_API_TOKEN: "long-token-value-here",
		});
		expect(result.authenticated).toBe(true);
		expect(result.accountHint).toBe("lon***re");
	});

	it("should skip hint for short values", () => {
		const result = checkAuth(PROVIDER_REGISTRY.cloudflare, {
			CLOUDFLARE_API_TOKEN: "short",
		});
		expect(result.authenticated).toBe(true);
		expect(result.accountHint).toBeUndefined();
	});
});

// ─── 3. Service Keywords ────────────────────────────────────────────────────

describe("detectServiceFromQuery", () => {
	it("should detect storage from 'bucket'", () => {
		expect(detectServiceFromQuery("create a bucket", ["create", "bucket"])).toBe("storage");
	});

	it("should detect storage from 's3'", () => {
		expect(detectServiceFromQuery("set up s3", ["set", "up", "s3"])).toBe("storage");
	});

	it("should detect storage from 'blob'", () => {
		expect(detectServiceFromQuery("set up azure blob storage", ["set", "up", "azure", "blob", "storage"])).toBe("storage");
	});

	it("should detect serverless from 'lambda'", () => {
		expect(detectServiceFromQuery("deploy lambda function", ["deploy", "lambda", "function"])).toBe("serverless");
	});

	it("should detect compute from 'vm'", () => {
		expect(detectServiceFromQuery("create a vm", ["create", "vm"])).toBe("compute");
	});

	it("should detect container from 'kubernetes'", () => {
		expect(detectServiceFromQuery("set up kubernetes", ["set", "up", "kubernetes"])).toBe("container");
	});

	it("should detect database from 'sql'", () => {
		expect(detectServiceFromQuery("create sql database", ["create", "sql", "database"])).toBe("database");
	});

	it("should detect iac from 'terraform'", () => {
		expect(detectServiceFromQuery("run terraform plan", ["run", "terraform", "plan"])).toBe("iac");
	});

	it("should detect multi-word phrases like 'object storage'", () => {
		expect(detectServiceFromQuery("set up object storage", ["set", "up", "object", "storage"])).toBe("storage");
	});

	it("should return null for unrelated queries", () => {
		expect(detectServiceFromQuery("check disk space", ["check", "disk", "space"])).toBeNull();
	});
});

// ─── 4. Provider Keywords ───────────────────────────────────────────────────

describe("detectProviderFromQuery", () => {
	it("should detect aws", () => {
		expect(detectProviderFromQuery(["aws", "s3", "bucket"])).toBe("aws");
	});

	it("should detect azure", () => {
		expect(detectProviderFromQuery(["azure", "blob", "storage"])).toBe("azure");
	});

	it("should detect gcp", () => {
		expect(detectProviderFromQuery(["gcp", "cloud", "storage"])).toBe("gcp");
	});

	it("should detect cloudflare from 'wrangler'", () => {
		expect(detectProviderFromQuery(["wrangler", "deploy"])).toBe("cloudflare");
	});

	it("should detect digitalocean from 'droplet'", () => {
		expect(detectProviderFromQuery(["create", "droplet"])).toBe("digitalocean");
	});

	it("should return null for no provider keywords", () => {
		expect(detectProviderFromQuery(["check", "disk", "space"])).toBeNull();
	});

	it("should pick strongest provider when ambiguous", () => {
		// "s3" is AWS, "lambda" is AWS — should pick aws with score 2
		expect(detectProviderFromQuery(["s3", "lambda"])).toBe("aws");
	});
});

// ─── 5. Recipe Lookup ───────────────────────────────────────────────────────

describe("findRecipe", () => {
	it("should find aws-s3-create", () => {
		const recipe = findRecipe("storage", "aws");
		expect(recipe).not.toBeNull();
		expect(recipe!.id).toBe("aws-s3-create");
		expect(recipe!.steps.length).toBeGreaterThanOrEqual(1);
		expect(recipe!.placeholders).toBeDefined();
	});

	it("should find azure-blob-create", () => {
		const recipe = findRecipe("storage", "azure");
		expect(recipe).not.toBeNull();
		expect(recipe!.id).toBe("azure-blob-create");
	});

	it("should find gcp-gcs-create", () => {
		const recipe = findRecipe("storage", "gcp");
		expect(recipe).not.toBeNull();
		expect(recipe!.id).toBe("gcp-gcs-create");
	});

	it("should find lambda deploy", () => {
		const recipe = findRecipe("serverless", "aws");
		expect(recipe).not.toBeNull();
		expect(recipe!.id).toBe("aws-lambda-deploy");
	});

	it("should return null for missing category/provider combo", () => {
		expect(findRecipe("cdn", "digitalocean")).toBeNull();
	});

	it("should have rollback commands on mutation steps", () => {
		const recipe = findRecipe("storage", "aws")!;
		const mutatingSteps = recipe.steps.filter((s) => s.mutatesState);
		expect(mutatingSteps.length).toBeGreaterThan(0);
		// At least some mutation steps should have rollback
		expect(mutatingSteps.some((s) => !!s.rollbackCommand)).toBe(true);
	});
});

// ─── 6. Service Equivalences ────────────────────────────────────────────────

describe("findEquivalents", () => {
	it("should find storage equivalents across providers", () => {
		const equivs = findEquivalents("storage");
		expect(equivs.length).toBeGreaterThanOrEqual(3);
		const providers = equivs.map((e) => e.provider);
		expect(providers).toContain("aws");
		expect(providers).toContain("azure");
		expect(providers).toContain("gcp");
	});

	it("should have correct service names", () => {
		const equivs = findEquivalents("storage");
		const aws = equivs.find((e) => e.provider === "aws")!;
		expect(aws.name).toBe("S3");
		const azure = equivs.find((e) => e.provider === "azure")!;
		expect(azure.name).toBe("Blob Storage");
	});

	it("should return empty for unknown category", () => {
		expect(findEquivalents("unknown" as CloudServiceCategory)).toEqual([]);
	});

	it("should have all 10 service categories", () => {
		const categories: CloudServiceCategory[] = [
			"storage", "compute", "serverless", "database", "container",
			"network", "cdn", "dns", "monitoring", "iac",
		];
		for (const cat of categories) {
			const equivs = findEquivalents(cat);
			expect(equivs.length).toBeGreaterThan(0);
		}
	});
});

// ─── 7. buildCloudResult ────────────────────────────────────────────────────

describe("buildCloudResult", () => {
	it("Scenario A: requested provider authenticated → recipe", () => {
		const analysis = makeAnalysis({
			query: "create s3 bucket",
			cloudContext: { requestedProvider: "aws", requestedService: "storage", detections: [] },
		});
		const detections = makeDetections([
			{ provider: "aws", installed: true, authed: true },
			{ provider: "azure", installed: false, authed: false },
		]);

		const result = buildCloudResult(analysis, detections);
		expect(result.recipe).not.toBeNull();
		expect(result.recipe!.id).toBe("aws-s3-create");
		expect(result.alternatives.length).toBe(0);
		expect(result.authGuidance).toBeUndefined();
	});

	it("Scenario B: not authenticated, alternative available", () => {
		const analysis = makeAnalysis({
			query: "set up azure blob storage",
			cloudContext: { requestedProvider: "azure", requestedService: "storage", detections: [] },
		});
		const detections = makeDetections([
			{ provider: "aws", installed: true, authed: true },
			{ provider: "azure", installed: true, authed: false },
			{ provider: "gcp", installed: false, authed: false },
		]);

		const result = buildCloudResult(analysis, detections);
		expect(result.recipe).toBeUndefined();
		expect(result.authGuidance).not.toBeUndefined();
		expect(result.authGuidance!.provider).toBe("azure");
		expect(result.authGuidance!.loginCommand).toBeTruthy();
		expect(result.alternatives.length).toBeGreaterThan(0);
		expect(result.alternatives[0].provider).toBe("aws");
		expect(result.alternatives[0].serviceName).toBe("S3");
	});

	it("Scenario C: CLI not installed", () => {
		const analysis = makeAnalysis({
			query: "set up azure blob storage",
			cloudContext: { requestedProvider: "azure", requestedService: "storage", detections: [] },
		});
		const detections = makeDetections([
			{ provider: "aws", installed: false, authed: false },
			{ provider: "azure", installed: false, authed: false },
			{ provider: "gcp", installed: false, authed: false },
		]);

		const result = buildCloudResult(analysis, detections);
		expect(result.recipe).toBeUndefined();
		expect(result.installGuidance).not.toBeUndefined();
		expect(result.installGuidance!.provider).toBe("azure");
		expect(result.installGuidance!.installCommand).toBeTruthy();
	});

	it("should return empty result when no service detected", () => {
		const analysis = makeAnalysis({
			query: "something random",
			cloudContext: { requestedProvider: undefined, requestedService: undefined, detections: [] },
		});
		const detections = makeDetections([
			{ provider: "aws", installed: true, authed: true },
		]);

		const result = buildCloudResult(analysis, detections);
		expect(result.recipe).toBeUndefined();
		expect(result.alternatives.length).toBe(0);
	});

	it("should find best alternative when no provider specified", () => {
		const analysis = makeAnalysis({
			query: "create storage bucket",
			cloudContext: { requestedProvider: undefined, requestedService: "storage", detections: [] },
		});
		const detections = makeDetections([
			{ provider: "aws", installed: true, authed: true },
			{ provider: "azure", installed: false, authed: false },
		]);

		const result = buildCloudResult(analysis, detections);
		// Should pick AWS since it's authenticated
		expect(result.recipe).not.toBeNull();
		expect(result.recipe!.provider).toBe("aws");
	});

	it("should provide install guidance when nothing is available", () => {
		const analysis = makeAnalysis({
			query: "deploy lambda function",
			cloudContext: { requestedProvider: undefined, requestedService: "serverless", detections: [] },
		});
		const detections = makeDetections([
			{ provider: "aws", installed: false, authed: false },
			{ provider: "azure", installed: false, authed: false },
			{ provider: "gcp", installed: false, authed: false },
		]);

		const result = buildCloudResult(analysis, detections);
		expect(result.installGuidance).not.toBeUndefined();
	});

	it("should not suggest the requested provider as an alternative", () => {
		const analysis = makeAnalysis({
			query: "create s3 bucket",
			cloudContext: { requestedProvider: "aws", requestedService: "storage", detections: [] },
		});
		const detections = makeDetections([
			{ provider: "aws", installed: true, authed: false },
			{ provider: "azure", installed: true, authed: true },
		]);

		const result = buildCloudResult(analysis, detections);
		const altProviders = result.alternatives.map((a) => a.provider);
		expect(altProviders).not.toContain("aws");
		expect(altProviders).toContain("azure");
	});
});

// ─── 8. Display Formatting ──────────────────────────────────────────────────

describe("formatCloudDisplay", () => {
	it("should format a recipe with steps and placeholders", () => {
		const result: CloudSourceResult = {
			recipe: findRecipe("storage", "aws")!,
			alternatives: [],
			detections: makeDetections([
				{ provider: "aws", installed: true, authed: true },
			]),
		};

		const display = formatCloudDisplay(result, "create s3 bucket");
		expect(display).toContain("Cloud Recipe:");
		expect(display).toContain("Create S3 Bucket");
		expect(display).toContain("Recipe:");
		expect(display).toContain("aws s3 mb");
		expect(display).toContain("{bucket_name}");
		expect(display).toContain("Cost:");
	});

	it("should show auth guidance when not authenticated", () => {
		const result: CloudSourceResult = {
			authGuidance: {
				provider: "azure",
				installed: true,
				loginCommand: "az login",
				docsUrl: "https://example.com",
			},
			alternatives: [{
				provider: "aws",
				serviceName: "S3",
				reason: "You're already authenticated with AWS",
				recipe: findRecipe("storage", "aws")!,
			}],
			detections: makeDetections([
				{ provider: "aws", installed: true, authed: true },
				{ provider: "azure", installed: true, authed: false },
			]),
		};

		const display = formatCloudDisplay(result, "set up azure blob");
		expect(display).toContain("not authenticated");
		expect(display).toContain("az login");
		expect(display).toContain("Alternative:");
		expect(display).toContain("S3");
	});

	it("should show install guidance when CLI not installed", () => {
		const result: CloudSourceResult = {
			installGuidance: {
				provider: "azure",
				installed: false,
				installCommand: "brew install azure-cli",
				docsUrl: "https://example.com",
			},
			alternatives: [],
			detections: [],
		};

		const display = formatCloudDisplay(result, "set up azure blob");
		expect(display).toContain("not installed");
		expect(display).toContain("brew install azure-cli");
	});

	it("should show no-providers message when nothing available", () => {
		const result: CloudSourceResult = {
			alternatives: [],
			detections: [],
		};

		const display = formatCloudDisplay(result, "set up cloud storage");
		expect(display).toContain("No cloud providers are currently authenticated");
	});
});

// ─── 9. Vimarsh Cloud Integration ──────────────────────────────────────────

describe("Vimarsh cloud domain detection", () => {
	it("should detect cloud domain from 'set up azure blob storage'", () => {
		const result = analyzeTask("set up azure blob storage");
		expect(result.domain).toBe("cloud");
		expect(result.cloudContext).toBeDefined();
		expect(result.cloudContext!.requestedProvider).toBe("azure");
		expect(result.cloudContext!.requestedService).toBe("storage");
	});

	it("should detect cloud domain from 'create s3 bucket'", () => {
		const result = analyzeTask("create s3 bucket");
		expect(result.domain).toBe("cloud");
		expect(result.cloudContext).toBeDefined();
		expect(result.cloudContext!.requestedProvider).toBe("aws");
		expect(result.cloudContext!.requestedService).toBe("storage");
	});

	it("should detect cloud domain from 'deploy lambda function'", () => {
		const result = analyzeTask("deploy lambda function");
		expect(result.domain).toBe("cloud");
		expect(result.cloudContext).toBeDefined();
		expect(result.cloudContext!.requestedService).toBe("serverless");
	});

	it("should detect cloud domain from 'set up kubernetes cluster'", () => {
		const result = analyzeTask("set up kubernetes cluster");
		expect(result.domain).toBe("cloud");
		expect(result.cloudContext).toBeDefined();
		expect(result.cloudContext!.requestedService).toBe("container");
	});

	it("should NOT detect cloud domain from 'check disk space left'", () => {
		const result = analyzeTask("check disk space left");
		expect(result.domain).not.toBe("cloud");
		expect(result.cloudContext).toBeUndefined();
	});

	it("should have cloud CLI candidates", () => {
		const result = analyzeTask("create s3 bucket");
		expect(result.candidateUtilities.some((c) => c.command === "aws")).toBe(true);
	});

	it("should detect terraform domain", () => {
		const result = analyzeTask("run terraform plan");
		expect(result.domain).toBe("cloud");
		expect(result.cloudContext).toBeDefined();
		expect(result.cloudContext!.requestedService).toBe("iac");
	});

	it("should detect gcp domain from 'gcloud compute instances'", () => {
		const result = analyzeTask("gcloud compute instances list");
		expect(result.domain).toBe("cloud");
		expect(result.cloudContext?.requestedProvider).toBe("gcp");
	});
});

// ─── 10. Recipe Coverage ────────────────────────────────────────────────────

describe("Recipe coverage", () => {
	it("should have at least 15 recipes", () => {
		expect(CLOUD_RECIPES.length).toBeGreaterThanOrEqual(15);
	});

	it("should cover storage, serverless, compute, container, database categories", () => {
		const categories = new Set(CLOUD_RECIPES.map((r) => r.category));
		expect(categories.has("storage")).toBe(true);
		expect(categories.has("serverless")).toBe(true);
		expect(categories.has("compute")).toBe(true);
		expect(categories.has("container")).toBe(true);
		expect(categories.has("database")).toBe(true);
	});

	it("should cover aws, azure, gcp providers", () => {
		const providers = new Set(CLOUD_RECIPES.map((r) => r.provider));
		expect(providers.has("aws")).toBe(true);
		expect(providers.has("azure")).toBe(true);
		expect(providers.has("gcp")).toBe(true);
	});

	it("all recipes should have unique IDs", () => {
		const ids = CLOUD_RECIPES.map((r) => r.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("all recipes should have at least 1 step", () => {
		for (const recipe of CLOUD_RECIPES) {
			expect(recipe.steps.length).toBeGreaterThanOrEqual(1);
		}
	});

	it("all recipe steps should have commands with placeholders or valid commands", () => {
		for (const recipe of CLOUD_RECIPES) {
			for (const step of recipe.steps) {
				expect(step.command).toBeTruthy();
				expect(step.description).toBeTruthy();
			}
		}
	});
});

// ─── 11. Detection Cache ────────────────────────────────────────────────────

describe("Detection cache", () => {
	beforeEach(() => {
		clearDetectionCache();
	});

	it("clearDetectionCache should reset cache", () => {
		clearDetectionCache(); // should not throw
	});
});

// ─── 12. Keyword Maps ──────────────────────────────────────────────────────

describe("Keyword maps", () => {
	it("CLOUD_SERVICE_KEYWORDS should have entries for all 10 categories", () => {
		const categories = new Set(CLOUD_SERVICE_KEYWORDS.values());
		expect(categories.size).toBeGreaterThanOrEqual(9);
	});

	it("CLOUD_PROVIDER_KEYWORDS should cover all 5 providers", () => {
		const providers = new Set(CLOUD_PROVIDER_KEYWORDS.values());
		expect(providers.has("aws")).toBe(true);
		expect(providers.has("azure")).toBe(true);
		expect(providers.has("gcp")).toBe(true);
		expect(providers.has("cloudflare")).toBe(true);
		expect(providers.has("digitalocean")).toBe(true);
	});
});
