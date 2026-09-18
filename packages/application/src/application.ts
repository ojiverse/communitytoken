/**
 * The application boundary of the Phase 2 CommunityToken service (issue #4
 * §1–§2): the runtime-independent use cases a trusted surface invokes after
 * resolving an `Actor`. Owns orchestration, authorization, and actor
 * context; owns no storage, no platform types, and no economic rules — the
 * economic decision boundary remains `@communitytoken/economic-kernel`.
 */

import type { UnitOfWork } from "./ports";
import type {
	Actor,
	AdminActor,
	HistoryEntry,
	Page,
	TreasuryWalletSelector,
	UseCaseResult,
	UserActor,
	UserWalletSelector,
	WalletSelector,
} from "./types";
import {
	type DistributeTokenInput,
	distributeToken,
} from "./use-cases/distribute-token";
import { type BalanceResult, getBalance } from "./use-cases/get-balance";
import {
	getTransactionHistory,
	type HistoryRequest,
} from "./use-cases/get-transaction-history";
import { type IssueTokenInput, issueToken } from "./use-cases/issue-token";
import {
	type PayTreasuryInput,
	type PayTreasuryResult,
	payTreasury,
} from "./use-cases/pay-treasury";
import type { OperationAccepted } from "./use-cases/shared";
import {
	type TransferTokenInput,
	type TransferTokenResult,
	transferToken,
} from "./use-cases/transfer-token";

/**
 * The dependencies every use case requires: the atomic boundary. The
 * section's `TransactionContext` supplies repositories and the frozen
 * `now_ms`; the injected `UnitOfWork` implementation owns the clock source.
 */
export type ApplicationDeps = {
	readonly uow: UnitOfWork;
};

/**
 * The runtime-independent application contract invoked by trusted surfaces
 * (the `/internal/*` and `/admin/*` boundaries of the economic-transition specification1). Every
 * method runs its operation inside `deps.uow.transact`. Callers that must
 * extend the atomic unit — the idempotency record of the idempotency specification, the Daily Reward
 * claim row of the Daily Reward specification — instead open the section themselves and invoke the
 * exported use-case operations against the shared `TransactionContext`;
 * this facade is the convenience path for a single operation. Results
 * carry expected failures (forbidden actor, invalid input, kernel
 * rejection) as values; contract violations and storage faults are thrown.
 */
export interface CommunityTokenApplication {
	/**
	 * Explicit `TOKEN_ISSUANCE` into the treasury (administrative boundary).
	 * @param actor the `admin-api` service principal.
	 */
	issueToken(
		actor: AdminActor,
		input: IssueTokenInput,
	): UseCaseResult<OperationAccepted>;

	/**
	 * `DISTRIBUTION` of existing treasury reserve to a user; never issues
	 * implicitly — insufficient treasury rejects (administrative boundary).
	 * @param actor the `admin-api` service principal.
	 */
	distributeToken(
		actor: AdminActor,
		input: DistributeTokenInput,
	): UseCaseResult<OperationAccepted>;

	/**
	 * `P2P_TRANSFER` from the actor's own wallet to another user. A
	 * self-transfer is valid and recorded net-zero.
	 * @param actor the sending user; only `UserActor` is accepted.
	 */
	transferToken(
		actor: UserActor,
		input: TransferTokenInput,
	): UseCaseResult<TransferTokenResult>;

	/**
	 * `TREASURY_PAYMENT` from the actor's own wallet to the treasury.
	 * @param actor the paying user; only `UserActor` is accepted.
	 */
	payTreasury(
		actor: UserActor,
		input: PayTreasuryInput,
	): UseCaseResult<PayTreasuryResult>;

	/**
	 * Balance of a user wallet under self-only visibility (the economic-transition specification7):
	 * the selector must name the acting user's own wallet.
	 * @param actor the wallet owner; only `UserActor` is accepted.
	 */
	getBalance(
		actor: UserActor,
		selector: UserWalletSelector,
	): UseCaseResult<BalanceResult>;

	/**
	 * Treasury balance — administrative treasury inspection (the economic-transition specification0,
	 * the actor/visibility specification).
	 * @param actor the `admin-api` service principal.
	 */
	getBalance(
		actor: AdminActor,
		selector: TreasuryWalletSelector,
	): UseCaseResult<BalanceResult>;

	/**
	 * Newest-first cursor-paginated history of a user wallet under the same
	 * visibility rule as `getBalance`. `request.limit` must be an integer
	 * in `1..100` (default 50); out-of-contract values are an
	 * `invalid-input` failure (the economic-transition specification7).
	 * @param actor the wallet owner; only `UserActor` is accepted.
	 */
	getTransactionHistory(
		actor: UserActor,
		selector: UserWalletSelector,
		request: HistoryRequest,
	): UseCaseResult<Page<HistoryEntry>>;

	/**
	 * Newest-first cursor-paginated treasury history — administrative
	 * treasury inspection (the authentication/delegation and actor/visibility specifications).
	 * @param actor the `admin-api` service principal.
	 */
	getTransactionHistory(
		actor: AdminActor,
		selector: TreasuryWalletSelector,
		request: HistoryRequest,
	): UseCaseResult<Page<HistoryEntry>>;
}

/**
 * Binds the application contract to its environment. The same instance may
 * serve any number of calls; per-section concerns (one frozen `now_ms` per
 * serialized transaction, atomic commit) belong to the injected `UnitOfWork`.
 */
export function createCommunityTokenApplication(
	deps: ApplicationDeps,
): CommunityTokenApplication {
	return {
		issueToken: (actor, input) =>
			deps.uow.transact((ctx) => issueToken(ctx, actor, input)),
		distributeToken: (actor, input) =>
			deps.uow.transact((ctx) => distributeToken(ctx, actor, input)),
		transferToken: (actor, input) =>
			deps.uow.transact((ctx) => transferToken(ctx, actor, input)),
		payTreasury: (actor, input) =>
			deps.uow.transact((ctx) => payTreasury(ctx, actor, input)),
		getBalance: (actor: Actor, selector: WalletSelector) =>
			deps.uow.transact((ctx) =>
				// The overloads pin actor to selector for typed callers; the
				// use-case guards re-check the actor at runtime.
				selector.type === "treasury"
					? getBalance(ctx, actor as AdminActor, selector)
					: getBalance(ctx, actor as UserActor, selector),
			),
		getTransactionHistory: (
			actor: Actor,
			selector: WalletSelector,
			request: HistoryRequest,
		) =>
			deps.uow.transact((ctx) =>
				selector.type === "treasury"
					? getTransactionHistory(ctx, actor as AdminActor, selector, request)
					: getTransactionHistory(ctx, actor as UserActor, selector, request),
			),
	};
}
