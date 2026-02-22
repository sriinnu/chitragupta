/**
 * Megha Data Tables - Provider registry, service equivalences, and
 * cloud recipes for cloud CLI detection.
 *
 * Extracted from megha.ts to keep files under 450 LOC.
 *
 * @packageDocumentation
 */

import type {
	CloudProvider,
	CloudServiceCategory,
	CloudService,
	CloudRecipe,
	CloudRecipeStep,
} from "./megha-types.js";

// ─── Provider Registry ──────────────────────────────────────────────────────

export interface ProviderConfig {
	cliName: string;
	envVars: string[];
	credFile?: string;
	loginCommand: string;
	installCommand: string;
	docsUrl: string;
	authDocsUrl: string;
	accountEnvVar?: string;
}

export const PROVIDER_REGISTRY: Readonly<Record<CloudProvider, ProviderConfig>> = {
	aws: {
		cliName: "aws",
		envVars: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
		credFile: ".aws/credentials",
		loginCommand: "aws configure",
		installCommand: "brew install awscli",
		docsUrl: "https://docs.aws.amazon.com/cli/latest/userguide/",
		authDocsUrl: "https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html",
		accountEnvVar: "AWS_ACCESS_KEY_ID",
	},
	azure: {
		cliName: "az",
		envVars: ["AZURE_SUBSCRIPTION_ID", "AZURE_TENANT_ID"],
		credFile: ".azure/azureProfile.json",
		loginCommand: "az login",
		installCommand: "brew install azure-cli",
		docsUrl: "https://learn.microsoft.com/en-us/cli/azure/",
		authDocsUrl: "https://learn.microsoft.com/en-us/cli/azure/authenticate-azure-cli",
		accountEnvVar: "AZURE_SUBSCRIPTION_ID",
	},
	gcp: {
		cliName: "gcloud",
		envVars: ["GOOGLE_APPLICATION_CREDENTIALS"],
		credFile: ".config/gcloud/configurations/config_default",
		loginCommand: "gcloud auth login",
		installCommand: "brew install google-cloud-sdk",
		docsUrl: "https://cloud.google.com/sdk/docs",
		authDocsUrl: "https://cloud.google.com/sdk/docs/authorizing",
		accountEnvVar: "GOOGLE_APPLICATION_CREDENTIALS",
	},
	cloudflare: {
		cliName: "wrangler",
		envVars: ["CLOUDFLARE_API_TOKEN"],
		loginCommand: "wrangler login",
		installCommand: "npm i -g wrangler",
		docsUrl: "https://developers.cloudflare.com/workers/wrangler/",
		authDocsUrl: "https://developers.cloudflare.com/workers/wrangler/configuration/",
		accountEnvVar: "CLOUDFLARE_API_TOKEN",
	},
	digitalocean: {
		cliName: "doctl",
		envVars: ["DIGITALOCEAN_ACCESS_TOKEN"],
		credFile: ".config/doctl/config.yaml",
		loginCommand: "doctl auth init",
		installCommand: "brew install doctl",
		docsUrl: "https://docs.digitalocean.com/reference/doctl/",
		authDocsUrl: "https://docs.digitalocean.com/reference/doctl/reference/auth/",
		accountEnvVar: "DIGITALOCEAN_ACCESS_TOKEN",
	},
};

// ─── Service Equivalences ───────────────────────────────────────────────────

