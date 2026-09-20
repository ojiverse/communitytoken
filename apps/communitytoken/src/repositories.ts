/**
 * SQLite-backed implementations of the application repository ports. Each
 * repository reads and writes `ctx.storage.sql` inside the owning
 * `transactionSync` section; handles handed to a section are bound to that
 * section's lifetime by the UnitOfWork, never to the storage itself.
 *
 * Records returned to callers are frozen storage-owned snapshots: a row
 * object handed out by a repository can never alias-mutate durable state,
 * which only changes through repository mutation methods.
 */

import type {
	IdempotencyRepository,
	IdentityBindingRepository,
	LedgerRepository,
	OperationRepository,
	WalletRepository,
} from "@communitytoken/application";
import {
	type HistoryRow,
	type IdempotencyRecord,
	type OperationRecord,
	type Page,
	type PersistedActor,
	persistedActor,
	rehydrate,
	type Wallet,
} from "@communitytoken/application";
import type { OperationKind } from "@communitytoken/economic-kernel";

type WalletRow = {
	readonly id: string;
	readonly kind: "system" | "user";
	readonly owner_user_id: string | null;
	readonly balance: number;
	readonly created_at: number;
	readonly updated_at: number;
};

type HistoryJoinRow = {
	readonly lrowid: number;
	readonly op_id: string;
	readonly kind: OperationKind;
	readonly metadata: string | null;
	readonly actor_kind: "user" | "service" | "system";
	readonly actor_id: string | null;
	readonly op_created_at: number;
	readonly amount: number;
	readonly from_wallet_id: string;
	readonly from_owner: string | null;
	readonly to_wallet_id: string;
	readonly to_owner: string | null;
};

const WALLET_COLUMNS =
	"id, kind, owner_user_id, balance, created_at, updated_at";

/**
 * The operation+ledger join behind `listForWallet`, newest first. The
 * `wallets` joins are LEFT JOINs: owner ids enrich the row for
 * `counterparty` shaping and must not drop a movement whose wallet row
 * somehow lacks an owner side.
 */
const HISTORY_SQL = `
SELECT l.rowid AS lrowid,
       o.id AS op_id, o.kind, o.metadata, o.actor_kind, o.actor_id,
       o.created_at AS op_created_at,
       l.amount, l.from_wallet_id, l.to_wallet_id,
       wf.owner_user_id AS from_owner,
       wt.owner_user_id AS to_owner
FROM ledger_transactions l
JOIN economic_operations o ON o.id = l.operation_id
LEFT JOIN wallets wf ON wf.id = l.from_wallet_id
LEFT JOIN wallets wt ON wt.id = l.to_wallet_id
WHERE (l.from_wallet_id = ? OR l.to_wallet_id = ?)
`;

