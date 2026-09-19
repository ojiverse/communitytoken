import {
	type Actor,
	ADMIN_API_PRINCIPAL,
	rehydrate,
	TREASURY_SELECTOR,
	userSelector,
	type WalletSelector,
} from "@communitytoken/application";
import type {
	EconomicHarness,
	HarnessCommand,
	HarnessResult,
	LedgerView,
	OperationKind,
	OperationView,
	WalletRef,
} from "@communitytoken/economic-contract";
import type { CommunityState } from "../src/index";

/**
 * Adapts the production CommunityState Durable Object to the shared economic
 * contract harness. The mutation path goes through the same application
 * evaluate/persist choreography as the product use cases, so passing the
 * unchanged Phase 1 suite proves the production adapter preserves the
 * economic invariants.
 */

const ADMIN_ACTOR: Actor = {
	kind: "service",
	principalId: ADMIN_API_PRINCIPAL,
};

/**
 * Deterministic harness actor mapping (issue #4): administrative kinds are
 * attributed to the `admin-api` principal; user-funded movements are
 * attributed to the source wallet's owning User; commands with no user
 * source — only expressible as deliberately invalid directions — fall back
 * to the identifier-less `system` actor. The actor is persisted audit
 * context and never influences kernel acceptance.
 */
export function actorFor(command: HarnessCommand): Actor {
	switch (command.kind) {
		case "TOKEN_ISSUANCE":
		case "DISTRIBUTION":
			return ADMIN_ACTOR;
		case "P2P_TRANSFER":
		case "TREASURY_PAYMENT":
			return command.from.type === "user"
				? { kind: "user", userId: rehydrate.userId(command.from.userId) }
				: { kind: "system" };
	}
}

function selectorFor(ref: WalletRef): WalletSelector {
	return ref.type === "treasury"
		? TREASURY_SELECTOR
		: userSelector(rehydrate.userId(ref.userId));
}

/** The actor that may read `ref`'s balance under the visibility rules. */
function readerFor(ref: WalletRef): Actor {
	return ref.type === "treasury"
		? ADMIN_ACTOR
		: { kind: "user", userId: rehydrate.userId(ref.userId) };
}

export function createProductionHarness(
	stub: DurableObjectStub<CommunityState>,
): EconomicHarness {
	return {
		async reset() {
			// Each test constructs a fresh DO id; nothing to reset.
		},

		async createUser(userId: string) {
			await stub.createUser(userId);
		},

		async apply(command: HarnessCommand): Promise<HarnessResult> {
			const result = await stub.applyEconomicCommand(actorFor(command), {
				kind: command.kind,
				from: selectorFor(command.from),
				to: selectorFor(command.to),
				amount: command.amount,
				...(command.metadata === undefined
					? {}
					: { metadata: command.metadata }),
			});
			if (result.ok) return { accepted: true };
			if (result.error.type === "rejected") {
				return { accepted: false, code: result.error.code };
			}
			throw new Error(
				`unexpected ${result.error.type} failure: ${result.error.detail}`,
			);
		},

		async balanceOf(ref: WalletRef) {
			const result = await stub.getBalance(readerFor(ref), selectorFor(ref));
			if (!result.ok) {
				throw new Error(`${result.error.type}: ${result.error.detail}`);
			}
			return result.value.balance;
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
				kind: r.kind as OperationKind,
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
