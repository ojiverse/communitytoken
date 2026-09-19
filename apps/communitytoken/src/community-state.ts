import { DurableObject } from "cloudflare:workers";
import {
	type Actor,
	type AdminActor,
	applyEconomicCommand as applyEconomicCommandOperation,
	type BalanceResult,
	type Clock,
	type CommunityTokenApplication,
	createCommunityTokenApplication,
	type DistributeTokenInput,
	type EconomicSelectorCommand,
	type HistoryEntry,
	type HistoryRequest,
	type IssueTokenInput,
	type OperationAccepted,
	type Page,
	type PayTreasuryInput,
	type PayTreasuryResult,
	type TransferTokenInput,
	type TransferTokenResult,
	type UnitOfWork,
	type UseCaseResult,
	type UserActor,
	type WalletSelector,
} from "@communitytoken/application";
import { TREASURY_WALLET_ID } from "@communitytoken/economic-kernel";
import { SCHEMA } from "./schema";
import { createStorageUnitOfWork } from "./unit-of-work";

/** Raw `economic_operations` row as returned by `listOperations`. */
export type OperationRow = {
	readonly id: string;
	readonly kind: string;
	readonly metadata: string | null;
	readonly actor_kind: string;
	readonly actor_id: string | null;
	readonly created_at: number;
};

/** Raw `ledger_transactions` row as returned by `listLedger`. */
export type LedgerRow = {
	readonly id: string;
	readonly operation_id: string;
	readonly from_wallet_id: string;
	readonly to_wallet_id: string;
	readonly amount: number;
	readonly created_at: number;
};

/**
 * The production CommunityState Durable Object (issue #4 PR-2): the single
 * serialization authority for one community's durable economic state.
 * The deployment dereferences exactly one instance via
 * `idFromName("community")`.
 *
 * All mutable state lives in `ctx.storage.sql`; the DO keeps no cached
 * state in instance fields, so object eviction/restart cannot lose
 * committed data. Schema initialization runs under
 * `blockConcurrencyWhile` before any RPC can execute.
 *
 * The RPC surface has two tiers:
 *
 *   - the six product use-case methods (`issueToken`, `distributeToken`,
 *     `transferToken`, `payTreasury`, `getBalance`,
 *     `getTransactionHistory`) — the real production entries that later
 *     PRs wire to routes; each owns an entire `transact` body;
 *   - test-support methods (`createUser`, `applyEconomicCommand`,
 *     `listOperations`, `listLedger`, `issuedAmount`, `totalSupply`) for
 *     the unchanged Phase 1 contract harness — unreachable from the
 *     Worker's `fetch()`, which returns 404 for every request in PR-2.
 */
export class CommunityState extends DurableObject {
	private readonly uow: UnitOfWork;
	private readonly app: CommunityTokenApplication;

