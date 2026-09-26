import type { TransactionContext } from "../ports";
import { type ExternalIdentity, err, type UseCaseResult } from "../types";
import { executeTransfer, type TransactionAccepted } from "./ledger";
import { isUnresolved, resolveDefaultAccount } from "./resolve-default-account";

/** A user-facing transfer between two exact ExternalIdentities. */
export type TransferBetweenIdentitiesInput = {
	readonly from: ExternalIdentity;
	readonly to: ExternalIdentity;
	readonly amount: number;
};

export type TransferBetweenIdentitiesResult = TransactionAccepted & {
	/** The sender default Account's balance after the transfer. */
	readonly fromBalance: number;
};

/**
 * User TRANSFER: resolves sender and recipient identities to their
 * Principals' default Accounts and executes one TRANSFER. The source is
 * always the sender's own default Account; a self-transfer is valid,
 * records one Transaction, and changes no balance.
 *
 * Runs inside the caller's already-open section so the idempotency record
 * commits in the same section as the transfer.
 *
 * @throws {Error} when the accepted source Account cannot be re-read — a
 *   storage contract violation, never a business value.
 */
export function transferBetweenIdentities(
	ctx: TransactionContext,
	input: TransferBetweenIdentitiesInput,
): UseCaseResult<TransferBetweenIdentitiesResult> {
	const sender = resolveDefaultAccount(ctx, input.from, "caller");
	if (isUnresolved(sender)) return err(sender);
	const recipient = resolveDefaultAccount(ctx, input.to, "recipient");
	if (isUnresolved(recipient)) return err(recipient);
	const result = executeTransfer(ctx, {
		sourceAccountId: sender.account.id,
		destinationAccountId: recipient.account.id,
		amount: input.amount,
	});
	if (!result.ok) return result;
	const post = ctx.accounts.findById(sender.account.id);
	if (post === undefined) {
		throw new Error("source account disappeared inside transaction");
	}
	return {
		ok: true,
		value: {
			transactionId: result.value.transactionId,
			fromBalance: post.balance,
		},
	};
}
