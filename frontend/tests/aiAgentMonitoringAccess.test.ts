import assert from "node:assert/strict";
import test from "node:test";
import {
  canAccessAiAgentMonitoring,
  parseAiAgentMonitoringAdminEmails,
  resolveAiAgentMonitoringAdminEmails,
} from "../src/features/ai/adminAccess";

test("AI Agent Monitoring is visible only to the allowlisted owner email", () => {
  assert.equal(canAccessAiAgentMonitoring("zayar@datafocus.cloud"), true);
  assert.equal(canAccessAiAgentMonitoring("ZAYAR@DataFocus.Cloud"), true);
  assert.equal(canAccessAiAgentMonitoring("admin@example.com"), false);
  assert.equal(canAccessAiAgentMonitoring(undefined), false);
});

test("AI Agent Monitoring parser trims and normalizes emails", () => {
  const parsed = parseAiAgentMonitoringAdminEmails(" Owner@Example.com, zayar@datafocus.cloud ,, ");
  assert.equal(parsed.has("owner@example.com"), true);
  assert.equal(parsed.has("zayar@datafocus.cloud"), true);
  assert.equal(parsed.has("Owner@Example.com"), false);
});

test("AI Agent Monitoring admin config falls back when build env is blank", () => {
  assert.equal(resolveAiAgentMonitoringAdminEmails(""), "zayar@datafocus.cloud");
  assert.equal(resolveAiAgentMonitoringAdminEmails(" owner@example.com "), "owner@example.com");
});
