/**
 * Niyama — Runtime validation utilities.
 * Sanskrit: Niyama (नियम) = rule, regulation, observance.
 *
 * Provides lightweight runtime validation for configuration objects,
 * API inputs, and data schemas without requiring external libraries
 * like Zod or Joi. Uses a fluent builder pattern.
 */

import { ChitraguptaError } from "./errors.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ValidatorFn<T = unknown> = (value: unknown) => { valid: boolean; error?: string; value?: T };

export interface ValidationError {
	path: string;
	message: string;
	received: unknown;
}

export interface ValidationResult<T = unknown> {
	valid: boolean;
	errors: ValidationError[];
	value?: T;
}

// ─── Validator Classes ───────────────────────────────────────────────────────

class StringValidator {
	private minLen?: number;
	private maxLen?: number;
	private patternRe?: RegExp;

	min(n: number): this {
		this.minLen = n;
		return this;
	}

	max(n: number): this {
		this.maxLen = n;
		return this;
	}

	pattern(re: RegExp): this {
		this.patternRe = re;
		return this;
	}

	validate: ValidatorFn<string> = (value: unknown) => {
		if (typeof value !== "string") {
			return { valid: false, error: `Expected string, received ${typeof value}` };
		}
		if (this.minLen !== undefined && value.length < this.minLen) {
			return { valid: false, error: `String length ${value.length} is below minimum ${this.minLen}` };
		}
		if (this.maxLen !== undefined && value.length > this.maxLen) {
			return { valid: false, error: `String length ${value.length} exceeds maximum ${this.maxLen}` };
		}
		if (this.patternRe && !this.patternRe.test(value)) {
			return { valid: false, error: `String does not match pattern ${this.patternRe}` };
		}
		return { valid: true, value };
	};
}

class NumberValidator {
	private minVal?: number;
	private maxVal?: number;
	private intOnly = false;

	min(n: number): this {
		this.minVal = n;
		return this;
	}

	max(n: number): this {
		this.maxVal = n;
		return this;
	}

	integer(): this {
		this.intOnly = true;
		return this;
	}

	validate: ValidatorFn<number> = (value: unknown) => {
		if (typeof value !== "number" || Number.isNaN(value)) {
			return { valid: false, error: `Expected number, received ${typeof value}` };
		}
		if (this.intOnly && !Number.isInteger(value)) {
			return { valid: false, error: `Expected integer, received ${value}` };
		}
		if (this.minVal !== undefined && value < this.minVal) {
			return { valid: false, error: `Number ${value} is below minimum ${this.minVal}` };
		}
		if (this.maxVal !== undefined && value > this.maxVal) {
			return { valid: false, error: `Number ${value} exceeds maximum ${this.maxVal}` };
		}
		return { valid: true, value };
	};
}

class BooleanValidator {
	validate: ValidatorFn<boolean> = (value: unknown) => {
		if (typeof value !== "boolean") {
			return { valid: false, error: `Expected boolean, received ${typeof value}` };
		}
		return { valid: true, value };
	};
}

class ArrayValidator<T> {
	private minLen?: number;
	private maxLen?: number;

	constructor(private itemValidator?: ValidatorFn<T>) {}

	min(n: number): this {
		this.minLen = n;
		return this;
	}

	max(n: number): this {
		this.maxLen = n;
		return this;
	}

	validate: ValidatorFn<T[]> = (value: unknown) => {
		if (!Array.isArray(value)) {
			return { valid: false, error: `Expected array, received ${typeof value}` };
		}
		if (this.minLen !== undefined && value.length < this.minLen) {
			return { valid: false, error: `Array length ${value.length} is below minimum ${this.minLen}` };
		}
		if (this.maxLen !== undefined && value.length > this.maxLen) {
			return { valid: false, error: `Array length ${value.length} exceeds maximum ${this.maxLen}` };
		}
		if (this.itemValidator) {
			const validated: T[] = [];
			for (let i = 0; i < value.length; i++) {
				const result = this.itemValidator(value[i]);
				if (!result.valid) {
					return { valid: false, error: `[${i}]: ${result.error}` };
				}
				validated.push(result.value as T);
			}
			return { valid: true, value: validated };
		}
		return { valid: true, value: value as T[] };
	};
}

type InferSchema<T extends Record<string, ValidatorFn>> = {
	[K in keyof T]: T[K] extends ValidatorFn<infer U> ? U : unknown;
};

class ObjectValidator<T extends Record<string, ValidatorFn>> {
	constructor(private schema: T) {}

