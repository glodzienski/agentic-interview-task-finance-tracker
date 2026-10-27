# Tickets: Monthly category budgets

Tracer-bullet slices that build the Budgets feature described in the spec appended to `TASK.md`. Vocabulary follows `CONTEXT.md`; respect ADR-0001 (receipt-item attribution) and ADR-0002 (per-currency Budgets).

Work the **frontier**: any ticket whose blockers are all done. For a purely linear chain that means top to bottom.

Every ticket is done only when `pnpm run check` passes.

## Budgets page: create a Budget and see this month's progress

**What to build:** A user finds "Budgets" in the main navigation (after Categories), creates a Budget by picking a category from the indented category tree, a currency (currencies used by their accounts, PLN fallback) and a monthly limit, and sees each Budget as a card with limit, Spending this Budget month, what's left or "X over", a progress bar, and an "Over budget" badge with icon when Spending strictly exceeds the limit. Spending counts only negative transactions, includes all descendant categories, only accounts in the Budget's currency, and only the current Budget month as computed in the browser's local time. This slice counts transactions by their own category only (receipt items come later). Budgets are user data: they appear in the data export and are removed on account hard-deletion.

**Blocked by:** None — can start immediately

- [ ] Sidebar shows a localised "Budgets" link that opens the authenticated Budgets page
- [ ] Empty state explains Budgets and offers "Add budget"
- [ ] Creating a Budget validates the limit (required, numeric, > 0, parsed with the shared money parser) and rejects a duplicate (category, currency) with a localised error
- [ ] The category must belong to the user; another user's categories, transactions and Budgets are never visible or counted
- [ ] Spent includes the category and descendants at any depth; positive amounts (income/refunds) are ignored; other currencies are ignored; transactions outside the month are ignored (first and last day included)
- [ ] Spending equal to the limit shows 0 left and is not over budget; over budget shows a red full bar, the badge, and "X over"
- [ ] Cards are sorted over-budget first, then by percentage used descending
- [ ] The overview server function takes the month (`YYYY-MM`, validated) from the browser
- [ ] Saving a transaction or completing an import refreshes Budgets totals (query invalidation)
- [ ] Budgets are included in the data export (JSON and CSV) and deleted in account hard-deletion
- [ ] All strings come from Paraglide messages
- [ ] Unit tests on the budgets server module against the in-memory DB cover the rules above; compliance tests cover export/delete
- [ ] E2E tests cover navigation, empty state, create, validation errors, parent rollup, refunds ignored, and the over-budget display

## Edit a Budget's limit and remove a Budget

**What to build:** A user edits an existing Budget's limit in a dialog where category and currency are shown read-only, and removes a Budget after confirming. Totals and over-budget state update immediately.

**Blocked by:** Budgets page: create a Budget and see this month's progress

- [ ] Edit dialog changes only the limit, with the same validation as create
- [ ] Delete asks for confirmation and removes the Budget from the list
- [ ] Updating or deleting another user's Budget (or a missing one) returns a not-found error
- [ ] Unit tests cover update/delete and ownership
- [ ] E2E tests cover editing the limit (including crossing into and out of over budget) and deleting with confirmation

## Count receipt items toward their own categories

**What to build:** For transactions with an itemised receipt, Budget Spending follows the Attributed category rule (ADR-0001): each categorised receipt item counts toward its own category even in a different branch of the tree; uncategorised items and any positive remainder (transaction amount minus items total) count toward the transaction's category; item totals are not capped at the transaction amount. The dashboard Sankey stays unchanged.

**Blocked by:** Budgets page: create a Budget and see this month's progress

- [ ] A grocery receipt with a Household item counts that item toward a Household Budget and the rest toward Groceries
- [ ] Uncategorised items and the remainder count toward the transaction's category
- [ ] Items summing to more than the transaction are counted in full
- [ ] An uncategorised transaction with categorised receipt items counts only its items, each toward its own category
- [ ] Existing analytics (Sankey, dashboard) tests still pass unchanged
- [ ] Unit tests cover each attribution case; one E2E test shows a receipt item counting toward its own Budget

## Free-plan budget limit and Pro upsell

