// @vitest-environment node
// Required: TanStack Start's import protection mocks server modules in jsdom (client) environment.
// Running in node environment ensures the real server logic executes against the in-memory DB.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/db/index.ts";
import { getCapturedEmails } from "../src/server/email.ts";
import { hardDeleteUser } from "../src/server/compliance.server.ts";
import {
  createBudget,
  deleteBudget,
  evaluateBudgetAlerts,
  getBudgetOverview,
  updateBudgetLimit,
} from "../src/server/budgets.server.ts";

const userId = "budgets-test-user";
const otherUserId = "budgets-other-user";

async function insertUser(id: string) {
  await db
    .insert(schema.users)
    .values({ id, username: id, password_hash: "x" });
}

const insertAccount = (id: string, currency = "PLN", owner = userId) =>
  db
    .insert(schema.accounts)
    .values({ id, user_id: owner, name: id, currency });

const insertCategory = (
  id: string,
  parentId: string | null = null,
  owner = userId,
) =>
  db
    .insert(schema.categories)
    .values({ id, user_id: owner, name: id, parent_id: parentId });

let txnSeq = 0;
async function insertTransaction(
  accountId: string,
  categoryId: string | null,
  amountMinor: number,
  date: string,
  owner = userId,
) {
  const id = `budgets-txn-${++txnSeq}`;
  await db.insert(schema.transactions).values({
    id,
    user_id: owner,
    account_id: accountId,
    category_id: categoryId,
    amount_minor: amountMinor,
    date,
  });
  return id;
}

let receiptSeq = 0;
/** Attach a receipt with the given items (amount, category) to a transaction. */
async function insertReceipt(
  transactionId: string,
  items: Array<[totalPriceMinor: number, categoryId: string | null]>,
) {
  const receiptId = `budgets-rcpt-${++receiptSeq}`;
  await db.insert(schema.receipts).values({
    id: receiptId,
    user_id: userId,
    transaction_id: transactionId,
  });
  for (const [i, [totalPriceMinor, categoryId]] of items.entries()) {
    await db.insert(schema.receipt_items).values({
      id: `${receiptId}-item-${i}`,
      receipt_id: receiptId,
      name: `item ${i}`,
      total_price_minor: totalPriceMinor,
      category_id: categoryId,
    });
  }
}

async function budgetFor(categoryId: string, limitMinor: number, currency = "PLN") {
  const result = await createBudget(userId, { categoryId, currency, limitMinor });
  if ("error" in result) throw new Error(result.error);
  return result.data.id;
}

async function statusOf(budgetId: string, month = "2026-10") {
  const { budgets } = await getBudgetOverview(userId, month);
  const status = budgets.find((b) => b.id === budgetId);
  if (!status) throw new Error(`budget ${budgetId} not in overview`);
  return status;
}

beforeEach(async () => {
  await insertUser(userId);
  await insertUser(otherUserId);
  await insertAccount("pln-acc");
});

afterEach(async () => {
  await hardDeleteUser(userId);
  await hardDeleteUser(otherUserId);
});

