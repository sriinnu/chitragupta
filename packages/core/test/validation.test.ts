import { describe, it, expect } from "vitest";
import { v, validate, assertValid, ChitraguptaError } from "@chitragupta/core";

// ─── StringValidator ─────────────────────────────────────────────────────────

describe("StringValidator", () => {
	it("should accept valid strings", () => {
		const result = v.string().validate("hello");
		expect(result.valid).toBe(true);
		expect(result.value).toBe("hello");
	});

	it("should reject non-string values", () => {
		const result = v.string().validate(42);
		expect(result.valid).toBe(false);
		expect(result.error).toContain("Expected string");
		expect(result.error).toContain("number");
	});

	it("should enforce min length", () => {
		const validator = v.string().min(3).validate;
		expect(validator("ab").valid).toBe(false);
		expect(validator("ab").error).toContain("below minimum 3");
		expect(validator("abc").valid).toBe(true);
		expect(validator("abcd").valid).toBe(true);
	});

	it("should enforce max length", () => {
		const validator = v.string().max(5).validate;
		expect(validator("hello").valid).toBe(true);
		expect(validator("helloo").valid).toBe(false);
		expect(validator("helloo").error).toContain("exceeds maximum 5");
	});

	it("should enforce pattern matching", () => {
		const validator = v.string().pattern(/^[a-z]+$/).validate;
		expect(validator("abc").valid).toBe(true);
		expect(validator("ABC").valid).toBe(false);
		expect(validator("ABC").error).toContain("does not match pattern");
	});

	it("should chain min, max, and pattern fluently", () => {
		const validator = v.string().min(2).max(10).pattern(/^[a-z]+$/).validate;
		expect(validator("a").valid).toBe(false);
		expect(validator("ab").valid).toBe(true);
		expect(validator("abcdefghijk").valid).toBe(false);
		expect(validator("abcDef").valid).toBe(false);
	});

	it("should accept empty string when no min constraint", () => {
		expect(v.string().validate("").valid).toBe(true);
	});

	it("should reject null and undefined", () => {
		expect(v.string().validate(null).valid).toBe(false);
		expect(v.string().validate(undefined).valid).toBe(false);
	});
});

// ─── NumberValidator ─────────────────────────────────────────────────────────

describe("NumberValidator", () => {
	it("should accept valid numbers", () => {
		const result = v.number().validate(42);
		expect(result.valid).toBe(true);
		expect(result.value).toBe(42);
	});

	it("should reject non-number values", () => {
		expect(v.number().validate("42").valid).toBe(false);
		expect(v.number().validate(true).valid).toBe(false);
	});

	it("should reject NaN", () => {
		const result = v.number().validate(NaN);
		expect(result.valid).toBe(false);
		expect(result.error).toContain("Expected number");
	});

	it("should enforce min value", () => {
		const validator = v.number().min(0).validate;
		expect(validator(-1).valid).toBe(false);
		expect(validator(-1).error).toContain("below minimum 0");
		expect(validator(0).valid).toBe(true);
		expect(validator(1).valid).toBe(true);
	});

	it("should enforce max value", () => {
		const validator = v.number().max(100).validate;
		expect(validator(100).valid).toBe(true);
		expect(validator(101).valid).toBe(false);
		expect(validator(101).error).toContain("exceeds maximum 100");
	});

	it("should enforce integer constraint", () => {
		const validator = v.number().integer().validate;
		expect(validator(42).valid).toBe(true);
		expect(validator(3.14).valid).toBe(false);
		expect(validator(3.14).error).toContain("Expected integer");
	});

	it("should chain min, max, and integer fluently", () => {
		const validator = v.number().integer().min(1).max(65535).validate;
		expect(validator(0).valid).toBe(false);
		expect(validator(1).valid).toBe(true);
		expect(validator(8080).valid).toBe(true);
		expect(validator(65535).valid).toBe(true);
		expect(validator(65536).valid).toBe(false);
		expect(validator(3.5).valid).toBe(false);
	});

	it("should accept negative numbers when no constraints", () => {
		expect(v.number().validate(-999).valid).toBe(true);
	});

	it("should accept floating point numbers when not integer-constrained", () => {
		expect(v.number().validate(3.14159).valid).toBe(true);
	});
});

// ─── BooleanValidator ────────────────────────────────────────────────────────