	validate: ValidatorFn<InferSchema<T>> = (value: unknown) => {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			return { valid: false, error: `Expected object, received ${value === null ? "null" : typeof value}` };
		}
		const obj = value as Record<string, unknown>;
		const result: Record<string, unknown> = {};
		const errors: string[] = [];

		for (const [key, validator] of Object.entries(this.schema)) {
			const fieldResult = validator(obj[key]);
			if (!fieldResult.valid) {
				errors.push(`${key}: ${fieldResult.error}`);
			} else {
				result[key] = fieldResult.value;
			}
		}

		if (errors.length > 0) {
			return { valid: false, error: errors.join("; ") };
		}
		return { valid: true, value: result as InferSchema<T> };
	};
}

class OptionalValidator<T> {
	constructor(private inner: ValidatorFn<T>) {}

	validate: ValidatorFn<T | undefined> = (value: unknown) => {
		if (value === undefined || value === null) {
			return { valid: true, value: undefined };
		}
		return this.inner(value) as { valid: boolean; error?: string; value?: T | undefined };
	};
}

class UnionValidator<T> {
	constructor(private validators: ValidatorFn<T>[]) {}

	validate: ValidatorFn<T> = (value: unknown) => {
		const errors: string[] = [];
		for (const validator of this.validators) {
			const result = validator(value);
			if (result.valid) {
				return result;
			}
			if (result.error) {
				errors.push(result.error);
			}
		}
		return {
			valid: false,
			error: `Value did not match any variant: ${errors.join(" | ")}`,
		};
	};
}

class LiteralValidator<T extends string | number | boolean> {
	constructor(private expected: T) {}

	validate: ValidatorFn<T> = (value: unknown) => {
		if (value !== this.expected) {
			return { valid: false, error: `Expected literal ${JSON.stringify(this.expected)}, received ${JSON.stringify(value)}` };
		}
		return { valid: true, value: value as T };
	};
}

// ─── Fluent Builder ──────────────────────────────────────────────────────────

/**
 * Fluent validator builders.
 *
 * Usage:
 * ```ts
 * const nameV = v.string().min(1).max(100).validate;
 * const portV = v.number().integer().min(1).max(65535).validate;
 * const configV = v.object({
 *   host: v.string().validate,
 *   port: v.number().integer().min(1).max(65535).validate,
 *   debug: v.optional(v.boolean().validate).validate,
 * }).validate;
 * ```
 */
export const v = {
	string: () => new StringValidator(),
	number: () => new NumberValidator(),
	boolean: () => new BooleanValidator(),
	array: <T>(itemValidator?: ValidatorFn<T>) => new ArrayValidator<T>(itemValidator),
	object: <T extends Record<string, ValidatorFn>>(schema: T) => new ObjectValidator<T>(schema),
	optional: <T>(validator: ValidatorFn<T>) => new OptionalValidator<T>(validator),
	union: <T>(...validators: ValidatorFn<T>[]) => new UnionValidator<T>(validators),
	literal: <T extends string | number | boolean>(value: T) => new LiteralValidator<T>(value),
};

// ─── Utility Functions ───────────────────────────────────────────────────────

/**
 * Validate a value against a validator function.
 *
 * Returns a structured {@link ValidationResult} with all errors collected
 * rather than throwing on the first failure.
 */
export function validate<T>(value: unknown, validator: ValidatorFn<T>): ValidationResult<T> {
	const result = validator(value);
	if (result.valid) {
		return { valid: true, errors: [], value: result.value };
	}
	return {
		valid: false,
		errors: [{
			path: "$",
			message: result.error ?? "Validation failed",
			received: value,
		}],
	};
}

/**
 * Assert that validation passes; throw a {@link ChitraguptaError} on failure.
 *
 * @param value - The value to validate.
 * @param validator - The validator function to apply.
 * @param label - Optional label for the error message (e.g. "config.port").
 * @returns The validated and typed value.
 * @throws ChitraguptaError with code `"VALIDATION_ERROR"` if validation fails.
 */
export function assertValid<T>(value: unknown, validator: ValidatorFn<T>, label?: string): T {
	const result = validate(value, validator);
	if (!result.valid) {
		const prefix = label ? `${label}: ` : "";
		const messages = result.errors.map((e) => `${e.path} — ${e.message}`).join("; ");
		throw new ChitraguptaError(`${prefix}${messages}`, "VALIDATION_ERROR");
	}
	return result.value as T;
}
