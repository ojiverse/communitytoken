/**
 * Shared machinery of the mutation use cases: actor guards and the uniform
 * evaluate-then-persist path of issue #4 §1 —
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
	type WalletFacts,
} from "@communitytoken/economic-kernel";
import type { Clock, TransactionScope } from "../ports";
import {
	type Actor,
	err,
	ok,
	type UseCaseResult,
	type UserId,
	type Wallet,
	type WalletId,
} from "../types";

/** Successful result of a committed economic operation. */
export type OperationAccepted = {
	readonly operationId: string;
};

/**
 * A placeholder wallet id for a user that owns no wallet, used only as a
 * command label so the kernel rejects with `WALLET_NOT_FOUND`. It can never
 * collide with a persisted wallet id: real ids are `crypto.randomUUID()`,
 * which contains no colon.
 */
export function missingWalletId(userId: UserId): WalletId {
	return `user:${userId}`;
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

export function requireService(
	actor: Actor,
	useCase: string,
): UseCaseResult<never> | null {
	return actor.kind === "service"
		? null
		: forbidden(`${useCase} requires a service actor, got ${actor.kind}`);
}

/**
 * Narrows `actor` to a user actor or returns a forbidden result. User-facing
 * mutations derive the funding wallet from the actor: a user can only move
 * their own funds (issue #4 §13 — the actor is the resolved internal User,
 * never the calling adapter).
 */
export function requireUser(
	actor: Actor,
	useCase: string,
): (Actor & { readonly kind: "user" }) | UseCaseResult<never> {
	return actor.kind === "user"
		? actor
		: forbidden(`${useCase} requires a user actor, got ${actor.kind}`);
}

/**
 * Evaluates `command` against `facts` and, when accepted, persists the
 * effect atomically inside the already-open transaction: balance deltas,
 * the EconomicOperation (with §13 actor columns), and the LedgerTransaction,
 * all stamped with a single `clock.nowMs()` sample (issue #4 §8). A
 * rejection persists nothing.
 */
export function evaluateAndPersist(
	tx: TransactionScope,
	clock: Clock,
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
	const now = clock.nowMs();
	for (const [walletId, delta] of effect.deltas) {
		const base =
			walletId === facts.from?.id
				? facts.from
				: walletId === facts.to?.id
					? facts.to
					: undefined;
		if (base === undefined) {
			throw new Error(`effect delta references unknown wallet: ${walletId}`);
		}
		tx.wallets.setBalance(walletId, base.balance + delta, now);
	}
	const operation = tx.operations.insert({
		kind: effect.kind,
		metadata: effect.metadata,
		actor,
		createdAt: now,
	});
	tx.ledger.insert({
		operationId: operation.id,
		fromWalletId: effect.fromWalletId,
		toWalletId: effect.toWalletId,
		amount: effect.amount,
		createdAt: now,
	});
	return ok({ operationId: operation.id });
}
