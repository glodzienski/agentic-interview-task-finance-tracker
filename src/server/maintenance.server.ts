import { evaluateAllBudgetAlerts } from "#/server/budgets.server";
import { runComplianceSweep } from "#/server/compliance.server";
import { env } from "#/server/env";
import { getLogger } from "#/server/logger";

//
// In-process scheduler for the hourly maintenance pass: the compliance sweep
// plus Over-budget alert evaluation for every user with Budgets. There is no
// external job runner — the loop is armed lazily by the first request (see
// start.ts) and re-runs hourly. TEST_MODE never arms it: E2E tests trigger
// the pass deterministically through /test-run-sweep instead.

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

type ComplianceSweepResult = Awaited<ReturnType<typeof runComplianceSweep>>;
type BudgetAlertsResult = Awaited<ReturnType<typeof evaluateAllBudgetAlerts>>;

/**
 * One maintenance pass. The two jobs are isolated: a failure in one is
 * logged (its result is null) and never stops the other. The compliance
 * sweep runs first so accounts it hard-deletes aren't evaluated for alerts.
 */
export async function runMaintenancePass(
  now: Date = new Date(),
  {
    complianceSweep = runComplianceSweep,
    budgetAlerts = evaluateAllBudgetAlerts,
  }: {
    complianceSweep?: (now: Date) => Promise<ComplianceSweepResult>;
    budgetAlerts?: (now: Date) => Promise<BudgetAlertsResult>;
  } = {},
): Promise<{
  compliance: ComplianceSweepResult | null;
  budgetAlerts: BudgetAlertsResult | null;
}> {
  const log = getLogger();
  const compliance = await complianceSweep(now).catch((error) => {
    log.error({ err: error }, "compliance sweep failed");
    return null;
  });
  const budgetAlertsResult = await budgetAlerts(now).catch((error) => {
    log.error({ err: error }, "budget alert evaluation failed");
    return null;
  });
  return { compliance, budgetAlerts: budgetAlertsResult };
}

let armed = false;

export function ensureMaintenanceLoop(): void {
  if (armed) return;
  armed = true;
  if (env.isTestMode) return;

  // runMaintenancePass never rejects — each job logs its own failure.
  const pass = () => void runMaintenancePass();
  pass();
  // unref: the timer must never keep a shutting-down server process alive.
  setInterval(pass, SWEEP_INTERVAL_MS).unref();
}