export const SERVICE_EQUIVALENCES: ReadonlyArray<{ category: CloudServiceCategory; services: CloudService[] }> = [
	{
		category: "storage",
		services: [
			{ provider: "aws", category: "storage", name: "S3", cliCommand: "aws s3" },
			{ provider: "azure", category: "storage", name: "Blob Storage", cliCommand: "az storage blob" },
			{ provider: "gcp", category: "storage", name: "Cloud Storage", cliCommand: "gsutil" },
			{ provider: "cloudflare", category: "storage", name: "R2", cliCommand: "wrangler r2" },
			{ provider: "digitalocean", category: "storage", name: "Spaces", cliCommand: "doctl compute cdn" },
		],
	},
	{
		category: "serverless",
		services: [
			{ provider: "aws", category: "serverless", name: "Lambda", cliCommand: "aws lambda" },
			{ provider: "azure", category: "serverless", name: "Functions", cliCommand: "az functionapp" },
			{ provider: "gcp", category: "serverless", name: "Cloud Functions", cliCommand: "gcloud functions" },
			{ provider: "cloudflare", category: "serverless", name: "Workers", cliCommand: "wrangler deploy" },
		],
	},
	{
		category: "compute",
		services: [
			{ provider: "aws", category: "compute", name: "EC2", cliCommand: "aws ec2" },
			{ provider: "azure", category: "compute", name: "Virtual Machines", cliCommand: "az vm" },
			{ provider: "gcp", category: "compute", name: "Compute Engine", cliCommand: "gcloud compute instances" },
			{ provider: "digitalocean", category: "compute", name: "Droplets", cliCommand: "doctl compute droplet" },
		],
	},
	{
		category: "container",
		services: [
			{ provider: "aws", category: "container", name: "EKS", cliCommand: "aws eks" },
			{ provider: "azure", category: "container", name: "AKS", cliCommand: "az aks" },
			{ provider: "gcp", category: "container", name: "GKE", cliCommand: "gcloud container clusters" },
			{ provider: "digitalocean", category: "container", name: "Kubernetes", cliCommand: "doctl kubernetes" },
		],
	},
	{
		category: "database",
		services: [
			{ provider: "aws", category: "database", name: "RDS", cliCommand: "aws rds" },
			{ provider: "azure", category: "database", name: "Azure SQL", cliCommand: "az sql server" },
			{ provider: "gcp", category: "database", name: "Cloud SQL", cliCommand: "gcloud sql instances" },
			{ provider: "digitalocean", category: "database", name: "Managed Databases", cliCommand: "doctl databases" },
		],
	},
	{
		category: "network",
		services: [
			{ provider: "aws", category: "network", name: "VPC", cliCommand: "aws ec2 create-vpc" },
			{ provider: "azure", category: "network", name: "VNet", cliCommand: "az network vnet" },
			{ provider: "gcp", category: "network", name: "VPC", cliCommand: "gcloud compute networks" },
		],
	},
	{
		category: "cdn",
		services: [
			{ provider: "aws", category: "cdn", name: "CloudFront", cliCommand: "aws cloudfront" },
			{ provider: "azure", category: "cdn", name: "CDN", cliCommand: "az cdn" },
			{ provider: "gcp", category: "cdn", name: "Cloud CDN", cliCommand: "gcloud compute backend-services" },
			{ provider: "cloudflare", category: "cdn", name: "CDN", cliCommand: "wrangler" },
		],
	},
	{
		category: "dns",
		services: [
			{ provider: "aws", category: "dns", name: "Route 53", cliCommand: "aws route53" },
			{ provider: "azure", category: "dns", name: "Azure DNS", cliCommand: "az network dns" },
			{ provider: "gcp", category: "dns", name: "Cloud DNS", cliCommand: "gcloud dns" },
			{ provider: "cloudflare", category: "dns", name: "DNS", cliCommand: "wrangler dns" },
		],
	},
	{
		category: "monitoring",
		services: [
			{ provider: "aws", category: "monitoring", name: "CloudWatch", cliCommand: "aws cloudwatch" },
			{ provider: "azure", category: "monitoring", name: "Monitor", cliCommand: "az monitor" },
			{ provider: "gcp", category: "monitoring", name: "Cloud Monitoring", cliCommand: "gcloud monitoring" },
		],
	},
	{
		category: "iac",
		services: [
			{ provider: "aws", category: "iac", name: "CloudFormation", cliCommand: "aws cloudformation" },
			{ provider: "azure", category: "iac", name: "ARM Templates", cliCommand: "az deployment group" },
			{ provider: "gcp", category: "iac", name: "Deployment Manager", cliCommand: "gcloud deployment-manager" },
		],
	},
];

// ─── Cloud Recipes ──────────────────────────────────────────────────────────

