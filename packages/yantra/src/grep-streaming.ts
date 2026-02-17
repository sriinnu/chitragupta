/**
 * @chitragupta/yantra — Streaming search for large files.
 *
 * Line-by-line streaming search using Node.js readline interface.
 * Used for files over the streaming threshold (1 MB) to avoid loading
 * the entire file into memory at once.
 */

import * as fs from "node:fs";
import * as readline from "node:readline";
import type { GrepMatch } from "./grep.js";

/**
 * Search a file using streaming line-by-line reads.
 * Used for files over STREAM_THRESHOLD to avoid loading the entire file.
 */
export async function searchFileStreaming(
  filePath: string,
  regex: RegExp,
  matches: GrepMatch[],
  maxResults: number,
  invert: boolean,
  beforeCtx: number,
  afterCtx: number,
): Promise<void> {
  let fileStream: fs.ReadStream;
  try {
    fileStream = fs.createReadStream(filePath, { encoding: "utf-8" });
  } catch {
    return;
  }

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  // Ring buffer for before-context lines
  const beforeBuffer: Array<{ lineNum: number; text: string }> = [];
  let lineNum = 0;
  let afterRemaining = 0;
  let matchCount = matches.filter((m) => !m.isContext).length;

  try {
    for await (const line of rl) {
      lineNum++;
      if (matchCount >= maxResults && afterRemaining <= 0) break;

      regex.lastIndex = 0;
      const isMatch = regex.test(line);
      const shouldInclude = invert ? !isMatch : isMatch;
      const text = line.length > 500 ? line.slice(0, 500) + "..." : line;

      if (shouldInclude && matchCount < maxResults) {
        // Flush before-context
        for (const ctx of beforeBuffer) {
          matches.push({
            file: filePath,
            line: ctx.lineNum,
            text: ctx.text,
            isContext: true,
          });
        }
        beforeBuffer.length = 0;

        matches.push({
          file: filePath,
          line: lineNum,
          text,
        });
        matchCount++;
        afterRemaining = afterCtx;
      } else if (afterRemaining > 0) {
        // After-context line
        matches.push({
          file: filePath,
          line: lineNum,
          text,
          isContext: true,
        });
        afterRemaining--;
      } else {
        // Track as potential before-context
        if (beforeCtx > 0) {
          beforeBuffer.push({ lineNum, text });
          if (beforeBuffer.length > beforeCtx) {
            beforeBuffer.shift();
          }
        }
      }
    }
  } catch {
    // Stream error — stop gracefully
  } finally {
    rl.close();
    fileStream.destroy();
  }
}
