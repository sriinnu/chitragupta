/**
 * Takumi Bridge — Chitragupta -> Takumi child-process communication.
 *
 * Talks to Takumi through its current one-shot CLI surface. The preferred
 * compatibility path is structured NDJSON streaming via:
 *
 *   takumi --print --stream ndjson --cwd <dir>
 *
 * If that surface is unavailable, the bridge falls back to plain text mode:
 *
 *   takumi --print --cwd <dir>
 *
 * Context is injected into the synthesized prompt and also exported as env
 * vars for forward compatibility with future Takumi-side bridge support.
 *
 * @module
 */

import { execFile, spawn, type ChildProcess } from "node:child_process";
import type {
	TakumiBridgeOptions,
	TakumiBridgeStatus,
	TakumiContext,
	TakumiExecutionObject,
	TakumiEvent,
	TakumiNormalizedResponse,
	TakumiRequest,
	TakumiResponse,
} from "./takumi-bridge-types.js";
import {
	commandOnPath,
	getVersion,
	parseCliOutput,
	safeJsonParse,
} from "./takumi-bridge-helpers.js";
import {
	auditTakumiResponseAgainstContract,
	buildContextEnv,
	buildPrompt,
	extractErrorMessage,
	inspectTakumiContextContract,
	resolveCacheIntent,
	shouldFallbackToCli,
} from "./takumi-bridge-context.js";
import {
	attachTakumiExecutionContract,
	ensureTakumiRequestIdentity,
} from "./takumi-bridge-contract.js";

// Re-export helpers for backward-compat / convenience
export {
	commandOnPath,
	getVersion,
	parseCliOutput,
	probeRpc,
} from "./takumi-bridge-helpers.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_COMMAND = "takumi";
const DETECT_TIMEOUT_MS = 5_000;
type TakumiBridgeRawResponse = Omit<TakumiResponse, "execution" | "taskId" | "laneId" | "finalReport" | "artifacts">;
type TakumiExecutionIdentity = {
	execution: TakumiExecutionObject;
	taskId: string;
	laneId: string;
};

export class TakumiBridge {
	private readonly command: string;
	private readonly cwd: string;
	private readonly timeout: number;
	private readonly projectPath: string;
	private status: TakumiBridgeStatus | null = null;
	private injectedContext: TakumiContext | null = null;
	private activeProcess: ChildProcess | null = null;

	constructor(options: TakumiBridgeOptions) {
		this.command = options.command ?? DEFAULT_COMMAND;
		this.cwd = options.cwd;
		this.timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
		this.projectPath = options.projectPath ?? options.cwd;
	}

	async detect(): Promise<TakumiBridgeStatus> {
		if (this.status !== null) return this.status;

		const exists = await commandOnPath(this.command);
		if (!exists) {
			this.status = { mode: "unavailable", command: this.command };
			return this.status;
		}

		const [version, streamSupported] = await Promise.all([
			getVersion(this.command),
			this._supportsStructuredStream(),
		]);

		this.status = {
			mode: streamSupported ? "rpc" : "cli",
			command: this.command,
			version: version ?? undefined,
		};
		return this.status;
	}

