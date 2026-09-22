# Daily Reward

Daily Reward is a feature policy layered on the economic model.

## Economic semantics

A successful Daily Reward is a treasury-funded transfer to a User.

Its economic operation kind is DAILY_REWARD.

It does not create supply.

The treasury must already contain sufficient balance.

The amount of a successful claim is the amount snapshotted by the Daily Reward window in which the
claim occurs.

Daily Reward never implies automatic issuance. Preventing treasury exhaustion is an operational
concern, not a reward-domain exception.

## Policy

The initial Daily Reward policy has amount 10 and reset phase 72000 seconds.

The reset phase is a position in a repeating 86400-second Unix-time cycle. It is not a civil-time or
time-zone value.

Administrative authority may change the amount and reset phase for a future window.

A policy change never alters the current window. When multiple policy changes are committed during
the same current window, the latest committed change is the policy used for the next window.

Policy changes are historical facts. A later change supersedes an earlier pending change for
next-window selection but does not erase it.

## Community-global windows

Daily Reward eligibility is divided into community-global windows, not per-User windows and not a
rolling 24-hour interval.

Each window fixes one start instant, one end instant, one amount, and one reset phase.

Once a window starts, those values remain unchanged until that window ends, regardless of subsequent
policy changes.

A claim belongs to the unique window whose interval contains the claim transaction's authoritative
time. The start instant is inclusive and the end instant is exclusive. A claim exactly at a boundary
therefore belongs to the new window.

All Users observe the same window sequence. The absence of a scheduler must not create per-User
window drift.

## Initial window

Before any Daily Reward window exists, the initial policy determines the window containing the first
authoritative Daily Reward transaction time.

The initial start instant is the most recent Unix timestamp at the initial reset phase in the
86400-second cycle that is not later than that authoritative time.

The initial window lasts exactly 86400 seconds.

## Window transition

A new window starts exactly when the preceding window ends.

The next window uses the latest policy change scheduled during the preceding window, or inherits the
preceding window's policy when no such change exists.

Let the old and new reset phases be positions in the 86400-second cycle. Their phase shift is the
shortest signed difference from old to new modulo 86400 seconds.

The signed difference is greater than negative 43200 seconds and less than or equal to positive
43200 seconds. An exact 12-hour tie therefore uses positive 43200 seconds.

The next window duration is 86400 seconds plus that signed phase shift.

A policy change can therefore create one transition window whose duration differs from 24 hours.
After the new reset phase is established, later windows are 86400 seconds long unless another policy
change changes the reset phase.

## Lazy materialization

Window boundaries are semantic facts and do not depend on a cron job or scheduled callback firing.

Before a Daily Reward operation that needs the current window observes window state, the system
advances the community-global window sequence until the transaction's authoritative time is contained
by the current window.

If several boundaries elapsed with no Daily Reward activity, every intervening window still exists
semantically and the sequence is advanced deterministically through them.

A policy change committed after a boundary cannot be applied retroactively to the window that already
started at that boundary. The current window is advanced first, then the new policy change is
scheduled for the following window.

Materializing or advancing the global window sequence is independent of whether an individual claim
later succeeds.

## Claim eligibility

A User may have at most one successful Daily Reward claim for each window.

A successful claim consumes that User's eligibility for the window.

A failed claim does not consume eligibility.

Treasury insufficiency is a failed claim and may be retried.

A successful claim, its economic operation, and its eligibility consumption are one indivisible
semantic result.

Daily Reward is explicitly claimed by a user action. The domain does not require that the claim
surface be a particular command or user interface, and there is no automatic per-User payout.

## Historical stability

Completed policy revisions, windows, and successful claims are historical facts.

A later policy change cannot alter a past or current window, change the amount of an already completed
claim, or reopen eligibility that was already consumed.