describe("budget overview: Spending", () => {
  it("shows limit, Spending this month and what's left", async () => {
    await insertCategory("groceries");
    const id = await budgetFor("groceries", 100000);
    await insertTransaction("pln-acc", "groceries", -30000, "2026-10-05");
    await insertTransaction("pln-acc", "groceries", -12050, "2026-10-20");

    const status = await statusOf(id);
    expect(status).toMatchObject({
      categoryId: "groceries",
      currency: "PLN",
      limitMinor: 100000,
      spentMinor: 42050,
      remainingMinor: 57950,
      overMinor: 0,
      isOverBudget: false,
    });
  });

  it("includes Spending in descendant categories at any depth", async () => {
    await insertCategory("food");
    await insertCategory("restaurants", "food");
    await insertCategory("sushi", "restaurants");
    await insertCategory("transport");
    const id = await budgetFor("food", 100000);
    await insertTransaction("pln-acc", "food", -1000, "2026-10-01");
    await insertTransaction("pln-acc", "restaurants", -2000, "2026-10-02");
    await insertTransaction("pln-acc", "sushi", -4000, "2026-10-03");
    await insertTransaction("pln-acc", "transport", -8000, "2026-10-04");

    expect((await statusOf(id)).spentMinor).toBe(7000);
  });

  it("ignores income and refunds instead of netting them", async () => {
    await insertCategory("shopping");
    const id = await budgetFor("shopping", 100000);
    await insertTransaction("pln-acc", "shopping", -50000, "2026-10-10");
    await insertTransaction("pln-acc", "shopping", 20000, "2026-10-12");

    expect((await statusOf(id)).spentMinor).toBe(50000);
  });

  it("counts only accounts in the Budget's currency", async () => {
    await insertAccount("eur-acc", "EUR");
    await insertCategory("groceries");
    const plnId = await budgetFor("groceries", 100000, "PLN");
    const eurId = await budgetFor("groceries", 20000, "EUR");
    await insertTransaction("pln-acc", "groceries", -30000, "2026-10-10");
    await insertTransaction("eur-acc", "groceries", -5000, "2026-10-11");

    expect((await statusOf(plnId)).spentMinor).toBe(30000);
    expect((await statusOf(eurId)).spentMinor).toBe(5000);
  });

  it("counts only the Budget month, first and last day included", async () => {
    await insertCategory("groceries");
    const id = await budgetFor("groceries", 100000);
    await insertTransaction("pln-acc", "groceries", -100, "2026-09-30");
    await insertTransaction("pln-acc", "groceries", -200, "2026-10-01");
    await insertTransaction("pln-acc", "groceries", -400, "2026-10-31");
    await insertTransaction("pln-acc", "groceries", -800, "2026-11-01");

    expect((await statusOf(id, "2026-10")).spentMinor).toBe(600);
  });

  it("starts each Budget month at zero, across a year boundary", async () => {
    await insertCategory("groceries");
    const id = await budgetFor("groceries", 100000);
    await insertTransaction("pln-acc", "groceries", -100, "2026-12-31");
    await insertTransaction("pln-acc", "groceries", -200, "2027-01-01");

    expect((await statusOf(id, "2026-12")).spentMinor).toBe(100);
    expect((await statusOf(id, "2027-01")).spentMinor).toBe(200);
  });

  it("never counts another user's Spending or shows their Budgets", async () => {
    await insertCategory("groceries");
    await insertAccount("other-acc", "PLN", otherUserId);
    await insertCategory("other-groceries", null, otherUserId);
    const id = await budgetFor("groceries", 100000);
    await createBudget(otherUserId, {
      categoryId: "other-groceries",
      currency: "PLN",
      limitMinor: 100,
    });
    await insertTransaction("other-acc", "other-groceries", -9999, "2026-10-10", otherUserId);

    const { budgets } = await getBudgetOverview(userId, "2026-10");
    expect(budgets.map((b) => b.id)).toEqual([id]);
    expect(budgets[0].spentMinor).toBe(0);
  });
});

describe("budget overview: over budget", () => {
  it("is not over budget when Spending equals the limit", async () => {
    await insertCategory("groceries");
    const id = await budgetFor("groceries", 50000);
    await insertTransaction("pln-acc", "groceries", -50000, "2026-10-10");

    expect(await statusOf(id)).toMatchObject({
      remainingMinor: 0,
      overMinor: 0,
      isOverBudget: false,
      percentUsed: 100,
    });
  });

  it("reports how far over when Spending exceeds the limit", async () => {
    await insertCategory("restaurants");
    const id = await budgetFor("restaurants", 50000);
    await insertTransaction("pln-acc", "restaurants", -62000, "2026-10-10");

    expect(await statusOf(id)).toMatchObject({
      spentMinor: 62000,
      remainingMinor: 0,
      overMinor: 12000,
      isOverBudget: true,
      percentUsed: 124,
    });
  });

  it("lists over-budget Budgets first, then by percentage used", async () => {
    for (const name of ["low", "high", "over-small", "over-big"]) {
      await insertCategory(name);
    }
    const low = await budgetFor("low", 10000);
    const high = await budgetFor("high", 10000);
    const overSmall = await budgetFor("over-small", 10000);
    const overBig = await budgetFor("over-big", 10000);
    await insertTransaction("pln-acc", "low", -1000, "2026-10-10");
    await insertTransaction("pln-acc", "high", -9000, "2026-10-10");
    await insertTransaction("pln-acc", "over-small", -11000, "2026-10-10");
    await insertTransaction("pln-acc", "over-big", -30000, "2026-10-10");

    const { budgets } = await getBudgetOverview(userId, "2026-10");
    expect(budgets.map((b) => b.id)).toEqual([overBig, overSmall, high, low]);
  });
});

