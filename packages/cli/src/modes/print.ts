/**
 * @chitragupta/cli — Print mode.
 *
 * Non-interactive mode: sends a single prompt, streams the response
 * to stdout, and exits. No TUI, just plain text output with optional
 * ANSI colors for thinking blocks and tool calls.
 */

import type { Agent, AgentEventType } from "@chitragupta/anina";
import { dim, gray, cyan, yellow, bold, red, reset } from "@chitragupta/ui/ansi";

export interface PrintModeOptions {
	agent: Agent;
	prompt: string;
	/** Whether to use ANSI colors in output. Defaults to true if stdout is a TTY. */
	color?: boolean;
	/** Whether to show thinking blocks. Defaults to false. */
	showThinking?: boolean;
}

/**
 * Run print mode: send one prompt, stream the response to stdout, exit.
 *
 * Returns the process exit code (0 for success, 1 for error).
 */
export async function runPrintMode(options: PrintModeOptions): Promise<number> {
	const { agent, prompt, showThinking = false } = options;
	const useColor = options.color ?? process.stdout.isTTY ?? false;

	let inThinking = false;
	let hasOutput = false;

	// Wire up event handler for streaming output
	const originalOnEvent = agent.getConfig().onEvent;

	const eventHandler = (event: AgentEventType, data: unknown) => {
		const eventData = data as Record<string, unknown>;

		switch (event) {
			case "stream:text": {
				const text = eventData.text as string;
				if (inThinking) {
					// End thinking block before text
					if (useColor) {
						process.stderr.write(reset + "\n");
					}
					inThinking = false;
				}
				process.stdout.write(text);
				hasOutput = true;
				break;
			}

			case "stream:thinking": {
				if (showThinking) {
					if (!inThinking) {
						if (useColor) {
							process.stderr.write(dim(gray("[thinking] ")));
						} else {
							process.stderr.write("[thinking] ");
						}
						inThinking = true;
					}
					const text = eventData.text as string;
					if (useColor) {
						process.stderr.write(dim(text));
					} else {
						process.stderr.write(text);
					}
				}
				break;
			}

			case "tool:start": {
				const name = eventData.name as string;
				if (useColor) {
					process.stderr.write(dim(cyan(`[tool: ${name}] `)));
				} else {
					process.stderr.write(`[tool: ${name}] `);
				}
				break;
			}

			case "tool:done": {
				if (useColor) {
					process.stderr.write(dim(cyan("done\n")));
				} else {
					process.stderr.write("done\n");
				}
				break;
			}

			case "tool:error": {
				const errorMsg = eventData.error as string;
				if (useColor) {
					process.stderr.write(red(`error: ${errorMsg}\n`));
				} else {
					process.stderr.write(`error: ${errorMsg}\n`);
				}
				break;
			}

			case "stream:done": {
				if (inThinking) {
					if (useColor) {
						process.stderr.write(reset + "\n");
					}
					inThinking = false;
				}
				break;
			}
		}

		// Forward to any original event handler
		originalOnEvent?.(event, data);
	};

	// Inject our event handler
	agent.setOnEvent(eventHandler);

	try {
		await agent.prompt(prompt);

		// Ensure output ends with a newline
		if (hasOutput) {
			process.stdout.write("\n");
		}

		// Process any follow-up messages
		await agent.processFollowUps();

		return 0;
	} catch (error) {
		if (inThinking) {
			process.stderr.write("\n");
		}

		const message = error instanceof Error ? error.message : String(error);

		if (useColor) {
			process.stderr.write(red(`\nError: ${message}\n`));
		} else {
			process.stderr.write(`\nError: ${message}\n`);
		}

		return 1;
	}
}
