import {
	type EconomicHarness,
	type HarnessCommand,
	type HarnessResult,
	type LedgerView,
	type OperationView,
	type RejectionCode,
	userRef,
	type WalletRef,
} from "@communitytoken/economic-contract";
import type { CommunityState } from "../src/index";

const REJECTION_CODES: readonly RejectionCode[] = [
	"INVALID_AMOUNT",
	"WALLET_NOT_FOUND",
	"DIRECTION_VIOLATION",
	"INSUFFICIENT_BALANCE",
	"OVERFLOW",
];

function rejectionCode(error: unknown): RejectionCode | undefined {
	const message = error instanceof Error ? error.message : String(error);
	const prefix = message.split(":", 1)[0];
	return REJECTION_CODES.find((c) => c === prefix);
}

function walletId(ref: WalletRef): string {
	// The PoC addresses wallets directly by id. User wallets live under the
	// "u:" namespace so an opaque user id can never alias the singleton
	// treasury wallet id "treasury".
	return ref.type === "treasury" ? "treasury" : `u:${ref.userId}`;
}

/**
 * Adapts the CommunityState Durable Object to the shared economic contract
 * harness. This is an independent implementation — it does not reuse the
 * kernel — so passing the same suite is evidence the contract, not shared
 * code, pins the semantics.
 */
export function createPocHarness(
	stub: DurableObjectStub<CommunityState>,
): EconomicHarness {
	return {
		async reset() {
			// Each test constructs a fresh DO id; nothing to reset.
		},

		async createUser(userId: string) {
			await stub.createWallet(walletId(userRef(userId)));
		},

		async apply(command: HarnessCommand): Promise<HarnessResult> {
			try {
				await stub.applyOperation({
					kind: command.kind,
					fromWalletId: walletId(command.from),
					toWalletId: walletId(command.to),
					amount: command.amount,
					...(command.metadata === undefined
						? {}
						: { metadata: command.metadata }),
				});
				return { accepted: true };
			} catch (e) {
				const code = rejectionCode(e);
				if (code === undefined) throw e;
				return { accepted: false, code };
			}
		},

		async balanceOf(ref: WalletRef) {
			return stub.getBalance(walletId(ref));
		},

		async totalSupply() {
			return stub.totalSupply();
		},

		async issuedAmount() {
			return stub.issuedAmount();
		},

		async operations(): Promise<readonly OperationView[]> {
			const rows = await stub.listOperations();
			return rows.map((r) => ({
				id: r.id,
				kind: r.kind,
				metadata: r.metadata,
				createdAt: r.created_at,
			}));
		},

		async ledger(): Promise<readonly LedgerView[]> {
			const rows = await stub.listLedger();
			return rows.map((r) => ({
				id: r.id,
				operationId: r.operation_id,
				fromWalletId: r.from_wallet_id,
				toWalletId: r.to_wallet_id,
				amount: r.amount,
				createdAt: r.created_at,
			}));
		},
	};
}
