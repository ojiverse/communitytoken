/**
 * Idempotency fingerprint v1 (issue #4 PR-3, the idempotency
 * specification): an RFC 8785 (JCS) canonical JSON serializer plus the
 * SHA-256 preimage digest. Runs in the Worker before the synchronous
 * Durable Object section — the digest must complete before
 * `transactionSync` begins.
 *
 * The canonicalizer serializes canonical JSON directly; it never rebuilds
 * a sorted ordinary object for `JSON.stringify`, because JavaScript
 * enumerates integer-index-looking property names in numeric order rather
 * than insertion order, which would corrupt the JCS code-unit ordering.
 *
 * Fingerprint v1 preimage:
 *
 *   "communitytoken-idempotency-v1\n"
 *   + UPPERCASE_METHOD + "\n"
 *   + PATH + "\n"
 *   + RFC8785_JCS(parsed_json_body)
 *
 * request_fingerprint = lowercase hex of SHA-256 over UTF-8(preimage).
 * The idempotency key, bearer bytes, service principal, transport-only
 * headers, and query parameters are excluded by construction — they never
 * enter the preimage.
 */

/** The fingerprint version persisted on `idempotency_records`. */
export const FINGERPRINT_VERSION = "v1";

const PREIMAGE_PREFIX = "communitytoken-idempotency-v1\n";

/**
 * Thrown when a value cannot be canonically serialized: a string or
 * property name containing a lone surrogate (invalid Unicode per RFC
 * 8785), a non-finite number, or a value outside the JSON data model.
 * The boundary maps this to `400 invalid_request`.
 */
export class CanonicalizationError extends Error {
	constructor(detail: string) {
		super(detail);
		this.name = "CanonicalizationError";
	}
}

/**
 * Asserts `value` is well-formed Unicode: every UTF-16 high surrogate is
 * followed by a low surrogate and no unpaired low surrogate appears.
 * `JSON.parse` happily produces lone surrogates from `\uXXXX` escapes, so
 * parsed input is not proof of well-formedness.
 */
function assertWellFormed(value: string): void {
	for (let i = 0; i < value.length; i++) {
		const unit = value.charCodeAt(i);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = value.charCodeAt(i + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) {
				throw new CanonicalizationError("lone high surrogate in JSON value");
			}
			i++;
		} else if (unit >= 0xdc00 && unit <= 0xdfff) {
			throw new CanonicalizationError("lone low surrogate in JSON value");
		}
	}
}

/**
 * Compares two property names in raw UTF-16 code-unit order — the ordering
 * RFC 8785 requires — which is exactly JavaScript's `<` on strings.
 */
function codeUnitOrder(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Serializes `value` as canonical JSON per RFC 8785: object property names
 * sorted recursively by raw UTF-16 code-unit order, arrays in element
 * order, and ECMAScript JSON serialization for strings, numbers, and
 * literals (`JSON.stringify` on a scalar is that serialization). No
 * Unicode normalization is applied.
 *
 * @throws {CanonicalizationError} when `value` contains a lone surrogate,
 *   a non-finite number, or a non-JSON value (undefined, function, symbol,
 *   bigint). Input is normally already `JSON.parse` output, where only the
 *   surrogate case can occur.
 */
export function canonicalizeJson(value: unknown): string {
	switch (typeof value) {
		case "string":
			assertWellFormed(value);
			return JSON.stringify(value);
		case "number":
			if (!Number.isFinite(value)) {
				throw new CanonicalizationError("non-finite number in JSON value");
			}
			return JSON.stringify(value);
		case "boolean":
			return value ? "true" : "false";
		case "object": {
			if (value === null) return "null";
			if (Array.isArray(value)) {
				const elements = value.map((element) => canonicalizeJson(element));
				return `[${elements.join(",")}]`;
			}
			const record = value as Record<string, unknown>;
			const keys = Object.keys(record).sort(codeUnitOrder);
			const properties = keys.map((key) => {
				assertWellFormed(key);
				return `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`;
			});
			return `{${properties.join(",")}}`;
		}
		default:
			throw new CanonicalizationError(
				`cannot canonicalize JSON value of type ${typeof value}`,
			);
	}
}

/**
 * Computes the fingerprint v1 of a wire-validated request: the lowercase
 * hexadecimal SHA-256 digest of the fixed preimage built from the
 * uppercase method, the request path, and the canonical serialization of
 * the parsed JSON body.
 *
 * @throws {CanonicalizationError} when the parsed body cannot be
 *   canonically serialized (lone surrogates).
 */
export async function requestFingerprintV1(
	method: string,
	path: string,
	parsedBody: unknown,
): Promise<string> {
	const canonical = canonicalizeJson(parsedBody);
	const preimage = `${PREIMAGE_PREFIX}${method.toUpperCase()}\n${path}\n${canonical}`;
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(preimage),
	);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}
