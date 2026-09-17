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
	type ServiceActor,
	TREASURY_SELECTOR,
	type UserActor,
	type UserId,
	userId,
	userSelector,
	type WalletId,
	walletId,
} from "../src/index";

export function forbiddenByType(
	app: CommunityTokenApplication,
): readonly unknown[] {
	const results: unknown[] = [];

	// @ts-expect-error a plain string is not a UserId
	const uidFromString: UserId = "alice";
	// @ts-expect-error a WalletId is not a UserId
	const uidFromWallet: UserId = walletId("wallet-1");
	// @ts-expect-error a UserId is not a WalletId
	const widFromUser: WalletId = userId("alice");
	results.push(uidFromString, uidFromWallet, widFromUser);

	const alice = userId("alice");
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

	return results;
}
