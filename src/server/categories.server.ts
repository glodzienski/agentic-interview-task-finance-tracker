import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "#/db";
import { deleteBudgetsForCategories } from "#/server/budgets.server";
import { ownedEntityExists } from "#/server/ownership.server";

//
// Category logic shared by categories.functions.ts handlers and unit tests —
// never imported from route components.

export interface DeleteCategoryInput {
  id: string;
  reassignToCategoryId?: string | null;
}

export type DeleteCategoryResult = { success: true } | { error: string };

/**
 * Delete a category with all its descendants. Their transactions are
 * reassigned (or left uncategorised), receipt items uncategorised, and
 * rules and Budgets on them removed.
 */
export async function deleteCategoryForUser(
  userId: string,
  data: DeleteCategoryInput,
): Promise<DeleteCategoryResult> {
  // Ownership first: every write below is scoped to ids derived from a
  // category this user owns, so a foreign id must stop here.
  if (!(await ownedEntityExists("category", userId, data.id))) {
    return { error: "Category not found" };
  }

  // The target plus all its descendants (children, grandchildren, etc.)
  const allIdsToDelete = [data.id];
  for (let i = 0; i < allIdsToDelete.length; i++) {
    const children = await db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(
        and(
          eq(schema.categories.parent_id, allIdsToDelete[i]),
          eq(schema.categories.user_id, userId),
        ),
      );
    for (const child of children) {
      if (!allIdsToDelete.includes(child.id)) allIdsToDelete.push(child.id);
    }
  }

  if (data.reassignToCategoryId) {
    if (allIdsToDelete.includes(data.reassignToCategoryId)) {
      return {
        error: "Cannot reassign transactions to the category being deleted",
      };
    }
    if (!(await ownedEntityExists("category", userId, data.reassignToCategoryId))) {
      return { error: "Reassignment target category does not exist" };
    }
  }

  // One transaction: Budgets, rules and reassignments must never be removed
  // or applied without the categories themselves going too.
  await db.transaction(async (tx) => {
    await tx
      .update(schema.transactions)
      .set({ category_id: data.reassignToCategoryId ?? null })
      .where(
        and(
          inArray(schema.transactions.category_id, allIdsToDelete),
          eq(schema.transactions.user_id, userId),
        ),
      );

    // receipt_items has no user_id — scope through the user's receipts.
    await tx
      .update(schema.receipt_items)
      .set({ category_id: null })
      .where(
        and(
          inArray(schema.receipt_items.category_id, allIdsToDelete),
          inArray(
            schema.receipt_items.receipt_id,
            tx
              .select({ id: schema.receipts.id })
              .from(schema.receipts)
              .where(eq(schema.receipts.user_id, userId)),
          ),
        ),
      );

    await tx
      .delete(schema.categorization_rules)
      .where(
        and(
          inArray(schema.categorization_rules.category_id, allIdsToDelete),
          eq(schema.categorization_rules.user_id, userId),
        ),
      );

    // Budgets go with their categories (alert history cascades) — they
    // never follow reassigned transactions (see CONTEXT.md, Budget).
    await deleteBudgetsForCategories(userId, allIdsToDelete, tx);

    await tx
      .delete(schema.categories)
      .where(
        and(inArray(schema.categories.id, allIdsToDelete), eq(schema.categories.user_id, userId)),
      );
  });

  return { success: true };
}
