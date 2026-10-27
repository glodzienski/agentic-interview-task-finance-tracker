# Monthly category budgets

**Type:** User Story · **Priority:** High · **Tags:** budgets, pro-upsell

## Description

As a user, I want to set a monthly spending limit per category so that I can
control my spending instead of just tracking it.

Users can currently see what they spent but have no way to plan against it.
Budgets is also one of the features we want to use to drive Pro upgrades.

## Acceptance criteria

- New "Budgets" page in the main navigation.
- User can add a budget for a category with a monthly limit, change the
  limit, and remove the budget.
- Each budget shows the limit, amount spent this month, what's left, and
  clearly shows when the user is over budget.
- A budget on a parent category includes spending in its subcategories.
- Only spending counts — income/refunds don't reduce the spent amount.
- Budgets reset every month.
- User gets an email when they go over a budget. Max one email per budget
  per month.
- Free plan: up to 3 budgets. Pro: unlimited.

## Notes

- Must not break existing functionality.
- Budgets are user data — same compliance requirements as the rest.

---

# Spec: Monthly category budgets

> Synthesised from the design grilling session. Vocabulary follows `CONTEXT.md`
> (**Spending**, **Attributed category**, **Budget**, **Budget month**,
> **Over budget**, **Over-budget alert**). Respects ADR-0001 (receipt-item
> attribution) and ADR-0002 (per-currency Budgets).

## Problem Statement

Users can see what they spent, but they can't plan against it. There is no way
to say "I want to spend at most 1000 PLN on Groceries this month" and then see,
at a glance, how close they are — and nothing tells them when they've blown
through a limit. The business also wants a feature that gives free users a
reason to upgrade to Pro.

## Solution

A new **Budgets** page in the main navigation where a user sets a monthly
limit for a category in a currency. Each Budget shows its limit, the Spending
in the current Budget month, what's left (or how much over), and a clear
over-budget state. Budgets on a parent category include Spending in all its
descendant categories, only Spending counts (income and refunds are ignored),
and every Budget starts each month at zero. When a Budget goes over budget in
the current month, the user gets one Over-budget alert email for that Budget
that month. Free users can have up to 3 Budgets; Pro users have unlimited.

## User Stories

### Managing Budgets

1. As a user, I want a "Budgets" entry in the main navigation, so that I can find budgeting without hunting for it.
2. As a user, I want to add a Budget by choosing a category, a currency and a monthly limit, so that I can plan my Spending for that category.
3. As a user, I want the category picker to show my full category tree with subcategories indented, so that I can budget either a broad parent or a specific subcategory.
4. As a user, I want the currency picker to offer only currencies my accounts actually use, so that I can't create a Budget that can never accumulate Spending.
5. As a user with no accounts yet, I want the currency to default to PLN, so that I can still set up a Budget ahead of time.
6. As a user, I want to enter the limit in my usual money format (e.g. "1000,50" or "1000.50"), so that I don't have to think about formatting.
7. As a user, I want to be told when the limit is empty, zero, negative or not a number, so that I fix it before saving.
8. As a user, I want to be told when I already have a Budget for that category in that currency, so that I don't end up with confusing duplicates.
9. As a user, I want to change a Budget's limit, so that I can adjust my plan as my month unfolds.
10. As a user, I want to remove a Budget after confirming, so that I can stop tracking a category without accidental deletion.
11. As a user, I want to create a Budget on a parent category and a separate Budget on one of its subcategories, so that I can have an overall limit plus a tighter one on a weak spot.
12. As a user, I want to create separate Budgets for the same category in different currencies, so that my PLN and EUR Spending are each tracked correctly.

### Seeing progress

13. As a user, I want each Budget to show its limit, amount spent this month and what's left, so that I know where I stand.
14. As a user, I want a progress bar per Budget, so that I can scan my Budgets visually.
15. As a user, I want an over-budget Budget to show a red, full progress bar and an "Over budget" badge with an icon, so that the state is obvious and not conveyed by colour alone.
16. As a user, I want an over-budget Budget to show "X over" instead of a negative "left" amount, so that the number reads naturally.
17. As a user, I want Spending exactly equal to my limit to show as 0 left and not over budget, so that hitting my plan exactly isn't treated as failure.
18. As a user, I want over-budget Budgets listed first, then the rest by percentage used (highest first), so that problems are the first thing I see.
19. As a user, I want a parent-category Budget to include Spending in all its subcategories (at any depth), so that the parent limit reflects the whole area.
20. As a user, I want income and refunds to be ignored, so that a refund doesn't make it look like I spent less than I did.
21. As a user, I want only Spending from accounts in the Budget's currency to count, so that totals are never a meaningless sum of PLN and EUR.
22. As a user who itemises receipts, I want each categorised receipt item to count toward its own category, so that a toaster on a grocery receipt counts toward Household, not Groceries.
23. As a user, I want uncategorised receipt items and any part of the transaction the items don't cover to count toward the transaction's category, so that no Spending goes missing.
24. As a user, I want my Budgets to start from zero every month, so that each month is a fresh plan.
25. As a user, I want "this month" to follow my own local calendar, so that just after midnight on the 1st I see the new month, not the previous one.
26. As a user, I want the Budgets page to refresh its totals after I add or edit transactions, so that I'm never looking at stale numbers.
27. As a user with no Budgets, I want an empty state that explains Budgets and offers an "Add budget" button, so that I know how to start.

