import { and, asc, eq, gte, inArray, lt, sql, type SQLWrapper } from "drizzle-orm";
import { db, schema } from "#/db";
import { formatMoney } from "#/lib/money";
import { m } from "#/paraglide/messages";
import { sendEmail, type EmailMessage } from "#/server/email";
import { env } from "#/server/env";
import { getLogger } from "#/server/logger";
import { ownedEntityExists } from "#/server/ownership.server";

//
// Budgets: monthly Spending limits per category and currency. Vocabulary
// (Spending, Budget, Budget month, Over budget, Over-budget alert) is defined
// in CONTEXT.md; currency semantics in ADR-0002. Imported only from budgets.functions.ts
// handlers and unit tests — never from route components.

// --- Types ---

export interface BudgetStatus {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string | null;
  currency: string;
  /** All amounts are integer minor units (grosze/cents). */
  limitMinor: number;
  spentMinor: number;
  /** What's left; 0 once over budget. */
  remainingMinor: number;
  /** How far over the limit; 0 while within budget. */
  overMinor: number;
  isOverBudget: boolean;
  /** Spent as a rounded percentage of the limit (may exceed 100). */
  percentUsed: number;
}

export interface BudgetOverview {
  budgets: BudgetStatus[];
  /** Currencies offered when creating a Budget (account currencies, PLN fallback). */
  currencies: string[];
  /** Whether Over-budget alerts can reach the user (drives the verify-email hint). */
  alertsEnabled: boolean;
}

/** Matches the accounts.currency column default. */
const DEFAULT_CURRENCY = "PLN";

export interface CreateBudgetInput {
  categoryId: string;
  currency: string;
  limitMinor: number;
}

export type CreateBudgetResult =
  | { success: true; data: { id: string } }
  | {
      error: string;
      code: "category_not_found" | "budget_duplicate";
    };

// --- Budget month ---

