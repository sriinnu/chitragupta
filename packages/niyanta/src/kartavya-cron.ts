/**
 * Kartavya trigger matching — cron, threshold, and pattern evaluation.
 *
 * Pure functions extracted from KartavyaEngine for modularity.
 */

// ─── Cron Matching ──────────────────────────────────────────────────────────

/**
 * Check if a simplified cron expression matches the given time.
 *
 * Supports: `minute hour dayOfMonth month dayOfWeek`
 * - `*` matches any value
 * - Specific numbers: `30`, `14`
 * - Step values: `*​/5` (every 5 units)
 *
 * @param cronExpr - A 5-field cron expression.
 * @param now - The time to check against (defaults to current time).
 */
export function matchesCronExpr(cronExpr: string, now?: Date): boolean {
	const date = now ?? new Date();
	const parts = cronExpr.trim().split(/\s+/);
	if (parts.length !== 5) return false;

	const fields = [
		date.getMinutes(),
		date.getHours(),
		date.getDate(),
		date.getMonth() + 1,
		date.getDay(),
	];

	for (let i = 0; i < 5; i++) {
		if (!matchCronField(parts[i], fields[i])) return false;
	}

	return true;
}

/**
 * Match a single cron field against a value.
 * Supports `*`, step `*​/N`, and literal numbers.
 */
function matchCronField(field: string, value: number): boolean {
	if (field === "*") return true;

	if (field.startsWith("*/")) {
		const step = parseInt(field.slice(2), 10);
		if (isNaN(step) || step <= 0) return false;
		return value % step === 0;
	}

	const num = parseInt(field, 10);
	if (isNaN(num)) return false;
	return value === num;
}

// ─── Threshold Evaluation ────────────────────────────────────────────────────

/**
 * Evaluate a threshold expression against metric values.
 *
 * Supports: `metric_name > value`, `metric_name < value`,
 * `metric_name >= value`, `metric_name <= value`, `metric_name == value`.
 */
export function evaluateThreshold(condition: string, metrics: Record<string, number>): boolean {
	const match = condition.match(/^(\w+)\s*(>=|<=|>|<|==)\s*([\d.]+)$/);
	if (!match) return false;

	const [, metricName, operator, valueStr] = match;
	const metricValue = metrics[metricName];
	if (metricValue === undefined) return false;

	const threshold = parseFloat(valueStr);
	if (isNaN(threshold)) return false;

	switch (operator) {
		case ">": return metricValue > threshold;
		case "<": return metricValue < threshold;
		case ">=": return metricValue >= threshold;
		case "<=": return metricValue <= threshold;
		case "==": return metricValue === threshold;
		default: return false;
	}
}

// ─── Pattern Evaluation ──────────────────────────────────────────────────────

/**
 * Evaluate a pattern trigger: checks if the condition regex matches
 * any of the recent pattern strings.
 */
export function evaluatePattern(condition: string, patterns: string[]): boolean {
	try {
		const regex = new RegExp(condition);
		return patterns.some((p) => regex.test(p));
	} catch {
		return patterns.some((p) => p.includes(condition));
	}
}

// ─── Execution Log Pruning ───────────────────────────────────────────────────

/** Remove execution log entries older than 1 hour (in-place). */
export function pruneExecutionLog(log: number[], now: number): void {
	const oneHourAgo = now - 3_600_000;
	while (log.length > 0 && log[0] < oneHourAgo) {
		log.shift();
	}
}
