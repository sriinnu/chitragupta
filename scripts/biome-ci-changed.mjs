#!/usr/bin/env node

/**
 * Run Biome only on files changed by the current CI event.
 *
 * I keep this incremental gate separate from the broader local `pnpm run check`
 * command because the repo still carries historical Biome debt that would make
 * a full-repo CI sweep fail on unrelated files. This script enforces quality on
 * the current change set without pretending the backlog is already cleaned.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

/** File suffixes that Biome can validate in this repo. */
const BIOME_FILE_RE = /\.(?:[cm]?[jt]sx?|jsonc?|css|graphql|gql|html)$/i;

/**
 * Run one git command and return trimmed stdout lines.
 *
 * I use execFileSync here to keep the CI helper dependency-free and easy to
 * debug from the GitHub runner logs.
 */
function gitLines(args) {
	const output = execFileSync("git", args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	return output
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

/** Determine the diff range for the active GitHub event, with a local fallback. */
function resolveDiffRange() {
	const eventName = process.env.GITHUB_EVENT_NAME ?? "";
	const headSha = process.env.GITHUB_SHA?.trim();
	const beforeSha = process.env.GITHUB_EVENT_BEFORE?.trim();
	const baseRef = process.env.GITHUB_BASE_REF?.trim();

	if (eventName === "pull_request" && baseRef) {
		return `origin/${baseRef}...HEAD`;
	}
	if (eventName === "push" && headSha && beforeSha && !/^0+$/.test(beforeSha)) {
		return `${beforeSha}..${headSha}`;
	}
	return "HEAD~1..HEAD";
}

/** Collect the changed files that should be checked by Biome. */
function resolveChangedBiomeFiles() {
	const range = resolveDiffRange();
	let files = gitLines(["diff", "--name-only", "--diff-filter=ACMR", range]);
	if (files.length === 0 && !process.env.GITHUB_ACTIONS) {
		files = gitLines(["diff", "--name-only", "--diff-filter=ACMR", "HEAD"]);
	}
	return {
		range,
		files: files
			.map((file) => {
				if (existsSync(file)) return file;
				const slashIndex = file.indexOf("/");
				if (slashIndex <= 0) return file;
				const nestedRelative = file.slice(slashIndex + 1);
				return existsSync(nestedRelative) ? nestedRelative : file;
			})
			.filter((file) => BIOME_FILE_RE.test(file)),
	};
}

function main() {
	const { range, files } = resolveChangedBiomeFiles();
	if (files.length === 0) {
		console.log(`[biome-ci-changed] No Biome-managed files changed for range ${range}.`);
		return;
	}

	console.log(`[biome-ci-changed] Checking ${files.length} changed file(s) from ${range}.`);
	execFileSync(
		"pnpm",
		[
			"exec",
			"biome",
			"ci",
			"--error-on-warnings",
			"--files-ignore-unknown=true",
			"--no-errors-on-unmatched",
			...files,
		],
		{ stdio: "inherit" },
	);
}

main();
