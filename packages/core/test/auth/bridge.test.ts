import { describe, expect, it } from "vitest";
import {
	BridgeAuthError,
	parseBridgeKey,
	parseBridgeKeyFromEnv,
	parseBridgeScopes,
} from "@chitragupta/core";

describe("Bridge auth helpers", () => {
	it("parses a valid daemon bridge key", () => {
		expect(parseBridgeKey("chg_0123456789abcdef0123456789abcdef")).toBe(
			"chg_0123456789abcdef0123456789abcdef",
		);
	});

	it("rejects malformed bridge keys", () => {
		expect(() => parseBridgeKey("not-a-key")).toThrow(BridgeAuthError);
		expect(() => parseBridgeKey("chg_short")).toThrow(BridgeAuthError);
	});

	it("parses env keys using precedence order", () => {
		expect(
			parseBridgeKeyFromEnv(
				{
					SECONDARY: "  ",
					PRIMARY: " chg_0123456789abcdef0123456789abcdef ",
				},
				["SECONDARY", "PRIMARY"],
			),
		).toBe("chg_0123456789abcdef0123456789abcdef");
	});

	it("parses scope lists without duplicates or empty entries", () => {
		expect(parseBridgeScopes("read, write, ,read,admin")).toEqual(["read", "write", "admin"]);
	});
});