describe("creating a Budget", () => {
  it("rejects a category that belongs to another user", async () => {
    await insertCategory("not-mine", null, otherUserId);

    const result = await createBudget(userId, {
      categoryId: "not-mine",
      currency: "PLN",
      limitMinor: 1000,
    });
    expect(result).toMatchObject({ code: "category_not_found" });
    expect((await getBudgetOverview(userId, "2026-10")).budgets).toHaveLength(0);
  });

  it("rejects a second Budget for the same category and currency", async () => {
    await insertCategory("groceries");
    await budgetFor("groceries", 1000, "PLN");

    const duplicate = await createBudget(userId, {
      categoryId: "groceries",
      currency: "PLN",
      limitMinor: 2000,
    });
    expect(duplicate).toMatchObject({ code: "budget_duplicate" });

    const otherCurrency = await createBudget(userId, {
      categoryId: "groceries",
      currency: "EUR",
      limitMinor: 2000,
    });
    expect(otherCurrency).toMatchObject({ success: true });
  });

  it("allows nested Budgets on a parent and its subcategory", async () => {
    await insertCategory("food");
    await insertCategory("restaurants", "food");
    const food = await budgetFor("food", 200000);
    const restaurants = await budgetFor("restaurants", 50000);
    await insertTransaction("pln-acc", "restaurants", -60000, "2026-10-10");

    expect(await statusOf(restaurants)).toMatchObject({ isOverBudget: true });
    expect(await statusOf(food)).toMatchObject({
      spentMinor: 60000,
      isOverBudget: false,
    });
  });
});

describe("budget overview: currencies", () => {
  it("offers the currencies the user's accounts use", async () => {
    await insertAccount("eur-acc", "EUR");
    await insertAccount("pln-acc-2", "PLN");

    const { currencies } = await getBudgetOverview(userId, "2026-10");
    expect(currencies).toEqual(["EUR", "PLN"]);
  });

  it("falls back to PLN when the user has no accounts", async () => {
    const { currencies } = await getBudgetOverview(otherUserId, "2026-10");
    expect(currencies).toEqual(["PLN"]);
  });
});

describe("editing a Budget's limit", () => {
  it("changes only the limit, recomputing what's left", async () => {
    await insertCategory("groceries");
    const id = await budgetFor("groceries", 50000);
    await insertTransaction("pln-acc", "groceries", -40000, "2026-10-10");

    expect(await updateBudgetLimit(userId, id, 30000)).toEqual({ success: true });
    expect(await statusOf(id)).toMatchObject({
      categoryId: "groceries",
      currency: "PLN",
      limitMinor: 30000,
      isOverBudget: true,
      overMinor: 10000,
    });

    await updateBudgetLimit(userId, id, 60000);
    expect(await statusOf(id)).toMatchObject({
      isOverBudget: false,
      remainingMinor: 20000,
    });
  });

  it("treats another user's Budget as not found", async () => {
    await insertCategory("other-groceries", null, otherUserId);
    const theirs = await createBudget(otherUserId, {
      categoryId: "other-groceries",
      currency: "PLN",
      limitMinor: 1000,
    });
    if ("error" in theirs) throw new Error(theirs.error);

    expect(await updateBudgetLimit(userId, theirs.data.id, 1)).toMatchObject({
      code: "budget_not_found",
    });
    const { budgets } = await getBudgetOverview(otherUserId, "2026-10");
    expect(budgets[0].limitMinor).toBe(1000);
  });

  it("reports a missing Budget as not found", async () => {
    expect(await updateBudgetLimit(userId, "no-such-budget", 1000)).toMatchObject({
      code: "budget_not_found",
    });
  });
});

