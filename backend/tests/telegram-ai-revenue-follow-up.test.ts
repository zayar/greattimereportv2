import assert from "node:assert/strict";
import test from "node:test";
import type { AiRevenueAction } from "../src/types/ai-revenue-agent.ts";

process.env.APICORE_GRAPHQL_URL ??= "https://example.com/graphql";

const {
  formatAiRevenueTaskListMessage,
  getPackageBalanceLabel,
  getWhyLine,
  isAiRevenueFollowUpSessionCommand,
  isAiRevenueFollowUpTelegramText,
} = await import("../src/services/telegram/ai-revenue-follow-up.service.ts");

function buildAction(overrides: Partial<AiRevenueAction> = {}): AiRevenueAction {
  return {
    id: "action-1",
    clinicId: "clinic-1",
    clinicCode: "GT001",
    dateKey: "2026-07-07",
    opportunityKey: "opp-1",
    originalDateKey: "2026-07-07",
    dueDateKey: "2026-07-07",
    nextFollowUpAt: null,
    source: "apicore",
    sourceRefId: null,
    actionType: "service_reminder_follow_up",
    workflowState: "new",
    visibilityState: "active",
    assignedToUserId: null,
    assignedToName: null,
    attemptCount: 0,
    lastContactAt: null,
    lastContactChannel: null,
    lastContactResult: null,
    lastFollowUpNote: null,
    lastFollowUpAttemptId: null,
    completedAt: null,
    closedAt: null,
    closedReason: null,
    priority: "high",
    priorityScore: 90,
    title: "Follow up customer",
    summary: "Customer is due for a follow-up.",
    reason: "0 sessions left, but customer is still due for service reminder.",
    displayReason: "0 sessions left",
    evidence: [],
    recommendedAction: "Confirm service and invite for next appointment.",
    aiSuggestion: null,
    customer: {
      customerKey: "customer-1",
      memberId: "member-1",
      customerName: "Aye Phyu Phyu Lwin",
      phoneNumber: "+959796581921",
      phoneMasked: "+959*****921",
    },
    service: {
      serviceId: "service-1",
      serviceName: "Hair Removal Underarm",
      lastVisitDate: "2025-07-16",
      lastVisitSinceDays: 356,
      lastTreatmentTherapist: "Shwe Yee",
      preferredTherapist: null,
      reminderDate: "2026-07-07",
    },
    serviceUsage: [],
    packageInfo: {
      packageId: "package-1",
      packageName: "Hair Removal Underarm 10 Times",
      remainingUnits: 0,
      purchasedUnits: 10,
      usedUnits: 10,
      lastUsedAt: "2025-07-16",
    },
    appointment: {
      bookingId: null,
      appointmentDateTime: null,
      bookingStatus: null,
      requestMode: null,
      serviceId: null,
      serviceName: null,
      practitionerId: null,
      practitionerName: null,
      note: null,
      attributionNote: null,
      requestedAt: null,
      reminderSentAt: null,
      cameAt: null,
      cancelledAt: null,
      noShowAt: null,
      completedAt: null,
    },
    message: {
      channel: null,
      draftText: null,
      approvedText: null,
      approvedBy: null,
      approvedAt: null,
      sentAt: null,
      providerMessageId: null,
      lastInboundText: null,
      lastInboundIntent: null,
      lastInboundAt: null,
    },
    revenue: {
      actualRevenue: null,
      influencedRevenue: null,
      packageSessionsRecovered: null,
      orderId: null,
      invoiceNumber: null,
      attributionType: null,
      revenueAt: null,
      revenueNote: null,
    },
    followUp: {
      status: "open",
      dueDate: "2026-07-07",
      nextFollowUpDate: null,
      lastAttemptId: null,
      lastContactedAt: null,
      lastChannel: null,
      lastResult: null,
      lastNote: null,
      lastHandledBy: null,
      attemptCount: 0,
      completedAt: null,
      completedBy: null,
      suppressedAt: null,
      suppressionId: null,
      outcome: {
        appointmentBookingId: null,
        appointmentBookedAt: null,
        appointmentDateTime: null,
        customerCameAt: null,
        treatmentCompletedAt: null,
        packageSessionUsedAt: null,
        packageSessionsRecovered: 0,
        repurchaseInvoiceNumber: null,
        repurchaseRevenue: 0,
        revenueAttributedAt: null,
        attributionType: "unknown",
      },
    },
    status: "new",
    createdAt: "2026-07-07T01:00:00.000Z",
    updatedAt: "2026-07-07T01:00:00.000Z",
    createdBy: null,
    lastStatusAt: null,
    lastStatusBy: null,
    resolution: null,
    ...overrides,
  };
}

