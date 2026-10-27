import { and, asc, eq, gte, inArray, lt, sql, type SQLWrapper } from "drizzle-orm";
import { db, schema } from "#/db";
import { ownedEntityExists } from "#/server/ownership.server";

//
// Budgets: monthly Spending limits per category and currency. Vocabulary
// (Spending, Budget, Budget month, Over budget) is defined in CONTEXT.md;
// currency semantics in ADR-0002. Imported only from budgets.functions.ts
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
  const attribute = (
    categoryId: string | null,
    currency: string | null,
    minor: number,
  ) => {
    // Uncategorised Spending counts toward no Budget.
    if (!categoryId || minor <= 0) return;
    const key = `${categoryId}|${currency}`;
    spending.set(key, (spending.get(key) ?? 0) + minor);
  };

  for (const txn of transactions) {
    const spent = -txn.amountMinor;
    const items = itemsByTransaction.get(txn.id) ?? [];
    let itemsTotal = 0;
    let uncategorisedItems = 0;
    for (const item of items) {
      itemsTotal += item.totalPriceMinor;
      if (item.categoryId) {
        attribute(item.categoryId, txn.currency, item.totalPriceMinor);
      } else {
        uncategorisedItems += item.totalPriceMinor;
      }
    }
    // The transaction's category gets its uncategorised items plus whatever
    // the items don't cover — never less because other items ran over.
    const uncovered = Math.max(0, spent - itemsTotal);
    attribute(txn.categoryId, txn.currency, uncategorisedItems + uncovered);
  }
  return spending;
}

interface AttributableItem {
  categoryId: string | null;
  totalPriceMinor: number;
}

/** Receipt items of the given transactions (all their receipts), by transaction id. */
async function receiptItemsByTransaction(
  userId: string,
  transactionIds: SQLWrapper,
): Promise<Map<string, AttributableItem[]>> {
  const grouped = new Map<string, AttributableItem[]>();
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
    const items = grouped.get(row.transactionId);
    if (items) items.push(row);
    else grouped.set(row.transactionId, [row]);
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

  return { budgets, currencies: await accountCurrencies(userId) };
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
  const deleted = await db
    .delete(schema.budgets)
    .where(ownedBudget(userId, budgetId))
    .returning({ id: schema.budgets.id });
  return deleted.length > 0 ? { success: true } : BUDGET_NOT_FOUND;
}
