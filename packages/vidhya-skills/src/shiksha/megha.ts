/**
 * Megha (मेघ — Cloud) — Cloud-Aware Shiksha Extension.
 *
 * Detects installed cloud CLIs and auth status, maps cloud services
 * across providers, provides pre-built recipes, and suggests
 * authenticated alternatives when the requested provider is unavailable.
 *
 * All detection is **local** (env vars + file existence) — zero network cost.
 *
 * @packageDocumentation
 */

import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	CloudProvider,
	CloudServiceCategory,
	AuthStatus,
	CLIDetection,
	CloudService,
	CloudRecipe,
	CloudRecipeStep,
	AuthGuidance,
	AlternativeSuggestion,
	CloudContext,
	CloudSourceResult,
} from "./megha-types.js";
import type { TaskAnalysis } from "./types.js";

import {
	PROVIDER_REGISTRY,
	SERVICE_EQUIVALENCES,
	CLOUD_RECIPES,
} from "./megha-data.js";
import type { ProviderConfig } from "./megha-data.js";
import { formatCloudDisplay } from "./megha-display.js";

// ─── Keyword Maps ───────────────────────────────────────────────────────────

/** Map query words → CloudServiceCategory. */
const CLOUD_SERVICE_KEYWORDS: ReadonlyMap<string, CloudServiceCategory> = new Map([
	// Storage
	["bucket", "storage"], ["s3", "storage"], ["blob", "storage"], ["object store", "storage"],
	["object storage", "storage"], ["r2", "storage"], ["spaces", "storage"], ["gcs", "storage"],
	// Serverless
	["lambda", "serverless"], ["function", "serverless"], ["serverless", "serverless"],
	["faas", "serverless"], ["workers", "serverless"],
	// Compute
	["vm", "compute"], ["ec2", "compute"], ["instance", "compute"], ["virtual machine", "compute"],
	["droplet", "compute"],
	// Container
	["kubernetes", "container"], ["k8s", "container"], ["aks", "container"], ["eks", "container"],
	["gke", "container"], ["cluster", "container"],
	// Database
	["database", "database"], ["db", "database"], ["sql", "database"], ["rds", "database"],
	["cosmos", "database"], ["dynamodb", "database"],
	// Network
	["vpc", "network"], ["vnet", "network"], ["subnet", "network"], ["load balancer", "network"],
	// CDN
	["cdn", "cdn"], ["cloudfront", "cdn"], ["edge", "cdn"],
	// DNS
	["route53", "dns"],
	// Monitoring
	["cloudwatch", "monitoring"], ["logs", "monitoring"],
	// IaC
	["terraform", "iac"], ["cloudformation", "iac"], ["arm template", "iac"],
]);

/** Map query words → CloudProvider. */
const CLOUD_PROVIDER_KEYWORDS: ReadonlyMap<string, CloudProvider> = new Map([
	// AWS
	["aws", "aws"], ["amazon", "aws"], ["s3", "aws"], ["ec2", "aws"],
	["lambda", "aws"], ["dynamodb", "aws"], ["cloudfront", "aws"],
	["rds", "aws"], ["cloudwatch", "aws"], ["route53", "aws"],
	["cloudformation", "aws"], ["eks", "aws"],
	// Azure
	["azure", "azure"], ["microsoft", "azure"], ["blob", "azure"],
	["arm template", "azure"], ["aks", "azure"],
	// GCP
	["gcp", "gcp"], ["google", "gcp"], ["gcloud", "gcp"],
	["bigquery", "gcp"], ["gke", "gcp"],
	// Cloudflare
	["cloudflare", "cloudflare"], ["workers", "cloudflare"], ["r2", "cloudflare"],
	["wrangler", "cloudflare"],
	// DigitalOcean
	["digitalocean", "digitalocean"], ["droplet", "digitalocean"], ["spaces", "digitalocean"],
	["doctl", "digitalocean"],
]);

// ─── Detection Engine ───────────────────────────────────────────────────────

/** Cached detection result + expiry timestamp. */
let detectionCache: { detections: CLIDetection[]; expiresAt: number } | null = null;

/**
 * Check if a CLI binary is installed via `which`.
 * Returns true/false — no network call.
 */
function isCliInstalled(cliName: string): Promise<boolean> {
	return new Promise((resolve) => {
		execFile("which", [cliName], { timeout: 2000 }, (err) => {
			resolve(!err);
		});
	});
}

/**
 * Check authentication status for a provider by examining
 * env vars and credential files. Zero network cost.
 */