describe("removing a Budget", () => {
  it("removes it from the overview", async () => {
    await insertCategory("groceries");
    const id = await budgetFor("groceries", 50000);

    expect(await deleteBudget(userId, id)).toEqual({ success: true });
    expect((await getBudgetOverview(userId, "2026-10")).budgets).toHaveLength(0);
  });

  it("treats another user's Budget or a missing one as not found", async () => {
    await insertCategory("other-groceries", null, otherUserId);
    const theirs = await createBudget(otherUserId, {
      categoryId: "other-groceries",
      currency: "PLN",
      limitMinor: 1000,
    });
    if ("error" in theirs) throw new Error(theirs.error);

    expect(await deleteBudget(userId, theirs.data.id)).toMatchObject({
      code: "budget_not_found",
    });
    expect(await deleteBudget(userId, "no-such-budget")).toMatchObject({
      code: "budget_not_found",
    });
    expect((await getBudgetOverview(otherUserId, "2026-10")).budgets).toHaveLength(1);
  });
});

describe("budget overview: receipt items (ADR-0001)", () => {
  beforeEach(async () => {
    await insertCategory("groceries");
    await insertCategory("household");
  });

  it("counts each categorised item toward its own category, the rest toward the transaction's", async () => {
    const groceries = await budgetFor("groceries", 100000);
    const household = await budgetFor("household", 100000);
    const txn = await insertTransaction("pln-acc", "groceries", -20000, "2026-10-10");
    // 150 food + 30 toaster + 5 uncategorised = 185; 15 not covered by items.
    await insertReceipt(txn, [
      [15000, "groceries"],
      [3000, "household"],
      [500, null],
    ]);

    expect((await statusOf(household)).spentMinor).toBe(3000);
    expect((await statusOf(groceries)).spentMinor).toBe(17000);
  });

  it("counts an item toward its category even in another branch of the tree", async () => {
    await insertCategory("home");
    await insertCategory("appliances", "home");
    const home = await budgetFor("home", 100000);
    const txn = await insertTransaction("pln-acc", "groceries", -5000, "2026-10-10");
    await insertReceipt(txn, [[2000, "appliances"]]);

    expect((await statusOf(home)).spentMinor).toBe(2000);
  });

  it("counts items in full when they add up to more than the transaction", async () => {
    const groceries = await budgetFor("groceries", 100000);
    const household = await budgetFor("household", 100000);
    const txn = await insertTransaction("pln-acc", "groceries", -1000, "2026-10-10");
    await insertReceipt(txn, [
      [800, "household"],
      [700, "groceries"],
    ]);

    expect((await statusOf(household)).spentMinor).toBe(800);
    expect((await statusOf(groceries)).spentMinor).toBe(700);
  });

  it("counts only the items of an uncategorised transaction", async () => {
    const household = await budgetFor("household", 100000);
    const groceries = await budgetFor("groceries", 100000);
    const txn = await insertTransaction("pln-acc", null, -9000, "2026-10-10");
    await insertReceipt(txn, [
      [2500, "household"],
      [1000, null],
    ]);

    expect((await statusOf(household)).spentMinor).toBe(2500);
    expect((await statusOf(groceries)).spentMinor).toBe(0);
  });

  it("counts a transaction whose receipt has no items toward its own category", async () => {
    const groceries = await budgetFor("groceries", 100000);
    const txn = await insertTransaction("pln-acc", "groceries", -4200, "2026-10-10");
    await insertReceipt(txn, []);

    expect((await statusOf(groceries)).spentMinor).toBe(4200);
  });

  it("ignores receipt items on income and refunds", async () => {
    const household = await budgetFor("household", 100000);
    const refund = await insertTransaction("pln-acc", "groceries", 3000, "2026-10-10");
    await insertReceipt(refund, [[3000, "household"]]);

    expect((await statusOf(household)).spentMinor).toBe(0);
  });

  it("applies the Budget's currency and month to receipt items too", async () => {
    await insertAccount("eur-acc", "EUR");
    const household = await budgetFor("household", 100000);
    const eurTxn = await insertTransaction("eur-acc", "groceries", -5000, "2026-10-10");
    await insertReceipt(eurTxn, [[5000, "household"]]);
    const lastMonth = await insertTransaction("pln-acc", "groceries", -5000, "2026-09-30");
    await insertReceipt(lastMonth, [[5000, "household"]]);

    expect((await statusOf(household)).spentMinor).toBe(0);
  });
});

