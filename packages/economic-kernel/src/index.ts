/**
 * Runtime-independent economic evaluator for the CommunityToken rebuild.
 *
 * Owns the transition rules of the economic-transitions specification and the
 * preconditions of the economic-state specification's formal model. This is the production-bound economic kernel: a pure
 * function from current economic facts plus a command to either a rejection or
 * an `EconomicEffect`. It owns nothing else — no state, history, users,
 * storage, clock, or identifier allocation. Durable record identity and commit
 * timestamps are allocated at the persistence boundary that applies the
 * effect; balance deltas are expressed per wallet (the economic-transitions specification delta semantics), so a
 * self-transfer is a recorded net-zero movement rather than an error or a
 * supply leak.
 */

/** Upper bound of every monetary domain (the economic-state specification): TokenAmount, WalletBalance, TotalSupply. */
export const MAX_MONETARY_VALUE = Number.MAX_SAFE_INTEGER;

/** Well-known identifier of the deployment's single system wallet (the economic-state specification). */
export const TREASURY_WALLET_ID = "treasury";

export type WalletKind = "system" | "user";

export type OperationKind =
	| "TOKEN_ISSUANCE"
	| "DISTRIBUTION"
	| "P2P_TRANSFER"
	| "TREASURY_PAYMENT";

/**
 * The facts about one wallet that the transition rules read. Callers resolve
 * command wallet references to facts — `undefined` means the wallet does not
 * exist and the evaluator will reject with `WALLET_NOT_FOUND`.
 */
export type WalletFacts = {
	readonly id: string;
	readonly kind: WalletKind;
	readonly balance: number;
};

/** Every economic fact a command's evaluation may read. */
export type EconomicFacts = {
	readonly from: WalletFacts | undefined;
	readonly to: WalletFacts | undefined;
	readonly totalSupply: number;
};

export type OperationCommand = {
	readonly kind: OperationKind;
	readonly fromWalletId: string;
	readonly toWalletId: string;
	readonly amount: number;
	readonly metadata?: string;
};

export type RejectionCode =
	| "INVALID_AMOUNT"
	| "WALLET_NOT_FOUND"
	| "DIRECTION_VIOLATION"
	| "INSUFFICIENT_BALANCE"
	| "OVERFLOW";

/**
 * The semantic effect of an accepted operation (the economic-transitions specification transition output):
 * `deltas` maps each touched wallet to its signed balance change — the
 * indicator-form `Delta_C(w)` of the formal model restricted to non-zero
 * entries — while the remaining fields are the facts the persistence boundary
 * records as the EconomicOperation and its LedgerTransaction.
 */
export type EconomicEffect = {
	readonly kind: OperationKind;
	readonly fromWalletId: string;
	readonly toWalletId: string;
	readonly amount: number;
	readonly metadata: string | null;
	readonly deltas: ReadonlyMap<string, number>;
};

export type AcceptedOperation = {
	readonly accepted: true;
	readonly effect: EconomicEffect;
};

export type RejectedOperation = {
	readonly accepted: false;
	readonly code: RejectionCode;
	readonly detail: string;
};

export type OperationDecision = AcceptedOperation | RejectedOperation;

function directionHolds(
	kind: OperationKind,
	from: WalletFacts,
	to: WalletFacts,
): boolean {
	switch (kind) {
		case "TOKEN_ISSUANCE":
			return from.id === to.id && from.kind === "system";
		case "DISTRIBUTION":
			return from.kind === "system" && to.kind === "user";
		case "P2P_TRANSFER":
			return from.kind === "user" && to.kind === "user";
		case "TREASURY_PAYMENT":
			return from.kind === "user" && to.kind === "system";
	}
}

function reject(code: RejectionCode, detail: string): RejectedOperation {
	return { accepted: false, code, detail };
}

/**
 * Evaluates a command against current economic facts. Pure and total: every
 * input produces either a rejection (nothing committable exists) or an effect
 * the caller persists atomically. Validation order follows the economic-transitions specification: amount domain,
 * wallet existence, direction discipline, funds, then the domain bounds of the
 * resulting balances and total supply.
 *
 * @throws {Error} when `facts` was resolved against different wallet ids than
 *   the command names — a caller contract violation, not a rejection.
 */
export function evaluateOperation(
	facts: EconomicFacts,
	command: OperationCommand,
): OperationDecision {
	const { kind, fromWalletId, toWalletId, amount, metadata } = command;

	if (!Number.isSafeInteger(amount) || amount < 1) {
		return reject(
			"INVALID_AMOUNT",
			`amount must be an integer in 1..${MAX_MONETARY_VALUE}, got ${amount}`,
		);
	}
	const { from, to, totalSupply } = facts;
	if (from === undefined || to === undefined) {
		const missing = from === undefined ? fromWalletId : toWalletId;
		return reject("WALLET_NOT_FOUND", `wallet not found: ${missing}`);
	}
	if (from.id !== fromWalletId || to.id !== toWalletId) {
		throw new Error(
			`facts/command mismatch: command is ${fromWalletId} -> ${toWalletId}, ` +
				`facts are ${from.id} -> ${to.id}`,
		);
	}
	if (!directionHolds(kind, from, to)) {
		return reject(
			"DIRECTION_VIOLATION",
			`${kind} does not admit ${from.kind} -> ${to.kind}`,
		);
	}
	if (kind !== "TOKEN_ISSUANCE" && from.balance < amount) {
		return reject(
			"INSUFFICIENT_BALANCE",
			`wallet ${from.id} has ${from.balance}, needs ${amount}`,
		);
	}

	const deltas = new Map<string, number>();
	if (kind === "TOKEN_ISSUANCE") {
		deltas.set(to.id, amount);
	} else {
		// Indicator-form Delta_C(w) = -amount*[w=from] + amount*[w=to]: a
		// self-transfer cancels to an explicit zero, which is then dropped as
		// a no-op balance change while the movement is still recorded.
		deltas.set(from.id, (deltas.get(from.id) ?? 0) - amount);
		deltas.set(to.id, (deltas.get(to.id) ?? 0) + amount);
		if (deltas.get(from.id) === 0) deltas.delete(from.id);
	}
	// Per the economic-transitions specification: every resulting balance stays in WalletBalance. A
	// self-transfer produces no delta, so it can never overflow.
	for (const [walletId, delta] of deltas) {
		const wallet = walletId === from.id ? from : to;
		if (wallet.balance + delta > MAX_MONETARY_VALUE) {
			return reject(
				"OVERFLOW",
				`credit would push wallet ${walletId} above ${MAX_MONETARY_VALUE}`,
			);
		}
	}
	if (kind === "TOKEN_ISSUANCE" && totalSupply + amount > MAX_MONETARY_VALUE) {
		return reject(
			"OVERFLOW",
			`issuance would push total supply above ${MAX_MONETARY_VALUE}`,
		);
	}

	return {
		accepted: true,
		effect: {
			kind,
			fromWalletId: from.id,
			toWalletId: to.id,
			amount,
			metadata: metadata ?? null,
			deltas,
		},
	};
}