function checkAuth(
	config: ProviderConfig,
	env: Record<string, string | undefined> = process.env,
): { authenticated: boolean; method?: string; accountHint?: string } {
	// Check env vars first
	const hasEnvVars = config.envVars.every((v) => !!env[v]);
	if (hasEnvVars) {
		let accountHint: string | undefined;
		if (config.accountEnvVar) {
			const val = env[config.accountEnvVar];
			if (val && val.length > 6) {
				accountHint = val.slice(0, 3) + "***" + val.slice(-2);
			}
		}
		return { authenticated: true, method: "env_vars", accountHint };
	}

	// Check credentials file
	if (config.credFile) {
		const credPath = join(homedir(), config.credFile);
		if (existsSync(credPath)) {
			return { authenticated: true, method: "credentials_file" };
		}
	}

	return { authenticated: false };
}

/**
 * Detect all cloud providers — which CLIs are installed and authenticated.
 *
 * Results are cached for `cacheTTL` ms (default 60s).
 * All detection is local — zero network cost, <50ms typical.
 *
 * @param cacheTTL - Cache TTL in ms. Pass 0 to force refresh.
 * @param env - Environment variables (for testing injection).
 */
export async function detectProviders(
	cacheTTL: number = 60_000,
	env?: Record<string, string | undefined>,
): Promise<CLIDetection[]> {
	// Check cache
	if (detectionCache && Date.now() < detectionCache.expiresAt && cacheTTL > 0) {
		return detectionCache.detections;
	}

	const providers = Object.entries(PROVIDER_REGISTRY) as Array<[CloudProvider, ProviderConfig]>;
	const detections: CLIDetection[] = [];

	// Check all providers in parallel
	const results = await Promise.all(
		providers.map(async ([provider, config]) => {
			const installed = await isCliInstalled(config.cliName);

			if (!installed) {
				return {
					provider,
					cliName: config.cliName,
					installed: false,
					authStatus: "cli_not_installed" as AuthStatus,
				};
			}

			const auth = checkAuth(config, env);
			return {
				provider,
				cliName: config.cliName,
				installed: true,
				authStatus: (auth.authenticated ? "authenticated" : "not_authenticated") as AuthStatus,
				authMethod: auth.method,
				accountHint: auth.accountHint,
			};
		}),
	);

	detections.push(...results);

	// Cache results
	if (cacheTTL > 0) {
		detectionCache = { detections, expiresAt: Date.now() + cacheTTL };
	}

	return detections;
}

/** Clear the detection cache (for testing). */
export function clearDetectionCache(): void {
	detectionCache = null;
}

// ─── Query Analysis ─────────────────────────────────────────────────────────

/**
 * Detect cloud service category from a user query.
 */
export function detectServiceFromQuery(query: string, tokens: string[]): CloudServiceCategory | null {
	const lower = query.toLowerCase();

	// Check multi-word phrases first
	for (const [phrase, category] of CLOUD_SERVICE_KEYWORDS) {
		if (phrase.includes(" ") && lower.includes(phrase)) {
			return category;
		}
	}

	// Check single-word tokens
	for (const token of tokens) {
		const category = CLOUD_SERVICE_KEYWORDS.get(token);
		if (category) return category;
	}

	return null;
}

/**
 * Detect cloud provider from a user query.
 */
export function detectProviderFromQuery(tokens: string[]): CloudProvider | null {
	// Score each provider by keyword hits (some keywords overlap — pick strongest)
	const scores = new Map<CloudProvider, number>();

	for (const token of tokens) {
		const provider = CLOUD_PROVIDER_KEYWORDS.get(token);
		if (provider) {
			scores.set(provider, (scores.get(provider) ?? 0) + 1);
		}
	}

	if (scores.size === 0) return null;

	// Return highest-scoring provider
	let best: CloudProvider | null = null;
	let bestScore = 0;
	for (const [provider, score] of scores) {
		if (score > bestScore) {
			best = provider;
			bestScore = score;
		}
	}
	return best;
}

// ─── Recipe Lookup ──────────────────────────────────────────────────────────

/**
 * Find a recipe for a given category and provider.
 */
export function findRecipe(category: CloudServiceCategory, provider: CloudProvider): CloudRecipe | null {
	return CLOUD_RECIPES.find((r) => r.category === category && r.provider === provider) ?? null;
}

/**
 * Find equivalent services across providers for a category.
 */
