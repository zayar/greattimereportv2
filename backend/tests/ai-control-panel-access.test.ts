import assert from "node:assert/strict";
import test from "node:test";

process.env.APICORE_GRAPHQL_URL ??= "https://example.com/graphql";

const {
  isAiControlPanelAdminEmail,
  parseAiControlPanelAdminEmails,
} = await import("../src/services/ai-control-panel-access.service.ts");

test("AI Control Panel admin allowlist includes the default owner email", () => {
  assert.equal(isAiControlPanelAdminEmail("zayar@datafocus.cloud"), true);
  assert.equal(isAiControlPanelAdminEmail("ZAYAR@DATAFOCUS.CLOUD"), true);
  assert.equal(isAiControlPanelAdminEmail("team@example.com"), false);
});

test("AI Control Panel admin allowlist parser trims and normalizes emails", () => {
  const emails = parseAiControlPanelAdminEmails(" zayar@datafocus.cloud, Owner@Example.com ,, ");

  assert.equal(emails.has("zayar@datafocus.cloud"), true);
  assert.equal(emails.has("owner@example.com"), true);
  assert.equal(emails.has(""), false);
});