	/**
	 * The clock authority behind the UnitOfWork's per-section sample. The
	 * production value is `Date.now()`; the field is the injection seam
	 * deterministic tests replace (request-supplied timestamps are never
	 * accepted).
	 */
	clock: Clock = { nowMs: () => Date.now() };

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		ctx.blockConcurrencyWhile(async () => {
			ctx.storage.sql.exec(SCHEMA);
			this.ensureTreasury();
		});
		this.uow = createStorageUnitOfWork(ctx.storage, {
			nowMs: () => this.clock.nowMs(),
		});
		this.app = createCommunityTokenApplication({ uow: this.uow });
	}

	/**
	 * Seeds the deployment's single system wallet at construction time.
	 * The treasury id is the kernel's well-known identifier; its balance
	 * starts at zero — initial funding is an explicit TOKEN_ISSUANCE, not
	 * a hidden seed.
	 */
	private ensureTreasury(): void {
		const found = this.ctx.storage.sql
			.exec("SELECT id FROM wallets WHERE id = ?", TREASURY_WALLET_ID)
			.toArray();
		if (found.length === 0) {
			const t = this.clock.nowMs();
			this.ctx.storage.sql.exec(
				"INSERT INTO wallets (id, kind, owner_user_id, balance, created_at, updated_at) VALUES (?, 'system', NULL, 0, ?, ?)",
				TREASURY_WALLET_ID,
				t,
				t,
			);
		}
	}

	// ---- Product use-case methods ------------------------------------

	issueToken(
		actor: AdminActor,
		input: IssueTokenInput,
	): UseCaseResult<OperationAccepted> {
		return this.app.issueToken(actor, input);
	}

	distributeToken(
		actor: AdminActor,
		input: DistributeTokenInput,
	): UseCaseResult<OperationAccepted> {
		return this.app.distributeToken(actor, input);
	}

	transferToken(
		actor: UserActor,
		input: TransferTokenInput,
	): UseCaseResult<TransferTokenResult> {
		return this.app.transferToken(actor, input);
	}

	payTreasury(
		actor: UserActor,
		input: PayTreasuryInput,
	): UseCaseResult<PayTreasuryResult> {
		return this.app.payTreasury(actor, input);
	}

	getBalance(
		actor: Actor,
		selector: WalletSelector,
	): UseCaseResult<BalanceResult> {
		// The facade's overloads pin actor to selector for typed callers;
		// the use-case guards re-check the pairing at runtime.
		return selector.type === "treasury"
			? this.app.getBalance(actor as AdminActor, selector)
			: this.app.getBalance(actor as UserActor, selector);
	}

	getTransactionHistory(
		actor: Actor,
		selector: WalletSelector,
		request: HistoryRequest,
	): UseCaseResult<Page<HistoryEntry>> {
		return selector.type === "treasury"
			? this.app.getTransactionHistory(actor as AdminActor, selector, request)
			: this.app.getTransactionHistory(actor as UserActor, selector, request);
	}

	// ---- Test-support methods (unreachable from fetch) ----------------

	/**
	 * Registers a user and its single zero-balance wallet for the
	 * contract suite: `users` then `wallets` inside one serialized
	 * transaction (the FK order workerd enforces). The suite-supplied id
	 * is stored verbatim — caller-supplied test input, not a relaxation
	 * of production `crypto.randomUUID()` id generation — while the
	 * seeded wallet id is a fresh UUID.
	 */
	createUser(rawUserId: string): void {
		this.ctx.storage.transactionSync(() => {
			const t = this.clock.nowMs();
			this.ctx.storage.sql.exec(
				"INSERT INTO users (id, created_at) VALUES (?, ?)",
				rawUserId,
				t,
			);
			this.ctx.storage.sql.exec(
				"INSERT INTO wallets (id, kind, owner_user_id, balance, created_at, updated_at) VALUES (?, 'user', ?, 0, ?, ?)",
				crypto.randomUUID(),
				rawUserId,
				t,
				t,
			);
		});
	}

	/**
	 * The non-facade application operation the Phase 1 contract adapter
	 * drives: resolves `WalletSelector`s and runs the normal
	 * evaluate/persist choreography inside one serialized transaction.
	 * `actor` is supplied explicitly by the harness's deterministic
	 * mapping and is persisted verbatim as audit context.
	 */
	applyEconomicCommand(
		actor: Actor,
		command: EconomicSelectorCommand,
	): UseCaseResult<OperationAccepted> {
		return this.uow.transact((ctx) =>
			applyEconomicCommandOperation(ctx, actor, command),
		);
	}

	listOperations(): readonly OperationRow[] {
		return this.ctx.storage.sql
			.exec(
				"SELECT id, kind, metadata, actor_kind, actor_id, created_at FROM economic_operations ORDER BY rowid",
			)
			.toArray() as unknown as OperationRow[];
	}

	listLedger(): readonly LedgerRow[] {
		return this.ctx.storage.sql
			.exec(
				"SELECT id, operation_id, from_wallet_id, to_wallet_id, amount, created_at FROM ledger_transactions ORDER BY rowid",
			)
			.toArray() as unknown as LedgerRow[];
	}

	issuedAmount(): number {
		return Number(
			this.ctx.storage.sql
				.exec(
					"SELECT COALESCE(SUM(l.amount), 0) AS total " +
						"FROM ledger_transactions l " +
						"JOIN economic_operations o ON o.id = l.operation_id " +
						"WHERE o.kind = 'TOKEN_ISSUANCE'",
				)
				.one()["total"],
		);
	}

	/**
	 * The supply fact through the production wallet-repository aggregate
	 * inside a transaction — the same read path the evaluator's facts
	 * use, not a separate raw query.
	 */
	totalSupply(): number {
		return this.uow.transact((ctx) => ctx.wallets.totalSupply());
	}
}
