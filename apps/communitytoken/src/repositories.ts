/**
 * SQLite-backed implementations of the application repository ports. Each
 * repository reads and writes `ctx.storage.sql` inside the owning
 * `transactionSync` section; handles handed to a section are bound to that
 * section's lifetime by the UnitOfWork, never to the storage itself.
 *
 * Records returned to callers are frozen storage-owned snapshots: a row
 * object handed out by a repository can never alias-mutate durable state,
 * which only changes through repository mutation methods. Identifiers are
 * allocated here with `crypto.randomUUID()`.
 */

import {
	type Account,
	type AccountRepository,
	type AdministrativeIssuerRepository,
	type DefaultAccountRepository,
	type IdempotencyRecord,
	type IdempotencyRepository,
	type IdentityBindingRepository,
	type Page,
	type PrincipalRepository,
	type RegistrationIntent,
	type RegistrationIntentRepository,
	type RegistrationIntentStatus,
	rehydrate,
	type TransactionRecord,
	type TransactionRepository,
} from "@communitytoken/application";

type AccountRow = {
	readonly id: string;
	readonly owner_principal_id: string;
	readonly balance: number;
	readonly created_at: number;
	readonly updated_at: number;
};

const ACCOUNT_COLUMNS =
	"id, owner_principal_id, balance, created_at, updated_at";

function toAccount(row: AccountRow): Account {
	return Object.freeze({
		id: rehydrate.accountId(row.id),
		ownerPrincipalId: rehydrate.principalId(row.owner_principal_id),
		balance: row.balance,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	});
}

export function createPrincipalRepository(
	sql: SqlStorage,
): PrincipalRepository {
	return {
		findById(id) {
			const rows = sql
				.exec("SELECT id, created_at FROM principals WHERE id = ?", id)
				.toArray() as unknown as { id: string; created_at: number }[];
			const row = rows[0];
			return row === undefined
				? undefined
				: Object.freeze({
						id: rehydrate.principalId(row.id),
						createdAt: row.created_at,
					});
		},
		insert(record) {
			const id = rehydrate.principalId(crypto.randomUUID());
			sql.exec(
				"INSERT INTO principals (id, created_at) VALUES (?, ?)",
				id,
				record.createdAt,
			);
			return Object.freeze({ id, createdAt: record.createdAt });
		},
	};
}

