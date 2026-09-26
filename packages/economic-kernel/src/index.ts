/**
 * Runtime-independent primitive ledger evaluator for CommunityToken.
 *
 * Owns the ISSUE and TRANSFER transition rules of the economic-transitions
 * specification over the Principal / Account model of the economic-state
 * specification. Each evaluator is a pure function from current facts plus a
 * command to either a rejection or an effect. It owns nothing else — no
 * state, history, identity, storage, clock, identifier allocation, or
 * authorization: the kernel never decides whether an issuer Principal is
 * permitted to issue, and it knows no Account kind or product role. Durable
 * Transaction identity and commit time are allocated at the persistence
 * boundary that applies the effect.
 */

/** Upper bound of every monetary domain (economic-state specification): amount, balance, supply. */
export const MAX_MONETARY_VALUE = Number.MAX_SAFE_INTEGER;

/** The two primitive monetary Transaction kinds. */
export type TransactionKind = "ISSUE" | "TRANSFER";

/**
 * The facts about one Account the transition rules read. Callers resolve
 * command Account ids to facts — `undefined` means the Account does not
 * exist and evaluation rejects with `ACCOUNT_NOT_FOUND`.
 */
export type AccountFacts = {
	readonly id: string;
	readonly balance: number;
};

/**
 * The facts about the issuer Principal ISSUE reads: only its existence.
 * `undefined` rejects with `PRINCIPAL_NOT_FOUND`.
 */
export type PrincipalFacts = {
	readonly id: string;
};

/** Every fact an ISSUE evaluation reads. */
export type IssueFacts = {
	readonly issuer: PrincipalFacts | undefined;
	readonly destination: AccountFacts | undefined;
	readonly totalSupply: number;
};

/** Every fact a TRANSFER evaluation reads. TRANSFER never changes supply. */
export type TransferFacts = {
	readonly source: AccountFacts | undefined;
	readonly destination: AccountFacts | undefined;
};

/** ISSUE(issuerPrincipal, destinationAccount, amount). */
export type IssueCommand = {
	readonly issuerPrincipalId: string;
	readonly destinationAccountId: string;
	readonly amount: number;
};

/** TRANSFER(sourceAccount, destinationAccount, amount). */
export type TransferCommand = {
	readonly sourceAccountId: string;
	readonly destinationAccountId: string;
	readonly amount: number;
};

export type RejectionCode =
	| "INVALID_AMOUNT"
	| "PRINCIPAL_NOT_FOUND"
	| "ACCOUNT_NOT_FOUND"
	| "INSUFFICIENT_BALANCE"
	| "OVERFLOW";

/**
 * Signed balance change per touched Account, restricted to non-zero
 * entries: a self-transfer is an accepted effect with no delta.
 */
export type EffectDeltas = ReadonlyMap<string, number>;

/**
 * The effect of an accepted ISSUE: the facts the persistence boundary
 * records as the Transaction — including the issuer Principal, the durable
 * provenance of the created supply — plus the balance deltas to apply.
 */
export type IssueEffect = {
	readonly kind: "ISSUE";
	readonly issuerPrincipalId: string;
	readonly destinationAccountId: string;
	readonly amount: number;
	readonly deltas: EffectDeltas;
};

/**
 * The effect of an accepted TRANSFER. It deliberately carries no issuer or
 * actor: TRANSFER authorization is application-owned.
 */
export type TransferEffect = {
	readonly kind: "TRANSFER";
	readonly sourceAccountId: string;
	readonly destinationAccountId: string;
	readonly amount: number;
	readonly deltas: EffectDeltas;
};

export type Rejection = {
	readonly accepted: false;
	readonly code: RejectionCode;
	readonly detail: string;
};

export type Decision<E> =
	| { readonly accepted: true; readonly effect: E }
	| Rejection;

function reject(code: RejectionCode, detail: string): Rejection {
	return { accepted: false, code, detail };
}

