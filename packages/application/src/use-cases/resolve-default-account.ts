import type { TransactionContext } from "../ports";
import type {
	Account,
	ExternalIdentity,
	PrincipalId,
	UnresolvedError,
} from "../types";

/** An ExternalIdentity resolved to its Principal and default Account. */
export type ResolvedDefaultAccount = {
	readonly type: "resolved";
	readonly principalId: PrincipalId;
	readonly account: Account;
};

/** Which side of a request the identity names — selects the error codes. */
export type ResolutionRole = "caller" | "recipient";

/**
 * Resolves an exact ExternalIdentity to its bound Principal and that
 * Principal's application-designated default Account. Returns the
 * `unresolved` failure for an unbound identity or a Principal without a
 * designation; `role` selects the caller-side or recipient-side code.
 *
 * @throws {Error} when a designation names an Account that does not exist
 *   — a storage contract violation the schema forbids.
 */
export function resolveDefaultAccount(
	ctx: TransactionContext,
	identity: ExternalIdentity,
	role: ResolutionRole,
): ResolvedDefaultAccount | UnresolvedError {
	const recipient = role === "recipient";
	const principalId = ctx.identityBindings.findPrincipalIdByExternal(
		identity.issuer,
		identity.subject,
	);
	if (principalId === undefined) {
		return {
			type: "unresolved",
			code: recipient ? "RECIPIENT_NOT_BOUND" : "IDENTITY_NOT_BOUND",
			detail: `no identity binding for ${identity.issuer}:${identity.subject}`,
		};
	}
	const accountId = ctx.defaultAccounts.findAccountId(principalId);
	if (accountId === undefined) {
		return {
			type: "unresolved",
			code: recipient
				? "RECIPIENT_DEFAULT_ACCOUNT_NOT_DESIGNATED"
				: "DEFAULT_ACCOUNT_NOT_DESIGNATED",
			detail: `no default account for ${identity.issuer}:${identity.subject}`,
		};
	}
	const account = ctx.accounts.findById(accountId);
	if (account === undefined) {
		throw new Error(`designated default account is missing: ${accountId}`);
	}
	return { type: "resolved", principalId, account };
}

/** Narrows a resolution result to its failure. */
export function isUnresolved(
	value: ResolvedDefaultAccount | UnresolvedError,
): value is UnresolvedError {
	return value.type === "unresolved";
}