describe("BooleanValidator", () => {
	it("should accept true and false", () => {
		expect(v.boolean().validate(true).valid).toBe(true);
		expect(v.boolean().validate(true).value).toBe(true);
		expect(v.boolean().validate(false).valid).toBe(true);
		expect(v.boolean().validate(false).value).toBe(false);
	});

	it("should reject non-boolean values", () => {
		expect(v.boolean().validate(1).valid).toBe(false);
		expect(v.boolean().validate("true").valid).toBe(false);
		expect(v.boolean().validate(null).valid).toBe(false);
	});
});

// ─── ArrayValidator ──────────────────────────────────────────────────────────

describe("ArrayValidator", () => {
	it("should accept arrays", () => {
		const result = v.array().validate([1, 2, 3]);
		expect(result.valid).toBe(true);
		expect(result.value).toEqual([1, 2, 3]);
	});

	it("should reject non-array values", () => {
		expect(v.array().validate("not an array").valid).toBe(false);
		expect(v.array().validate({}).valid).toBe(false);
		expect(v.array().validate(null).valid).toBe(false);
	});

	it("should enforce min length", () => {
		const validator = v.array().min(2).validate;
		expect(validator([1]).valid).toBe(false);
		expect(validator([1]).error).toContain("below minimum 2");
		expect(validator([1, 2]).valid).toBe(true);
	});

	it("should enforce max length", () => {
		const validator = v.array().max(3).validate;
		expect(validator([1, 2, 3]).valid).toBe(true);
		expect(validator([1, 2, 3, 4]).valid).toBe(false);
		expect(validator([1, 2, 3, 4]).error).toContain("exceeds maximum 3");
	});

	it("should validate item types when itemValidator is provided", () => {
		const validator = v.array(v.number().validate).validate;
		expect(validator([1, 2, 3]).valid).toBe(true);
		expect(validator([1, "two", 3]).valid).toBe(false);
		expect(validator([1, "two", 3]).error).toContain("[1]:");
	});

	it("should accept empty arrays", () => {
		expect(v.array().validate([]).valid).toBe(true);
	});

	it("should chain min, max with item validation", () => {
		const validator = v.array(v.string().validate).min(1).max(3).validate;
		expect(validator([]).valid).toBe(false);
		expect(validator(["a"]).valid).toBe(true);
		expect(validator(["a", "b", "c"]).valid).toBe(true);
		expect(validator(["a", "b", "c", "d"]).valid).toBe(false);
		expect(validator([1]).valid).toBe(false);
	});
});

// ─── ObjectValidator ─────────────────────────────────────────────────────────

describe("ObjectValidator", () => {
	it("should validate object with schema", () => {
		const validator = v.object({
			name: v.string().validate,
			age: v.number().validate,
		}).validate;

		const result = validator({ name: "Alice", age: 30 });
		expect(result.valid).toBe(true);
		expect(result.value).toEqual({ name: "Alice", age: 30 });
	});

	it("should reject non-object values", () => {
		const validator = v.object({ x: v.number().validate }).validate;
		expect(validator("not an object").valid).toBe(false);
		expect(validator(null).valid).toBe(false);
		expect(validator([]).valid).toBe(false);
	});

	it("should collect all field errors", () => {
		const validator = v.object({
			name: v.string().validate,
			age: v.number().validate,
		}).validate;

		const result = validator({ name: 42, age: "thirty" });
		expect(result.valid).toBe(false);
		expect(result.error).toContain("name:");
		expect(result.error).toContain("age:");
	});

	it("should validate nested objects", () => {
		const validator = v.object({
			host: v.string().validate,
			port: v.number().integer().min(1).max(65535).validate,
			debug: v.optional(v.boolean().validate).validate,
		}).validate;

		expect(validator({ host: "localhost", port: 8080 }).valid).toBe(true);
		expect(validator({ host: "localhost", port: 8080, debug: true }).valid).toBe(true);
		expect(validator({ host: "localhost", port: 0 }).valid).toBe(false);
	});
});

// ─── OptionalValidator ───────────────────────────────────────────────────────