/** First day of the Budget month and first day of the following month. */
function monthBounds(month: string): { from: string; to: string } {
  const [year, mon] = month.split("-").map(Number);
  const next = mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, "0")}`;
  return { from: `${month}-01`, to: `${next}-01` };
}

// --- Spending ---

/**
 * Spending in the Budget month keyed by `${categoryId}|${currency}`, using
 * the Attributed category rule (CONTEXT.md, ADR-0001): each categorised
 * receipt item counts toward its own category; uncategorised items and any
 * amount the items don't cover count toward the transaction's category.
 * Item totals are not capped at the transaction amount.
 */
async function spendingByCategoryAndCurrency(
  userId: string,
  month: string,
): Promise<Map<string, number>> {
  const { from, to } = monthBounds(month);
  const monthSpending = and(
    eq(schema.transactions.user_id, userId),
    gte(schema.transactions.date, from),
    lt(schema.transactions.date, to),
    sql`${schema.transactions.amount_minor} < 0`,
  );
  const transactions = await db
    .select({
      id: schema.transactions.id,
      categoryId: schema.transactions.category_id,
      currency: schema.accounts.currency,
      amountMinor: schema.transactions.amount_minor,
    })
    .from(schema.transactions)
    .innerJoin(
      schema.accounts,
      eq(schema.transactions.account_id, schema.accounts.id),
    )
    .where(monthSpending);

  // A subquery rather than a list of ids: no bind-parameter limit to hit.
  const itemsByTransaction = await receiptItemsByTransaction(
    userId,
    db
      .select({ id: schema.transactions.id })
      .from(schema.transactions)
      .where(monthSpending),
  );

  const spending = new Map<string, number>();
  const add = (categoryId: string | null, currency: string | null, minor: number) => {
    // Uncategorised Spending counts toward no Budget.
    if (!categoryId || minor <= 0) return;
    const key = `${categoryId}|${currency}`;
    spending.set(key, (spending.get(key) ?? 0) + minor);
  };

  for (const txn of transactions) {
    const spent = -txn.amountMinor;
    const items = itemsByTransaction.get(txn.id) ?? [];
    let toTransactionCategory = spent;
    for (const item of items) {
      if (item.categoryId) {
        add(item.categoryId, txn.currency, item.totalPriceMinor);
        toTransactionCategory -= item.totalPriceMinor;
      }
    }
    // Uncategorised items stay in toTransactionCategory, as does the
    // uncovered remainder; a negative remainder (items exceed the
    // transaction) adds nothing.
    add(txn.categoryId, txn.currency, toTransactionCategory);
  }
  return spending;
}

/** Receipt items of the given transactions, grouped by transaction id. */
async function receiptItemsByTransaction(
  userId: string,
  transactionIds: SQLWrapper,
): Promise<Map<string, { categoryId: string | null; totalPriceMinor: number }[]>> {
  const grouped = new Map<
    string,
    { categoryId: string | null; totalPriceMinor: number }[]
  >();
  const rows = await db
    .select({
      transactionId: schema.receipts.transaction_id,
      categoryId: schema.receipt_items.category_id,
      totalPriceMinor: schema.receipt_items.total_price_minor,
    })
    .from(schema.receipt_items)
    .innerJoin(
      schema.receipts,
      eq(schema.receipt_items.receipt_id, schema.receipts.id),
    )
    .where(
      and(
        eq(schema.receipts.user_id, userId),
        inArray(schema.receipts.transaction_id, transactionIds),
      ),
    );
  for (const row of rows) {
    if (!row.transactionId) continue;
    grouped.set(row.transactionId, [...(grouped.get(row.transactionId) ?? []), row]);
  }
  return grouped;
}

/** Each category id mapped to itself plus all its descendants (any depth). */
async function categorySubtrees(userId: string): Promise<Map<string, string[]>> {
  const rows = await db
    .select({
      id: schema.categories.id,
      parentId: schema.categories.parent_id,
    })
    .from(schema.categories)
    .where(eq(schema.categories.user_id, userId));

  const children = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    children.set(row.parentId, [...(children.get(row.parentId) ?? []), row.id]);
  }

  const subtrees = new Map<string, string[]>();
  for (const row of rows) {
    const ids: string[] = [];
    // Category updates reject cycles, but guard anyway so bad data can't hang.
    const seen = new Set<string>();
    const stack = [row.id];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      stack.push(...(children.get(id) ?? []));
    }
    subtrees.set(row.id, ids);
  }
  return subtrees;
}

// --- Overview ---

export async function getBudgetOverview(
  userId: string,
  month: string,
): Promise<BudgetOverview> {
  const [budgets, currencies, alertRecipient] = await Promise.all([
    budgetStatuses(userId, month),
    accountCurrencies(userId),
    alertRecipientOf(userId),
  ]);
  return { budgets, currencies, alertsEnabled: alertRecipient !== null };
}

/** Every Budget's status in the Budget month, problems first. */
async function budgetStatuses(
  userId: string,
  month: string,
): Promise<BudgetStatus[]> {
  const budgetRows = await db
    .select({
      id: schema.budgets.id,
      categoryId: schema.budgets.category_id,
      categoryName: schema.categories.name,
      categoryColor: schema.categories.color,
      currency: schema.budgets.currency,
      limitMinor: schema.budgets.limit_minor,
    })
    .from(schema.budgets)
    .innerJoin(
      schema.categories,
      eq(schema.budgets.category_id, schema.categories.id),
    )
    .where(eq(schema.budgets.user_id, userId));

  const [spending, subtrees] = await Promise.all([
    spendingByCategoryAndCurrency(userId, month),
    categorySubtrees(userId),
  ]);

  const budgets = budgetRows.map((row): BudgetStatus => {
    const spentMinor = (subtrees.get(row.categoryId) ?? [row.categoryId]).reduce(
      (sum, categoryId) => sum + (spending.get(`${categoryId}|${row.currency}`) ?? 0),
      0,
    );
    return {
      ...row,
      spentMinor,
      remainingMinor: Math.max(0, row.limitMinor - spentMinor),
      overMinor: Math.max(0, spentMinor - row.limitMinor),
      isOverBudget: spentMinor > row.limitMinor,
      percentUsed: Math.round((spentMinor / row.limitMinor) * 100),
    };
  });

  // Problems first: over-budget Budgets, then the most-used ones.
  budgets.sort(
    (a, b) =>
      Number(b.isOverBudget) - Number(a.isOverBudget) ||
      b.spentMinor / b.limitMinor - a.spentMinor / a.limitMinor ||
      a.categoryName.localeCompare(b.categoryName),
  );

  return budgets;
}

/** Currencies a new Budget can use: those of the user's accounts. */
async function accountCurrencies(userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ currency: schema.accounts.currency })
    .from(schema.accounts)
    .where(eq(schema.accounts.user_id, userId))
    .orderBy(asc(schema.accounts.currency));
  const currencies = rows.flatMap((r) => (r.currency ? [r.currency] : []));
  return currencies.length > 0 ? currencies : [DEFAULT_CURRENCY];
}

// --- Mutations ---

export async function createBudget(
  userId: string,
  input: CreateBudgetInput,
): Promise<CreateBudgetResult> {
  if (!(await ownedEntityExists("category", userId, input.categoryId))) {
    return { error: "Category not found", code: "category_not_found" };
  }

  // The (user, category, currency) unique index is the duplicate guard —
  // also under concurrent creates.
  const inserted = await db
    .insert(schema.budgets)
    .values({
      id: crypto.randomUUID(),
      user_id: userId,
      category_id: input.categoryId,
      currency: input.currency,
      limit_minor: input.limitMinor,
    })
    .onConflictDoNothing()
    .returning({ id: schema.budgets.id });
  if (inserted.length === 0) {
    return {
      error: "A budget for this category and currency already exists",
      code: "budget_duplicate",
    };
  }
  return { success: true, data: { id: inserted[0].id } };
}

export type BudgetMutationResult =
  | { success: true }
  | { error: string; code: "budget_not_found" };

/** Ownership in the same query: another user's Budget reads as not found. */
function ownedBudget(userId: string, budgetId: string) {
  return and(
    eq(schema.budgets.id, budgetId),
    eq(schema.budgets.user_id, userId),
  );
}

const BUDGET_NOT_FOUND = {
  error: "Budget not found",
  code: "budget_not_found",
} as const;

/** Change a Budget's limit. Category and currency are fixed at creation. */
export async function updateBudgetLimit(
  userId: string,
  budgetId: string,
  limitMinor: number,
): Promise<BudgetMutationResult> {
  const updated = await db
    .update(schema.budgets)
    .set({ limit_minor: limitMinor })
    .where(ownedBudget(userId, budgetId))
    .returning({ id: schema.budgets.id });
  return updated.length > 0 ? { success: true } : BUDGET_NOT_FOUND;
}

export async function deleteBudget(
  userId: string,
  budgetId: string,
): Promise<BudgetMutationResult> {
  // Its alert history goes with it (ON DELETE CASCADE).
  const deleted = await db
    .delete(schema.budgets)
    .where(ownedBudget(userId, budgetId))
    .returning({ id: schema.budgets.id });
  return deleted.length > 0 ? { success: true } : BUDGET_NOT_FOUND;
}

// --- Over-budget alerts ---

const HOUR_MS = 60 * 60 * 1000;

/**
 * Budget months that are current somewhere on Earth at `now` — from UTC−12
 * to UTC+14. One month, or two around the turn of a month. Only these can
 * trigger an Over-budget alert; late Spending in a past month sends nothing.
 */
function monthsCurrentSomewhere(now: Date): string[] {
  const monthOf = (t: number) => new Date(t).toISOString().slice(0, 7);
  return [
    ...new Set([
      monthOf(now.getTime() - 12 * HOUR_MS),
      monthOf(now.getTime() + 14 * HOUR_MS),
    ]),
  ];
}

/**
 * The address Over-budget alerts go to: a verified email with no account
 * deletion pending — never a possibly mistyped address, never someone who
 * asked to leave. Null when the user can't receive alerts.
 */
async function alertRecipientOf(userId: string): Promise<string | null> {
  const [user] = await db
    .select({
      email: schema.users.email,
      emailVerifiedAt: schema.users.email_verified_at,
      deletionRequestedAt: schema.users.deletion_requested_at,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user?.email || !user.emailVerifiedAt || user.deletionRequestedAt) {
    return null;
  }
  return user.email;
}

function formatMonthForEmail(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  return new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function budgetAlertEmail(
  to: string,
  budget: BudgetStatus,
  month: string,
): EmailMessage {
  return {
    to,
    subject: m.email_budget_alert_subject({ category: budget.categoryName }),
    text: m.email_budget_alert_body({
      category: budget.categoryName,
      month: formatMonthForEmail(month),
      spent: formatMoney(budget.spentMinor, budget.currency),
      limit: formatMoney(budget.limitMinor, budget.currency),
      link: `${env.email.baseUrl}/budgets`,
    }),
  };
}

/**
 * Send the Over-budget alerts due at `now`: one per over-budget Budget per
 * current Budget month, ever. Idempotent and safe to run concurrently — each
 * alert is claimed through the (budget, month) unique index before sending,
 * and only the claim's winner sends. A failed send releases the claim so a
 * later evaluation retries. Users who can't receive alerts are skipped
 * without claiming anything, so the alert still goes out once they can.
 */
export async function evaluateBudgetAlerts(
  userId: string,
  now: Date,
  { send = sendEmail }: { send?: (message: EmailMessage) => Promise<void> } = {},
): Promise<void> {
  const recipient = await alertRecipientOf(userId);
  if (!recipient) return;

  for (const month of monthsCurrentSomewhere(now)) {
    const budgets = await budgetStatuses(userId, month);
    for (const budget of budgets.filter((b) => b.isOverBudget)) {
      const claimed = await db
        .insert(schema.budget_alerts)
        .values({
          id: crypto.randomUUID(),
          user_id: userId,
          budget_id: budget.id,
          month,
        })
        .onConflictDoNothing()
        .returning({ id: schema.budget_alerts.id });
      if (claimed.length === 0) continue;

      try {
        await send(budgetAlertEmail(recipient, budget, month));
      } catch (error) {
        const log = getLogger().child({ userId, budgetId: budget.id, month });
        log.error({ err: error }, "failed to send over-budget alert");
        // Release the claim so a later evaluation retries. If even that
        // fails, the alert is lost for this month — but the remaining
        // Budgets are still evaluated.
        await db
          .delete(schema.budget_alerts)
          .where(eq(schema.budget_alerts.id, claimed[0].id))
          .catch((releaseError) =>
            log.error({ err: releaseError }, "failed to release over-budget alert claim"),
          );
      }
    }
  }
}

/**
 * Fire-and-forget `evaluateBudgetAlerts` after a user action that may push a
 * Budget over: the action never waits for, or fails because of, the alert.
 */
export function checkBudgetAlertsInBackground(userId: string): void {
  void evaluateBudgetAlerts(userId, new Date()).catch((error) =>
    getLogger().error({ err: error, userId }, "over-budget alert check failed"),
  );
}
