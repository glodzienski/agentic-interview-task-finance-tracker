// @vitest-environment node
// Required: TanStack Start's import protection mocks server modules in jsdom (client) environment.
// Running in node environment ensures the real server logic executes against the in-memory DB.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/db/index.ts";
import { hardDeleteUser } from "../src/server/compliance.server.ts";
import { deleteCategoryForUser } from "../src/server/categories.server.ts";

const userId = "categories-test-user";
const otherUserId = "categories-other-user";

const insertCategory = (id: string, parentId: string | null, owner: string) =>
  db
    .insert(schema.categories)
    .values({ id, user_id: owner, name: id, parent_id: parentId });

const insertBudget = (id: string, categoryId: string, owner: string) =>
  db.insert(schema.budgets).values({
    id,
    user_id: owner,
    category_id: categoryId,
    currency: "PLN",
    limit_minor: 1000,
  });

const categoryIds = async (owner: string) =>
  (
    await db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(eq(schema.categories.user_id, owner))
  ).map((r) => r.id);

const budgetIds = async (owner: string) =>
  (
    await db
      .select({ id: schema.budgets.id })
      .from(schema.budgets)
      .where(eq(schema.budgets.user_id, owner))
  ).map((r) => r.id);

beforeEach(async () => {
  for (const id of [userId, otherUserId]) {
    await db.insert(schema.users).values({ id, username: id, password_hash: "x" });
  }
});

afterEach(async () => {
  await hardDeleteUser(userId);
  await hardDeleteUser(otherUserId);
});

describe("deleting a category", () => {
  it("removes the category, its descendants and every Budget on them", async () => {
    await insertCategory("food", null, userId);
    await insertCategory("restaurants", "food", userId);
    await insertCategory("sushi", "restaurants", userId);
    await insertCategory("transport", null, userId);
    await insertBudget("b-food", "food", userId);
    await insertBudget("b-sushi", "sushi", userId);
    await insertBudget("b-transport", "transport", userId);

    expect(await deleteCategoryForUser(userId, { id: "food" })).toEqual({
      success: true,
    });

    expect(await categoryIds(userId)).toEqual(["transport"]);
    expect(await budgetIds(userId)).toEqual(["b-transport"]);
  });

  it("removes the alert history of the Budgets it removes", async () => {
    await insertCategory("food", null, userId);
    await insertBudget("b-food", "food", userId);
    await db.insert(schema.budget_alerts).values({
      id: "alert-food",
      user_id: userId,
      budget_id: "b-food",
      month: "2026-10",
    });

    expect(await deleteCategoryForUser(userId, { id: "food" })).toEqual({
      success: true,
    });

    const alerts = await db
      .select({ id: schema.budget_alerts.id })
      .from(schema.budget_alerts)
      .where(eq(schema.budget_alerts.user_id, userId));
    expect(alerts).toHaveLength(0);
  });

  it("treats another user's category as not found and changes nothing of theirs", async () => {
    await insertCategory("theirs", null, otherUserId);
    await insertBudget("b-theirs", "theirs", otherUserId);
    await db.insert(schema.categorization_rules).values({
      id: "rule-theirs",
      user_id: otherUserId,
      pattern: "coffee",
      category_id: "theirs",
    });

    expect(await deleteCategoryForUser(userId, { id: "theirs" })).toMatchObject({
      error: "Category not found",
    });

    expect(await categoryIds(otherUserId)).toEqual(["theirs"]);
    expect(await budgetIds(otherUserId)).toEqual(["b-theirs"]);
    const rules = await db
      .select({ id: schema.categorization_rules.id })
      .from(schema.categorization_rules)
      .where(eq(schema.categorization_rules.user_id, otherUserId));
    expect(rules).toHaveLength(1);
  });

  it("rejects reassigning to a sub-category that is being deleted, changing nothing", async () => {
    await insertCategory("food", null, userId);
    await insertCategory("restaurants", "food", userId);
    await insertBudget("b-food", "food", userId);

    expect(
      await deleteCategoryForUser(userId, {
        id: "food",
        reassignToCategoryId: "restaurants",
      }),
    ).toMatchObject({
      error: "Cannot reassign transactions to the category being deleted",
    });

    expect((await categoryIds(userId)).sort()).toEqual(["food", "restaurants"]);
    expect(await budgetIds(userId)).toEqual(["b-food"]);
  });
});
