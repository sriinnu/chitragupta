/**
 * Global type declarations for the Hub SPA.
 *
 * Extends `preact.JSX.IntrinsicAttributes` with preact-router's
 * routable props (`path`, `default`) so routed components accept
 * them without individual prop declarations.
 * @module types
 */

declare namespace preact.JSX {
	interface IntrinsicAttributes {
		path?: string;
		default?: boolean;
	}
}
