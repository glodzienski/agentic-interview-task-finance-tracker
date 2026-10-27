import type { APIRequestContext } from "@playwright/test";
import { test, expect, type Page } from "./fixtures";

//
// Over-budget alert emails after direct actions. Emails are captured in
// memory by the TEST_MODE email provider and read back via /test-emails,
// filtered by each test's unique recipient so the suite stays parallel.
// Seeded users get default categories and a "Main" PLN account; their email
// is `${username}@example.com`.

type CapturedEmail = { to: string; subject: string; text: string };

const ALERT_SUBJECT = "Over budget:";

async function alertEmails(
  request: APIRequestContext,
  to: string,
): Promise<CapturedEmail[]> {
  const res = await request.get(`/test-emails?to=${encodeURIComponent(to)}`);
  const { emails } = (await res.json()) as { emails: CapturedEmail[] };
  return emails.filter((e) => e.subject.startsWith(ALERT_SUBJECT));
}

/**
 * The alert check is fire-and-forget, so a "nothing more was sent" assertion
 * can only wait a moment and look; one second is ample for the in-memory DB.
 */
async function expectAlertCountToStay(
  request: APIRequestContext,
  to: string,
  count: number,
) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  expect(await alertEmails(request, to)).toHaveLength(count);
}

// Transactions are dated today: the current Budget month in local time.
function today(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

async function addTransaction(
  page: Page,
  opts: { description: string; amount: string; category: string },
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
  await modal.getByRole("button", { name: "Create Transaction" }).click();
  await expect(modal).toBeHidden();
  await expect(page.getByText(opts.description)).toBeVisible();
}

async function addBudget(page: Page, category: string, limit: string) {
  await page.goto("/budgets");
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Add Budget" })
    .click();
  const dialog = page.getByRole("dialog", { name: "New Budget" });
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

test.describe("Over-budget alerts", () => {
  test("emails once when a transaction pushes a Budget over, and not again that month", async ({
    page,
    signedInUser,
    baseURL,
  }) => {
    const email = `${signedInUser.username}@example.com`;
    await addBudget(page, "Entertainment", "100");
    await addTransaction(page, {
      description: "Concert tickets",
      amount: "80",
      category: "Entertainment",
    });
    await expectAlertCountToStay(page.request, email, 0);

    await addTransaction(page, {
      description: "Cinema night",
      amount: "45.50",
      category: "Entertainment",
    });

    await expect
      .poll(async () => (await alertEmails(page.request, email)).length)
      .toBe(1);
    const [alert] = await alertEmails(page.request, email);
    expect(alert.subject).toContain("Entertainment");
    expect(alert.text).toContain("Spent: 125.50 PLN");
    expect(alert.text).toContain("Limit: 100.00 PLN");
    expect(alert.text).toContain(`${baseURL}/budgets`);

    await addTransaction(page, {
      description: "Bowling",
      amount: "30",
      category: "Entertainment",
    });
    await expectAlertCountToStay(page.request, email, 1);
  });

  test("emails when lowering a Budget's limit puts it over budget", async ({
    page,
    signedInUser,
  }) => {
    const email = `${signedInUser.username}@example.com`;
    await addBudget(page, "Transport", "200");
    await addTransaction(page, {
      description: "Train pass",
      amount: "150",
      category: "Transport",
    });

    await page.goto("/budgets");
    await budgetCard(page, "Transport").getByTestId("edit-budget").click();
    const dialog = page.getByRole("dialog", { name: "Edit Budget" });
    await dialog.getByLabel("Monthly limit").fill("100");
    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(dialog).toBeHidden();
    await expect(budgetCard(page, "Transport").getByText("Over budget")).toBeVisible();

    await expect
      .poll(async () => (await alertEmails(page.request, email)).length)
      .toBe(1);
    expect((await alertEmails(page.request, email))[0].subject).toContain(
      "Transport",
    );
  });

  test("a verified user sees no verify-email hint", async ({
    page,
    signedInUser: _signedInUser,
  }) => {
    await page.goto("/budgets");
    await expect(page.getByText("No budgets yet")).toBeVisible();
    await expect(page.getByRole("note")).toBeHidden();
  });

  test("an unverified user sees the verify-email hint and gets no alert", async ({
    page,
  }) => {
    const res = await page.request.post(
      "/test-create-user?seed=defaults&verified=false",
    );
    const { email } = (await res.json()) as { email: string };

    await page.goto("/budgets");
    await expect(page.getByRole("note")).toHaveText(
      "Over-budget alert emails are only sent to a verified email address. Verify your email to receive them.",
    );

    await addBudget(page, "Entertainment", "10");
    await addTransaction(page, {
      description: "Arcade",
      amount: "25",
      category: "Entertainment",
    });
    await expectAlertCountToStay(page.request, email, 0);
  });
});