test("AI Revenue follow-up intent matches natural and prefixed Telegram questions", () => {
  assert.equal(isAiRevenueFollowUpTelegramText("Who should I follow up ?"), true);
  assert.equal(isAiRevenueFollowUpTelegramText("Who should I follow up today?"), true);
  assert.equal(isAiRevenueFollowUpTelegramText("/ask Who should I follow up ?"), true);
  assert.equal(isAiRevenueFollowUpTelegramText("/ask Who should I follow up today?"), true);
  assert.equal(isAiRevenueFollowUpTelegramText("/gt who to follow up today"), true);
  assert.equal(isAiRevenueFollowUpTelegramText("ဘယ်သူကို ဆက်သွယ်ရမလဲ"), true);
});

test("AI Revenue follow-up intent avoids explanation-style follow-up questions", () => {
  assert.equal(isAiRevenueFollowUpTelegramText("Explain why I should follow up this customer"), false);
  assert.equal(isAiRevenueFollowUpTelegramText("Show follow up message detail for Aye Aye"), false);
});

test("AI Revenue follow-up session commands match detail and message shortcuts", () => {
  assert.equal(isAiRevenueFollowUpSessionCommand("F1D"), true);
  assert.equal(isAiRevenueFollowUpSessionCommand("F2M"), true);
  assert.equal(isAiRevenueFollowUpSessionCommand("/fdetail 1"), true);
  assert.equal(isAiRevenueFollowUpSessionCommand("/fmessage 1"), true);
});

test("AI Revenue follow-up formatting does not show zero package balance", () => {
  const action = buildAction();

  assert.equal(getPackageBalanceLabel(action), null);
  assert.equal(getWhyLine(action, "2026-07-07"), "356 days since last visit");

  const message = formatAiRevenueTaskListMessage({
    dateKey: "2026-07-07",
    actions: [action],
    counts: {
      dueNow: 1,
      overdue: 0,
      highPriority: 1,
      contactedToday: 0,
      completedToday: 0,
    },
    chatType: "private",
    viewerContext: {
      chatType: "private",
      telegramUserId: "123",
      target: {
        isAgentChatEnabled: true,
        agentChatAccessMode: "all_members",
        agentChatAllowedUserIds: [],
      },
    },
  });

  assert.equal(/0\s*(?:\/\s*\d+)?\s*sessions?\s*left/i.test(message), false);
});

test("AI Revenue group follow-up format does not expose customer details or full phone", () => {
  const action = buildAction();
  const message = formatAiRevenueTaskListMessage({
    dateKey: "2026-07-07",
    actions: [action],
    counts: {
      dueNow: 1,
      overdue: 0,
      highPriority: 1,
      contactedToday: 0,
      completedToday: 0,
    },
    chatType: "group",
    viewerContext: {
      chatType: "group",
      telegramUserId: "123",
      target: {
        isAgentChatEnabled: true,
        agentChatAccessMode: "all_members",
        agentChatAllowedUserIds: [],
      },
    },
  });

  assert.equal(message.includes("+959796581921"), false);
  assert.equal(message.includes("Aye Phyu Phyu Lwin"), false);
  assert.equal(message.includes("Hair Removal Underarm"), false);
});