	async execute(
		request: TakumiRequest,
		onEvent?: (event: TakumiEvent) => void,
	): Promise<TakumiNormalizedResponse> {
		request = ensureTakumiRequestIdentity(request);
		const status = await this.detect();

		if (this.injectedContext) {
			request = {
				...request,
				context: { ...this.injectedContext, ...request.context },
			};
			this.injectedContext = null;
		}
		const contractInspection = inspectTakumiContextContract(request.context);
		if (contractInspection.violations.length > 0) {
			return attachTakumiExecutionContract(request, request.context, {
				type: "result",
				modeUsed: status.mode === "rpc" ? "rpc" : "cli",
				cacheIntent: resolveCacheIntent(request.context),
				filesModified: [],
				toolCalls: [],
				output: [
					"Takumi execution blocked by the Chitragupta engine route contract.",
					...contractInspection.violations.map((violation) => `- ${violation}`),
				].join("\n"),
				exitCode: 1,
			});
		}

		if (status.mode === "unavailable") {
			return attachTakumiExecutionContract(request, request.context, {
				type: "result",
				modeUsed: "cli",
				cacheIntent: resolveCacheIntent(request.context),
				filesModified: [],
				toolCalls: [],
				output:
					`Takumi is not available on PATH.\n` +
					`Install: https://github.com/sriinnu/takumi\n` +
					`Or set a custom command in TakumiBridgeOptions.`,
				exitCode: 127,
			});
		}

		const prompt = await buildPrompt(request.task, this.projectPath, request.context);
		if (status.mode === "rpc") {
			const structuredResult = await this._spawnRpc(
				prompt,
				request.context,
				{ execution: request.execution!, taskId: request.taskId!, laneId: request.laneId! },
				onEvent,
			);
			if (shouldFallbackToCli(structuredResult)) {
				const cliResult = await this._spawnCli(
					prompt,
					request.context,
					{ execution: request.execution!, taskId: request.taskId!, laneId: request.laneId! },
					onEvent,
				);
				return attachTakumiExecutionContract(
					request,
					request.context,
					auditTakumiResponseAgainstContract(request.context, cliResult),
				);
			}
			return attachTakumiExecutionContract(
				request,
				request.context,
				auditTakumiResponseAgainstContract(request.context, structuredResult),
			);
		}

		const cliResult = await this._spawnCli(
			prompt,
			request.context,
			{ execution: request.execution!, taskId: request.taskId!, laneId: request.laneId! },
			onEvent,
		);
		return attachTakumiExecutionContract(
			request,
			request.context,
			auditTakumiResponseAgainstContract(request.context, cliResult),
		);
	}

	injectContext(context: TakumiContext): void {
		this.injectedContext = context;
	}

	getStatus(): TakumiBridgeStatus | null {
		return this.status;
	}

	resetDetection(): void {
		this.status = null;
	}

	dispose(): void {
		if (this.activeProcess && !this.activeProcess.killed) {
			this.activeProcess.kill("SIGTERM");
		}
		this.activeProcess = null;
		this.injectedContext = null;
	}

	private _spawnRpc(
		prompt: string,
		context: TakumiContext | undefined,
		identity: TakumiExecutionIdentity,
		onEvent?: (event: TakumiEvent) => void,
	): Promise<TakumiBridgeRawResponse> {
		return new Promise((resolve) => {
			const args = ["--print", "--stream", "ndjson", "--cwd", this.cwd];
			const proc = spawn(this.command, args, {
				cwd: this.cwd,
				stdio: ["pipe", "pipe", "pipe"],
				env: { ...process.env, ...buildContextEnv(context) },
			});
			this.activeProcess = proc;

				const chunks: string[] = [];
				let sawErrorEvent = false;
				let buffered = "";
				const toolCalls: string[] = [];

			const timer = setTimeout(() => {
				proc.kill("SIGTERM");
			}, this.timeout);

			const flushLine = (line: string) => {
				const parsed = safeJsonParse(line);
				if (!parsed) {
						if (line.trim()) {
							chunks.push(line.endsWith("\n") ? line : `${line}\n`);
							onEvent?.({ ...identity, type: "progress", data: line });
						}
					return;
				}

				const eventType =
					typeof parsed.type === "string" ? parsed.type : undefined;
				switch (eventType) {
					case "text_delta":
					case "text_done":
					case "thinking_delta":
					case "thinking_done": {
						const text =
							typeof parsed.text === "string" ? parsed.text : "";
							if (text) {
								chunks.push(text);
								onEvent?.({ ...identity, type: "progress", data: text });
							}
						break;
					}
						case "tool_use": {
							const name =
								typeof parsed.name === "string" ? parsed.name : "tool";
							toolCalls.push(name);
							onEvent?.({ ...identity, type: "tool_call", data: name });
							break;
						}
					case "tool_result": {
						const output =
							typeof parsed.output === "string" ? parsed.output : "";
						if (output) {
							chunks.push(output.endsWith("\n") ? output : `${output}\n`);
								onEvent?.({
									...identity,
									type: parsed.isError === true ? "error" : "progress",
									data: output,
								});
						}
						if (parsed.isError === true) sawErrorEvent = true;
						break;
					}
					case "error": {
						const message = extractErrorMessage(parsed.error);
							if (message) {
								chunks.push(`Error: ${message}\n`);
								onEvent?.({ ...identity, type: "error", data: message });
							}
						sawErrorEvent = true;
						break;
					}
					default:
						break;
				}
			};

			proc.stdout?.on("data", (chunk: Buffer) => {
				buffered += chunk.toString("utf-8");
				const lines = buffered.split("\n");
				buffered = lines.pop() ?? "";
				for (const line of lines) flushLine(line);
			});

			proc.stderr?.on("data", (chunk: Buffer) => {
				chunks.push(chunk.toString("utf-8"));
			});

			proc.on("error", (err) => {
				clearTimeout(timer);
				this.activeProcess = null;
						resolve({
							type: "result",
							modeUsed: "rpc",
							cacheIntent: resolveCacheIntent(context),
							filesModified: [],
							toolCalls: [],
							output: `Failed to spawn ${this.command}: ${err.message}`,
							exitCode: 1,
						});
			});

			proc.on("close", (code) => {
				clearTimeout(timer);
				this.activeProcess = null;
				if (buffered.trim()) flushLine(buffered);

				const output = chunks.join("");
				const parsed = parseCliOutput(output);
				const exitCode = sawErrorEvent && (code ?? 0) === 0 ? 1 : (code ?? 1);

						resolve({
							type: "result",
							modeUsed: "rpc",
							cacheIntent: resolveCacheIntent(context),
							filesModified: parsed.filesModified,
							testsRun: parsed.testsRun,
							toolCalls,
							diffSummary: parsed.diffSummary,
							output,
							exitCode,
						});
			});

			proc.stdin?.write(prompt);
			proc.stdin?.end();
		});
	}

