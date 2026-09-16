import { DurableObject } from "cloudflare:workers";

/**
 * Persistence PoC for the CommunityToken rebuild (issue #3, Phase 1 §5).
 *
 * Proves that the target production consistency model —
 *   Worker -> single named CommunityState Durable Object -> SQLite storage —
 * can preserve the economic invariants of the existing Supabase/PostgreSQL
 * implementation without row locks or triggers.
 *
 * All mutable state lives in `ctx.storage.sql`. The DO keeps no cached state
 * in instance fields, so object eviction/restart cannot lose committed data.
 */

type WalletKind = "system" | "user";

type OperationKind =
	| "TOKEN_ISSUANCE"
	| "DISTRIBUTION"
	| "P2P_TRANSFER"
	| "TREASURY_PAYMENT";

interface WalletRow {
	id: string;
	kind: WalletKind;
	balance: number;
	created_at: number;
	updated_at: number;
}

interface LedgerRow {
	id: string;
	operation_id: string;
	from_wallet_id: string;
	to_wallet_id: string;
	amount: number;
	created_at: number;
}

interface OperationRow {
	id: string;
	kind: OperationKind;
	actor_wallet_id: string | null;
	metadata: string | null;
	created_at: number;
}

const TREASURY_WALLET_ID = "treasury";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('system', 'user')),
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS economic_operations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN
    ('TOKEN_ISSUANCE', 'DISTRIBUTION', 'P2P_TRANSFER', 'TREASURY_PAYMENT')),
  actor_wallet_id TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES economic_operations(id),
  from_wallet_id TEXT NOT NULL REFERENCES wallets(id),
  to_wallet_id TEXT NOT NULL REFERENCES wallets(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  created_at INTEGER NOT NULL
);

-- Ledger history is append-only: hard storage-level constraint, not
-- application convention.
CREATE TRIGGER IF NOT EXISTS ledger_immutable_update
BEFORE UPDATE ON ledger_transactions
BEGIN
  SELECT RAISE(ABORT, 'ledger_transactions is append-only');
END;

CREATE TRIGGER IF NOT EXISTS ledger_immutable_delete
BEFORE DELETE ON ledger_transactions
BEGIN
  SELECT RAISE(ABORT, 'ledger_transactions is append-only');
