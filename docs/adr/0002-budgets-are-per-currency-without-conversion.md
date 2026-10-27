# Budgets are per currency, without conversion

Accounts can each have their own ISO currency, yet existing analytics sum amounts across currencies as if they were one unit. For Budgets we decided each Budget carries its own currency, is unique per (category, currency), and counts only Spending from accounts in that currency — amounts are never converted. Summing mixed currencies would make the limit, the "left" figure and the over-budget alert silently wrong for multi-currency users, and the app has no exchange-rate source; adding one would introduce an external dependency and a question of which rate applies to which day.

## Considered Options

- **Ignore currency (like the dashboard):** consistent with existing code, but wrong numbers drive a real email.
- **Convert via exchange rates:** most convenient for the user, but out of scope and requires an external rate provider.

## Consequences

- A multi-currency user needs one Budget per currency for the same category, and each counts toward the free plan's budget limit.
- Introducing conversion later means migrating Budget semantics (and possibly merging per-currency Budgets), so it is not a drop-in change.
