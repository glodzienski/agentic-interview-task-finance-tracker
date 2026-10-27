import { createFileRoute } from "@tanstack/react-router";
import { runMaintenancePass } from "#/server/maintenance.server";

// Test-only endpoint: runs one maintenance pass — the compliance sweep
// (expired account deletions + ai_raw_response retention) and Over-budget
// alert evaluation for every user with Budgets — synchronously so E2E tests
// can observe its effects deterministically; the real hourly loop is
// disarmed in TEST_MODE. Only enabled when TEST_MODE=1.
export const Route = createFileRoute("/test-run-sweep")({
  server: {
    handlers: {
      POST: async () => {
        if (process.env.TEST_MODE !== "1") {
          return new Response("Not available", { status: 404 });
        }
        const result = await runMaintenancePass();
        // A failed job is logged and null; surface it as a 500 so E2E
        // tests fail at the sweep, not later with a confusing assertion.
        const failed = result.compliance === null || result.budgetAlerts === null;
        return Response.json(result, { status: failed ? 500 : 200 });
      },
    },
  },
});
