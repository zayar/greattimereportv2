import assert from "node:assert/strict";
import test from "node:test";
import { canAccessAiControlPanel, parseAiControlPanelAdminEmails } from "../src/features/ai/adminAccess";

test("AI Control Panel is visible only to the allowlisted owner email", () => {
  assert.equal(canAccessAiControlPanel("zayar@datafocus.cloud"), true);
  assert.equal(canAccessAiControlPanel("ZAYAR@DATAFOCUS.CLOUD"), true);
  assert.equal(canAccessAiControlPanel("manager@example.com"), false);
  assert.equal(canAccessAiControlPanel(undefined), false);
});

test("AI Control Panel admin parser trims and normalizes emails", () => {
  const emails = parseAiControlPanelAdminEmails(" zayar@datafocus.cloud, Owner@Example.com ,, ");

  assert.equal(emails.has("zayar@datafocus.cloud"), true);
  assert.equal(emails.has("owner@example.com"), true);
  assert.equal(emails.has(""), false);
});
