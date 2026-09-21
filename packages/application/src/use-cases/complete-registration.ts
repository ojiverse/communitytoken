import type { TransactionContext } from "../ports";
import type { UserId } from "../types";

/**
 * The verified external identity the trusted boundary proved while the
 * intent stayed active. `state` selects the intent; the verified pair must
 * equal the intent's expected pair (the registration specification's
 * proof binding).
 */
export type CompleteRegistrationInput = {
	readonly state: string;
	readonly verifiedIssuer: string;
	readonly verifiedSubject: string;
};

/** Why a completion cannot proceed — mapped onto pages by the callback boundary. */
export type RegistrationUnavailableReason =
	| "not-found"
	| "consumed"
	| "superseded"
	| "expired"
	| "mismatch";

/**
 * The outcome of registration completion (the registration specification):
 *
 *   - `completed` — the identity is bound to `userId`; `created` tells
 *     whether this section created the User (false when the identity was
 *     already bound between intent creation and completion — the existing
 *     User resolves and the intent is still consumed).
 *   - `unavailable` — the intent cannot complete; `reason` discriminates
 *     the failure. A `mismatch` — or any rejection — consumes nothing and
 *     creates nothing.
 */
export type CompleteRegistrationOutcome =
	| {
			readonly type: "completed";
			readonly userId: UserId;
			readonly created: boolean;
	  }
	| {
			readonly type: "unavailable";
			readonly reason: RegistrationUnavailableReason;
	  };

/**
 * Completes a registration intent inside the caller's already-open section
 * (issue #4 PR-4, the registration specification). The order is fixed:
 *
 *   find state
 *   -> reject non-active status (consumed / superseded)
 *   -> reject ctx.nowMs >= expiresAt (expired)
 *   -> reject verified pair != expected pair (mismatch — non-mutating,
 *      never consumes the intent)
 *   -> binding lookup
 *   -> if already bound: markConsumed, completed(existing, created=false)
 *   -> insert User + zero-balance user Wallet + IdentityBinding
 *   -> markConsumed
 *   -> completed(new user, created=true)
 *
 * The whole result — User, wallet, binding, consumed intent — commits
 * atomically inside this one section.
 */
export function completeRegistration(
	ctx: TransactionContext,
	input: CompleteRegistrationInput,
): CompleteRegistrationOutcome {
	const intent = ctx.registrationIntents.findByState(input.state);
	if (intent === undefined) {
		return { type: "unavailable", reason: "not-found" };
	}
	if (intent.status !== "active") {
		return { type: "unavailable", reason: intent.status };
	}
	if (ctx.nowMs >= intent.expiresAt) {
		return { type: "unavailable", reason: "expired" };
	}
	if (
		intent.expectedIssuer !== input.verifiedIssuer ||
		intent.expectedSubject !== input.verifiedSubject
	) {
		return { type: "unavailable", reason: "mismatch" };
	}
	const bound = ctx.identityBindings.findUserIdByExternal(
		intent.expectedIssuer,
		intent.expectedSubject,
	);
	if (bound !== undefined) {
		ctx.registrationIntents.markConsumed(intent.id, ctx.nowMs);
		return { type: "completed", userId: bound, created: false };
	}
	const user = ctx.users.insert({ createdAt: ctx.nowMs });
	ctx.wallets.insertUserWallet({
		ownerUserId: user.id,
		createdAt: ctx.nowMs,
	});
	ctx.identityBindings.insert({
		issuer: intent.expectedIssuer,
		subject: intent.expectedSubject,
		userId: user.id,
		createdAt: ctx.nowMs,
	});
	ctx.registrationIntents.markConsumed(intent.id, ctx.nowMs);
	return { type: "completed", userId: user.id, created: true };
}