### Over-budget alerts

28. As a user, I want an email when a Budget goes over budget in the current month, so that I can react before the month is out.
29. As a user, I want at most one Over-budget alert per Budget per month, even if I dip back under and go over again, so that I'm not spammed.
30. As a user, I want the alert to arrive right after the action that pushed me over (adding a transaction, importing, changing a limit) where possible, so that it's timely.
31. As a user, I want the alert to still arrive when I went over through some other route (e.g. recategorising, moving a subcategory under a budgeted parent), so that no over-budget event is missed — even if it arrives up to an hour later.
32. As a user, I want the alert to name the category, limit, amount spent and month, and link to the Budgets page, so that I understand it at a glance.
33. As a user, I want no alert for a past month when old transactions are imported late, so that I'm not told about things I can no longer act on.
34. As a user, I want alerts sent only to my verified email address, so that my financial details never go to a mistyped address.
35. As a user without a verified email, I want a hint on the Budgets page that I need to verify my email to receive over-budget alerts, so that I know why I'm not getting them.
36. As a user who verifies their email later in the month, I want to still receive an alert for a Budget that was already over, so that verifying doesn't lose the alert.
37. As a user who has requested account deletion, I want no alert emails during the grace period, so that I'm not contacted after asking to leave.
38. As a user, I want a failed email delivery to be retried later, so that a temporary email outage doesn't silently drop my alert.
39. As a user, I want my import or transaction save never to fail because of an alert problem, so that budgeting never breaks core features.

### Plans and upsell

40. As a free user, I want to create up to 3 Budgets, so that I can try the feature.
41. As a free user with 3 Budgets, I want the "Add budget" button disabled with a "Free plan: 3 budgets — Upgrade to Pro" message linking to Billing, so that I know how to get more.
42. As a free user, I want a clear, localised error if I somehow submit a 4th Budget, so that the limit is enforced server-side, not just in the UI.
43. As a Pro user, I want unlimited Budgets, so that I can budget every category.
44. As a user who downgrades from Pro with more than 3 Budgets, I want all my existing Budgets to keep working (tracking, editing, alerts), with only creating new ones blocked, so that I don't lose anything.

### Categories interplay

45. As a user deleting a category that has Budgets on it or on its descendants, I want the confirmation dialog to warn me how many Budgets will also be removed, so that it isn't a surprise.
46. As a user, I want those Budgets removed together with the category, so that I'm not left with Budgets pointing at nothing — and the slots are freed on the free plan.
47. As a user, I want moving a subcategory to a different parent to change which parent Budget its Spending counts toward, so that Budgets always reflect my current category tree.

### Compliance

48. As a user, I want my Budgets and alert history included in my data export, so that my data-portability rights cover this feature.
49. As a user, I want my Budgets and alert history permanently deleted with my account, so that my right to erasure covers this feature.
50. As a user, I want to see, edit and delete only my own Budgets, so that no one else can view or change my financial plans.

### Internationalisation

51. As a user, I want every Budgets label, message, error and email to come from the app's translation catalogue, so that the feature can be localised like the rest of the app.

## Implementation Decisions

### Domain rules (from the grilling session)

- **Spending** is any transaction with a negative amount. Positive amounts (income, refunds) are excluded entirely — never netted.
- **Attributed category** (ADR-0001): for a transaction with a receipt, each categorised receipt item contributes its total to its own category; uncategorised items plus any positive remainder (transaction amount minus items total) go to the transaction's category; item totals are not capped at the transaction amount. Transactions without a receipt contribute their full amount to their own category. Uncategorised Spending counts toward no Budget.
- A Budget's Spending = sum of attributed Spending whose category is the Budget's category **or any descendant** (arbitrary depth, using the current category tree), on accounts whose currency equals the Budget's currency (ADR-0002), with a transaction date inside the Budget month.
- **Budget month** is a calendar month (`YYYY-MM`). A transaction belongs to the month of its calendar date. The current month for the UI is computed in the browser (local time) and passed to the server, which validates the format.
- **Over budget** means Spending strictly greater than the limit.
- Budgets are unique per (user, category, currency). Nested Budgets (parent and descendant both budgeted) are allowed and tracked independently.
- Only the current month is shown. Budgets store a single current limit — no per-month limit history.
- Editing a Budget changes only its limit. Category and currency are fixed at creation (delete and recreate to change them).