function invalidAmount(amount: number): Rejection | null {
	return Number.isSafeInteger(amount) && amount >= 1
		? null
		: reject(
				"INVALID_AMOUNT",
				`amount must be an integer in 1..${MAX_MONETARY_VALUE}, got ${amount}`,
			);
}

function assertFactsMatch(label: string, factId: string, commandId: string) {
	if (factId !== commandId) {
		throw new Error(
			`facts/command mismatch: command ${label} is ${commandId}, facts are ${factId}`,
		);
	}
}

/**
 * Evaluates ISSUE against current facts. Pure and total. Validation order:
 * amount domain, issuer Principal existence, destination Account existence,
 * destination balance bound, total supply bound. Authorization of the
 * issuer is not evaluated here.
 *
 * @throws {Error} when `facts` was resolved against different ids than the
 *   command names — a caller contract violation, not a rejection.
 */
export function evaluateIssue(
	facts: IssueFacts,
	command: IssueCommand,
): Decision<IssueEffect> {
	const { issuerPrincipalId, destinationAccountId, amount } = command;
	const amountRejection = invalidAmount(amount);
	if (amountRejection) return amountRejection;
	const { issuer, destination, totalSupply } = facts;
	if (issuer === undefined) {
		return reject(
			"PRINCIPAL_NOT_FOUND",
			`issuer principal not found: ${issuerPrincipalId}`,
		);
	}
	assertFactsMatch("issuer", issuer.id, issuerPrincipalId);
	if (destination === undefined) {
		return reject(
			"ACCOUNT_NOT_FOUND",
			`account not found: ${destinationAccountId}`,
		);
	}
	assertFactsMatch("destination", destination.id, destinationAccountId);
	if (destination.balance + amount > MAX_MONETARY_VALUE) {
		return reject(
			"OVERFLOW",
			`credit would push account ${destination.id} above ${MAX_MONETARY_VALUE}`,
		);
	}
	if (totalSupply + amount > MAX_MONETARY_VALUE) {
		return reject(
			"OVERFLOW",
			`issuance would push total supply above ${MAX_MONETARY_VALUE}`,
		);
	}
	return {
		accepted: true,
		effect: {
			kind: "ISSUE",
			issuerPrincipalId: issuer.id,
			destinationAccountId: destination.id,
			amount,
			deltas: new Map([[destination.id, amount]]),
		},
	};
}

/**
 * Evaluates TRANSFER against current facts. Pure and total. Validation
 * order: amount domain, source and destination existence, sufficient source
 * balance, destination balance bound. A self-transfer is accepted when the
 * source holds the amount and produces no delta.
 *
 * @throws {Error} when `facts` was resolved against different ids than the
 *   command names — a caller contract violation, not a rejection.
 */
export function evaluateTransfer(
	facts: TransferFacts,
	command: TransferCommand,
): Decision<TransferEffect> {
	const { sourceAccountId, destinationAccountId, amount } = command;
	const amountRejection = invalidAmount(amount);
	if (amountRejection) return amountRejection;
	const { source, destination } = facts;
	if (source === undefined || destination === undefined) {
		const missing =
			source === undefined ? sourceAccountId : destinationAccountId;
		return reject("ACCOUNT_NOT_FOUND", `account not found: ${missing}`);
	}
	assertFactsMatch("source", source.id, sourceAccountId);
	assertFactsMatch("destination", destination.id, destinationAccountId);
	if (source.balance < amount) {
		return reject(
			"INSUFFICIENT_BALANCE",
			`account ${source.id} has ${source.balance}, needs ${amount}`,
		);
	}
	const deltas = new Map<string, number>();
	if (source.id !== destination.id) {
		if (destination.balance + amount > MAX_MONETARY_VALUE) {
			return reject(
				"OVERFLOW",
				`credit would push account ${destination.id} above ${MAX_MONETARY_VALUE}`,
			);
		}
		deltas.set(source.id, -amount);
		deltas.set(destination.id, amount);
	}
	return {
		accepted: true,
		effect: {
			kind: "TRANSFER",
			sourceAccountId: source.id,
			destinationAccountId: destination.id,
			amount,
			deltas,
		},
	};
}
