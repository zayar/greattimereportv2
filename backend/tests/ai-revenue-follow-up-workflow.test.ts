import assert from "node:assert/strict";
import test from "node:test";
import type {
  AiRevenueAction,
  AiRevenueContactResult,
} from "../src/types/ai-revenue-agent.ts";

process.env.APICORE_GRAPHQL_URL ??= "https://example.com/graphql";

const { deriveFollowUpWorkflowPatch } = await import("../src/services/ai-revenue-agent/ai-revenue-agent.service.ts");
const { HttpError } = await import("../src/utils/http-error.ts");
type NormalizedAiRevenueFollowUpAttemptInput = import(
  "../src/services/ai-revenue-agent/ai-revenue-agent.service.ts"
).NormalizedAiRevenueFollowUpAttemptInput;

function buildAction(overrides: Partial<AiRevenueAction> = {}): AiRevenueAction {
  return {
    id: "action-1",
    clinicId: "clinic-1",
    clinicCode: "GT001",
    dateKey: "2026-07-06",
    opportunityKey: null,
    originalDateKey: "2026-07-06",
    dueDateKey: "2026-07-06",
    nextFollowUpAt: null,
    source: "daily_report",
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
    priority: "medium",
    priorityScore: 72,
    title: "Follow up customer",
    summary: "Customer is due for a follow-up.",
    reason: "service follow-up due",
    displayReason: null,
    evidence: [],
    recommendedAction: "Call the customer.",
    aiSuggestion: "Call and offer the next appointment.",
    customer: {
      customerKey: "customer-1",
      memberId: "member-1",
      customerName: "Test Customer",
      phoneNumber: "09123456789",
      phoneMasked: "091*****789",
    },
    service: {
      serviceId: "service-1",
      serviceName: "Facial",
      lastVisitDate: "2026-06-01",
      lastVisitSinceDays: 35,
      lastTreatmentTherapist: "Aye Aye",
      preferredTherapist: null,
      reminderDate: "2026-07-06",
    },
    serviceUsage: [],
    packageInfo: {
      packageId: null,
      packageName: null,
      remainingUnits: null,
      purchasedUnits: null,
      usedUnits: null,
      lastUsedAt: null,
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
      status: "pending",
      dueDate: "2026-07-06",
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
      outcome: {},
    },
    status: "new",
    createdAt: "2026-07-06T01:00:00.000Z",
    updatedAt: "2026-07-06T01:00:00.000Z",
    createdBy: null,
    lastStatusAt: null,
    lastStatusBy: null,
    resolution: null,
    ...overrides,
  };
}

function buildAttempt(
  result: AiRevenueContactResult,
  overrides: Partial<NormalizedAiRevenueFollowUpAttemptInput> = {},
): NormalizedAiRevenueFollowUpAttemptInput {
  return {
    clinicId: "clinic-1",
    actionId: "action-1",
    channel: "phone",
    result,
    note: "Staff note",
    messageText: null,
    nextFollowUpAt: null,
    nextFollowUpDateKey: null,
    suppressCustomer: false,
    suppressionScope: undefined,
    suppressionUntil: null,
    permanentSuppression: undefined,
    appointment: undefined,
    outcome: undefined,
    actor: null,
    contactedAt: "2026-07-06T02:00:00.000Z",
    source: "workflow",
    ...overrides,
  };
}

test("deriveFollowUpWorkflowPatch schedules no-answer follow-up when a next date exists", () => {
  const patch = deriveFollowUpWorkflowPatch(
    buildAction(),
    buildAttempt("no_answer", {
      nextFollowUpDateKey: "2026-07-07",
      nextFollowUpAt: "2026-07-07T02:30:00.000Z",
    }),
  );

  assert.equal(patch.workflowState, "scheduled_follow_up");
  assert.equal(patch.visibilityState, "scheduled");
  assert.equal(patch.dueDateKey, "2026-07-07");
  assert.equal(patch.nextFollowUpAt, "2026-07-07T02:30:00.000Z");
  assert.equal(patch.status, "human_takeover");
  assert.equal(patch.attemptCount, 1);
});

test("deriveFollowUpWorkflowPatch rejects call-later without a next follow-up date", () => {
  assert.throws(
    () => deriveFollowUpWorkflowPatch(buildAction(), buildAttempt("call_later")),
    (error) =>
      error instanceof HttpError &&
      error.statusCode === 400 &&
      /Next follow-up date is required/i.test(error.message),
  );
});

test("deriveFollowUpWorkflowPatch completes appointment-booked queue work", () => {
  const patch = deriveFollowUpWorkflowPatch(
    buildAction(),
    buildAttempt("appointment_booked", {
      appointment: {
        bookingId: "booking-1",
        appointmentDateTime: "2026-07-07T04:00:00.000Z",
      },
    }),
  );

  assert.equal(patch.workflowState, "appointment_booked");
  assert.equal(patch.visibilityState, "completed");
  assert.equal(patch.status, "appointment_created");
  assert.equal(patch.dueDateKey, "2026-07-06");
});

test("deriveFollowUpWorkflowPatch closes and suppresses do-not-contact results", () => {
  const patch = deriveFollowUpWorkflowPatch(
    buildAction(),
    buildAttempt("do_not_contact", {
      suppressCustomer: true,
      suppressionScope: "customer",
      permanentSuppression: true,
    }),
  );

  assert.equal(patch.workflowState, "closed");
  assert.equal(patch.visibilityState, "suppressed");
  assert.equal(patch.status, "closed");
  assert.equal(patch.closedAt, "2026-07-06T02:00:00.000Z");
  assert.equal(patch.closedReason, "do_not_contact");
});

test("deriveFollowUpWorkflowPatch marks completed results completed", () => {
  const patch = deriveFollowUpWorkflowPatch(buildAction(), buildAttempt("completed"));

  assert.equal(patch.workflowState, "completed");
  assert.equal(patch.visibilityState, "completed");
  assert.equal(patch.status, "completed");
  assert.equal(patch.completedAt, "2026-07-06T02:00:00.000Z");
});
