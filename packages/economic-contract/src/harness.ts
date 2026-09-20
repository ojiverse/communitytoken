/**
 * The storage-independent economic contract for the CommunityToken rebuild.
 *
 * `defineEconomicContract` registers one suite derived from the invariants and
 * transition rules of the economic-transitions and economic-state specifications. Any storage backend runs
 * the identical suite by supplying an `EconomicHarness`, so the suite — not
 * any implementation — is the migration contract of issue #3 §4.
 */

/**
 * A wallet reference as the contract suite expresses it. The tagged union keeps
 * the treasury sentinel in its own namespace: an opaque user id equal to the
 * sentinel's spelling can never collide with it.
 */
export type WalletRef =
	| { readonly type: "treasury" }
	| { readonly type: "user"; readonly userId: string };

/** Refers to the deployment's single system wallet in commands and queries. */
export const TREASURY_REF: WalletRef = { type: "treasury" };

/** Refers to the wallet of a user registered through `createUser`. */
export function userRef(userId: string): WalletRef {
	return { type: "user", userId };
}

export type OperationKind =
	| "TOKEN_ISSUANCE"
	| "DISTRIBUTION"
	| "P2P_TRANSFER"
	| "TREASURY_PAYMENT";

/** Rejection vocabulary shared by every conforming implementation (the economic-transitions specification). */
export type RejectionCode =
	| "INVALID_AMOUNT"
	| "WALLET_NOT_FOUND"
	| "DIRECTION_VIOLATION"
	| "INSUFFICIENT_BALANCE"
	| "OVERFLOW";

export type HarnessCommand = {
	readonly kind: OperationKind;
	readonly from: WalletRef;
	readonly to: WalletRef;
	readonly amount: number;
	readonly metadata?: string;
};

export type HarnessResult =
	| { readonly accepted: true }
	| { readonly accepted: false; readonly code: RejectionCode };

export type OperationView = {
	readonly id: string;
	readonly kind: OperationKind;
	readonly metadata: string | null;
	readonly createdAt: number;
};

export type LedgerView = {
	readonly id: string;
	readonly operationId: string;
	readonly fromWalletId: string;
	readonly toWalletId: string;
	readonly amount: number;
	readonly createdAt: number;
};

/**
 * Adaptation surface between the contract suite and one economic
 * implementation. Implementations may use any storage; only the observable
 * economic behavior defined here is contracted.
 */
export interface EconomicHarness {
	/**
	 * Returns the implementation to a fresh community: one treasury wallet,
	 * no users, empty operation and ledger history.
	 */
	reset(): Promise<void>;

	/**
	 * Registers a user and creates its single wallet.
	 * @throws {Error} when the user is already registered.
	 */
	createUser(userId: string): Promise<void>;

	/**
	 * Evaluates a command against current state and commits it when accepted.
	 * A rejected command must leave all observable state untouched.
	 */
	apply(command: HarnessCommand): Promise<HarnessResult>;

	/**
	 * Returns the current balance of a user's wallet or of the treasury.
	 * @throws {Error} when the reference names no existing wallet.
	 */
	balanceOf(ref: WalletRef): Promise<number>;

	/** Returns the sum of all wallet balances. */
	totalSupply(): Promise<number>;

	/** Returns the sum of amounts over all TOKEN_ISSUANCE ledger entries. */
	issuedAmount(): Promise<number>;

	/** Returns every committed operation in commit order. */
	operations(): Promise<readonly OperationView[]>;

	/** Returns every ledger entry in commit order. */
	ledger(): Promise<readonly LedgerView[]>;
}

/** Builds a fresh harness for one run of the contract suite. */
export type HarnessFactory = () => EconomicHarness;
