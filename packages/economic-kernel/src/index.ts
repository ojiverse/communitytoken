/**
 * Runtime-independent economic kernel for the CommunityToken rebuild.
 *
 * Owns the operation semantics of docs/economic-model.md §3 and the economic
 * invariants of §4. No Cloudflare, storage, or platform types appear here;
 * time and identifier generation are injected ports per §6, so the kernel is
 * deterministic under test and embeddable inside the CommunityState Durable
 * Object, which applies accepted decisions inside its storage transaction.
 *
 * The kernel never mutates: `evaluateOperation` reads state and returns a
 * decision, and `commitOperation` returns a new CommunityState. A rejected
 * decision carries no operation, ledger entry, or balance change, so
 * "rejection leaves no trace" is a type-level fact, not a runtime check.
 */

/** Upper bound of every monetary domain (§3): TokenAmount, WalletBalance, TotalSupply. */
export const MAX_MONETARY_VALUE = Number.MAX_SAFE_INTEGER;

/** Well-known identifier of the deployment's single system wallet (§2). */
export const TREASURY_WALLET_ID = "treasury";

export type WalletKind = "system" | "user";

export type OperationKind =
	| "TOKEN_ISSUANCE"
	| "DISTRIBUTION"
	| "P2P_TRANSFER"
	| "TREASURY_PAYMENT";

export type User = {
	readonly id: string;
	readonly walletId: string;
	readonly createdAt: number;
};

export type Wallet = {
	readonly id: string;
	readonly kind: WalletKind;
	readonly balance: number;
	readonly createdAt: number;
};

export type EconomicOperation = {
	readonly id: string;
	readonly kind: OperationKind;
	readonly metadata: string | null;
	readonly createdAt: number;
};

export type LedgerTransaction = {
	readonly id: string;
	readonly operationId: string;
	readonly fromWalletId: string;
	readonly toWalletId: string;
	readonly amount: number;
	readonly createdAt: number;
};

export type CommunityState = {
	readonly users: ReadonlyMap<string, User>;
	readonly wallets: ReadonlyMap<string, Wallet>;
	readonly operations: readonly EconomicOperation[];
	readonly ledger: readonly LedgerTransaction[];
};

/**
 * Wall-clock time source. The kernel calls it once per produced record; the
 * result is stamped as `createdAt`. Implementations must return epoch
 * milliseconds and must be monotonic enough that ordering by call sequence is
 * meaningful.
 */
export interface Clock {
	/**
	 * Returns the current time in epoch milliseconds.
	 * @throws {Error} when the underlying clock is unavailable.
	 */
	now(): number;
}

/**
 * Identifier source for users' wallets, operations, and ledger entries.
 * Identifiers are opaque to the kernel: it never parses or reuses them.
 */
export interface IdGenerator {
	/**
	 * Returns a new identifier that is unique within the deployment.
	 * @throws {Error} when no unused identifier can be produced.
	 */
	nextId(): string;
}