function toWallet(row: WalletRow): Wallet {
	const base = {
		id: rehydrate.walletId(row.id),
		balance: row.balance,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
	if (row.kind === "system") {
		return Object.freeze({ ...base, kind: "system", ownerUserId: null });
	}
	if (row.owner_user_id === null) {
		throw new Error(`user wallet ${row.id} has no owner`);
	}
	return Object.freeze({
		...base,
		kind: "user",
		ownerUserId: rehydrate.userId(row.owner_user_id),
	});
}

function toPersistedActor(
	actorKind: "user" | "service" | "system",
	actorId: string | null,
): PersistedActor {
	switch (actorKind) {
		case "user":
			if (actorId === null) throw new Error("user actor without actor_id");
			return { actorKind: "user", actorId: rehydrate.userId(actorId) };
		case "service":
			if (actorId === null) {
				throw new Error("service actor without actor_id");
			}
			return { actorKind: "service", actorId };
		case "system":
			return { actorKind: "system", actorId: null };
	}
}

export function createWalletRepository(sql: SqlStorage): WalletRepository {
	return {
		findById(id) {
			const rows = sql
				.exec(`SELECT ${WALLET_COLUMNS} FROM wallets WHERE id = ?`, id)
				.toArray() as unknown as WalletRow[];
			return rows.length === 0 ? undefined : toWallet(rows[0] as WalletRow);
		},
		findByOwnerUserId(owner) {
			const rows = sql
				.exec(
					`SELECT ${WALLET_COLUMNS} FROM wallets WHERE owner_user_id = ?`,
					owner,
				)
				.toArray() as unknown as WalletRow[];
			return rows.length === 0 ? undefined : toWallet(rows[0] as WalletRow);
		},
		setBalance(id, balance, updatedAt) {
			const cursor = sql.exec(
				"UPDATE wallets SET balance = ?, updated_at = ? WHERE id = ?",
				balance,
				updatedAt,
				id,
			);
			if (cursor.rowsWritten !== 1) {
				throw new Error(`setBalance on missing wallet: ${id}`);
			}
		},
		totalSupply() {
			return Number(
				sql
					.exec("SELECT COALESCE(SUM(balance), 0) AS total FROM wallets")
					.one()["total"],
			);
		},
	};
}

export function createOperationRepository(
	sql: SqlStorage,
): OperationRepository {
	return {
		insert(record) {
			const id = rehydrate.operationId(crypto.randomUUID());
			const actor = persistedActor(record.actor);
			sql.exec(
				"INSERT INTO economic_operations (id, kind, metadata, actor_kind, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
				id,
				record.kind,
				record.metadata,
				actor.actorKind,
				actor.actorId,
				record.createdAt,
			);
			const stored: OperationRecord = Object.freeze({
				id,
				kind: record.kind,
				metadata: record.metadata,
				createdAt: record.createdAt,
				...actor,
			});
			return stored;
		},
		listForWallet(walletId, cursor, limit) {
			const rows = (cursor === null
				? sql.exec(
						`${HISTORY_SQL} ORDER BY l.rowid DESC LIMIT ?`,
						walletId,
						walletId,
						limit + 1,
					)
				: sql.exec(
						`${HISTORY_SQL} AND l.rowid < ? ORDER BY l.rowid DESC LIMIT ?`,
						walletId,
						walletId,
						Number(cursor),
						limit + 1,
					)
			).toArray() as unknown as HistoryJoinRow[];
			const pageRows = rows.slice(0, limit);
			const entries: HistoryRow[] = pageRows.map((row) => ({
				id: rehydrate.operationId(row.op_id),
				kind: row.kind,
				amount: row.amount,
				fromWalletId: rehydrate.walletId(row.from_wallet_id),
				fromOwnerUserId:
					row.from_owner === null ? null : rehydrate.userId(row.from_owner),
				toWalletId: rehydrate.walletId(row.to_wallet_id),
				toOwnerUserId:
					row.to_owner === null ? null : rehydrate.userId(row.to_owner),
				metadata: row.metadata,
				createdAt: row.op_created_at,
				...toPersistedActor(row.actor_kind, row.actor_id),
			}));
			const last = pageRows.at(-1);
			const page: Page<HistoryRow> = {
				entries,
				nextCursor:
					rows.length > pageRows.length && last !== undefined
						? String(last.lrowid)
						: null,
			};
			return page;
		},
	};
}

export function createLedgerRepository(sql: SqlStorage): LedgerRepository {
	return {
		insert(entry) {
			const id = rehydrate.ledgerId(crypto.randomUUID());
			sql.exec(
				"INSERT INTO ledger_transactions (id, operation_id, from_wallet_id, to_wallet_id, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)",
				id,
				entry.operationId,
				entry.fromWalletId,
				entry.toWalletId,
				entry.amount,
				entry.createdAt,
			);
			return Object.freeze({
				id,
				operationId: entry.operationId,
				fromWalletId: entry.fromWalletId,
				toWalletId: entry.toWalletId,
				amount: entry.amount,
				createdAt: entry.createdAt,
			});
		},
	};
}

type IdentityBindingRow = {
	readonly user_id: string;
};

/**
 * SQLite-backed IdentityBinding lookup: exact `(issuer, subject)` match
 * against the append-only binding table. Creation is registration-owned
 * (PR-4); PR-3 has no insert port.
 */
export function createIdentityBindingRepository(
	sql: SqlStorage,
): IdentityBindingRepository {
	return {
		findUserIdByExternal(issuer, subject) {
			const rows = sql
				.exec(
					"SELECT user_id FROM identity_bindings WHERE issuer = ? AND subject = ?",
					issuer,
					subject,
				)
				.toArray() as unknown as IdentityBindingRow[];
			const row = rows[0];
			return row === undefined ? undefined : rehydrate.userId(row.user_id);
		},
	};
}

type IdempotencyRow = {
	readonly service_principal: string;
	readonly idempotency_key: string;
	readonly fingerprint_version: string;
	readonly request_fingerprint: string;
	readonly stored_result: string;
	readonly created_at: number;
};

/**
 * SQLite-backed IdempotencyRecord storage: the `(service_principal,
 * idempotency_key)` UNIQUE constraint is the storage floor that makes a
 * duplicate `insert` fail, so a second commit under the same key can never
 * overwrite the first replay record.
 */
export function createIdempotencyRepository(
	sql: SqlStorage,
): IdempotencyRepository {
	return {
		find(servicePrincipal, idempotencyKey) {
			const rows = sql
				.exec(
					"SELECT service_principal, idempotency_key, fingerprint_version, request_fingerprint, stored_result, created_at FROM idempotency_records WHERE service_principal = ? AND idempotency_key = ?",
					servicePrincipal,
					idempotencyKey,
				)
				.toArray() as unknown as IdempotencyRow[];
			const row = rows[0];
			if (row === undefined) return undefined;
			const record: IdempotencyRecord = {
				servicePrincipal: row.service_principal,
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
				"INSERT INTO idempotency_records (service_principal, idempotency_key, fingerprint_version, request_fingerprint, stored_result, created_at) VALUES (?, ?, ?, ?, ?, ?)",
				record.servicePrincipal,
				record.idempotencyKey,
				record.fingerprintVersion,
				record.requestFingerprint,
				record.storedResult,
				record.createdAt,
			);
		},
	};
}