export const CLOUD_RECIPES: ReadonlyArray<CloudRecipe> = [
	// ── Storage ─────────────────────────────
	{
		id: "aws-s3-create",
		category: "storage",
		provider: "aws",
		name: "Create S3 Bucket",
		description: "Create an S3 bucket for object storage",
		steps: [
			{ order: 1, description: "Create bucket", command: "aws s3 mb s3://{bucket_name} --region {region}", mutatesState: true, rollbackCommand: "aws s3 rb s3://{bucket_name}" },
			{ order: 2, description: "Verify bucket", command: "aws s3 ls s3://{bucket_name}", mutatesState: false },
		],
		placeholders: { bucket_name: "Globally unique bucket name", region: "AWS region (e.g., us-east-1)" },
		estimatedCost: "Free tier: 5GB, 20K GET, 2K PUT requests/month",
		docsUrl: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/",
	},
	{
		id: "azure-blob-create",
		category: "storage",
		provider: "azure",
		name: "Create Azure Blob Storage",
		description: "Create a storage account and blob container",
		steps: [
			{ order: 1, description: "Create resource group", command: "az group create --name {resource_group} --location {location}", mutatesState: true, rollbackCommand: "az group delete --name {resource_group} --yes" },
			{ order: 2, description: "Create storage account", command: "az storage account create --name {storage_account} --resource-group {resource_group} --location {location} --sku Standard_LRS", mutatesState: true },
			{ order: 3, description: "Create blob container", command: "az storage container create --name {container_name} --account-name {storage_account}", mutatesState: true },
		],
		placeholders: {
			resource_group: "Name for the resource group",
			storage_account: "Storage account name (lowercase, 3-24 chars)",
			container_name: "Blob container name",
			location: "Azure region (e.g., eastus, westus2)",
		},
		estimatedCost: "~$0.018/GB/month (LRS)",
		docsUrl: "https://learn.microsoft.com/en-us/cli/azure/storage",
	},
	{
		id: "gcp-gcs-create",
		category: "storage",
		provider: "gcp",
		name: "Create Cloud Storage Bucket",
		description: "Create a Google Cloud Storage bucket",
		steps: [
			{ order: 1, description: "Create bucket", command: "gsutil mb -l {location} gs://{bucket_name}/", mutatesState: true, rollbackCommand: "gsutil rb gs://{bucket_name}/" },
			{ order: 2, description: "Verify bucket", command: "gsutil ls gs://{bucket_name}/", mutatesState: false },
		],
		placeholders: { bucket_name: "Globally unique bucket name", location: "GCP region (e.g., us-central1)" },
		estimatedCost: "Free tier: 5GB Standard storage/month",
		docsUrl: "https://cloud.google.com/storage/docs",
	},
	// ── Serverless ──────────────────────────
	{
		id: "aws-lambda-deploy",
		category: "serverless",
		provider: "aws",
		name: "Deploy Lambda Function",
		description: "Create and deploy an AWS Lambda function",
		steps: [
			{ order: 1, description: "Create function zip", command: "zip {function_name}.zip index.js", mutatesState: false },
			{ order: 2, description: "Create Lambda function", command: "aws lambda create-function --function-name {function_name} --runtime nodejs20.x --role {role_arn} --handler index.handler --zip-file fileb://{function_name}.zip", mutatesState: true, rollbackCommand: "aws lambda delete-function --function-name {function_name}" },
			{ order: 3, description: "Verify function", command: "aws lambda get-function --function-name {function_name}", mutatesState: false },
		],
		placeholders: { function_name: "Lambda function name", role_arn: "IAM role ARN for Lambda execution" },
		estimatedCost: "Free tier: 1M requests, 400K GB-seconds/month",
		docsUrl: "https://docs.aws.amazon.com/lambda/latest/dg/",
	},
	{
		id: "azure-function-deploy",
		category: "serverless",
		provider: "azure",
		name: "Deploy Azure Function",
		description: "Create and deploy an Azure Functions app",
		steps: [
			{ order: 1, description: "Create function app", command: "az functionapp create --name {app_name} --resource-group {resource_group} --consumption-plan-location {location} --runtime node --functions-version 4 --storage-account {storage_account}", mutatesState: true },
			{ order: 2, description: "Deploy function", command: "func azure functionapp publish {app_name}", mutatesState: true },
		],
		placeholders: {
			app_name: "Function app name (globally unique)",
			resource_group: "Resource group name",
			location: "Azure region (e.g., eastus)",
			storage_account: "Storage account for function state",
		},
		estimatedCost: "Free tier: 1M executions/month",
		docsUrl: "https://learn.microsoft.com/en-us/azure/azure-functions/",
	},
	{
		id: "gcp-function-deploy",
		category: "serverless",
		provider: "gcp",
		name: "Deploy Cloud Function",
		description: "Deploy a Google Cloud Function",
		steps: [
			{ order: 1, description: "Deploy function", command: "gcloud functions deploy {function_name} --runtime nodejs20 --trigger-http --allow-unauthenticated --region {region}", mutatesState: true, rollbackCommand: "gcloud functions delete {function_name} --region {region} --quiet" },
			{ order: 2, description: "Get function URL", command: "gcloud functions describe {function_name} --region {region} --format='value(httpsTrigger.url)'", mutatesState: false },
		],
		placeholders: { function_name: "Cloud Function name", region: "GCP region (e.g., us-central1)" },
		estimatedCost: "Free tier: 2M invocations/month",
		docsUrl: "https://cloud.google.com/functions/docs",
	},
	// ── Compute ─────────────────────────────
	{
		id: "aws-ec2-launch",
		category: "compute",
		provider: "aws",
		name: "Launch EC2 Instance",
		description: "Launch an EC2 virtual machine",
		steps: [
			{ order: 1, description: "Launch instance", command: "aws ec2 run-instances --image-id {ami_id} --instance-type {instance_type} --key-name {key_name} --count 1", mutatesState: true },
			{ order: 2, description: "List running instances", command: "aws ec2 describe-instances --filters Name=instance-state-name,Values=running --query 'Reservations[*].Instances[*].[InstanceId,PublicIpAddress]' --output table", mutatesState: false },
		],
		placeholders: { ami_id: "AMI ID (e.g., ami-0c55b159cbfafe1f0)", instance_type: "Instance type (e.g., t2.micro)", key_name: "SSH key pair name" },
		estimatedCost: "Free tier: 750 hrs/month t2.micro (12 months)",
		docsUrl: "https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/",
	},
	{
		id: "azure-vm-create",
		category: "compute",
		provider: "azure",
		name: "Create Azure VM",
		description: "Create an Azure virtual machine",
		steps: [
			{ order: 1, description: "Create VM", command: "az vm create --resource-group {resource_group} --name {vm_name} --image {image} --size {size} --admin-username {admin_user} --generate-ssh-keys", mutatesState: true },
			{ order: 2, description: "Show VM details", command: "az vm show --resource-group {resource_group} --name {vm_name} --show-details --output table", mutatesState: false },
		],
		placeholders: { resource_group: "Resource group name", vm_name: "VM name", image: "VM image (e.g., Ubuntu2204)", size: "VM size (e.g., Standard_B1s)", admin_user: "Admin username" },
		estimatedCost: "Free tier: 750 hrs/month B1s (12 months)",
		docsUrl: "https://learn.microsoft.com/en-us/azure/virtual-machines/",
	},
	{
		id: "gcp-compute-launch",
		category: "compute",
		provider: "gcp",
		name: "Launch Compute Engine Instance",
		description: "Launch a GCP Compute Engine VM",
		steps: [
			{ order: 1, description: "Create instance", command: "gcloud compute instances create {instance_name} --zone {zone} --machine-type {machine_type} --image-family {image_family} --image-project {image_project}", mutatesState: true, rollbackCommand: "gcloud compute instances delete {instance_name} --zone {zone} --quiet" },
			{ order: 2, description: "List instances", command: "gcloud compute instances list", mutatesState: false },
		],
		placeholders: { instance_name: "Instance name", zone: "GCP zone (e.g., us-central1-a)", machine_type: "Machine type (e.g., e2-micro)", image_family: "Image family (e.g., debian-11)", image_project: "Image project (e.g., debian-cloud)" },
		estimatedCost: "Free tier: 1 e2-micro instance/month",
		docsUrl: "https://cloud.google.com/compute/docs",
	},
	// ── Container ───────────────────────────
	{
		id: "aws-eks-create",
		category: "container",
		provider: "aws",
		name: "Create EKS Cluster",
		description: "Create an Amazon EKS Kubernetes cluster",
		steps: [
			{ order: 1, description: "Create cluster", command: "aws eks create-cluster --name {cluster_name} --role-arn {role_arn} --resources-vpc-config subnetIds={subnet_ids}", mutatesState: true },
			{ order: 2, description: "Wait for cluster active", command: "aws eks wait cluster-active --name {cluster_name}", mutatesState: false },
			{ order: 3, description: "Update kubeconfig", command: "aws eks update-kubeconfig --name {cluster_name}", mutatesState: false },
		],
		placeholders: { cluster_name: "EKS cluster name", role_arn: "IAM role ARN for EKS", subnet_ids: "Comma-separated subnet IDs" },
		estimatedCost: "~$0.10/hr per cluster + node costs",
		docsUrl: "https://docs.aws.amazon.com/eks/latest/userguide/",
	},
	{
		id: "azure-aks-create",
		category: "container",
		provider: "azure",
		name: "Create AKS Cluster",
		description: "Create an Azure Kubernetes Service cluster",
		steps: [
			{ order: 1, description: "Create AKS cluster", command: "az aks create --resource-group {resource_group} --name {cluster_name} --node-count {node_count} --generate-ssh-keys", mutatesState: true },
			{ order: 2, description: "Get credentials", command: "az aks get-credentials --resource-group {resource_group} --name {cluster_name}", mutatesState: false },
			{ order: 3, description: "Verify cluster", command: "kubectl get nodes", mutatesState: false },
		],
		placeholders: { resource_group: "Resource group name", cluster_name: "AKS cluster name", node_count: "Number of nodes (e.g., 1)" },
		estimatedCost: "Free control plane, pay for nodes",
		docsUrl: "https://learn.microsoft.com/en-us/azure/aks/",
	},
	{
		id: "gcp-gke-create",
		category: "container",
		provider: "gcp",
		name: "Create GKE Cluster",
		description: "Create a Google Kubernetes Engine cluster",
		steps: [
			{ order: 1, description: "Create cluster", command: "gcloud container clusters create {cluster_name} --zone {zone} --num-nodes {node_count}", mutatesState: true, rollbackCommand: "gcloud container clusters delete {cluster_name} --zone {zone} --quiet" },
			{ order: 2, description: "Get credentials", command: "gcloud container clusters get-credentials {cluster_name} --zone {zone}", mutatesState: false },
			{ order: 3, description: "Verify cluster", command: "kubectl get nodes", mutatesState: false },
		],
		placeholders: { cluster_name: "GKE cluster name", zone: "GCP zone (e.g., us-central1-a)", node_count: "Number of nodes (e.g., 1)" },
		estimatedCost: "Free tier: 1 zonal cluster (no management fee)",
		docsUrl: "https://cloud.google.com/kubernetes-engine/docs",
	},
	// ── Database ────────────────────────────
	{
		id: "aws-rds-create",
		category: "database",
		provider: "aws",
		name: "Create RDS Instance",
		description: "Create an Amazon RDS database instance",
		steps: [
			{ order: 1, description: "Create DB instance", command: "aws rds create-db-instance --db-instance-identifier {db_name} --db-instance-class {instance_class} --engine {engine} --master-username {username} --master-user-password {password} --allocated-storage {storage_gb}", mutatesState: true, rollbackCommand: "aws rds delete-db-instance --db-instance-identifier {db_name} --skip-final-snapshot" },
			{ order: 2, description: "Wait for availability", command: "aws rds wait db-instance-available --db-instance-identifier {db_name}", mutatesState: false },
		],
		placeholders: { db_name: "DB instance identifier", instance_class: "Instance class (e.g., db.t3.micro)", engine: "Database engine (postgres, mysql, mariadb)", username: "Master username", password: "Master password", storage_gb: "Allocated storage in GB (e.g., 20)" },
		estimatedCost: "Free tier: 750 hrs/month db.t3.micro (12 months)",
		docsUrl: "https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/",
	},
	{
		id: "azure-sql-create",
		category: "database",
		provider: "azure",
		name: "Create Azure SQL Database",
		description: "Create an Azure SQL database",
		steps: [
			{ order: 1, description: "Create SQL server", command: "az sql server create --name {server_name} --resource-group {resource_group} --location {location} --admin-user {admin_user} --admin-password {admin_password}", mutatesState: true },
			{ order: 2, description: "Create database", command: "az sql db create --resource-group {resource_group} --server {server_name} --name {db_name} --service-objective {tier}", mutatesState: true },
		],
		placeholders: { server_name: "SQL server name (globally unique)", resource_group: "Resource group name", location: "Azure region", admin_user: "Admin username", admin_password: "Admin password", db_name: "Database name", tier: "Service tier (e.g., Basic, S0)" },
		estimatedCost: "Basic tier: ~$5/month",
		docsUrl: "https://learn.microsoft.com/en-us/azure/azure-sql/",
	},
	{
		id: "gcp-cloudsql-create",
		category: "database",
		provider: "gcp",
		name: "Create Cloud SQL Instance",
		description: "Create a Google Cloud SQL database instance",
		steps: [
			{ order: 1, description: "Create instance", command: "gcloud sql instances create {instance_name} --database-version={db_version} --tier={tier} --region={region} --root-password={password}", mutatesState: true, rollbackCommand: "gcloud sql instances delete {instance_name} --quiet" },
			{ order: 2, description: "Create database", command: "gcloud sql databases create {db_name} --instance={instance_name}", mutatesState: true },
		],
		placeholders: { instance_name: "Cloud SQL instance name", db_version: "Database version (e.g., POSTGRES_15, MYSQL_8_0)", tier: "Machine tier (e.g., db-f1-micro)", region: "GCP region", password: "Root password", db_name: "Database name" },
		estimatedCost: "db-f1-micro: ~$7.67/month",
		docsUrl: "https://cloud.google.com/sql/docs",
	},
];

