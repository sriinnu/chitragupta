/**
 * @chitragupta/daemon — Takumi binding observation, prediction, and healing methods.
 *
 * Implements the live daemon-side contract for:
 * - observe.batch
 * - pattern.query
 * - predict.next
 * - health.status
 * - heal.report
 * - preference.update
 *
 * @module
 */

import type { RpcRouter } from "./rpc-router.js";
import { registerObserveBatch } from "./services-binding-observe.js";
import { registerBindingQueryMethods } from "./services-binding-routes.js";

export function registerBindingMethods(router: RpcRouter): void {
	registerObserveBatch(router);
	registerBindingQueryMethods(router);
}
