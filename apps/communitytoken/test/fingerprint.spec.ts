import { describe, expect, it } from "vitest";
import {
	CanonicalizationError,
	canonicalizeJson,
	FINGERPRINT_VERSION,
	requestFingerprintV1,
} from "../src/fingerprint";

/**
 * PR-3 fingerprint v1 coverage (issue #4): the local RFC 8785 (JCS)
 * canonicalizer and the fixed preimage digest. The vectors pin property
 * ordering by raw UTF-16 code unit — including integer-index-looking
 * names, which a sorted-rebuild implementation would silently reorder —
 * nested objects inside arrays, ECMAScript number serialization, and
 * lone-surrogate rejection.
 */

const EURO = "€";
const CONTROL_F = String.fromCharCode(0x0f);
const PUA_E000 = String.fromCharCode(0xe000);
const GRINNING = "😀"; // U+1F600 — UTF-16 D83D DE00

function hex(digest: ArrayBuffer): string {
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

describe("canonicalizeJson", () => {
	it("serializes the RFC 8785 Appendix B vector canonically", () => {
		// The parsed string is €,$,\x0f,\n,A,',B,",\,\",",/ — the canonical
		// escapes are exactly what JSON.stringify emits for a scalar.
		const str = [
			EURO,
			"$",
			CONTROL_F,
			"\n",
			"A",
			"'",
			"B",
			'"',
			"\\",
			"\\",
			'"',
			"/",
		].join("");
		const input = JSON.parse(
			'{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"/","literals":[null,true,false]}',
		);
		expect(canonicalizeJson(input)).toBe(
			`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":${JSON.stringify(str)}}`,
		);
	});

	it("orders property names by raw UTF-16 code unit, including integer-looking keys", () => {
		// A sorted-rebuild implementation emits integer-index names in
		// numeric order (1, 2, 10) — JCS requires code-unit order.
		expect(canonicalizeJson({ "10": 1, "2": 2, a: 3, "1": 4 })).toBe(
			'{"1":4,"10":1,"2":2,"a":3}',
		);
	});

	it("orders non-ASCII names by code unit, not by code point", () => {
		// U+1F600 encodes as D83D DE00 — a leading surrogate that sorts
		// before the BMP code point U+E000 under code-unit ordering.
		expect(canonicalizeJson({ [PUA_E000]: 1, [GRINNING]: 2 })).toBe(
			`{"${GRINNING}":2,"${PUA_E000}":1}`,
		);
	});

	it("preserves array order while sorting nested objects", () => {
		expect(
			canonicalizeJson([
				{ b: 1, a: 2 },
				{ d: 3, c: 4 },
			]),
		).toBe('[{"a":2,"b":1},{"c":4,"d":3}]');
		expect(canonicalizeJson({ outer: [{ y: [1, { z: 0, a: 9 }] }] })).toBe(
			'{"outer":[{"y":[1,{"a":9,"z":0}]}]}',
		);
	});

	it("serializes scalars per ECMAScript JSON rules", () => {
		expect(canonicalizeJson(null)).toBe("null");
		expect(canonicalizeJson(true)).toBe("true");
		expect(canonicalizeJson(0.002)).toBe("0.002");
		expect(canonicalizeJson(-0)).toBe("0");
		expect(canonicalizeJson("a")).toBe('"a"');
		expect(canonicalizeJson([])).toBe("[]");
		expect(canonicalizeJson({})).toBe("{}");
	});

	it("rejects lone surrogates in values and property names", () => {
		const loneHigh = JSON.parse('"\\ud800"');
		const loneLow = JSON.parse('"\\udc00"');
		expect(() => canonicalizeJson(loneHigh)).toThrow(CanonicalizationError);
		expect(() => canonicalizeJson(loneLow)).toThrow(CanonicalizationError);
		expect(() => canonicalizeJson({ "\ud800": 1 })).toThrow(
			CanonicalizationError,
		);
		expect(() => canonicalizeJson({ k: loneHigh })).toThrow(
			CanonicalizationError,
		);
		// A well-formed surrogate pair is valid Unicode and canonicalizes.
		expect(canonicalizeJson(GRINNING)).toBe(`"${GRINNING}"`);
	});

	it("rejects non-JSON values and non-finite numbers", () => {
		expect(() => canonicalizeJson(undefined)).toThrow(CanonicalizationError);
		expect(() => canonicalizeJson(Number.NaN)).toThrow(CanonicalizationError);
		expect(() => canonicalizeJson(Number.POSITIVE_INFINITY)).toThrow(
			CanonicalizationError,
		);
	});
});

describe("requestFingerprintV1", () => {
	it("computes the fixed preimage digest", async () => {
		const body = { b: 1, a: { d: [2, { e: 3 }] } };
		const fingerprint = await requestFingerprintV1(
			"post",
			"/api/v1/transfers",
			body,
		);
		const preimage = `communitytoken-idempotency-v1\nPOST\n/api/v1/transfers\n${canonicalizeJson(body)}`;
		const expected = hex(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(preimage)),
		);
		expect(fingerprint).toBe(expected);
		expect(FINGERPRINT_VERSION).toBe("v1");
	});

	it("uppercases the method and uses the path verbatim", async () => {
		const lower = await requestFingerprintV1("post", "/api/v1/transfers", {});
		const upper = await requestFingerprintV1("POST", "/api/v1/transfers", {});
		expect(lower).toBe(upper);
		const otherPath = await requestFingerprintV1(
			"POST",
			"/api/v1/transfers/",
			{},
		);
		expect(otherPath).not.toBe(upper);
	});

	it("changes when the body changes", async () => {
		const a = await requestFingerprintV1("POST", "/x", { amount: 5 });
		const b = await requestFingerprintV1("POST", "/x", { amount: 6 });
		expect(a).not.toBe(b);
	});
});