	private _spawnCli(
		prompt: string,
		context: TakumiContext | undefined,
		identity: TakumiExecutionIdentity,
		onEvent?: (event: TakumiEvent) => void,
	): Promise<TakumiBridgeRawResponse> {
		return new Promise((resolve) => {
			const args = this._buildCliArgs();
			const proc = spawn(this.command, args, {
				cwd: this.cwd,
				stdio: ["pipe", "pipe", "pipe"],
				env: { ...process.env, ...buildContextEnv(context) },
			});
			this.activeProcess = proc;

			const chunks: string[] = [];

			const timer = setTimeout(() => {
				proc.kill("SIGTERM");
			}, this.timeout);

				const collect = (chunk: Buffer) => {
					const text = chunk.toString("utf-8");
					chunks.push(text);
					onEvent?.({ ...identity, type: "progress", data: text });
				};

			proc.stdout?.on("data", collect);
			proc.stderr?.on("data", collect);

			proc.on("error", (err) => {
				clearTimeout(timer);
				this.activeProcess = null;
						resolve({
							type: "result",
							modeUsed: "cli",
							cacheIntent: resolveCacheIntent(context),
							filesModified: [],
							toolCalls: [],
							output: `Failed to spawn ${this.command}: ${err.message}`,
							exitCode: 1,
						});
			});

			proc.on("close", (code) => {
				clearTimeout(timer);
				this.activeProcess = null;
				const output = chunks.join("");
				const parsed = parseCliOutput(output);

						resolve({
							type: "result",
							modeUsed: "cli",
							cacheIntent: resolveCacheIntent(context),
							filesModified: parsed.filesModified,
							testsRun: parsed.testsRun,
							toolCalls: [],
							diffSummary: parsed.diffSummary,
							output,
							exitCode: code ?? 1,
						});
			});

			proc.stdin?.write(prompt);
			proc.stdin?.end();
		});
	}

	private _buildCliArgs(): string[] {
		return ["--print", "--cwd", this.cwd];
	}

	private _supportsStructuredStream(): Promise<boolean> {
		return new Promise((resolve) => {
			execFile(
				this.command,
				["--help", "--stream", "ndjson"],
				{ cwd: this.cwd, timeout: DETECT_TIMEOUT_MS },
				(error, stdout, stderr) => {
					const output = `${stdout ?? ""}\n${stderr ?? ""}`;
					if (output.includes("Unknown option: --stream")) {
						resolve(false);
						return;
					}
					resolve(!error || !/Unknown option/i.test(output));
				},
			);
		});
	}
}
