import type {
	EconomicHarness,
	HarnessCommand,
	HarnessResult,
	TransactionView,
} from "@communitytoken/economic-contract";
import {
	type AccountFacts,
	type EffectDeltas,
	evaluateIssue,
	evaluateTransfer,
} from "../src/index";

/**
 * In-memory reference adapter: the stateful model the contract suite runs
 * against for the kernel. It owns what the pure evaluator deliberately does
 * not — Principals, Accounts, Transaction history, durable-id allocation,
 * and commit timestamps — and internally performs the production shape
 * `read facts -> evaluate -> apply effect -> commit`, all in one place.
 */
export function createInMemoryHarness(): EconomicHarness {
	let principals = new Set<string>();
	let accounts = new Map<string, AccountFacts>();
	let transactions: TransactionView[] = [];
	let seq = 0;
	let now = 1_700_000_000_000;

	function init(): void {
		principals = new Set();
		accounts = new Map();
		transactions = [];
		seq = 0;
	}
	init();

	function supply(): number {
		let total = 0;
		for (const account of accounts.values()) total += account.balance;
		return total;
	}

	function applyDeltas(deltas: EffectDeltas): void {
		for (const [accountId, delta] of deltas) {
			const account = accounts.get(accountId);
			if (account === undefined) {
				throw new Error(`effect references unknown account: ${accountId}`);
			}
			accounts.set(accountId, { ...account, balance: account.balance + delta });
		}
	}

	function commit(command: HarnessCommand): HarnessResult {
		if (command.kind === "ISSUE") {
			const decision = evaluateIssue(
				{
					issuer: principals.has(command.issuerPrincipalId)
						? { id: command.issuerPrincipalId }
						: undefined,
					destination: accounts.get(command.destinationAccountId),
					totalSupply: supply(),
				},
				command,
			);
			if (!decision.accepted) return { accepted: false, code: decision.code };
			applyDeltas(decision.effect.deltas);
			const id = `tx-${++seq}`;
			transactions.push({
				id,
				kind: "ISSUE",
				issuerPrincipalId: decision.effect.issuerPrincipalId,
				sourceAccountId: null,
				destinationAccountId: decision.effect.destinationAccountId,
				amount: decision.effect.amount,
				committedAt: now++,
			});
			return { accepted: true, transactionId: id };
		}
		const decision = evaluateTransfer(
			{
				source: accounts.get(command.sourceAccountId),
				destination: accounts.get(command.destinationAccountId),
			},
			command,
		);
		if (!decision.accepted) return { accepted: false, code: decision.code };
		applyDeltas(decision.effect.deltas);
		const id = `tx-${++seq}`;
		transactions.push({
			id,
			kind: "TRANSFER",
			issuerPrincipalId: null,
			sourceAccountId: decision.effect.sourceAccountId,
			destinationAccountId: decision.effect.destinationAccountId,
			amount: decision.effect.amount,
			committedAt: now++,
		});
		return { accepted: true, transactionId: id };
	}

	return {
		async reset() {
			init();
		},

		async createPrincipal() {
			const id = `principal-${++seq}`;
			principals.add(id);
			return id;
		},

		async createAccount(ownerPrincipalId: string) {
			if (!principals.has(ownerPrincipalId)) {
				throw new Error(`unknown owner principal: ${ownerPrincipalId}`);
			}
			const id = `account-${++seq}`;
			accounts.set(id, { id, balance: 0 });
			return id;
		},

		async apply(command: HarnessCommand): Promise<HarnessResult> {
			return commit(command);
		},

		async balanceOf(accountId: string) {
			const account = accounts.get(accountId);
			if (account === undefined) {
				throw new Error(`no account: ${accountId}`);
			}
			return account.balance;
		},

		async totalSupply() {
			return supply();
		},

		async issuedAmount() {
			return transactions.reduce(
				(sum, tx) => (tx.kind === "ISSUE" ? sum + tx.amount : sum),
				0,
			);
		},

		async transactions() {
			return [...transactions];
		},
	};
}