### Schema changes

- New **budgets** table: id, owning user, category, currency (3-letter ISO), limit in integer minor units (must be > 0), created timestamp. Unique constraint on (user, category, currency). Scoped directly by user, like other user-data tables.
- New **budget alerts** table recording an Over-budget alert sent: id, owning user, budget, month (`YYYY-MM`), sent timestamp. Unique constraint on (budget, month) — this is the deduplication and concurrency guard.
- Generated via Drizzle migration in the existing migration flow.

### Modules

- **Budgets server module (new, server-only, deep module)** — owns all budget logic and is the unit-test seam:
  - `getBudgetOverview(userId, month)` → list of Budgets each with category (id, name, colour), currency, limit, spent, remaining (non-negative), over amount (non-negative), over-budget flag, percentage used; pre-sorted (over-budget first, then by percentage used descending). Also returns whether the user is eligible to receive alerts (for the hint) and the plan's budget limit/usage (for the upsell state). All money in integer minor units.
  - `evaluateBudgetAlerts(userId, now)` → idempotent check. Determines the set of "current" months as every calendar month that is current in some timezone at `now` (UTC−12 … UTC+14; one or two months). For each Budget over budget in such a month, and only if the user is eligible (email present, verified, no deletion pending), it claims the (budget, month) alert row with insert-on-conflict-do-nothing; the winner sends the email; if sending throws, the winner deletes its claim and logs. Ineligible users are skipped without claiming, so the alert can still go out later in the month.
  - `evaluateAllBudgetAlerts(now)` → runs `evaluateBudgetAlerts` for every user that has at least one Budget; used by the hourly maintenance loop.
  - CRUD helpers for create / update-limit / delete with ownership checks (category must belong to the user; budget must belong to the user) and the plan-limit gate.
- **Budgets server functions (new)** — thin `createServerFn` wrappers with `inputValidator` schemas: get overview (input: month), create budget (category, currency, limit), update limit (id, limit), delete budget (id). They authenticate, validate, call the server module, and return `{ success, data }` or `{ error, code? }`. Create and update fire `evaluateBudgetAlerts` fire-and-forget with logged errors.
- **Billing module (modified)** — `Entitlements` gains `maxBudgets` (null = unlimited for Pro; free value from env config, default 3). New `checkBudgetLimit(userId)` mirroring `checkAccountLimit`: counts existing Budgets, blocks creation at the limit with code `budget_limit_reached` and the numeric limit for localised UI messaging. Existing Budgets above the limit are never locked. Count-then-insert race is accepted for consistency with accounts.
- **Env config (modified)** — new free-plan max budgets setting alongside the free max accounts setting.
- **Spending write paths (modified)** — after a successful manual transaction create/update and after an import commit, fire `evaluateBudgetAlerts(userId, now)` fire-and-forget with `.catch` logging, matching the password-change-notice pattern. Other write paths (categorisation rules/AI, receipts, category moves/reassignments) are covered by the hourly sweep.
- **Maintenance loop (modified)** — the hourly in-process loop also runs `evaluateAllBudgetAlerts`. Failures are logged and never stop the compliance sweep (and vice versa).
- **Test sweep route (modified)** — the TEST_MODE-only sweep endpoint also runs the budget alert evaluation so E2E tests can trigger the hourly path deterministically.
- **Categories (modified)** — category deletion also deletes Budgets (and their alert rows) on the deleted category and all its descendants, inside the same operation. The category list/delete flow exposes how many Budgets would be removed so the confirmation dialog can warn.
- **Compliance (modified)** — data export includes Budgets and budget alerts (JSON and per-table CSV); account hard-deletion deletes both inside the existing deletion transaction, before categories.
- **Email (unchanged API)** — alerts go through the existing `sendEmail` abstraction; subject and body are Paraglide messages with parameters (category name, formatted limit and spent with currency, month, link to the Budgets page built from the configured base URL).
- **Budgets route (new, authenticated)** — uses TanStack Query per project conventions: module-level query key including the month; `useServerFn` + `useQuery` for the overview; `useMutation` for create/update/delete, invalidating the budgets query on success and handling `{ error }` results. Transaction and import mutations elsewhere also invalidate the budgets query key so totals stay fresh.
- **Sidebar (modified)** — "Budgets" nav item placed after Categories.
- **Messages (modified)** — all new UI strings, errors, the upsell text, the verify-email hint and the alert email added to the English catalogue and compiled.

### UI behaviour