END;
`;

export class CommunityState extends DurableObject {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		ctx.blockConcurrencyWhile(async () => {
			ctx.storage.sql.exec(SCHEMA);
			this.ensureTreasury();
		});
	}

	private now(): number {
		return Date.now();
	}

	private ensureTreasury(): void {
		const found = this.ctx.storage.sql
			.exec("SELECT id FROM wallets WHERE id = ?", TREASURY_WALLET_ID)
			.toArray();
		if (found.length === 0) {
			const t = this.now();
			this.ctx.storage.sql.exec(
				"INSERT INTO wallets (id, kind, balance, created_at, updated_at) VALUES (?, 'system', 0, ?, ?)",
				TREASURY_WALLET_ID,
				t,
				t,
			);
		}
	}

	private getWallet(id: string): WalletRow {
		const rows = this.ctx.storage.sql
			.exec(
				"SELECT id, kind, balance, created_at, updated_at FROM wallets WHERE id = ?",
				id,
			)
			.toArray();
		if (rows.length === 0) throw new Error(`wallet not found: ${id}`);
		return rows[0] as unknown as WalletRow;
	}

	createWallet(id: string, kind: WalletKind = "user"): void {
		this.ctx.storage.sql.exec(
			"INSERT INTO wallets (id, kind, balance, created_at, updated_at) VALUES (?, ?, 0, ?, ?)",
			id,
			kind,
			this.now(),
			this.now(),
		);
	}

	getBalance(id: string): number {
		return this.getWallet(id).balance;
	}

	/**
	 * The critical mutation path from issue #3:
	 *   read balances -> evaluate invariants -> update balances
	 *   -> persist EconomicOperation -> append ledger entries -> commit atomically
	 */
	private applyOperation(params: {
		kind: OperationKind;
		fromWalletId: string;
		toWalletId: string;
		amount: number;
		metadata?: string;
	}): string {
		const { kind, fromWalletId, toWalletId, amount, metadata } = params;

		if (!Number.isSafeInteger(amount) || amount <= 0) {
			throw new Error("amount must be a positive integer");
		}

		return this.ctx.storage.transactionSync(() => {
			const from = this.getWallet(fromWalletId);
			const to = this.getWallet(toWalletId);
			const t = this.now();
			const opId = crypto.randomUUID();
			const txId = crypto.randomUUID();

			switch (kind) {
				case "TOKEN_ISSUANCE":
					if (from.id !== to.id || from.kind !== "system") {
						throw new Error(
							"issuance must be a self-transfer on a system wallet",
						);
					}
					break;
				case "DISTRIBUTION":
					if (from.kind !== "system" || to.kind !== "user") {
						throw new Error("distribution must be system -> user");
					}
					break;
				case "P2P_TRANSFER":
					if (from.kind !== "user" || to.kind !== "user") {
						throw new Error("p2p transfer must be user -> user");
					}
					break;
				case "TREASURY_PAYMENT":
					if (from.kind !== "user" || to.kind !== "system") {
						throw new Error("treasury payment must be user -> system");
					}
					break;
			}

			if (kind !== "TOKEN_ISSUANCE" && from.balance < amount) {
				throw new Error(
					`insufficient balance: has ${from.balance}, needs ${amount}`,
				);
			}

			if (kind !== "TOKEN_ISSUANCE") {
				this.ctx.storage.sql.exec(
					"UPDATE wallets SET balance = balance - ?, updated_at = ? WHERE id = ?",
					amount,
					t,
					from.id,
				);
			}
			this.ctx.storage.sql.exec(
				"UPDATE wallets SET balance = balance + ?, updated_at = ? WHERE id = ?",
				amount,
				t,
				to.id,
			);

			this.ctx.storage.sql.exec(
				"INSERT INTO economic_operations (id, kind, actor_wallet_id, metadata, created_at) VALUES (?, ?, ?, ?, ?)",
				opId,
				kind,
				from.id,
				metadata ?? null,
				t,
			);
			this.ctx.storage.sql.exec(
				"INSERT INTO ledger_transactions (id, operation_id, from_wallet_id, to_wallet_id, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)",
				txId,
				opId,
				from.id,
				to.id,
				amount,
				t,
			);

			return opId;
		});
	}

	issue(amount: number): string {
		return this.applyOperation({
			kind: "TOKEN_ISSUANCE",
			fromWalletId: TREASURY_WALLET_ID,
			toWalletId: TREASURY_WALLET_ID,
			amount,
		});
	}

	distribute(toWalletId: string, amount: number): string {
		return this.applyOperation({
			kind: "DISTRIBUTION",
			fromWalletId: TREASURY_WALLET_ID,
			toWalletId,
			amount,
		});
	}

	transferP2P(
		fromWalletId: string,
		toWalletId: string,
		amount: number,
	): string {
		return this.applyOperation({
			kind: "P2P_TRANSFER",
			fromWalletId,
			toWalletId,
			amount,
		});
	}

	payTreasury(fromWalletId: string, amount: number): string {
		return this.applyOperation({
			kind: "TREASURY_PAYMENT",
			fromWalletId,
			toWalletId: TREASURY_WALLET_ID,
			amount,
		});
	}

	/**
	 * Deliberately racy variant used to prove that the serialization boundary
	 * matters: reads and writes are split across awaited calls with no
	 * transactionSync wrapper, so concurrent calls can interleave and
	 * double-spend. Never use outside tests.
	 */
	async transferP2PUnsafe(
		fromWalletId: string,
		toWalletId: string,
		amount: number,
	): Promise<void> {
		const from = this.getWallet(fromWalletId);
		const t = this.now();
		await Promise.resolve();
		if (from.balance < amount) {
			throw new Error("insufficient balance");
		}
		await Promise.resolve();
		this.ctx.storage.sql.exec(
			"UPDATE wallets SET balance = balance - ?, updated_at = ? WHERE id = ?",
			amount,
			t,
			fromWalletId,
		);
		this.ctx.storage.sql.exec(
			"UPDATE wallets SET balance = balance + ?, updated_at = ? WHERE id = ?",
			amount,
			t,
			toWalletId,
		);
	}

	listOperations(): OperationRow[] {
		return this.ctx.storage.sql
			.exec(
				"SELECT id, kind, actor_wallet_id, metadata, created_at FROM economic_operations ORDER BY rowid",
			)
			.toArray() as unknown as OperationRow[];
	}

	listLedger(): LedgerRow[] {
		return this.ctx.storage.sql
			.exec(
				"SELECT id, operation_id, from_wallet_id, to_wallet_id, amount, created_at FROM ledger_transactions ORDER BY rowid",
			)
			.toArray() as unknown as LedgerRow[];
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const stub = env.COMMUNITY_STATE.get(
			env.COMMUNITY_STATE.idFromName("community"),
		);
		const url = new URL(request.url);

		if (request.method === "POST" && url.pathname === "/wallets") {
			const body = (await request.json()) as { id: string; kind?: WalletKind };
			await stub.createWallet(body.id, body.kind ?? "user");
			return Response.json({ id: body.id }, { status: 201 });
		}

		if (request.method === "GET" && url.pathname.startsWith("/wallets/")) {
			const id = url.pathname.split("/")[2] ?? "";
			try {
				return Response.json({ id, balance: await stub.getBalance(id) });
			} catch {
				return Response.json({ error: "wallet not found" }, { status: 404 });
			}
		}

		if (request.method === "POST" && url.pathname === "/issue") {
			const { amount } = (await request.json()) as { amount: number };
			return Response.json({ operationId: await stub.issue(amount) });
		}

		if (request.method === "POST" && url.pathname === "/transfer") {
			const body = (await request.json()) as {
				from: string;
				to: string;
				amount: number;
				kind?: OperationKind;
			};
			try {
				const operationId =
					body.kind === "DISTRIBUTION"
						? await stub.distribute(body.to, body.amount)
						: body.kind === "TREASURY_PAYMENT"
							? await stub.payTreasury(body.from, body.amount)
							: await stub.transferP2P(body.from, body.to, body.amount);
				return Response.json({ operationId });
			} catch (e) {
				return Response.json(
					{ error: e instanceof Error ? e.message : "failed" },
					{ status: 422 },
				);
			}
		}

		return Response.json({ error: "not found" }, { status: 404 });
	},
};
