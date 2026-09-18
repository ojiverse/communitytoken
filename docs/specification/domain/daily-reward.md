# Daily Reward

Daily Reward is a feature policy layered on the economic model.

## Economic semantics

A successful Daily Reward is a treasury-funded transfer to a User.

Its economic operation kind is DAILY_REWARD.

Its amount is 10 tokens.

It does not create supply.

The treasury must already contain sufficient balance.

## Eligibility window

Let now_ms be the authoritative timestamp of the claim transaction.

Define:

unix_seconds = floor(now_ms / 1000)

reward_window_id =
  floor((unix_seconds - 72000) / 86400)

A User may have at most one successful Daily Reward claim for each reward_window_id.

The offset is fixed at 72000 seconds. Therefore the window boundary occurs at 20:00 UTC, equivalent
to 05:00 JST under the current civil-time relationship. Time zone is not stored as domain state.

A claim exactly at a boundary belongs to the new window.

## Invariants

1. Reward eligibility is window-based, not rolling-24-hours.
2. A successful claim consumes eligibility for that User and window.
3. A failed claim does not consume eligibility.
4. Treasury insufficiency is a failed claim and may be retried while eligibility remains.
5. A successful claim and its eligibility consumption are one indivisible semantic result.
6. Changing the reward amount or reset offset changes product policy and therefore requires an explicit specification change.

Daily Reward never implies automatic issuance. Preventing treasury exhaustion is an operational
concern, not a reward-domain exception.
