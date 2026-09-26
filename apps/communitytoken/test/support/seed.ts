import { runInDurableObject } from "cloudflare:test";
import { ADMIN_API_CALLER } from "@communitytoken/application";
import type {
	CommunityState,
	ExternalIdentity,
} from "../../src/community-state";

/**
 * Test-only seeding over the production Durable Object storage. The
 * production object deliberately exposes no test-support RPC: seeding runs
 * inside the object through `runInDurableObject`, and funding goes through
 * the real administrative issuance method so ISSUE provenance and supply
 * accounting stay production-shaped.
 */

/** The internal ids of a seeded registered identity (never exposed by routes). */
export type SeededIdentity = {
	readonly principalId: string;
	readonly accountId: string;
};

/**
 * Writes the state a first registration produces — Principal, zero-balance
 * Account, default designation, IdentityBinding — in one storage
 * transaction.
 * @throws {Error} when the identity is already bound (storage UNIQUE).
 */
export function seedIdentity(
	stub: DurableObjectStub<CommunityState>,
	identity: ExternalIdentity,
): Promise<SeededIdentity> {
	return runInDurableObject(stub, (_instance, state) =>
		state.storage.transactionSync(() => {
			const principalId = crypto.randomUUID();
			const accountId = crypto.randomUUID();
			const sql = state.storage.sql;
			sql.exec(
				"INSERT INTO principals (id, created_at) VALUES (?, 0)",
				principalId,
			);
			sql.exec(
				"INSERT INTO accounts (id, owner_principal_id, balance, created_at, updated_at) VALUES (?, ?, 0, 0, 0)",
				accountId,
				principalId,
			);
			sql.exec(
				"INSERT INTO default_accounts (principal_id, account_id, created_at) VALUES (?, ?, 0)",
				principalId,
				accountId,
			);
			sql.exec(
				"INSERT INTO identity_bindings (issuer, subject, principal_id, created_at) VALUES (?, ?, ?, 0)",
				identity.issuer,
				identity.subject,
				principalId,
			);
			return { principalId, accountId };
		}),
	);
}

/** Adds another IdentityBinding for an already-seeded Principal. */
export function bindIdentity(
	stub: DurableObjectStub<CommunityState>,
	principalId: string,
	identity: ExternalIdentity,
): Promise<void> {
	return runInDurableObject(stub, (_instance, state) => {
		state.storage.sql.exec(
			"INSERT INTO identity_bindings (issuer, subject, principal_id, created_at) VALUES (?, ?, ?, 0)",
			identity.issuer,
			identity.subject,
			principalId,
		);
	});
}

/**
 * Funds `target`'s default Account through the production administrative
 * issuance method with a fresh idempotency key.
 * @throws {Error} when the issuance does not succeed.
 */
export async function fund(
	stub: DurableObjectStub<CommunityState>,
	target: ExternalIdentity,
	amount: number,
): Promise<string> {
	const response = await runInDurableObject(stub, (instance) =>
		instance.adminIssue(
			ADMIN_API_CALLER,
			{
				key: `fund-${crypto.randomUUID()}`,
				fingerprintVersion: "v1",
				requestFingerprint: crypto.randomUUID(),
			},
			{ target, amount },
		),
	);
	if (response.status !== 200) {
		throw new Error(`funding failed: ${JSON.stringify(response.body)}`);
	}
	return (response.body as { transaction_id: string }).transaction_id;
}

/** Runs one read-only SQL statement inside the object and returns its rows. */
export function query<T>(
	stub: DurableObjectStub<CommunityState>,
	statement: string,
	...bindings: (string | number | null)[]
): Promise<T[]> {
	return runInDurableObject(
		stub,
		(_instance, state) =>
			state.storage.sql
				.exec(statement, ...bindings)
				.toArray() as unknown as T[],
	);
}

/** The administrative issuer Principal id recorded at initialization. */
export async function administrativeIssuer(
	stub: DurableObjectStub<CommunityState>,
): Promise<string> {
	const rows = await query<{ principal_id: string }>(
		stub,
		"SELECT principal_id FROM administrative_issuer",
	);
	const row = rows[0];
	if (row === undefined) throw new Error("administrative issuer missing");
	return row.principal_id;
}