export function createAccountRepository(sql: SqlStorage): AccountRepository {
	return {
		findById(id) {
			const rows = sql
				.exec(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = ?`, id)
				.toArray() as unknown as AccountRow[];
			const row = rows[0];
			return row === undefined ? undefined : toAccount(row);
		},
		insert(record) {
			const id = crypto.randomUUID();
			sql.exec(
				`INSERT INTO accounts (${ACCOUNT_COLUMNS}) VALUES (?, ?, 0, ?, ?)`,
				id,
				record.ownerPrincipalId,
				record.createdAt,
				record.createdAt,
			);
			return toAccount({
				id,
				owner_principal_id: record.ownerPrincipalId,
				balance: 0,
				created_at: record.createdAt,
				updated_at: record.createdAt,
			});
		},
		setBalance(id, balance, updatedAt) {
			const cursor = sql.exec(
				"UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ?",
				balance,
				updatedAt,
				id,
			);
			if (cursor.rowsWritten !== 1) {
				throw new Error(`setBalance on missing account: ${id}`);
			}
		},
		totalSupply() {
			return Number(
				sql
					.exec("SELECT COALESCE(SUM(balance), 0) AS total FROM accounts")
					.one()["total"],
			);
		},
	};
}

/**
 * SQLite-backed default-Account designation: the primary key, composite
 * foreign key, and unique constraint of `default_accounts` reject a second
 * designation, a foreign-owned Account, and a doubly-designated Account.
 */
export function createDefaultAccountRepository(
	sql: SqlStorage,
): DefaultAccountRepository {
	return {
		findAccountId(principalId) {
			const rows = sql
				.exec(
					"SELECT account_id FROM default_accounts WHERE principal_id = ?",
					principalId,
				)
				.toArray() as unknown as { account_id: string }[];
			const row = rows[0];
			return row === undefined
				? undefined
				: rehydrate.accountId(row.account_id);
		},
		designate(designation) {
			sql.exec(
				"INSERT INTO default_accounts (principal_id, account_id, created_at) VALUES (?, ?, ?)",
				designation.principalId,
				designation.accountId,
				designation.createdAt,
			);
		},
	};
}

type TransactionRow = {
	readonly rowid: number;
	readonly id: string;
	readonly kind: "ISSUE" | "TRANSFER";
	readonly issuer_principal_id: string | null;
	readonly source_account_id: string | null;
	readonly destination_account_id: string;
	readonly amount: number;
	readonly committed_at: number;
};

const TRANSACTION_COLUMNS =
	"rowid, id, kind, issuer_principal_id, source_account_id, destination_account_id, amount, committed_at";

/**
 * Rehydrates a stored Transaction row, re-checking the kind/shape
 * correlation the storage CHECK guarantees.
 * @throws {Error} when a row violates the ISSUE/TRANSFER shape.
 */
export function toTransactionRecord(row: TransactionRow): TransactionRecord {
	const base = {
		id: rehydrate.transactionId(row.id),
		destinationAccountId: rehydrate.accountId(row.destination_account_id),
		amount: row.amount,
		committedAt: row.committed_at,
	};
	if (row.kind === "ISSUE") {
		if (row.issuer_principal_id === null || row.source_account_id !== null) {
			throw new Error(`malformed ISSUE row: ${row.id}`);
		}
		return Object.freeze({
			...base,
			kind: "ISSUE",
			issuerPrincipalId: rehydrate.principalId(row.issuer_principal_id),
			sourceAccountId: null,
		});
	}
	if (row.source_account_id === null || row.issuer_principal_id !== null) {
		throw new Error(`malformed TRANSFER row: ${row.id}`);
	}
	return Object.freeze({
		...base,
		kind: "TRANSFER",
		issuerPrincipalId: null,
		sourceAccountId: rehydrate.accountId(row.source_account_id),
	});
}

/**
 * SQLite-backed immutable Transaction history. The history cursor is the
 * decimal storage rowid of the last returned row.
 */
export function createTransactionRepository(
	sql: SqlStorage,
): TransactionRepository {
	return {
		insert(record) {
			const id = crypto.randomUUID();
			const issuer = record.kind === "ISSUE" ? record.issuerPrincipalId : null;
			const source = record.kind === "TRANSFER" ? record.sourceAccountId : null;
			sql.exec(
				"INSERT INTO transactions (id, kind, issuer_principal_id, source_account_id, destination_account_id, amount, committed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
				id,
				record.kind,
				issuer,
				source,
				record.destinationAccountId,
				record.amount,
				record.committedAt,
			);
			return toTransactionRecord({
				rowid: 0,
				id,
				kind: record.kind,
				issuer_principal_id: issuer,
				source_account_id: source,
				destination_account_id: record.destinationAccountId,
				amount: record.amount,
				committed_at: record.committedAt,
			});
		},
		listForAccount(accountId, cursor, limit) {
			const where =
				"(source_account_id = ? OR destination_account_id = ?)" +
				(cursor === null ? "" : " AND rowid < ?");
			const args: (string | number)[] =
				cursor === null
					? [accountId, accountId, limit + 1]
					: [accountId, accountId, Number(cursor), limit + 1];
			const rows = sql
				.exec(
					`SELECT ${TRANSACTION_COLUMNS} FROM transactions WHERE ${where} ORDER BY rowid DESC LIMIT ?`,
					...args,
				)
				.toArray() as unknown as TransactionRow[];
			const pageRows = rows.slice(0, limit);
			const last = pageRows.at(-1);
			const page: Page<TransactionRecord> = {
				entries: pageRows.map(toTransactionRecord),
				nextCursor:
					rows.length > pageRows.length && last !== undefined
						? String(last.rowid)
						: null,
			};
			return page;
		},
	};
}

/**
 * SQLite-backed IdentityBinding storage: exact `(issuer, subject)` lookup,
 * same-issuer subject listing for the counterparty projection, and the
 * registration-owned `insert`. A duplicate pair is rejected by the UNIQUE
 * constraint and propagates as a storage failure.
 */
export function createIdentityBindingRepository(
	sql: SqlStorage,
): IdentityBindingRepository {
	return {
		findPrincipalIdByExternal(issuer, subject) {
			const rows = sql
				.exec(
					"SELECT principal_id FROM identity_bindings WHERE issuer = ? AND subject = ?",
					issuer,
					subject,
				)
				.toArray() as unknown as { principal_id: string }[];
			const row = rows[0];
			return row === undefined
				? undefined
				: rehydrate.principalId(row.principal_id);
		},
		listSubjects(principalId, issuer) {
			const rows = sql
				.exec(
					"SELECT subject FROM identity_bindings WHERE principal_id = ? AND issuer = ?",
					principalId,
					issuer,
				)
				.toArray() as unknown as { subject: string }[];
			return Object.freeze(rows.map((row) => row.subject));
		},
		insert(binding) {
			sql.exec(
				"INSERT INTO identity_bindings (issuer, subject, principal_id, created_at) VALUES (?, ?, ?, ?)",
				binding.issuer,
				binding.subject,
				binding.principalId,
				binding.createdAt,
			);
		},
	};
}

/**
 * SQLite-backed administrative issuer mapping: the `singleton = 1` primary
 * key admits one row, and the immutability triggers keep it stable.
 */
export function createAdministrativeIssuerRepository(
	sql: SqlStorage,
): AdministrativeIssuerRepository {
	return {
		find() {
			const rows = sql
				.exec("SELECT principal_id FROM administrative_issuer")
				.toArray() as unknown as { principal_id: string }[];
			const row = rows[0];
			return row === undefined
				? undefined
				: rehydrate.principalId(row.principal_id);
		},
		insert(principalId, createdAt) {
			sql.exec(
				"INSERT INTO administrative_issuer (singleton, principal_id, created_at) VALUES (1, ?, ?)",
				principalId,
				createdAt,
			);
		},
	};
}

type IdempotencyRow = {
	readonly technical_caller: string;
	readonly idempotency_key: string;
	readonly fingerprint_version: string;
	readonly request_fingerprint: string;
	readonly stored_result: string;
	readonly created_at: number;
};

/**
 * SQLite-backed IdempotencyRecord storage: the `(technical_caller,
 * idempotency_key)` UNIQUE constraint is the storage floor that makes a
 * duplicate `insert` fail, so a second commit under the same key can never
 * overwrite the first replay record.
 */
export function createIdempotencyRepository(
	sql: SqlStorage,
): IdempotencyRepository {
	return {
		find(technicalCaller, idempotencyKey) {
			const rows = sql
				.exec(
					"SELECT technical_caller, idempotency_key, fingerprint_version, request_fingerprint, stored_result, created_at FROM idempotency_records WHERE technical_caller = ? AND idempotency_key = ?",
					technicalCaller,
					idempotencyKey,
				)
				.toArray() as unknown as IdempotencyRow[];
			const row = rows[0];
			if (row === undefined) return undefined;
			const record: IdempotencyRecord = {
				technicalCaller: row.technical_caller,
				idempotencyKey: row.idempotency_key,
				fingerprintVersion: row.fingerprint_version,
				requestFingerprint: row.request_fingerprint,
				storedResult: row.stored_result,
				createdAt: row.created_at,
			};
			return Object.freeze(record);
		},
		insert(record) {
			sql.exec(
				"INSERT INTO idempotency_records (technical_caller, idempotency_key, fingerprint_version, request_fingerprint, stored_result, created_at) VALUES (?, ?, ?, ?, ?, ?)",
				record.technicalCaller,
				record.idempotencyKey,
				record.fingerprintVersion,
				record.requestFingerprint,
				record.storedResult,
				record.createdAt,
			);
		},
	};
}

type RegistrationIntentRow = {
	readonly id: string;
	readonly expected_issuer: string;
	readonly expected_subject: string;
	readonly state: string;
	readonly nonce: string;
	readonly pkce_verifier: string;
	readonly status: RegistrationIntentStatus;
	readonly created_at: number;
	readonly expires_at: number;
	readonly consumed_at: number | null;
};

const INTENT_COLUMNS =
	"id, expected_issuer, expected_subject, state, nonce, pkce_verifier, status, created_at, expires_at, consumed_at";

function toRegistrationIntent(row: RegistrationIntentRow): RegistrationIntent {
	return Object.freeze({
		id: rehydrate.registrationIntentId(row.id),
		expectedIssuer: row.expected_issuer,
		expectedSubject: row.expected_subject,
		state: row.state,
		nonce: row.nonce,
		proofKeySecret: row.pkce_verifier,
		status: row.status,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		consumedAt: row.consumed_at,
	});
}

/**
 * SQLite-backed RegistrationIntent storage: the
 * application boundary's `proofKeySecret` maps to the `pkce_verifier`
 * column. The storage floor enforces the lifecycle: `supersedeActive`
 * rewrites every status-active row of the pair (including already-expired
 * ones, which is what keeps the partial unique index from blocking the
 * replacement insert), `markConsumed` writes the single-use terminal
 * transition, and any illegal transition or immutable-column write aborts
 * in the storage triggers.
 */
export function createRegistrationIntentRepository(
	sql: SqlStorage,
): RegistrationIntentRepository {
	return {
		findByState(state) {
			const rows = sql
				.exec(
					`SELECT ${INTENT_COLUMNS} FROM registration_intents WHERE state = ?`,
					state,
				)
				.toArray() as unknown as RegistrationIntentRow[];
			const row = rows[0];
			return row === undefined ? undefined : toRegistrationIntent(row);
		},
		supersedeActive(expectedIssuer, expectedSubject) {
			sql.exec(
				"UPDATE registration_intents SET status = 'superseded' WHERE expected_issuer = ? AND expected_subject = ? AND status = 'active'",
				expectedIssuer,
				expectedSubject,
			);
		},
		insert(record) {
			const id = rehydrate.registrationIntentId(crypto.randomUUID());
			sql.exec(
				`INSERT INTO registration_intents (${INTENT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL)`,
				id,
				record.expectedIssuer,
				record.expectedSubject,
				record.state,
				record.nonce,
				record.proofKeySecret,
				record.createdAt,
				record.expiresAt,
			);
			return toRegistrationIntent({
				id,
				expected_issuer: record.expectedIssuer,
				expected_subject: record.expectedSubject,
				state: record.state,
				nonce: record.nonce,
				pkce_verifier: record.proofKeySecret,
				status: "active",
				created_at: record.createdAt,
				expires_at: record.expiresAt,
				consumed_at: null,
			});
		},
		markConsumed(id, consumedAt) {
			const cursor = sql.exec(
				"UPDATE registration_intents SET status = 'consumed', consumed_at = ? WHERE id = ?",
				consumedAt,
				id,
			);
			if (cursor.rowsWritten !== 1) {
				throw new Error(`markConsumed on missing intent: ${id}`);
			}
		},
	};
}