**What to build:** Free users can have up to 3 Budgets; Pro users have unlimited. At the limit, "Add budget" is disabled with a localised "Free plan: 3 budgets — Upgrade to Pro" message linking to Billing, and the server rejects further creation with a `budget_limit_reached` code and the limit. A user who downgrades with more than 3 Budgets keeps all of them fully working; only creating new ones is blocked — the same rule as accounts.

**Blocked by:** Budgets page: create a Budget and see this month's progress

- [ ] Entitlements expose a budget limit (unlimited for Pro, configurable free value defaulting to 3)
- [ ] Server-side gate blocks the 4th Budget on free with `budget_limit_reached` and the limit; UI shows the localised message
- [ ] Pro users can create more than 3 Budgets
- [ ] After a downgrade, existing Budgets above the limit still track, can be edited and deleted
- [ ] Unit tests alongside the existing billing tests
- [ ] E2E tests use the plan-override test route for free vs Pro

## Over-budget alert email after direct actions

**What to build:** When a Budget goes over budget in the current Budget month, the user receives one Over-budget alert email for that Budget that month, naming the category, limit, spent, month, and linking to the Budgets page. The check runs right after creating/updating a transaction, completing an import, and creating or updating a Budget's limit — fire-and-forget, never failing the user's action. Alerts only go to a verified email with no pending account deletion; otherwise nothing is claimed so the alert can still go out later, and the Budgets page shows a hint to verify the email. Concurrent checks send exactly one email; a failed send releases its claim so a later check retries. Only months current somewhere on Earth at the time of the check can trigger an alert.

**Blocked by:** Budgets page: create a Budget and see this month's progress; Edit a Budget's limit and remove a Budget

- [ ] Alert history is recorded per (Budget, Budget month) with a uniqueness guard
- [ ] Going over sends one email; further over-limit Spending, or dipping under and over again, sends nothing more that month
- [ ] Concurrent evaluations send exactly one email
- [ ] A send failure releases the claim and logs; the next evaluation sends
- [ ] No email for users without an email, with an unverified email, or with deletion pending; no claim is recorded; the page shows the verify-email hint
- [ ] Late Spending that pushes a past month over budget sends nothing
- [ ] Alert errors never fail transaction saves, imports or Budget saves
- [ ] Deleting a Budget removes its alert history
- [ ] Alert history is included in the data export and deleted in account hard-deletion
- [ ] Email subject/body are Paraglide messages
- [ ] Unit tests cover all alert rules with an explicit `now`; E2E tests assert via the captured-emails test route

## Hourly job catches indirect over-budget cases

**What to build:** The hourly in-process maintenance loop also evaluates Over-budget alerts for every user with Budgets, so going over through paths without an immediate check (rule/AI recategorisation, receipts, moving a subcategory under a budgeted parent, verifying an email later in the month) still sends the alert within an hour. The TEST_MODE sweep route runs the same evaluation so E2E tests can trigger it deterministically. A failure in either the budget evaluation or the compliance sweep never stops the other.

**Blocked by:** Over-budget alert email after direct actions

- [ ] The maintenance loop runs budget alert evaluation for all users with Budgets
- [ ] The sweep test route also runs budget alert evaluation
- [ ] Budget evaluation failures are logged and don't affect the compliance sweep (and vice versa)
- [ ] A user who becomes eligible (verifies email) later in the month receives the pending alert on the next sweep
- [ ] Unit tests for the all-users evaluation; E2E test triggers an indirect over-budget case and asserts the email after the sweep route

## Deleting a category removes its Budgets

**What to build:** When a user deletes a category, Budgets on that category and on all its descendants are removed with it, freeing free-plan slots. The delete confirmation dialog warns how many Budgets will also be removed. Existing category deletion behaviour (descendant deletion, transaction reassignment) is unchanged.

**Blocked by:** Budgets page: create a Budget and see this month's progress

- [ ] Deleting a category removes Budgets on it and its descendants, in the same operation
- [ ] The confirmation dialog shows a localised "also removes N budgets" warning only when N > 0
- [ ] Reassigning transactions to another category does not move Budgets
- [ ] Existing categories E2E tests still pass
- [ ] New E2E test covers the warning and the removal; unit test covers the cascade
