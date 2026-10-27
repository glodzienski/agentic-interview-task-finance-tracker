import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUserId } from "#/server/session";
import {
  createBudget as createBudgetForUser,
  getBudgetOverview as getBudgetOverviewForUser,
} from "#/server/budgets.server";


// Budget month as computed in the browser's local time (see CONTEXT.md).
const monthRegex = /^\d{4}-(0[1-9]|1[0-2])$/;
const currencyRegex = /^[A-Z]{3}$/;

const getBudgetOverviewSchema = z.object({
  month: z.string().regex(monthRegex, "Month must be YYYY-MM"),
});

const createBudgetSchema = z.object({
  categoryId: z.string().min(1),
  currency: z
    .string()
    .regex(currencyRegex, "Currency must be a 3-letter ISO code (e.g. PLN, USD)"),
  // Integer minor units; the column is a 32-bit integer.
  limitMinor: z.number().int().positive().max(2_147_483_647),
});

export const getBudgetOverview = createServerFn({ method: "GET" })
  .inputValidator(getBudgetOverviewSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return getBudgetOverviewForUser(userId, data.month);
  });

export const createBudget = createServerFn({ method: "POST" })
  .inputValidator(createBudgetSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return createBudgetForUser(userId, data);
  });
