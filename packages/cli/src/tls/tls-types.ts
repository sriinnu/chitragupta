/**
 * Kavach — Local TLS/SSL types for Chitragupta Hub.
 * Sanskrit: Kavach (कवच) = armor, shield.
 *
 * Defines the certificate, store, and trust configuration types
 * used across the TLS subsystem.
 * @module tls/tls-types
 */

/** PEM-encoded certificate material ready for `https.createServer()`. */
export interface TlsCertificates {
	/** PEM-encoded leaf certificate. */
	cert: string;
	/** PEM-encoded private key for the leaf certificate. */
	key: string;
	/** PEM-encoded CA certificate (for client trust verification). */
	ca: string;
}

/** Metadata about a stored certificate for expiry tracking. */
export interface CertMeta {
	/** ISO-8601 timestamp when the certificate was created. */
	createdAt: string;
	/** ISO-8601 timestamp when the certificate expires. */
	expiresAt: string;
	/** SHA-256 fingerprint of the CA certificate (hex). */
	caFingerprint: string;
	/** Common Name used for the leaf certificate. */
	leafCN: string;
}

/** Result of a TLS provisioning attempt. */
export interface ProvisionResult {
	/** Whether TLS certificates are available and valid. */
	ok: boolean;
	/** The certificate material (present when `ok` is true). */
	certs?: TlsCertificates;
	/** Human-readable reason when `ok` is false. */
	reason?: string;
	/** Whether the CA was freshly generated this run. */
	freshCA?: boolean;
	/** Whether the leaf cert was freshly generated this run. */
	freshLeaf?: boolean;
}

/** Options for the TLS store. */
export interface TlsStoreOptions {
	/** Override the default store directory (~/.chitragupta/tls/). */
	storeDir?: string;
	/** Days before expiry to trigger renewal. Default: 30. */
	renewalThresholdDays?: number;
}

/** Result of a Keychain trust operation. */
export interface TrustResult {
	/** Whether the CA is now trusted in the system store. */
	trusted: boolean;
	/** Human-readable status message. */
	message: string;
	/** Whether the user was prompted for consent. */
	prompted?: boolean;
}
