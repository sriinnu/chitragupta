import type { RpcRouter } from "./rpc-router.js";
import { registerResearchLoopControlMethods } from "./services-research-loops.js";
import { registerResearchLedgerMethods } from "./services-research-records.js";
import { registerResearchLoopSchedulerMethods } from "./services-research-scheduler.js";

export function registerResearchMethods(router: RpcRouter): void {
	registerResearchLoopControlMethods(router);
	registerResearchLoopSchedulerMethods(router);
	registerResearchLedgerMethods(router);
}
