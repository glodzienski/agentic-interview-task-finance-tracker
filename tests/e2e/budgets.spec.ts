import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "./fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));


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

  test("edits only the limit, moving into and out of over budget", async ({
    page,
  }) => {
    await addBudget(page, "Transport", "200");
    await addTransaction(page, {
      description: "Train pass",
      amount: "150",
      category: "Transport",
    });
    await page.goto("/budgets");
    const card = budgetCard(page, "Transport");
    await expect(card.getByTestId("budget-remaining")).toHaveText(
      "50.00 PLN left",
    );

    await card.getByRole("button", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit Budget" });
    await expect(dialog.getByLabel("Category")).toHaveValue("Transport");
    await expect(dialog.getByLabel("Category")).toBeDisabled();
    await expect(dialog.getByLabel("Currency")).toHaveValue("PLN");
    await expect(dialog.getByLabel("Currency")).toBeDisabled();
    await expect(dialog.getByLabel("Monthly limit")).toHaveValue("200.00");

    await dialog.getByLabel("Monthly limit").fill("100");
    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(dialog).toBeHidden();
    await expect(card.getByText("Over budget")).toBeVisible();
    await expect(card.getByTestId("budget-remaining")).toHaveText(
      "50.00 PLN over",
    );

    await card.getByRole("button", { name: "Edit" }).click();
    await dialog.getByLabel("Monthly limit").fill("400,50");
    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(dialog).toBeHidden();
    await expect(card.getByText("Over budget")).toBeHidden();
    await expect(card.getByTestId("budget-spent")).toHaveText(
      "150.00 PLN of 400.50 PLN",
    );
  });

  test("rejects an invalid limit when editing", async ({ page }) => {
    await addBudget(page, "Housing", "900");

    await budgetCard(page, "Housing").getByRole("button", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit Budget" });
    await dialog.getByLabel("Monthly limit").fill("0");
    await dialog.getByRole("button", { name: "Save Changes" }).click();

    await expect(dialog.getByRole("alert")).toHaveText(
      "Enter a limit greater than 0",
    );
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(
      budgetCard(page, "Housing").getByTestId("budget-spent"),
    ).toHaveText("0.00 PLN of 900.00 PLN");
  });

  test("removes a Budget only after confirming", async ({ page }) => {
    await addBudget(page, "Health", "300");
    const card = budgetCard(page, "Health");

    await card.getByRole("button", { name: "Delete" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Delete Budget" });
    await expect(confirm).toContainText("Remove the Health (PLN) budget?");
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toBeHidden();
    await expect(card).toBeVisible();

    await card.getByRole("button", { name: "Delete" }).click();
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(confirm).toBeHidden();
    await expect(card).toBeHidden();
    await expect(page.getByText("No budgets yet")).toBeVisible();
  });

  test("editing a Budget deleted in another tab says it no longer exists", async ({
    page,
    context,
  }) => {
    await addBudget(page, "Housing", "800");
    await budgetCard(page, "Housing")
      .getByRole("button", { name: "Edit" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Edit Budget" });

    const otherTab = await context.newPage();
    await otherTab.goto("/budgets");
    await budgetCard(otherTab, "Housing")
      .getByRole("button", { name: "Delete" })
      .click();
    await otherTab
      .getByRole("alertdialog", { name: "Delete Budget" })
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(otherTab.getByText("No budgets yet")).toBeVisible();

    await dialog.getByLabel("Monthly limit").fill("900");
    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "This budget no longer exists.",
    );
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("No budgets yet")).toBeVisible();
  });

  test("deleting a Budget already deleted in another tab just clears it", async ({
    page,
    context,
  }) => {
    await addBudget(page, "Health", "250");

    const otherTab = await context.newPage();
    await otherTab.goto("/budgets");
    await budgetCard(otherTab, "Health")
      .getByRole("button", { name: "Delete" })
      .click();
    await otherTab
      .getByRole("alertdialog", { name: "Delete Budget" })
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(otherTab.getByText("No budgets yet")).toBeVisible();

    await budgetCard(page, "Health")
      .getByRole("button", { name: "Delete" })
      .click();
    const confirm = page.getByRole("alertdialog", { name: "Delete Budget" });
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByText("No budgets yet")).toBeVisible();
  });

  test("keeps the Budget and shows an error when deleting fails", async ({
    page,
  }) => {
    await addBudget(page, "Transport", "120");
    const card = budgetCard(page, "Transport");
    await card.getByRole("button", { name: "Delete" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Delete Budget" });

    // Fail the delete server-function call (the only POST from here on).
    await page.route("**/_serverFn/**", (route) =>
      route.request().method() === "POST" ? route.abort() : route.continue(),
    );
    await confirm.getByRole("button", { name: "Delete" }).click();

    await expect(confirm.getByRole("alert")).toHaveText(
      "Could not delete the budget. Please try again.",
    );
    await page.unroute("**/_serverFn/**");
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(card).toBeVisible();
  });

  test("deleting a category warns about and removes Budgets on it and its subcategories", async ({
    page,
  }) => {
    await addBudget(page, "Groceries", "500");
    await addBudget(page, "— Vegetables", "100");
    await addBudget(page, "Transport", "200");

    await page.goto("/categories");
    await page
      .getByTestId("category-row")
      .filter({ hasText: /^Groceries/ })
      .first()
      .getByTestId("delete-category")
      .click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm.getByTestId("delete-removes-budgets")).toHaveText(
      "This will also remove 2 budget(s) on this category and its sub-categories.",
    );
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(confirm).toBeHidden();

    await page.goto("/budgets");
    await expect(page.getByTestId("budget-card")).toHaveCount(1);
    await expect(budgetCard(page, "Transport")).toBeVisible();
  });

  test("deleting a category without Budgets shows no Budget warning", async ({
    page,
  }) => {
    await addBudget(page, "Transport", "200");

    await page.goto("/categories");
    await page
      .getByTestId("category-row")
      .filter({ hasText: /^Housing/ })
      .first()
      .getByTestId("delete-category")
      .click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toBeVisible();
    await expect(confirm.getByTestId("delete-removes-budgets")).toBeHidden();
  });

  test("reassigning a deleted category's transactions does not move its Budget", async ({
    page,
  }) => {
    await addBudget(page, "Health", "300");
    await addTransaction(page, {
      description: "Pharmacy run",
      amount: "40",
      category: "Health",
    });

    await page.goto("/categories");
    await page
      .getByTestId("category-row")
      .filter({ hasText: /^Health/ })
      .first()
      .getByTestId("delete-category")
      .click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm.getByTestId("delete-removes-budgets")).toBeVisible();
    await confirm.getByLabel("Reassign transactions to").selectOption("Housing");
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(confirm).toBeHidden();

    await page.goto("/budgets");
    await expect(page.getByText("No budgets yet")).toBeVisible();
  });

  test("counts scanned receipt items toward their own categories' Budgets", async ({
    page,
  }) => {
    // The fake AI scan yields Product A (21.00, Alcohol) and Product B
    // (15.99, Vegetables) — both under Groceries. Linked to a 36.99 expense
    // filed under Transport, the items move that Spending to Groceries.
    await addBudget(page, "— Vegetables", "100");
    await addBudget(page, "Groceries", "100");
    await addBudget(page, "Transport", "100");
    await addTransaction(page, {
      description: "Hypermarket",
      amount: "36.99",
      category: "Transport",
    });

    await page.goto("/receipts/scan");
    await page
      .getByTestId("file-input")
      .setInputFiles(
        path.join(__dirname, "fixtures", "images", "receipt-test.png"),
      );
    await expect(page.getByText("Matching transaction found")).toBeVisible();
    await expect(
      page.getByTestId("item-category-0").locator("option:checked"),
    ).toHaveText("Alcohol");
    await expect(
      page.getByTestId("item-category-1").locator("option:checked"),
    ).toHaveText("Vegetables");
    await page.getByTestId("save-receipt-btn").click();
    await expect(page.getByText("Receipt saved successfully!")).toBeVisible();

    await page.goto("/budgets");
    await expect(
      budgetCard(page, "Vegetables").getByTestId("budget-spent"),
    ).toHaveText("15.99 PLN of 100.00 PLN");
    await expect(
      budgetCard(page, "Groceries").getByTestId("budget-spent"),
    ).toHaveText("36.99 PLN of 100.00 PLN");
    await expect(
      budgetCard(page, "Transport").getByTestId("budget-spent"),
    ).toHaveText("0.00 PLN of 100.00 PLN");
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

// Free plan: up to 3 Budgets. Plans are switched with the TEST_MODE
// /test-set-plan override, which writes what a verified webhook would.
test.describe("Budgets plan limit", () => {
  const FREE_CATEGORIES = ["Housing", "Health", "Shopping"];

  test.beforeEach(async ({ page, signedInUser: _signedInUser }) => {
    await page.goto("/budgets");
  });

  function addBudgetButton(page: Page) {
    return page.getByRole("banner").getByRole("button", { name: "Add Budget" });
  }

  test("disables Add Budget at 3 Budgets on the free plan and links to Billing", async ({
    page,
  }) => {
    for (const category of FREE_CATEGORIES.slice(0, 2)) {
      await addBudget(page, category, "100");
    }
    await expect(addBudgetButton(page)).toBeEnabled();
    await expect(page.getByTestId("budget-limit-hint")).toBeHidden();

    await addBudget(page, FREE_CATEGORIES[2], "100");
    await expect(page.getByTestId("budget-card")).toHaveCount(3);
    await expect(addBudgetButton(page)).toBeDisabled();
    const hint = page.getByTestId("budget-limit-hint");
    await expect(hint).toHaveText("Free plan: 3 budgets — Upgrade to Pro");

    await hint.getByRole("link", { name: /Upgrade to Pro/ }).click();
    await expect(page).toHaveURL("/billing");
  });

  test("rejects a 4th Budget created from a stale page", async ({ page }) => {
    for (const category of FREE_CATEGORIES.slice(0, 2)) {
      await addBudget(page, category, "100");
    }
    // Open the dialog while the page still shows 2 Budgets…
    const dialog = await openNewBudgetDialog(page);

    // …then fill the last free slot from another tab of the same session.
    const otherTab = await page.context().newPage();
    await addBudget(otherTab, FREE_CATEGORIES[2], "100");
    await otherTab.close();

    await dialog.getByLabel("Category").selectOption("Entertainment");
    await dialog.getByLabel("Monthly limit").fill("100");
    await dialog.getByRole("button", { name: "Create Budget" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "The free plan is limited to 3 budgets. Upgrade to Pro for unlimited budgets.",
    );
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByTestId("budget-card")).toHaveCount(3);
    await expect(budgetCard(page, "Entertainment")).toBeHidden();
    await expect(addBudgetButton(page)).toBeDisabled();
  });

  test("lets Pro users create more than 3 Budgets", async ({ page }) => {
    expect((await page.request.post("/test-set-plan?plan=pro")).ok()).toBe(true);

    for (const category of [...FREE_CATEGORIES, "Entertainment"]) {
      await addBudget(page, category, "100");
    }
    await expect(page.getByTestId("budget-card")).toHaveCount(4);
    await expect(addBudgetButton(page)).toBeEnabled();
    await expect(page.getByTestId("budget-limit-hint")).toBeHidden();
  });

  test("keeps every Budget working after a downgrade, blocking only new ones", async ({
    page,
  }) => {
    expect((await page.request.post("/test-set-plan?plan=pro")).ok()).toBe(true);
    for (const category of [...FREE_CATEGORIES, "Entertainment"]) {
      await addBudget(page, category, "100");
    }
    expect(
      (await page.request.post("/test-set-plan?plan=free&status=canceled")).ok(),
    ).toBe(true);

    await addTransaction(page, {
      description: "Cinema night",
      amount: "150",
      category: "Entertainment",
    });
    await page.goto("/budgets");
    await expect(page.getByTestId("budget-card")).toHaveCount(4);
    const entertainment = budgetCard(page, "Entertainment");
    await expect(entertainment.getByText("Over budget")).toBeVisible();
    await expect(addBudgetButton(page)).toBeDisabled();
    await expect(page.getByTestId("budget-limit-hint")).toBeVisible();

    // Still editable above the limit.
    await entertainment.getByRole("button", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit Budget" });
    await dialog.getByLabel("Monthly limit").fill("200");
    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(dialog).toBeHidden();
    await expect(entertainment.getByTestId("budget-remaining")).toHaveText(
      "50.00 PLN left",
    );

    // Deleting down to 3 is still at the limit; below it, creating is back.
    const confirm = page.getByRole("alertdialog", { name: "Delete Budget" });
    const remove = async (category: string) => {
      await budgetCard(page, category).getByRole("button", { name: "Delete" }).click();
      await confirm.getByRole("button", { name: "Delete" }).click();
      await expect(confirm).toBeHidden();
      await expect(budgetCard(page, category)).toBeHidden();
    };
    await remove("Housing");
    await expect(page.getByTestId("budget-card")).toHaveCount(3);
    await expect(addBudgetButton(page)).toBeDisabled();
    await remove("Health");
    await expect(page.getByTestId("budget-card")).toHaveCount(2);
    await expect(addBudgetButton(page)).toBeEnabled();
    await expect(page.getByTestId("budget-limit-hint")).toBeHidden();
  });
});