export type KernelPorts = {
	readonly clock: Clock;
	readonly ids: IdGenerator;
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

export type BalanceChange = {
	readonly walletId: string;
	readonly newBalance: number;
};

/**
 * An operation the kernel approved. Committing it through `commitOperation`
 * — or persisting its `balanceChanges`, `operation`, and `ledgerEntry` inside
 * one storage transaction — is the only way economic state may change.
 */
export type AcceptedOperation = {
	readonly accepted: true;
	readonly operation: EconomicOperation;
	readonly ledgerEntry: LedgerTransaction;
	readonly balanceChanges: readonly BalanceChange[];
};

export type RejectedOperation = {
	readonly accepted: false;
	readonly code: RejectionCode;
	readonly detail: string;
};

export type OperationDecision = AcceptedOperation | RejectedOperation;

/**
 * Creates the initial state of a deployment: one system wallet (the treasury)
 * and no users. Issuance is the only way value enters this state.
 */
export function initializeCommunity(ports: KernelPorts): CommunityState {
	const treasury: Wallet = {
		id: TREASURY_WALLET_ID,
		kind: "system",
		balance: 0,
		createdAt: ports.clock.now(),
	};
	return {
		users: new Map(),
		wallets: new Map([[treasury.id, treasury]]),
		operations: [],
		ledger: [],
	};
}

/**
 * Registers a user and its single wallet (§4: one wallet per user).
 * @throws {Error} when `userId` is already registered.
 */
export function registerUser(
	state: CommunityState,
	userId: string,
	ports: KernelPorts,
): CommunityState {
	if (state.users.has(userId)) {
		throw new Error(`user already registered: ${userId}`);
	}
	const createdAt = ports.clock.now();
	const wallet: Wallet = {
		id: ports.ids.nextId(),
		kind: "user",
		balance: 0,
		createdAt,
	};
	const user: User = { id: userId, walletId: wallet.id, createdAt };
	const wallets = new Map(state.wallets);
	wallets.set(wallet.id, wallet);
	const users = new Map(state.users);
	users.set(user.id, user);
	return { ...state, users, wallets };
}

function directionHolds(
	kind: OperationKind,
	from: Wallet,
	to: Wallet,
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
 * Evaluates a command against the current state without changing anything.
 * Validation order: amount domain, wallet existence, direction discipline,
 * funds, then the §3 overflow bounds. Returns a decision the caller may
 * commit; a rejected decision contains nothing committable.
 */
export function evaluateOperation(
	state: CommunityState,
	command: OperationCommand,
	ports: KernelPorts,
): OperationDecision {
	const { kind, fromWalletId, toWalletId, amount, metadata } = command;

	if (!Number.isSafeInteger(amount) || amount < 1) {
		return reject(
			"INVALID_AMOUNT",
			`amount must be an integer in 1..${MAX_MONETARY_VALUE}, got ${amount}`,
		);
	}
	const from = state.wallets.get(fromWalletId);
	const to = state.wallets.get(toWalletId);
	if (!from || !to) {
		const missing = !from ? fromWalletId : toWalletId;
		return reject("WALLET_NOT_FOUND", `wallet not found: ${missing}`);
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
	if (to.balance + amount > MAX_MONETARY_VALUE) {
		return reject(
			"OVERFLOW",
			`credit would push wallet ${to.id} above ${MAX_MONETARY_VALUE}`,
		);
	}
	if (
		kind === "TOKEN_ISSUANCE" &&
		totalSupply(state) + amount > MAX_MONETARY_VALUE
	) {
		return reject(
			"OVERFLOW",
			`issuance would push total supply above ${MAX_MONETARY_VALUE}`,
		);
	}

	const createdAt = ports.clock.now();
	const operation: EconomicOperation = {
		id: ports.ids.nextId(),
		kind,
		metadata: metadata ?? null,
		createdAt,
	};
	const ledgerEntry: LedgerTransaction = {
		id: ports.ids.nextId(),
		operationId: operation.id,
		fromWalletId: from.id,
		toWalletId: to.id,
		amount,
		createdAt,
	};
	const balanceChanges: readonly BalanceChange[] =
		kind === "TOKEN_ISSUANCE"
			? [{ walletId: to.id, newBalance: to.balance + amount }]
			: [
					{ walletId: from.id, newBalance: from.balance - amount },
					{ walletId: to.id, newBalance: to.balance + amount },
				];
	return { accepted: true, operation, ledgerEntry, balanceChanges };
}

/**
 * Applies an accepted decision, returning the next state. Wallets are updated
 * in place inside a new map; the operation and its ledger entry are appended
 * to history. Prior entries are never touched.
 * @throws {Error} when a balance change references a wallet absent from state
 *   (i.e. the decision was evaluated against a different state).
 */
export function commitOperation(
	state: CommunityState,
	decision: AcceptedOperation,
): CommunityState {
	const wallets = new Map(state.wallets);
	for (const change of decision.balanceChanges) {
		const wallet = wallets.get(change.walletId);
		if (!wallet) {
			throw new Error(`decision references unknown wallet: ${change.walletId}`);
		}
		wallets.set(wallet.id, { ...wallet, balance: change.newBalance });
	}
	return {
		...state,
		wallets,
		operations: [...state.operations, decision.operation],
		ledger: [...state.ledger, decision.ledgerEntry],
	};
}

/** Sum of all wallet balances; equals issued supply in every accepted state (§4). */
export function totalSupply(state: CommunityState): number {
	let total = 0;
	for (const wallet of state.wallets.values()) {
		total += wallet.balance;
	}
	return total;
}

/** Total amount ever introduced by TOKEN_ISSUANCE operations. */
export function issuedAmount(state: CommunityState): number {
	const issuanceIds = new Set(
		state.operations
			.filter((o) => o.kind === "TOKEN_ISSUANCE")
			.map((o) => o.id),
	);
	return state.ledger.reduce(
		(sum, entry) =>
			issuanceIds.has(entry.operationId) ? sum + entry.amount : sum,
		0,
	);
}
