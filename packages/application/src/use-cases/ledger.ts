/**
 * The primitive ledger operations: the uniform evaluate-then-persist path of
 * the economic-transitions specification over the application ports —
 *
 *   read current facts
 *   -> evaluate @communitytoken/economic-kernel
 *   -> reject with no state change
 *   OR apply balance deltas and append one immutable Transaction.
 *
 * These operations are role-agnostic exactly like the kernel: they perform
 * no authorization. Authorization belongs to the use cases that call them,
 * and in Phase 2 only the administrative issuance use case constructs an
 * ISSUE. Both run inside the caller's already-open section so outer
 * orchestration can compose them with idempotency or other state.
 */

import {
	type EffectDeltas,
	evaluateIssue,
	evaluateTransfer,
} from "@communitytoken/economic-kernel";
import type { TransactionContext } from "../ports";
import {
	type AccountId,
	err,
	ok,
	type PrincipalId,
	rehydrate,
	type TransactionId,
	type UseCaseResult,
} from "../types";

/** ISSUE(issuerPrincipal, destinationAccount, amount). */
export type IssueCommand = {
	readonly issuerPrincipalId: PrincipalId;
	readonly destinationAccountId: AccountId;
	readonly amount: number;
};

/** TRANSFER(sourceAccount, destinationAccount, amount). */
export type TransferCommand = {
	readonly sourceAccountId: AccountId;
	readonly destinationAccountId: AccountId;
	readonly amount: number;
};

/** Successful result of a committed primitive Transaction. */
export type TransactionAccepted = {
	readonly transactionId: TransactionId;
};

/**
 * Applies accepted balance deltas as absolute writes computed from the
 * balances read for evaluation, stamped with the section's frozen now_ms.
 */
function applyDeltas(
	ctx: TransactionContext,
	deltas: EffectDeltas,
	balances: ReadonlyMap<string, number>,
): void {
	for (const [id, delta] of deltas) {
		const base = balances.get(id);
		if (base === undefined) {
			throw new Error(`effect delta references unread account: ${id}`);
		}
		ctx.accounts.setBalance(rehydrate.accountId(id), base + delta, ctx.nowMs);
	}
}

/**
 * Evaluates and, when accepted, persists one ISSUE: credits the destination
 * and appends a Transaction recording the issuer Principal. A rejection
 * (`INVALID_AMOUNT`, `PRINCIPAL_NOT_FOUND`, `ACCOUNT_NOT_FOUND`,
 * `OVERFLOW`) persists nothing.
 */
export function executeIssue(
	ctx: TransactionContext,
	command: IssueCommand,
): UseCaseResult<TransactionAccepted> {
	const issuer = ctx.principals.findById(command.issuerPrincipalId);
	const destination = ctx.accounts.findById(command.destinationAccountId);
	const decision = evaluateIssue(
		{
			issuer: issuer === undefined ? undefined : { id: issuer.id },
			destination,
			totalSupply: ctx.accounts.totalSupply(),
		},
		command,
	);
	if (!decision.accepted) {
		return err({
			type: "rejected",
			code: decision.code,
			detail: decision.detail,
		});
	}
	const { effect } = decision;
	const balances = new Map<string, number>();
	if (destination !== undefined) {
		balances.set(destination.id, destination.balance);
	}
	applyDeltas(ctx, effect.deltas, balances);
	const record = ctx.transactions.insert({
		kind: "ISSUE",
		issuerPrincipalId: command.issuerPrincipalId,
		destinationAccountId: command.destinationAccountId,
		amount: effect.amount,
		committedAt: ctx.nowMs,
	});
	return ok({ transactionId: record.id });
}

/**
 * Evaluates and, when accepted, persists one TRANSFER: moves the amount and
 * appends a Transaction with no issuer or actor. A self-transfer records one
 * Transaction and changes no balance. A rejection (`INVALID_AMOUNT`,
 * `ACCOUNT_NOT_FOUND`, `INSUFFICIENT_BALANCE`, `OVERFLOW`) persists nothing.
 */
export function executeTransfer(
	ctx: TransactionContext,
	command: TransferCommand,
): UseCaseResult<TransactionAccepted> {
	const source = ctx.accounts.findById(command.sourceAccountId);
	const destination = ctx.accounts.findById(command.destinationAccountId);
	const decision = evaluateTransfer({ source, destination }, command);
	if (!decision.accepted) {
		return err({
			type: "rejected",
			code: decision.code,
			detail: decision.detail,
		});
	}
	const { effect } = decision;
	const balances = new Map<string, number>();
	if (source !== undefined) balances.set(source.id, source.balance);
	if (destination !== undefined) {
		balances.set(destination.id, destination.balance);
	}
	applyDeltas(ctx, effect.deltas, balances);
	const record = ctx.transactions.insert({
		kind: "TRANSFER",
		sourceAccountId: command.sourceAccountId,
		destinationAccountId: command.destinationAccountId,
		amount: effect.amount,
		committedAt: ctx.nowMs,
	});
	return ok({ transactionId: record.id });
}
