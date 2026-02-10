#!/bin/bash
# GitHub repo metadata setup — run manually after going public

gh repo edit sriinnu/chitragupta --description "The Autonomous AI Agent Platform — Chitragupta"

gh repo edit sriinnu/chitragupta \
	--add-topic ai \
	--add-topic ai-agents \
	--add-topic autonomous-agents \
	--add-topic llm \
	--add-topic typescript \
	--add-topic mcp \
	--add-topic cli \
	--add-topic tool-use \
	--add-topic agent-framework \
	--add-topic multi-provider \
	--add-topic graphrag \
	--add-topic memory \
	--add-topic cognitive-ai
