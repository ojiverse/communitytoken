import { ADMIN_API_CALLER } from "@communitytoken/application";
import { describe, expect, it } from "vitest";
import {
	authenticate,
	DISCORD_ADAPTER_CALLER,
	type ServiceCredentials,
} from "../src/auth";

/**
 * PR-3 Worker authentication coverage (issue #4, the
 * authentication/delegation specification): the Bearer credential asserts
 * a technical caller. A missing/empty configured token never matches,
 * and a credential matching both configured secrets — including equal
 * configured secrets — is ambiguous and fails closed.
 */

const CREDENTIALS: ServiceCredentials = {
	adminApiToken: "test-admin-secret",
	discordAdapterToken: "test-discord-secret",
};

function requestWith(header?: string): Request {
	return new Request("https://token.ojiver.se/x", {
		headers: header === undefined ? {} : { Authorization: header },
	});
}

describe("authenticate", () => {
	it("rejects a missing or malformed Authorization header", async () => {
		expect(await authenticate(requestWith(), CREDENTIALS)).toBeNull();
		expect(
			await authenticate(requestWith("Basic abc"), CREDENTIALS),
		).toBeNull();
		expect(await authenticate(requestWith("Bearer"), CREDENTIALS)).toBeNull();
		expect(await authenticate(requestWith("Bearer "), CREDENTIALS)).toBeNull();
		expect(
			await authenticate(requestWith("Bearer wrong"), CREDENTIALS),
		).toBeNull();
	});

	it("accepts each configured credential and asserts its technical caller", async () => {
		expect(
			await authenticate(
				requestWith("Bearer test-discord-secret"),
				CREDENTIALS,
			),
		).toBe(DISCORD_ADAPTER_CALLER);
		expect(
			await authenticate(requestWith("Bearer test-admin-secret"), CREDENTIALS),
		).toBe(ADMIN_API_CALLER);
	});

	it("parses the Bearer scheme case-insensitively and keeps the token verbatim", async () => {
		expect(
			await authenticate(requestWith("bearer test-admin-secret"), CREDENTIALS),
		).toBe(ADMIN_API_CALLER);
		// No trimming or case normalization of the credential bytes: inner
		// whitespace and a different case are different credentials.
		expect(
			await authenticate(requestWith("Bearer  test-admin-secret"), CREDENTIALS),
		).toBeNull();
		expect(
			await authenticate(requestWith("Bearer TEST-ADMIN-SECRET"), CREDENTIALS),
		).toBeNull();
	});

	it("never matches an unset or empty configured token", async () => {
		const unset: ServiceCredentials = {
			adminApiToken: undefined,
			discordAdapterToken: "test-discord-secret",
		};
		expect(
			await authenticate(requestWith("Bearer anything"), unset),
		).toBeNull();
		const empty: ServiceCredentials = {
			adminApiToken: "",
			discordAdapterToken: "test-discord-secret",
		};
		expect(
			await authenticate(requestWith("Bearer test-admin-secret"), empty),
		).toBeNull();
	});

	it("fails closed when both configured secrets equal the credential", async () => {
		const equal: ServiceCredentials = {
			adminApiToken: "same-secret",
			discordAdapterToken: "same-secret",
		};
		// Ambiguous match — no technical caller is asserted.
		expect(
			await authenticate(requestWith("Bearer same-secret"), equal),
		).toBeNull();
	});
});