describe("over-budget alerts", () => {
  // 2026-10-15 12:00 UTC: mid-month, so only October is current anywhere.
  const midOctober = new Date("2026-10-15T12:00:00Z");
  let emailSeq = 0;
  let email: string;

  /** Give the test user a fresh, unique email so captured mail doesn't mix. */
  async function setEmail(verified = true, deletionRequested = false) {
    email = `budgets-alert-${++emailSeq}-${Date.now()}@example.com`;
    await db
      .update(schema.users)
      .set({
        email,
        email_verified_at: verified ? new Date() : null,
        deletion_requested_at: deletionRequested ? new Date() : null,
      })
      .where(eq(schema.users.id, userId));
  }

  const sentAlerts = () => getCapturedEmails(email);
  const alertRows = () =>
    db
      .select()
      .from(schema.budget_alerts)
      .where(eq(schema.budget_alerts.user_id, userId));

  beforeEach(async () => {
    await insertCategory("groceries");
    await setEmail();
  });

  it("emails once when a Budget goes over budget, naming category, limit, spent and month", async () => {
    await budgetFor("groceries", 10000);
    await insertTransaction("pln-acc", "groceries", -12550, "2026-10-10");

    await evaluateBudgetAlerts(userId, midOctober);

    const emails = sentAlerts();
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toContain("groceries");
    expect(emails[0].text).toContain("groceries");
    expect(emails[0].text).toContain("100.00 PLN");
    expect(emails[0].text).toContain("125.50 PLN");
    expect(emails[0].text).toContain("October 2026");
    expect(emails[0].text).toContain("/budgets");
    expect(await alertRows()).toMatchObject([{ month: "2026-10" }]);
  });

  it("sends nothing while Spending is within the limit, including exactly at it", async () => {
    await budgetFor("groceries", 10000);
    await insertTransaction("pln-acc", "groceries", -10000, "2026-10-10");

    await evaluateBudgetAlerts(userId, midOctober);

    expect(sentAlerts()).toHaveLength(0);
    expect(await alertRows()).toHaveLength(0);
  });

  it("sends nothing more that month for further over-limit Spending", async () => {
    await budgetFor("groceries", 10000);
    await insertTransaction("pln-acc", "groceries", -12000, "2026-10-10");
    await evaluateBudgetAlerts(userId, midOctober);
    await insertTransaction("pln-acc", "groceries", -5000, "2026-10-11");
    await evaluateBudgetAlerts(userId, midOctober);

    expect(sentAlerts()).toHaveLength(1);
  });

  it("sends nothing more after dipping under and going over again in the same month", async () => {
    const id = await budgetFor("groceries", 10000);
    await insertTransaction("pln-acc", "groceries", -12000, "2026-10-10");
    await evaluateBudgetAlerts(userId, midOctober);
    await updateBudgetLimit(userId, id, 20000);
    await evaluateBudgetAlerts(userId, midOctober);
    await updateBudgetLimit(userId, id, 10000);
    await evaluateBudgetAlerts(userId, midOctober);

    expect(sentAlerts()).toHaveLength(1);
  });

  it("alerts each over-budget Budget separately, and again in the next month", async () => {
    await insertCategory("transport");
    await budgetFor("groceries", 10000);
    await budgetFor("transport", 10000);
    await insertTransaction("pln-acc", "groceries", -12000, "2026-10-10");
    await insertTransaction("pln-acc", "transport", -12000, "2026-10-10");
    await evaluateBudgetAlerts(userId, midOctober);
    expect(sentAlerts()).toHaveLength(2);

    await insertTransaction("pln-acc", "groceries", -12000, "2026-11-10");
    await evaluateBudgetAlerts(userId, new Date("2026-11-15T12:00:00Z"));
    expect(sentAlerts()).toHaveLength(3);
  });

  it("sends exactly one email when evaluations run concurrently", async () => {
    await budgetFor("groceries", 10000);
    await insertTransaction("pln-acc", "groceries", -12000, "2026-10-10");

    await Promise.all([
      evaluateBudgetAlerts(userId, midOctober),
      evaluateBudgetAlerts(userId, midOctober),
      evaluateBudgetAlerts(userId, midOctober),
    ]);

    expect(sentAlerts()).toHaveLength(1);
    expect(await alertRows()).toHaveLength(1);
  });

  it("releases the claim when sending fails, so a later evaluation sends", async () => {
    await budgetFor("groceries", 10000);
    await insertTransaction("pln-acc", "groceries", -12000, "2026-10-10");

    await evaluateBudgetAlerts(userId, midOctober, {
      send: () => Promise.reject(new Error("provider down")),
    });
    expect(await alertRows()).toHaveLength(0);

    await evaluateBudgetAlerts(userId, midOctober);
    expect(sentAlerts()).toHaveLength(1);
    expect(await alertRows()).toHaveLength(1);
  });

  it.each([
    ["without an email", () => db.update(schema.users).set({ email: null }).where(eq(schema.users.id, userId))],
    ["with an unverified email", () => setEmail(false)],
    ["with deletion pending", () => setEmail(true, true)],
  ])("sends nothing and claims nothing for a user %s", async (_, makeIneligible) => {
    await budgetFor("groceries", 10000);
    await insertTransaction("pln-acc", "groceries", -12000, "2026-10-10");
    await makeIneligible();

    await evaluateBudgetAlerts(userId, midOctober);

    expect(sentAlerts()).toHaveLength(0);
    expect(await alertRows()).toHaveLength(0);
    expect((await getBudgetOverview(userId, "2026-10")).alertsEnabled).toBe(false);
  });

  it("sends the pending alert once the user verifies their email later in the month", async () => {
    await budgetFor("groceries", 10000);
    await insertTransaction("pln-acc", "groceries", -12000, "2026-10-10");
    await setEmail(false);
    await evaluateBudgetAlerts(userId, midOctober);
    expect(sentAlerts()).toHaveLength(0);

    await db
      .update(schema.users)
      .set({ email_verified_at: new Date() })
      .where(eq(schema.users.id, userId));
    await evaluateBudgetAlerts(userId, new Date("2026-10-20T12:00:00Z"));

    expect(sentAlerts()).toHaveLength(1);
    expect((await getBudgetOverview(userId, "2026-10")).alertsEnabled).toBe(true);
  });

  it("sends nothing when late Spending pushes a past month over budget", async () => {
    await budgetFor("groceries", 10000);
    await insertTransaction("pln-acc", "groceries", -12000, "2026-09-10");

    await evaluateBudgetAlerts(userId, midOctober);

    expect(sentAlerts()).toHaveLength(0);
  });

  it("around the turn of the month, covers both months current somewhere on Earth", async () => {
    await insertCategory("transport");
    await budgetFor("groceries", 10000);
    await budgetFor("transport", 10000);
    await insertTransaction("pln-acc", "groceries", -12000, "2026-10-31");
    await insertTransaction("pln-acc", "transport", -12000, "2026-11-01");

    // 2026-11-01 05:00 UTC: still October at UTC−12, already November in UTC.
    await evaluateBudgetAlerts(userId, new Date("2026-11-01T05:00:00Z"));

    expect((await alertRows()).map((r) => r.month).sort()).toEqual([
      "2026-10",
      "2026-11",
    ]);
  });

  it("treats a month as current once it has started in UTC+14", async () => {
    await budgetFor("groceries", 10000);
    await insertTransaction("pln-acc", "groceries", -12000, "2026-11-01");

    // 2026-10-31 09:00 UTC is 23:00 in UTC+14 — November hasn't started yet.
    await evaluateBudgetAlerts(userId, new Date("2026-10-31T09:00:00Z"));
    expect(sentAlerts()).toHaveLength(0);
    // 10:30 UTC is 00:30 on 1 November in UTC+14.
    await evaluateBudgetAlerts(userId, new Date("2026-10-31T10:30:00Z"));
    expect(sentAlerts()).toHaveLength(1);
  });

  it("never alerts on another user's Spending", async () => {
    await insertAccount("other-acc", "PLN", otherUserId);
    await insertCategory("other-groceries", null, otherUserId);
    await budgetFor("groceries", 10000);
    await insertTransaction("other-acc", "other-groceries", -50000, "2026-10-10", otherUserId);

    await evaluateBudgetAlerts(userId, midOctober);

    expect(sentAlerts()).toHaveLength(0);
  });

  it("deleting a Budget removes its alert history", async () => {
    const id = await budgetFor("groceries", 10000);
    await insertTransaction("pln-acc", "groceries", -12000, "2026-10-10");
    await evaluateBudgetAlerts(userId, midOctober);
    expect(await alertRows()).toHaveLength(1);

    await deleteBudget(userId, id);

    expect(await alertRows()).toHaveLength(0);
  });
});
