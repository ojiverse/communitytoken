/**
 * Shared machinery of the mutation use cases: actor guards and the uniform
 * evaluate-then-persist path of the economic-transition specification —
 *
 *   read current economic facts
 *   -> evaluate @communitytoken/economic-kernel
 *   -> reject with no state change
 *   OR persist the accepted EconomicEffect atomically.
 */

import {
	type EconomicFacts,
	evaluateOperation,
	type OperationCommand,
	TREASURY_WALLET_ID,
	type WalletFacts,
} from "@communitytoken/economic-kernel";
import type { TransactionContext } from "../ports";
import {
	type Actor,
	ADMIN_API_PRINCIPAL,
	err,
	type OperationId,
	ok,
	type UseCaseResult,
	type UserActor,
	type UserId,
	type Wallet,
	type WalletId,
	walletId,
} from "../types";

/** The treasury wallet's id branded for the application layer. */
export const TREASURY_ID: WalletId = walletId(TREASURY_WALLET_ID);

/** Successful result of a committed economic operation. */
export type OperationAccepted = {
	readonly operationId: OperationId;
};

/**
 * A placeholder wallet id for a user that owns no wallet, used only as a
 * command label so the kernel rejects with `WALLET_NOT_FOUND`. It can never
 * collide with a persisted wallet id: real ids are `crypto.randomUUID()`,
 * which contains no colon.
 */
export function missingWalletId(user: UserId): WalletId {
	return walletId(`user:${user}`);
}

/** Projects a stored wallet onto the fact shape the evaluator reads. */
export function walletFacts(
	wallet: Wallet | undefined,
): WalletFacts | undefined {
	return wallet === undefined
		? undefined
		: { id: wallet.id, kind: wallet.kind, balance: wallet.balance };
}

/** The current economic facts for a command whose wallets resolved to `from`/`to`. */
export function economicFacts(
	from: Wallet | undefined,
	to: Wallet | undefined,
	totalSupply: number,
): EconomicFacts {
	return {
		from: walletFacts(from),
		to: walletFacts(to),
		totalSupply,
	};
}

/** Returns a forbidden result unless `actor` is a service principal. */
export function forbidden(detail: string): UseCaseResult<never> {
	return err({ type: "forbidden", detail });
}

/**
 * Returns a forbidden result unless `actor` is the `admin-api` service
 * principal (the authentication/delegation and actor/visibility specifications). Administrative use cases take `AdminActor`
 * so misuse is a compile error in typed code; this guard is the runtime
 * backstop for callers that bypass the types.
 */
export function requireAdmin(
	actor: Actor,
	useCase: string,
): UseCaseResult<never> | null {
	return actor.kind === "service" && actor.principalId === ADMIN_API_PRINCIPAL
		? null
		: forbidden(
				`${useCase} requires the ${ADMIN_API_PRINCIPAL} principal, got ${
					actor.kind === "service" ? actor.principalId : actor.kind
				}`,
			);
}

/**
 * Narrows `actor` to a user actor or returns a forbidden result. User-facing
 * mutations derive the funding wallet from the actor: a user can only move
 * their own funds (the economic-transition specification3 — the actor is the resolved internal User,
 * never the calling adapter). Like `requireAdmin`, the guard is the runtime
 * backstop behind the `UserActor` parameter type.
 */
export function requireUser(
	actor: Actor,
	useCase: string,
): UserActor | UseCaseResult<never> {
	return actor.kind === "user"
		? actor
		: forbidden(`${useCase} requires a user actor, got ${actor.kind}`);
}

/**
 * Evaluates `command` against `facts` and, when accepted, persists the
 * effect inside the already-open section: balance deltas, the
 * EconomicOperation (with the actor/visibility specification actor columns), and the LedgerTransaction,
 * all stamped with the section's frozen `now_ms` (the temporal-authority specification). A
 * rejection persists nothing.
 */
export function evaluateAndPersist(
	ctx: TransactionContext,
	actor: Actor,
	facts: EconomicFacts,
	command: OperationCommand,
): UseCaseResult<OperationAccepted> {
	const decision = evaluateOperation(facts, command);
	if (!decision.accepted) {
		return err({
			type: "rejected",
			code: decision.code,
			detail: decision.detail,
		});
	}
	const { effect } = decision;
	const now = ctx.nowMs;
	for (const [id, delta] of effect.deltas) {
		const base =
			id === facts.from?.id
				? facts.from
				: id === facts.to?.id
					? facts.to
					: undefined;
		if (base === undefined) {
			throw new Error(`effect delta references unknown wallet: ${id}`);
		}
		ctx.wallets.setBalance(walletId(id), base.balance + delta, now);
	}
	const operation = ctx.operations.insert({
		kind: effect.kind,
		metadata: effect.metadata,
		actor,
		createdAt: now,
	});
	ctx.ledger.insert({
		operationId: operation.id,
		fromWalletId: walletId(effect.fromWalletId),
		toWalletId: walletId(effect.toWalletId),
		amount: effect.amount,
		createdAt: now,
	});
	return ok({ operationId: operation.id });
}