- Card list: category name + currency, edit and delete actions, progress bar, "spent / limit currency", and either "X left" or "X over".
- Over budget: red bar capped at 100% width, "Over budget" badge with icon.
- No near-limit (e.g. 80%) warning.
- Add/edit dialog: indented category tree picker, currency picker (currencies in use by the user's accounts, PLN fallback), limit input parsed with the shared money parser, inline validation errors. Edit dialog shows category and currency read-only.
- Empty state with explanation and "Add budget".
- Free user at limit: "Add budget" disabled with upgrade message linking to Billing.
- Verify-email hint when the user isn't eligible for alerts.

### API contracts (shape)

- Overview input: `{ month: "YYYY-MM" }` (validated). Output: `{ budgets: BudgetStatus[], alertsEnabled: boolean, limit: { max: number | null, used: number } }`.
- Create input: `{ categoryId, currency, limitMinor }`; errors: validation, category not found, duplicate (category, currency), `budget_limit_reached` with `limit`.
- Update input: `{ id, limitMinor }`; errors: validation, not found.
- Delete input: `{ id }`; errors: not found.

## Testing Decisions

### What makes a good test here

- Test external behaviour through the agreed seams, not internals: feed real rows into the in-memory database and assert on the returned overview / captured emails / database alert rows. No mocking of the database or of internal helpers.
- Time is controlled by passing `now` / `month`, never by faking clocks globally.
- Every E2E test uses its own fresh user via the existing fixtures and unique names, so the suite stays parallel-safe.

### Unit seam — budgets server module (in-memory PGlite, node environment)

Prior art: the analytics server tests (direct import of the server module, real SQL against PGlite).

- Spending attribution: negative only; positive amounts ignored; receipt items to own category across branches; uncategorised items and remainder to the transaction's category; items exceeding the transaction not capped; uncategorised transactions count nowhere.
- Rollup: parent includes children and grandchildren; nested Budgets tracked independently; moving a subcategory changes rollup.
- Currency: only matching-currency accounts count.
- Month boundaries: first and last day of month included, adjacent months excluded.
- Over budget: equal-to-limit is not over; remaining / over amounts; sort order.
- Ownership: another user's transactions and categories never count; another user's Budget can't be read, updated or deleted.
- Alerts: sends once when over; second evaluation sends nothing; dip-under-and-over again sends nothing; concurrent evaluations send exactly one; send failure releases the claim and a later run sends; ineligible users (no email, unverified, deletion pending) get nothing and no claim, then get the alert after becoming eligible; late Spending in a past month sends nothing; month-boundary window covers both months around the turn of the month.

### Unit — billing and compliance (existing test files)

Prior art: the billing tests and compliance tests.

- `checkBudgetLimit`: free blocks at 3 with `budget_limit_reached`; Pro unlimited; downgrade keeps existing Budgets usable.
- Export contains Budgets and budget alerts; hard deletion removes both.

### E2E seam — Playwright through the real UI

Prior art: the categories, billing, compliance and account-lifecycle specs; fixtures `signedInUser` / `unauthUser`; TEST_MODE routes for plan override, captured emails and the sweep.

- Navigation: Budgets link in the sidebar reaches the page.
- Empty state, then create a Budget; it shows limit, spent, left.
- Validation errors: empty/zero/invalid limit; duplicate (category, currency).
- Edit limit; delete with confirmation.
- Parent Budget includes subcategory Spending; refunds don't reduce spent.
- Over-budget display: badge, "X over".
- Free plan: 4th Budget blocked with upgrade message; Pro (via plan override) can create a 4th.
- Alert after adding a transaction that pushes over; no second alert after another over-limit transaction.
- Alert via the sweep route for an indirect cause (e.g. lowering limit / recategorisation).
- Unverified-email hint shown and no email sent.
- Deleting a budgeted category warns about Budgets and removes them; existing category-deletion flows still pass.
- Data export includes Budgets.

### Required gate

`pnpm run check` (typecheck, lint, unit, E2E) must pass after each ticket.

## Out of Scope

- Browsing past or future months; per-month limit history.
- Currency conversion or multi-currency Budgets (ADR-0002).
- Aligning the dashboard Sankey with receipt-item attribution (ADR-0001) — left unchanged.
- Near-limit (e.g. 80%) warnings or any notification other than the over-budget email.
- Budgets on "uncategorised" Spending.
- Rollover of unused budget into the next month.
- Weekly / yearly / custom budget periods.
- Per-user timezone settings.
- Exposing Budgets via MCP.
- Changing a Budget's category or currency in place.
- Locking Budgets above the free-plan limit after a downgrade.

## Further Notes

- Known accepted gaps: the count-then-insert race on the free-plan limit (same as accounts); a process crash between claiming and sending an alert loses that month's alert for that Budget.
- Around the turn of the month the alert window spans two months (~26h), so an alert for the previous month can still go out a few hours into a far-east user's new month.
- The Budgets page and the Sankey can show different per-category totals for itemised receipts by design (ADR-0001).
- `CONTEXT.md` is the glossary for this feature; keep it free of implementation details and update it if the language changes.
