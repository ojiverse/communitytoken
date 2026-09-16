/**
 * The application boundary of the Phase 2 CommunityToken service (issue #4
 * §1–§2): the runtime-independent use cases a trusted surface invokes after
 * resolving an `Actor`. Owns orchestration, authorization, and actor
 * context; owns no storage, no platform types, and no economic rules — the
 * economic decision boundary remains `@communitytoken/economic-kernel`.
 */

import type { Clock, UnitOfWork } from "./ports";
import type {
	Actor,
	HistoryEntry,
	Page,
	UseCaseResult,
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

/** The dependencies every use case requires: the atomic boundary and the clock authority. */
export type ApplicationDeps = {
	readonly uow: UnitOfWork;
	readonly clock: Clock;
};

/**
 * The runtime-independent application contract invoked by trusted surfaces
 * (the `/internal/*` and `/admin/*` boundaries of issue #4 §11). Every
 * method runs its work inside `deps.uow.transact`, so the caller's
 * implementation decides the serialization/atomicity mechanism. Results
 * carry expected failures (forbidden actor, kernel rejection) as values;
 * contract violations and storage faults are thrown.
 */
export interface CommunityTokenApplication {
	/**
	 * Explicit `TOKEN_ISSUANCE` into the treasury (administrative boundary).
	 * @param actor must have `kind === "service"`.
	 */
	issueToken(
		actor: Actor,
		input: IssueTokenInput,
	): UseCaseResult<OperationAccepted>;

	/**
	 * `DISTRIBUTION` of existing treasury reserve to a user; never issues
	 * implicitly — insufficient treasury rejects (administrative boundary).
	 * @param actor must have `kind === "service"`.
	 */
	distributeToken(
		actor: Actor,
		input: DistributeTokenInput,
	): UseCaseResult<OperationAccepted>;

	/**
	 * `P2P_TRANSFER` from the actor's own wallet to another user. A
	 * self-transfer is valid and recorded net-zero.
	 * @param actor must have `kind === "user"`; it is the sender.
	 */
	transferToken(
		actor: Actor,
		input: TransferTokenInput,
	): UseCaseResult<TransferTokenResult>;

	/**
	 * `TREASURY_PAYMENT` from the actor's own wallet to the treasury.
	 * @param actor must have `kind === "user"`; it is the payer.
	 */
	payTreasury(
		actor: Actor,
		input: PayTreasuryInput,
	): UseCaseResult<PayTreasuryResult>;

	/**
	 * Balance of the selected wallet under self-only visibility (issue #4
	 * §17): user selectors require the matching user actor, the treasury
	 * selector requires a service actor.
	 */
	getBalance(
		actor: Actor,
		selector: WalletSelector,
	): UseCaseResult<BalanceResult>;

	/**
	 * Newest-first cursor-paginated history of the selected wallet under the
	 * same visibility rule as `getBalance`. Page size defaults to 50 and is
	 * capped at 100 (issue #4 §17).
	 */
	getTransactionHistory(
		actor: Actor,
		selector: WalletSelector,
		request: HistoryRequest,
	): UseCaseResult<Page<HistoryEntry>>;
}

/**
 * Binds the application contract to its environment. The same instance may
 * serve any number of calls; per-request concerns (one `now_ms` sample per
 * serialized mutation) belong to the injected port implementations.
 */
export function createCommunityTokenApplication(
	deps: ApplicationDeps,
): CommunityTokenApplication {
	return {
		issueToken: (actor, input) => issueToken(deps, actor, input),
		distributeToken: (actor, input) => distributeToken(deps, actor, input),
		transferToken: (actor, input) => transferToken(deps, actor, input),
		payTreasury: (actor, input) => payTreasury(deps, actor, input),
		getBalance: (actor, selector) => getBalance(deps, actor, selector),
		getTransactionHistory: (actor, selector, request) =>
			getTransactionHistory(deps, actor, selector, request),
	};
}
