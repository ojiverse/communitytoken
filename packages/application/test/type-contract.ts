/**
 * Compile-time negative coverage for the types-as-design contract (issue #4
 * §5, §10, §13, §22). Every `@ts-expect-error` below must remain a type
 * error: if a public signature is accidentally weakened, `tsc --noEmit`
 * reports the directive as unused and `pnpm check` fails. This file is
 * never executed — vitest only runs `*.spec.ts`.
 */
import type { CommunityTokenApplication } from "../src/application";
import {
	ADMIN_API_PRINCIPAL,
	type AdminActor,
	type OperationRecord,
	rehydrate,
	type ServiceActor,
	TREASURY_SELECTOR,
	type UnitOfWork,
	type UserActor,
	type UserId,
	userSelector,
	type WalletId,
} from "../src/index";

export function forbiddenByType(
	app: CommunityTokenApplication,
	uow: UnitOfWork,
): readonly unknown[] {
	const results: unknown[] = [];

	// @ts-expect-error a plain string is not a UserId
	const uidFromString: UserId = "alice";
	// @ts-expect-error a WalletId is not a UserId
	const uidFromWallet: UserId = rehydrate.walletId("wallet-1");
	// @ts-expect-error a UserId is not a WalletId
	const widFromUser: WalletId = rehydrate.userId("alice");
	results.push(uidFromString, uidFromWallet, widFromUser);

	const alice = rehydrate.userId("alice");
	const aliceActor: UserActor = { kind: "user", userId: alice };
	const discordAdapter: ServiceActor = {
		kind: "service",
		principalId: "discord-adapter",
	};
	// @ts-expect-error a non-admin service principal cannot issue
	results.push(app.issueToken(discordAdapter, { amount: 1 }));
	results.push(
		// @ts-expect-error a non-admin service principal cannot distribute
		app.distributeToken(discordAdapter, { toUserId: alice, amount: 1 }),
	);

	// @ts-expect-error a user actor cannot read the treasury balance
	results.push(app.getBalance(aliceActor, TREASURY_SELECTOR));
	results.push(
		// @ts-expect-error a user actor cannot read the treasury history
		app.getTransactionHistory(aliceActor, TREASURY_SELECTOR, {}),
	);

	const admin: AdminActor = {
		kind: "service",
		principalId: ADMIN_API_PRINCIPAL,
	};
	// @ts-expect-error the admin principal cannot read a user balance
	results.push(app.getBalance(admin, userSelector(alice)));
	results.push(
		// @ts-expect-error the admin principal cannot read a user history
		app.getTransactionHistory(admin, userSelector(alice), {}),
	);

	// @ts-expect-error a system actor cannot carry an id
	const systemWithId: OperationRecord = {
		id: rehydrate.operationId("op-1"),
		kind: "TOKEN_ISSUANCE",
		metadata: null,
		actorKind: "system",
		actorId: "alice",
		createdAt: 0,
	};
	// @ts-expect-error a user actor cannot have a null id
	const userWithNullId: OperationRecord = {
		id: rehydrate.operationId("op-2"),
		kind: "P2P_TRANSFER",
		metadata: null,
		actorKind: "user",
		actorId: null,
		createdAt: 0,
	};
	results.push(systemWithId, userWithNullId);

	// @ts-expect-error async transaction callbacks are forbidden
	results.push(uow.transact(async () => 1));

	return results;
}
