import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { resolve } from "node:path";

/**
 * Vite configuration for the Chitragupta Hub SPA.
 *
 * Uses relative base path so the built assets can be served
 * from any sub-path when embedded in the CLI HTTP server.
 */
export default defineConfig({
	plugins: [preact()],
	base: "./",
	build: {
		outDir: "dist",
	},
	resolve: {
		alias: {
			"@/": `${resolve(__dirname, "src")}/`,
		},
	},
});
