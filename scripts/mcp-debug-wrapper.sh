#!/bin/bash
# Debug wrapper for MCP server — logs all startup info to a file
# Use this in .mcp.json to diagnose handshake failures.

LOG="/tmp/chitragupta-mcp-debug.log"
echo "=== MCP Launch $(date -Iseconds) ===" >> "$LOG"
echo "NODE: $(which node) $(node --version)" >> "$LOG"
echo "CWD: $(pwd)" >> "$LOG"
echo "ARGS: $*" >> "$LOG"
echo "PATH: $PATH" >> "$LOG"
echo "---" >> "$LOG"

# Run the actual MCP server, tee stderr to the log
exec node /mnt/c/sriinnu/personal/Kaala-brahma/chitragupta/packages/cli/dist/mcp-entry.js "$@" 2> >(tee -a "$LOG" >&2)
