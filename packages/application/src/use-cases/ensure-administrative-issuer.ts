import type { TransactionContext } from "../ports";
import type { PrincipalId } from "../types";

/**
 * The narrow application-owned initialization of the administrative issuer
 * Principal (authentication/delegation specification): returns the one
 * stable Principal the administrative technical authority maps to,
 * creating it — and only it — on first use. The Principal has no Account,
 * IdentityBinding, or default designation and is not a Principal subtype.
 *
 * Runs inside the caller's already-open section; idempotent across
 * sections.
 */
export function ensureAdministrativeIssuer(
	ctx: TransactionContext,
): PrincipalId {
	const existing = ctx.administrativeIssuer.find();
	if (existing !== undefined) return existing;
	const principal = ctx.principals.insert({ createdAt: ctx.nowMs });
	ctx.administrativeIssuer.insert(principal.id, ctx.nowMs);
	return principal.id;
}