export function findEquivalents(category: CloudServiceCategory): CloudService[] {
	const equiv = SERVICE_EQUIVALENCES.find((e) => e.category === category);
	return equiv?.services ?? [];
}

// ─── Build Cloud Result ─────────────────────────────────────────────────────

/**
 * Build a complete cloud source result from analysis + detections.
 *
 * Logic:
 * 1. If requested provider is authenticated → return its recipe
 * 2. If requested provider is installed but not authed → auth guidance
 * 3. Find authenticated alternatives with recipes
 * 4. If nothing installed → install guidance
 */
export function buildCloudResult(
	analysis: TaskAnalysis,
	detections: CLIDetection[],
): CloudSourceResult {
	const ctx = analysis.cloudContext;
	const category = ctx?.requestedService ?? null;
	const requestedProvider = ctx?.requestedProvider ?? null;

	const result: CloudSourceResult = {
		alternatives: [],
		detections,
	};

	// No service category detected — can't do much
	if (!category) return result;

	// Find requested provider detection
	const requestedDetection = requestedProvider
		? detections.find((d) => d.provider === requestedProvider)
		: null;

	// Scenario A: Requested provider is authenticated
	if (requestedDetection?.authStatus === "authenticated") {
		const recipe = findRecipe(category, requestedProvider!);
		if (recipe) {
			result.recipe = recipe;
			return result;
		}
	}

	// Scenario B: Requested provider is installed but not authenticated
	if (requestedDetection?.installed && requestedDetection.authStatus === "not_authenticated") {
		const config = PROVIDER_REGISTRY[requestedProvider!];
		result.authGuidance = {
			provider: requestedProvider!,
			installed: true,
			loginCommand: config.loginCommand,
			docsUrl: config.authDocsUrl,
			envVarsNeeded: config.envVars,
		};
	}

	// Scenario C: Requested provider not installed
	if (requestedProvider && requestedDetection && !requestedDetection.installed) {
		const config = PROVIDER_REGISTRY[requestedProvider];
		result.installGuidance = {
			provider: requestedProvider,
			installed: false,
			installCommand: config.installCommand,
			docsUrl: config.docsUrl,
			envVarsNeeded: config.envVars,
		};
	}

	// Find authenticated alternatives
	const equivalents = findEquivalents(category);
	for (const service of equivalents) {
		// Skip the requested provider
		if (service.provider === requestedProvider) continue;

		const detection = detections.find((d) => d.provider === service.provider);
		if (detection?.authStatus === "authenticated") {
			const recipe = findRecipe(category, service.provider);
			if (recipe) {
				result.alternatives.push({
					provider: service.provider,
					serviceName: service.name,
					reason: `You're already authenticated with ${service.provider.toUpperCase()}`,
					recipe,
				});
			}
		}
	}

	// If no provider was requested and we found alternatives, promote the first one to primary recipe
	if (!result.recipe && !requestedProvider && result.alternatives.length > 0) {
		const promoted = result.alternatives.shift()!;
		result.recipe = promoted.recipe;
	}

	// If no recipe and no alternatives and no provider requested, check all authenticated
	if (!result.recipe && result.alternatives.length === 0 && !requestedProvider) {
		for (const equiv of equivalents) {
			const detection = detections.find((d) => d.provider === equiv.provider);
			if (detection?.authStatus === "authenticated") {
				const recipe = findRecipe(category, equiv.provider);
				if (recipe) {
					result.recipe = recipe;
					break;
				}
			}
		}
	}

	// If still nothing and no install guidance, provide generic install guidance
	if (!result.recipe && result.alternatives.length === 0 && !result.authGuidance && !result.installGuidance) {
		// No CLIs at all — suggest the most common provider for this category
		const firstEquiv = equivalents[0];
		if (firstEquiv) {
			const config = PROVIDER_REGISTRY[firstEquiv.provider];
			result.installGuidance = {
				provider: firstEquiv.provider,
				installed: false,
				installCommand: config.installCommand,
				loginCommand: config.loginCommand,
				docsUrl: config.docsUrl,
				envVarsNeeded: config.envVars,
			};
		}
	}

	return result;
}

// ─── Exports for testing ───────────────────────────────────────────────────

export {
	formatCloudDisplay,
	PROVIDER_REGISTRY,
	SERVICE_EQUIVALENCES,
	CLOUD_RECIPES,
	CLOUD_SERVICE_KEYWORDS,
	CLOUD_PROVIDER_KEYWORDS,
	checkAuth,
	isCliInstalled,
};
export type { ProviderConfig };