describe("OptionalValidator", () => {
	it("should accept undefined and null", () => {
		const validator = v.optional(v.string().validate).validate;
		expect(validator(undefined).valid).toBe(true);
		expect(validator(undefined).value).toBe(undefined);
		expect(validator(null).valid).toBe(true);
		expect(validator(null).value).toBe(undefined);
	});

	it("should validate present values with inner validator", () => {
		const validator = v.optional(v.number().min(0).validate).validate;
		expect(validator(42).valid).toBe(true);
		expect(validator(42).value).toBe(42);
		expect(validator(-1).valid).toBe(false);
	});

	it("should pass through undefined when value is missing", () => {
		const validator = v.optional(v.string().validate).validate;
		const result = validator(undefined);
		expect(result.valid).toBe(true);
	});
});

// ─── UnionValidator ──────────────────────────────────────────────────────────

describe("UnionValidator", () => {
	it("should accept value matching any variant", () => {
		const validator = v.union(
			v.string().validate as any,
			v.number().validate as any,
		).validate;

		expect(validator("hello").valid).toBe(true);
		expect(validator(42).valid).toBe(true);
	});

	it("should reject values matching no variant", () => {
		const validator = v.union(
			v.string().validate as any,
			v.number().validate as any,
		).validate;

		const result = validator(true);
		expect(result.valid).toBe(false);
		expect(result.error).toContain("did not match any variant");
	});

	it("should return first matching variant value", () => {
		const validator = v.union(
			v.string().validate as any,
			v.number().validate as any,
		).validate;

		const result = validator("test");
		expect(result.valid).toBe(true);
		expect(result.value).toBe("test");
	});
});

// ─── LiteralValidator ────────────────────────────────────────────────────────

describe("LiteralValidator", () => {
	it("should accept the exact literal string", () => {
		const validator = v.literal("hello").validate;
		expect(validator("hello").valid).toBe(true);
		expect(validator("hello").value).toBe("hello");
	});

	it("should reject different values", () => {
		const validator = v.literal("hello").validate;
		const result = validator("world");
		expect(result.valid).toBe(false);
		expect(result.error).toContain("Expected literal");
		expect(result.error).toContain('"hello"');
	});

	it("should work with number literals", () => {
		const validator = v.literal(42).validate;
		expect(validator(42).valid).toBe(true);
		expect(validator(43).valid).toBe(false);
	});

	it("should work with boolean literals", () => {
		const validator = v.literal(true).validate;
		expect(validator(true).valid).toBe(true);
		expect(validator(false).valid).toBe(false);
	});

	it("should use strict equality (no coercion)", () => {
		const validator = v.literal(0).validate;
		expect(validator(0).valid).toBe(true);
		expect(validator("0").valid).toBe(false);
		expect(validator(false).valid).toBe(false);
	});
});

// ─── validate() utility ─────────────────────────────────────────────────────

describe("validate()", () => {
	it("should return valid result with value on success", () => {
		const result = validate("hello", v.string().validate);
		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
		expect(result.value).toBe("hello");
	});

	it("should return errors array on failure", () => {
		const result = validate(42, v.string().validate);
		expect(result.valid).toBe(false);
		expect(result.errors.length).toBe(1);
		expect(result.errors[0].path).toBe("$");
		expect(result.errors[0].message).toContain("Expected string");
		expect(result.errors[0].received).toBe(42);
	});

	it("should include the received value in error details", () => {
		const result = validate("bad", v.number().validate);
		expect(result.errors[0].received).toBe("bad");
	});
});

// ─── assertValid() utility ───────────────────────────────────────────────────

describe("assertValid()", () => {
	it("should return the validated value on success", () => {
		const value = assertValid(42, v.number().validate);
		expect(value).toBe(42);
	});

	it("should throw ChitraguptaError on failure", () => {
		expect(() => assertValid("bad", v.number().validate)).toThrow(ChitraguptaError);
	});

	it("should include label in error message when provided", () => {
		try {
			assertValid("bad", v.number().validate, "config.port");
			expect.unreachable("Should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(ChitraguptaError);
			expect((err as ChitraguptaError).message).toContain("config.port:");
			expect((err as ChitraguptaError).code).toBe("VALIDATION_ERROR");
		}
	});

	it("should not include label prefix when label is omitted", () => {
		try {
			assertValid("bad", v.number().validate);
			expect.unreachable("Should have thrown");
		} catch (err) {
			expect((err as ChitraguptaError).message).not.toContain(":");
			// Actually the error message contains "$ — Expected..." which has no label prefix
			expect((err as ChitraguptaError).message).toContain("$");
		}
	});
});
