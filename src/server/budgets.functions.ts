import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUserId } from "#/server/session";
import {
  checkBudgetAlertsInBackground,
  createBudget as createBudgetForUser,
  deleteBudget as deleteBudgetForUser,
  getBudgetOverview as getBudgetOverviewForUser,
  updateBudgetLimit as updateBudgetLimitForUser,
} from "#/server/budgets.server";


// Budget month as computed in the browser's local time (see CONTEXT.md).
const monthRegex = /^\d{4}-(0[1-9]|1[0-2])$/;
const currencyRegex = /^[A-Z]{3}$/;

const getBudgetOverviewSchema = z.object({
  month: z.string().regex(monthRegex, "Month must be YYYY-MM"),
});

// Integer minor units; the column is a 32-bit integer.
const limitMinorSchema = z.number().int().positive().max(2_147_483_647);

const createBudgetSchema = z.object({
  categoryId: z.string().min(1),
  currency: z
    .string()
    .regex(currencyRegex, "Currency must be a 3-letter ISO code (e.g. PLN, USD)"),
  limitMinor: limitMinorSchema,
});

const updateBudgetLimitSchema = z.object({
  id: z.string().min(1),
  limitMinor: limitMinorSchema,
});

const deleteBudgetSchema = z.object({
  id: z.string().min(1),
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
    const result = await createBudgetForUser(userId, data);
    if ("success" in result) checkBudgetAlertsInBackground(userId);
    return result;
  });

export const updateBudgetLimit = createServerFn({ method: "POST" })
  .inputValidator(updateBudgetLimitSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    const result = await updateBudgetLimitForUser(userId, data.id, data.limitMinor);
    if ("success" in result) checkBudgetAlertsInBackground(userId);
    return result;
  });

export const deleteBudget = createServerFn({ method: "POST" })
  .inputValidator(deleteBudgetSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return deleteBudgetForUser(userId, data.id);
  });
