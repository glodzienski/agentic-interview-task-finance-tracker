// @vitest-environment node
// Required: TanStack Start's import protection mocks server modules in jsdom (client) environment.

import { describe, it, expect } from "vitest";
import { runMaintenancePass } from "../src/server/maintenance.server.ts";

const now = new Date("2026-10-15T12:00:00Z");
const complianceResult = { deletedUsers: 0, purgedAiResponses: 0 };
const budgetAlertsResult = { evaluatedUsers: 0, failedUsers: 0 };

describe("maintenance pass", () => {
  it("runs the compliance sweep, then the budget alert evaluation, both at `now`", async () => {
    const calls: [string, Date][] = [];
    const result = await runMaintenancePass(now, {
      complianceSweep: async (at) => (calls.push(["compliance", at]), complianceResult),
      budgetAlerts: async (at) => (calls.push(["budgetAlerts", at]), budgetAlertsResult),
    });

    expect(result).toEqual({
      compliance: complianceResult,
      budgetAlerts: budgetAlertsResult,
    });
    expect(calls).toEqual([
      ["compliance", now],
      ["budgetAlerts", now],
    ]);
  });

  it("still evaluates budget alerts when the compliance sweep fails", async () => {
    const result = await runMaintenancePass(now, {
      complianceSweep: () => Promise.reject(new Error("sweep broke")),
      budgetAlerts: async () => budgetAlertsResult,
    });

    expect(result).toEqual({ compliance: null, budgetAlerts: budgetAlertsResult });
  });

  it("still runs the compliance sweep when budget alert evaluation fails", async () => {
    const result = await runMaintenancePass(now, {
      complianceSweep: async () => complianceResult,
      budgetAlerts: () => Promise.reject(new Error("alerts broke")),
    });

    expect(result).toEqual({ compliance: complianceResult, budgetAlerts: null });
  });
});
