/**
 * Megha (मेघ — Cloud) — Cloud-Aware Shiksha Types.
 *
 * Types for cloud CLI detection, service mapping, recipes,
 * auth guidance, and alternative suggestions.
 *
 * @packageDocumentation
 */

// ─── Cloud Provider ──────────────────────────────────────────────────────────

/** Supported cloud providers. */
export type CloudProvider = "aws" | "azure" | "gcp" | "cloudflare" | "digitalocean";

// ─── Service Category ────────────────────────────────────────────────────────

/** Cloud service categories with cross-provider equivalences. */
export type CloudServiceCategory =
	| "storage"
	| "compute"
	| "serverless"
	| "database"
	| "container"
	| "network"
	| "cdn"
	| "dns"
	| "monitoring"
	| "iac";

// ─── Auth Status ─────────────────────────────────────────────────────────────

/** Authentication state of a cloud CLI. */
export type AuthStatus = "authenticated" | "not_authenticated" | "cli_not_installed";

// ─── CLI Detection ───────────────────────────────────────────────────────────

/** Result of detecting a cloud CLI on the local system. */
export interface CLIDetection {
	/** Cloud provider. */
	provider: CloudProvider;
	/** CLI binary name (e.g., "aws", "az", "gcloud"). */
	cliName: string;
	/** Whether the CLI binary is installed. */
	installed: boolean;
	/** Authentication status. */
	authStatus: AuthStatus;
	/** How auth was detected (e.g., "env_vars", "credentials_file"). */
	authMethod?: string;
	/** Masked account hint for display (e.g., "sub-***23"). */
	accountHint?: string;
}

// ─── Cloud Service ───────────────────────────────────────────────────────────

/** A specific cloud service within a category. */
export interface CloudService {
	/** Cloud provider. */
	provider: CloudProvider;
	/** Service category. */
	category: CloudServiceCategory;
	/** Display name (e.g., "S3", "Blob Storage"). */
	name: string;
	/** CLI command prefix (e.g., "aws s3", "az storage blob"). */
	cliCommand: string;
}

// ─── Cloud Recipe ────────────────────────────────────────────────────────────

/** A single step in a cloud recipe. */
export interface CloudRecipeStep {
	/** Step order (1-based). */
	order: number;
	/** Human-readable description. */
	description: string;
	/** Shell command with {placeholders}. */
	command: string;
	/** Whether this step mutates cloud state. */
	mutatesState: boolean;
	/** Undo command (if reversible). */
	rollbackCommand?: string;
}

/** A pre-built recipe for a common cloud task. */
export interface CloudRecipe {
	/** Unique recipe ID (e.g., "aws-s3-create"). */
	id: string;
	/** Service category. */
	category: CloudServiceCategory;
	/** Cloud provider. */
	provider: CloudProvider;
	/** Display name (e.g., "Create S3 Bucket"). */
	name: string;
	/** Description. */
	description: string;
	/** Ordered steps. */
	steps: CloudRecipeStep[];
	/** Placeholder descriptions (e.g., { bucket_name: "Globally unique name" }). */
	placeholders: Record<string, string>;
	/** Estimated cost string (e.g., "~$0.023/GB/month"). */
	estimatedCost?: string;
	/** Documentation URL. */
	docsUrl?: string;
}

// ─── Auth Guidance ───────────────────────────────────────────────────────────

/** Guidance for authenticating or installing a cloud CLI. */
export interface AuthGuidance {
	/** Cloud provider. */
	provider: CloudProvider;
	/** Whether the CLI is installed. */
	installed: boolean;
	/** Install command (e.g., "brew install awscli"). */
	installCommand?: string;
	/** Login command (e.g., "aws configure"). */
	loginCommand?: string;
	/** Documentation URL. */
	docsUrl: string;
	/** Environment variables needed for auth. */
	envVarsNeeded?: string[];
}

// ─── Alternative Suggestion ──────────────────────────────────────────────────

/** An alternative cloud service the user is already authenticated with. */
export interface AlternativeSuggestion {
	/** Cloud provider of the alternative. */
	provider: CloudProvider;
	/** Service name (e.g., "S3"). */
	serviceName: string;
	/** Why this is suggested (e.g., "You're already authenticated with AWS"). */
	reason: string;
	/** Pre-built recipe for the alternative. */
	recipe: CloudRecipe;
}

// ─── Cloud Context ───────────────────────────────────────────────────────────

/** Cloud-specific context extracted from a user query. */
export interface CloudContext {
	/** Detected provider from query (e.g., "azure" from "set up azure blob"). */
	requestedProvider?: CloudProvider;
	/** Detected service category (e.g., "storage" from "blob storage"). */
	requestedService?: CloudServiceCategory;
	/** CLI detection results (populated by praptya). */
	detections: CLIDetection[];
}

// ─── Cloud Source Result ─────────────────────────────────────────────────────

/** Result of cloud-aware sourcing. */
export interface CloudSourceResult {
	/** Recipe for the requested (or alternative) service, if found. */
	recipe?: CloudRecipe;
	/** Auth guidance if CLI exists but not authenticated. */
	authGuidance?: AuthGuidance;
	/** Alternative services the user is already authenticated with. */
	alternatives: AlternativeSuggestion[];
	/** Install guidance if no CLI is installed at all. */
	installGuidance?: AuthGuidance;
	/** Full detection results. */
	detections: CLIDetection[];
}
