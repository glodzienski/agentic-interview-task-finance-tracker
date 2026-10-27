import { test, expect, type Page } from "./fixtures";


// Budgets measure the current Budget month in the browser's local time, so
// test transactions are dated today. Each test gets its own seeded user
// (default categories + a "Main" PLN account), so names never collide.

function today(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

async function addTransaction(
  page: Page,
  opts: {
    description: string;
    amount: string;
    category: string;
    isIncome?: boolean;
  },
) {
  await page.goto("/transactions");
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Add Transaction" })
    .click();
  const modal = page.getByRole("dialog", { name: "New Transaction" });
  await modal.getByLabel("Date").fill(`${today()}T12:00`);
  await modal.getByLabel("Description").fill(opts.description);
  await modal
    .getByRole("spinbutton", { name: "Amount", exact: true })
    .fill(opts.amount);
  await modal.getByLabel("Account").selectOption("Main (PLN)");
  await modal.getByLabel("Category").selectOption(opts.category);
  if (opts.isIncome) {
    await modal.getByLabel("Income").check();
  }
  await modal.getByRole("button", { name: "Create Transaction" }).click();
  await expect(modal).toBeHidden();
  await expect(page.getByText(opts.description)).toBeVisible();
}

async function openNewBudgetDialog(page: Page) {
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Add Budget" })
    .click();
  const dialog = page.getByRole("dialog", { name: "New Budget" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function addBudget(page: Page, category: string, limit: string) {
  await page.goto("/budgets");
  const dialog = await openNewBudgetDialog(page);
  await dialog.getByLabel("Category").selectOption(category);
  await dialog.getByLabel("Monthly limit").fill(limit);
  await dialog.getByRole("button", { name: "Create Budget" }).click();
  await expect(dialog).toBeHidden();
}

function budgetCard(page: Page, category: string) {
  return page
    .getByTestId("budget-card")
    .filter({ has: page.getByRole("heading", { name: category }) });
}

test.describe("Budgets", () => {
  test.beforeEach(async ({ page, signedInUser: _signedInUser }) => {
    await page.goto("/budgets");
  });

  test("is reachable from the sidebar and starts empty", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Budgets" }).click();

    await expect(page).toHaveURL("/budgets");
    await expect(
      page.getByRole("heading", { name: "Budgets", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("No budgets yet")).toBeVisible();
    await expect(
      page.getByRole("main").getByRole("button", { name: "Add Budget" }),
    ).toBeVisible();
  });

  test("creates a Budget showing limit, spent and what's left", async ({
    page,
  }) => {
    await addBudget(page, "Housing", "1000");

    const card = budgetCard(page, "Housing");
    await expect(card.getByTestId("budget-spent")).toHaveText(
      "0.00 PLN of 1000.00 PLN",
    );
    await expect(card.getByTestId("budget-remaining")).toHaveText(
      "1000.00 PLN left",
    );
    await expect(card.getByText("Over budget")).toBeHidden();
    await expect(page.getByText("No budgets yet")).toBeHidden();
  });

  test("rejects a missing category and an invalid limit", async ({ page }) => {
    await page.goto("/budgets");
    const dialog = await openNewBudgetDialog(page);

    await dialog.getByLabel("Monthly limit").fill("100");
    await dialog.getByRole("button", { name: "Create Budget" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Choose a category");

    await dialog.getByLabel("Category").selectOption("Transport");
    for (const invalid of ["", "0", "-5", "abc"]) {
      await dialog.getByLabel("Monthly limit").fill(invalid);
      await dialog.getByRole("button", { name: "Create Budget" }).click();
      await expect(dialog.getByRole("alert")).toHaveText(
        "Enter a limit greater than 0",
      );
    }
    await expect(dialog).toBeVisible();
  });

  test("rejects a duplicate Budget for the same category and currency", async ({
    page,
  }) => {
    await addBudget(page, "Health", "300");

    const dialog = await openNewBudgetDialog(page);
    await dialog.getByLabel("Category").selectOption("Health");
    await dialog.getByLabel("Monthly limit").fill("500");
    await dialog.getByRole("button", { name: "Create Budget" }).click();

    await expect(dialog.getByRole("alert")).toHaveText(
      "You already have a budget for this category in this currency.",
    );
    await expect(page.getByTestId("budget-card")).toHaveCount(1);
  });

  test("includes subcategory Spending and ignores refunds", async ({
    page,
  }) => {
    await addBudget(page, "Groceries", "500");
    await addTransaction(page, {
      description: "Veg market",
      amount: "120",
      category: "— Vegetables",
    });
    await addTransaction(page, {
      description: "Corner shop",
      amount: "30.50",
      category: "Groceries",
    });
    await addTransaction(page, {
      description: "Shop refund",
      amount: "50",
      category: "Groceries",
      isIncome: true,
    });

    await page.goto("/budgets");
    const card = budgetCard(page, "Groceries");
    await expect(card.getByTestId("budget-spent")).toHaveText(
      "150.50 PLN of 500.00 PLN",
    );
    await expect(card.getByTestId("budget-remaining")).toHaveText(
      "349.50 PLN left",
    );
  });

  test("deleting a budgeted category still works and removes its Budget", async ({
    page,
  }) => {
    await addBudget(page, "Transfers", "200");
    await expect(budgetCard(page, "Transfers")).toBeVisible();

    await page.goto("/categories");
    await page
      .getByTestId("category-row")
      .filter({ hasText: "Transfers" })
      .getByTestId("delete-category")
      .click();
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(
      page.getByTestId("category-row").filter({ hasText: "Transfers" }),
    ).toBeHidden();

    await page.goto("/budgets");
    await expect(page.getByText("No budgets yet")).toBeVisible();
  });

  test("clearly shows when a Budget is over budget", async ({ page }) => {
    await addBudget(page, "Entertainment", "100");
    await addTransaction(page, {
      description: "Concert tickets",
      amount: "150",
      category: "Entertainment",
    });

    await page.goto("/budgets");
    const card = budgetCard(page, "Entertainment");
    await expect(card.getByText("Over budget")).toBeVisible();
    await expect(card.getByTestId("budget-remaining")).toHaveText(
      "50.00 PLN over",
    );
    await expect(
      card.getByRole("progressbar", { name: "Entertainment budget used" }),
    ).toHaveAttribute("aria-valuenow", "100");
  });
});
