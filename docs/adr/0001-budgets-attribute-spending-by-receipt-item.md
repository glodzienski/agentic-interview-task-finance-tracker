# Budgets attribute Spending by receipt item, unlike the Sankey

Budgets count each categorized receipt item toward its own category, even when that category sits in a different branch of the tree than the transaction's category; uncategorized items and any amount the items don't cover fall back to the transaction's category, and item totals are not capped at the transaction amount. The dashboard Sankey instead gives the transaction's top-level category the whole amount and uses items only as subcategory nodes beneath it. We chose accuracy over consistency because a Budget exists to control Spending per category — a toaster on a grocery receipt must count toward Household, not Groceries. The Budgets page and the Sankey can therefore disagree for the same month; that is deliberate, and the Sankey was left untouched rather than changed under the "must not break existing functionality" constraint.

## Consequences

- Do not "fix" budget totals to match the Sankey, or vice versa, without revisiting this decision.
- If the Sankey is ever aligned, it should adopt the Attributed category rule from `CONTEXT.md`, not the other way around.
