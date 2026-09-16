import {
	type EconomicHarness,
	type HarnessCommand,
	type HarnessResult,
	type LedgerView,
	type OperationView,
	TREASURY_REF,
} from "@communitytoken/economic-contract";
import {
	evaluateOperation,
	TREASURY_WALLET_ID,
	type WalletFacts,
} from "../src/index";

/**
 * In-memory reference adapter: the stateful model the contract suite runs
 * against for the kernel. It owns what the pure evaluator deliberately does
 * not — users, wallets, histories, durable-id allocation, and commit
 * timestamps — and internally performs the production shape
 * `read facts -> evaluate -> apply effect -> commit`, all in one place.
 */
export function createInMemoryHarness(): EconomicHarness {
	type Wallet = {
		readonly id: string;
		readonly kind: "system" | "user";
		balance: number;
	};

	let wallets = new Map<string, Wallet>();
	let users = new Map<string, string>();
	let operations: OperationView[] = [];
	let ledger: LedgerView[] = [];
	let seq = 0;
	let now = 1_700_000_000_000;

	function init(): void {
		wallets = new Map([
			[
				TREASURY_WALLET_ID,
				{ id: TREASURY_WALLET_ID, kind: "system", balance: 0 },
			],
		]);
		users = new Map();
		operations = [];
		ledger = [];
		seq = 0;
	}
	init();

	function walletIdOf(ref: string): string | undefined {
		return ref === TREASURY_REF ? TREASURY_WALLET_ID : users.get(ref);
	}

	function factsOf(id: string | undefined): WalletFacts | undefined {
		return id === undefined ? undefined : wallets.get(id);
	}

	function supply(): number {
		let total = 0;
		for (const w of wallets.values()) total += w.balance;
		return total;
	}

	return {
		async reset() {
			init();
		},

		async createUser(userId: string) {
			if (users.has(userId)) {
				throw new Error(`user already registered: ${userId}`);
			}
			const walletId = `wallet-${++seq}`;
			users.set(userId, walletId);
			wallets.set(walletId, { id: walletId, kind: "user", balance: 0 });
		},

		async apply(command: HarnessCommand): Promise<HarnessResult> {
			const fromId = walletIdOf(command.from);
			const toId = walletIdOf(command.to);
			const decision = evaluateOperation(
				{
					from: factsOf(fromId),
					to: factsOf(toId),
					totalSupply: supply(),
				},
				{
					kind: command.kind,
					fromWalletId: fromId ?? command.from,
					toWalletId: toId ?? command.to,
					amount: command.amount,
					...(command.metadata === undefined
						? {}
						: { metadata: command.metadata }),
				},
			);
			if (!decision.accepted) {
				return { accepted: false, code: decision.code };
			}
			const { effect } = decision;
			for (const [walletId, delta] of effect.deltas) {
				const wallet = wallets.get(walletId);
				if (!wallet) {
					throw new Error(`effect references unknown wallet: ${walletId}`);
				}
				wallets.set(walletId, {
					...wallet,
					balance: wallet.balance + delta,
				});
			}
			const createdAt = now++;
			const operation: OperationView = {
				id: `op-${++seq}`,
				kind: effect.kind,
				metadata: effect.metadata,
				createdAt,
			};
			const entry: LedgerView = {
				id: `tx-${++seq}`,
				operationId: operation.id,
				fromWalletId: effect.fromWalletId,
				toWalletId: effect.toWalletId,
				amount: effect.amount,
				createdAt,
			};
			operations.push(operation);
			ledger.push(entry);
			return { accepted: true };
		},

		async balanceOf(ref: string) {
			const id = walletIdOf(ref);
			const wallet = id === undefined ? undefined : wallets.get(id);
			if (!wallet) throw new Error(`no wallet for ref: ${ref}`);
			return wallet.balance;
		},

		async totalSupply() {
			return supply();
		},

		async issuedAmount() {
			const issuanceIds = new Set(
				operations.filter((o) => o.kind === "TOKEN_ISSUANCE").map((o) => o.id),
			);
			return ledger.reduce(
				(sum, e) => (issuanceIds.has(e.operationId) ? sum + e.amount : sum),
				0,
			);
		},

		async operations() {
			return [...operations];
		},

		async ledger() {
			return [...ledger];
		},
	};
}
