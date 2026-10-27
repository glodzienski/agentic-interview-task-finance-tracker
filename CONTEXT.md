# Finance Tracker

A personal finance tracker: users import or enter transactions on their accounts, categorize them, and plan spending against those categories.

## Language

### Money movement

**Spending**:
Money leaving the user's accounts — a transaction with a negative amount. Income and refunds (positive amounts) are never Spending and never offset it.
_Avoid_: Expenses (fine in UI copy, but not as a distinct concept), outflow

**Attributed category**:
The category a piece of Spending counts toward. For a transaction with a receipt, each categorized receipt item counts toward its own category; uncategorized items and any amount the items don't cover count toward the transaction's category.
_Avoid_: Top category (that's a Sankey display notion, not attribution)

### Planning

**Budget**:
A user's monthly Spending limit for one category in one currency, covering that category and all its descendant categories. Only Spending from accounts in the Budget's currency counts toward it; amounts are never converted between currencies.
_Avoid_: Limit (the limit is a property of a Budget), cap

**Budget month**:
The calendar month a Budget's Spending is measured over. A transaction belongs to the Budget month containing its date; the *current* Budget month is the one containing today in the user's own local time. Every Budget starts each month at zero Spending.
_Avoid_: Period, cycle

**Over budget**:
A Budget's state when its Spending in a Budget month exceeds its limit. Spending exactly equal to the limit is not over budget.
_Avoid_: Overspent, exceeded (as a state name)

**Over-budget alert**:
The email telling a user a Budget went over budget. At most one is sent per Budget per Budget month, even if the Budget drops back under its limit and goes over again in the same month. Only the current Budget month can trigger one — late-arriving Spending that pushes a past month over budget sends nothing.
_Avoid_: Notification, warning
