/**
 * Typed error hierarchy for Chitragupta.
 *
 * All Chitragupta errors extend {@link ChitraguptaError} with a machine-readable
 * `code` string for programmatic error handling.
 */

/**
 * Base error class for all Chitragupta errors.
 *
 * Carries a machine-readable `code` field (e.g. `"PROVIDER_ERROR"`) for
 * programmatic error detection in addition to the human-readable `message`.
 */
export class ChitraguptaError extends Error {
	readonly code: string;

	constructor(message: string, code: string, cause?: Error) {
		super(message, { cause });
		this.name = "ChitraguptaError";
		this.code = code;
	}
}

/**
 * Error from an LLM provider (e.g. Anthropic, OpenAI, Google).
 *
 * Includes the `provider` name and optional HTTP `statusCode` for
 * error classification and retry decisions.
 */
export class ProviderError extends ChitraguptaError {
	readonly provider: string;
	readonly statusCode?: number;

	constructor(message: string, provider: string, statusCode?: number, cause?: Error) {
		super(message, "PROVIDER_ERROR", cause);
		this.name = "ProviderError";
		this.provider = provider;
		this.statusCode = statusCode;
	}
}

/**
 * Authentication error (invalid API key, expired token, etc.).
 */
export class AuthError extends ChitraguptaError {
	readonly provider: string;

	constructor(message: string, provider: string) {
		super(message, "AUTH_ERROR");
		this.name = "AuthError";
		this.provider = provider;
	}
}

/**
 * Error during plugin registration, initialization, or execution.
 */
export class PluginError extends ChitraguptaError {
	readonly pluginName: string;

	constructor(message: string, pluginName: string) {
		super(message, "PLUGIN_ERROR");
		this.name = "PluginError";
		this.pluginName = pluginName;
	}
}

/**
 * Configuration error (missing file, invalid JSON, unknown key, etc.).
 */
export class ConfigError extends ChitraguptaError {
	constructor(message: string) {
		super(message, "CONFIG_ERROR");
		this.name = "ConfigError";
	}
}

/**
 * Error during tool execution (file read failure, command error, etc.).
 */
export class ToolError extends ChitraguptaError {
	readonly toolName: string;

	constructor(message: string, toolName: string, cause?: Error) {
		super(message, "TOOL_ERROR", cause);
		this.name = "ToolError";
		this.toolName = toolName;
	}
}

/**
 * Error related to session operations (not found, corrupted, etc.).
 */
export class SessionError extends ChitraguptaError {
	constructor(message: string, cause?: Error) {
		super(message, "SESSION_ERROR", cause);
		this.name = "SessionError";
	}
}

/**
 * Error related to memory store operations (read/write failure, invalid scope).
 */
export class MemoryError extends ChitraguptaError {
	constructor(message: string, cause?: Error) {
		super(message, "MEMORY_ERROR", cause);
		this.name = "MemoryError";
	}
}

/**
 * Error indicating the operation was explicitly aborted (e.g. via AbortSignal).
 */
export class AbortError extends ChitraguptaError {
	constructor(message = "Operation aborted") {
		super(message, "ABORT_ERROR");
		this.name = "AbortError";
	}
}

/**
 * Error during streaming (connection drop, parse failure, etc.).
 */
export class StreamError extends ChitraguptaError {
	constructor(message: string) {
		super(message, "STREAM_ERROR");
		this.name = "StreamError";
	}
}
