// @vitest-environment node
// Required: TanStack Start's import protection mocks server modules in jsdom (client) environment.
// Running in node environment ensures the real server logic executes against the in-memory DB.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db, schema } from "../src/db/index.ts";
import { hardDeleteUser } from "../src/server/compliance.server.ts";
import {
  createBudget,
  getBudgetOverview,
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
const insertTransaction = (
  accountId: string,
  categoryId: string | null,
  amountMinor: number,
  date: string,
  owner = userId,
) =>
  db.insert(schema.transactions).values({
    id: `budgets-txn-${++txnSeq}`,
    user_id: owner,
    account_id: accountId,
    category_id: categoryId,
    amount_minor: amountMinor,
    date,
  });

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
