import assert from "node:assert/strict"
import test from "node:test"
import type { CustomerRelationshipAgentRow } from "../src/services/ai/customer-relationship-schemas.ts"

process.env.APICORE_GRAPHQL_URL ??= "https://example.com/graphql"

const { buildFallbackAgentCopy, detectCustomerRelationshipIntent, selectCustomerRelationshipEvidenceType } = await import(
  "../src/services/ai/customer-relationship-agent.service.ts"
)
const { buildCustomerRelationshipDailyMemoryV2FromRows, buildCustomerRelationshipProfilesFromRows } = await import(
  "../src/services/reports/customer-relationship-learning.service.ts"
)
const {
  filterProfilesToLearningRun,
  mergeCustomerRelationshipProfileForRefresh,
  normalizeCustomerRelationshipProfile,
  selectLatestCompletedCustomerRelationshipLearningRun,
} = await import(
  "../src/services/reports/customer-relationship-profile.repository.ts"
)

function buildProfiles() {
  return buildCustomerRelationshipProfilesFromRows({
    clinicId: "clinic-1",
    clinicCode: "QUEEN",
    learnedAt: "2026-06-05T00:00:00.000Z",
    lookbackDays: 365,
    rows: [
      {
        customerName: "Ma Aye",
        phoneNumber: "09123456789",
        memberId: "M-1",
        firstSeenDate: "2026-01-10",
        lastVisitDate: "2026-01-10",
        daysSinceLastVisit: 146,
        lastPaymentDate: "2026-05-01",
        lastPackagePurchaseDate: "2026-05-01",
        lastPackageServiceName: "Facial Treatment",
        lastPackageName: "Glow Package",
        totalVisits: 1,
        lifetimeSpend: 2500000,
        averageSpend: 1250000,
        recent90DayVisits: 0,
        previous90DayVisits: 1,
        avgVisitGapDays: null,
        preferredService: "Facial Treatment",
        preferredServiceCategory: "Facial",
        preferredTherapist: "May Thu",
        preferredDayOfWeek: "Monday",
        preferredHour: 14,
        lastService: "Facial Treatment",
        lastPaymentMethod: "KBZPay",
        packagePurchaseCount: 1,
        activePackageCount: 0,
        totalPackageSessions: 10,
        remainingPackageSessions: 10,
        visitsAfterLastPackagePurchase: 0,
        packageHoldingsJson: JSON.stringify([
          {
            serviceName: "Facial Treatment",
            packageName: "Glow Package",
            serviceCategory: "Facial",
            packageTotal: 10,
            usedCount: 0,
            remainingCount: 10,
            latestUsageDate: null,
            latestTherapist: null,
          },
        ]),
        packagePurchasesJson: JSON.stringify([
          {
            serviceName: "Facial Treatment",
            packageName: "Glow Package",
            serviceCategory: "Facial",
            purchaseCount: 1,
            latestPurchaseDate: "2026-05-01",
            totalAmount: 2500000,
          },
        ]),
        serviceUsageJson: JSON.stringify([
          {
            serviceName: "Facial Treatment",
            serviceCategory: "Facial",
            counts: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            totalUsage: 1,
          },
        ]),
      },
      {
        customerName: "Daw Hla",
        phoneNumber: "09999999999",
        memberId: "M-2",
        firstSeenDate: "2025-12-01",
        lastVisitDate: "2026-06-01",
        daysSinceLastVisit: 4,
        lastPaymentDate: "2026-06-01",
        lastPackagePurchaseDate: null,
        lastPackageServiceName: null,
        lastPackageName: null,
        totalVisits: 8,
        lifetimeSpend: 700000,
        averageSpend: 87500,
        recent90DayVisits: 4,
        previous90DayVisits: 3,
        avgVisitGapDays: 25,
        preferredService: "Laser Treatment",
        preferredServiceCategory: "Laser",
        preferredTherapist: "Dr. Aye",
        preferredDayOfWeek: "Tuesday",
        preferredHour: 16,
        lastService: "Laser Treatment",
        lastPaymentMethod: "Cash",
        packagePurchaseCount: 0,
        activePackageCount: 0,
        totalPackageSessions: 0,
        remainingPackageSessions: 0,
        visitsAfterLastPackagePurchase: 0,
        packageHoldingsJson: null,
        packagePurchasesJson: null,
        serviceUsageJson: JSON.stringify([
          {
            serviceName: "Laser Treatment",
            serviceCategory: "Laser",
            counts: [0, 1, 1, 0, 2, 4, 0, 0, 0, 0, 0, 0],
            totalUsage: 8,
          },
        ]),
      },
    ],
  })
}

test("detects supported customer relationship intents deterministically", () => {
  assert.equal(detectCustomerRelationshipIntent("Who bought package but never came?"), "package_bought_never_came")
  assert.equal(detectCustomerRelationshipIntent("Which VIP customers are inactive?"), "inactive_vip")
  assert.equal(detectCustomerRelationshipIntent("Which customers have unused package balance?"), "unused_package_balance")
  assert.equal(detectCustomerRelationshipIntent("Can you write custom SQL for all tables?"), "unsupported")
})

test("selects evidence type by safe detected intent", () => {
  assert.equal(selectCustomerRelationshipEvidenceType("package_bought_never_came"), "package_usage")
  assert.equal(selectCustomerRelationshipEvidenceType("package_bought_not_used"), "package_usage")
  assert.equal(selectCustomerRelationshipEvidenceType("unused_package_balance"), "package_usage")
  assert.equal(selectCustomerRelationshipEvidenceType("treatment_due"), "visit_pattern")
  assert.equal(selectCustomerRelationshipEvidenceType("churn_risk"), "risk_explanation")
  assert.equal(selectCustomerRelationshipEvidenceType("inactive_vip"), "risk_explanation")
  assert.equal(selectCustomerRelationshipEvidenceType("high_value_no_recent_visit"), "risk_explanation")
  assert.equal(selectCustomerRelationshipEvidenceType("general_summary"), "none")
  assert.equal(selectCustomerRelationshipEvidenceType("unsupported"), "none")
})

test("classifies package bought never came and unused balance from learned rows", () => {
  const profile = buildProfiles()[0]

  assert.equal(profile.packageBoughtNeverCame, true)
  assert.equal(profile.packageBoughtButNoUsage, true)
  assert.equal(profile.hasUnusedPackageBalance, true)
  assert.ok(profile.segments.includes("package_bought_never_came"))
  assert.ok(profile.segments.includes("package_bought_not_used"))
  assert.ok(profile.segments.includes("unused_package_balance"))
  assert.ok(profile.reasons.some((reason) => reason.includes("no visit after package purchase")))
  assert.equal(profile.lastPackageServiceName, "Facial Treatment")
  assert.equal(profile.lastPackageName, "Glow Package")
  assert.equal(profile.packageHoldings[0]?.remainingCount, 10)
  assert.equal(profile.serviceUsageByMonth[0]?.totalUsage, 1)
})

test("assigns higher priority to risky package customers than healthy active customers", () => {
  const [packageRiskProfile, healthyProfile] = buildProfiles()

  assert.equal(packageRiskProfile.riskLevel, "high")
  assert.ok(packageRiskProfile.priorityScore > healthyProfile.priorityScore)
  assert.ok(healthyProfile.segments.includes("healthy_active_customer"))
})

test("builds deterministic fallback answer when AI is unavailable", () => {
  const profile = buildProfiles()[0]
  const row: CustomerRelationshipAgentRow = {
    customerKey: profile.customerKey,
    customerName: profile.customerName,
    customerPhoneMasked: profile.customerPhoneMasked,
    lastVisitDate: profile.lastVisitDate,
    daysSinceLastVisit: profile.daysSinceLastVisit,
    lastService: profile.lastService,
    lastPackageServiceName: profile.lastPackageServiceName,
    lastPackageName: profile.lastPackageName,
    remainingPackageSessions: profile.remainingPackageSessions,
    packageHoldings: profile.packageHoldings,
    packagePurchases: profile.packagePurchases,
    lifetimeSpend: profile.lifetimeSpend,
    riskLevel: profile.riskLevel,
    segments: profile.segments,
    reasons: profile.reasons,
    nextBestAction: profile.nextBestAction,
    priorityScore: profile.priorityScore,
    lastFollowUpAt: null,
    lastFollowUpOutcome: null,
    followUpCount: 0,
  }

  const fallback = buildFallbackAgentCopy({
    intent: "package_bought_never_came",
    rows: [row],
    matchedCount: 1,
    dataFreshnessNote: "Learned today.",
    aiLanguage: "en-US",
  })

  assert.match(fallback.answerSummary, /Top priority is Ma Aye/)
  assert.ok(fallback.reasonBullets.length > 0)
  assert.match(fallback.evidenceNarrative, /Ma Aye/)
  assert.ok(fallback.recommendedActions.length > 0)
  assert.ok(fallback.nextQuestionSuggestions.length > 0)
})

test("fallback answer still works when evidence and rows are missing", () => {
  const fallback = buildFallbackAgentCopy({
    intent: "general_summary",
    rows: [],
    matchedCount: 0,
    dataFreshnessNote: "Learning has not run yet.",
    aiLanguage: "en-US",
  })

  assert.match(fallback.answerSummary, /No customers matched/)
  assert.ok(fallback.reasonBullets.length > 0)
  assert.match(fallback.evidenceNarrative, /No customer evidence/)
  assert.ok(fallback.recommendedActions.length > 0)
})

test("frontend agent rows expose masked phone only", () => {
  const profile = buildProfiles()[0]
  const row: CustomerRelationshipAgentRow = {
    customerKey: profile.customerKey,
    customerName: profile.customerName,
    customerPhoneMasked: profile.customerPhoneMasked,
    lastVisitDate: profile.lastVisitDate,
    daysSinceLastVisit: profile.daysSinceLastVisit,
    lastService: profile.lastService,
    lastPackageServiceName: profile.lastPackageServiceName,
    lastPackageName: profile.lastPackageName,
    remainingPackageSessions: profile.remainingPackageSessions,
    packageHoldings: profile.packageHoldings,
    packagePurchases: profile.packagePurchases,
    lifetimeSpend: profile.lifetimeSpend,
    riskLevel: profile.riskLevel,
    segments: profile.segments,
    reasons: profile.reasons,
    nextBestAction: profile.nextBestAction,
    priorityScore: profile.priorityScore,
    lastFollowUpAt: null,
    lastFollowUpOutcome: null,
    followUpCount: 0,
  }

  const serialized = JSON.stringify(row)
  assert.match(row.customerPhoneMasked, /^\*+6789$/)
  assert.doesNotMatch(serialized, /09123456789/)
  assert.doesNotMatch(serialized, /123456789/)
})

test("normalizes legacy learned profiles that do not have evidence arrays", () => {
  const legacyProfile = { ...buildProfiles()[0] } as Record<string, unknown>
  delete legacyProfile.packageHoldings
  delete legacyProfile.packagePurchases
  delete legacyProfile.serviceUsageByMonth
  delete legacyProfile.lastPackageServiceName
  delete legacyProfile.lastPackageName

  const normalized = normalizeCustomerRelationshipProfile(legacyProfile as never)

  assert.deepEqual(normalized.packageHoldings, [])
  assert.deepEqual(normalized.packagePurchases, [])
  assert.deepEqual(normalized.serviceUsageByMonth, [])
  assert.equal(normalized.lastPackageServiceName, null)
  assert.equal(normalized.lastPackageName, null)
})

function buildV2Row(overrides: Partial<ReturnType<typeof buildProfiles>[number]> & Record<string, unknown> = {}) {
  const packageHolding = overrides.packageHoldingsJson ?? null
  const packagePurchase = overrides.packagePurchasesJson ?? JSON.stringify([
    {
      purchaseKey: "purchase-1",
      invoiceNumber: "INV-1",
      serviceId: overrides.serviceId ?? null,
      packageId: overrides.packageId ?? null,
      serviceName: overrides.lastPackageServiceName ?? "Whitening Laser",
      packageName: overrides.lastPackageName ?? "Laser Package",
      serviceCategory: "Laser",
      purchaseCount: 1,
      latestPurchaseDate: overrides.lastPackagePurchaseDate ?? "2026-06-01",
      totalAmount: 500000,
    },
  ])

  return {
    customerName: "Win Wati Ko",
    phoneNumber: "09991232486",
    memberId: "M-2486",
    firstSeenDate: "2025-01-01",
    lastVisitDate: "2026-01-01",
    daysSinceLastVisit: 174,
    lastPaymentDate: overrides.lastPackagePurchaseDate ?? "2026-06-01",
    lastPackagePurchaseDate: overrides.lastPackagePurchaseDate ?? "2026-06-01",
    lastPackageServiceName: overrides.lastPackageServiceName ?? "Whitening Laser",
    lastPackageName: overrides.lastPackageName ?? "Laser Package",
    totalVisits: 1,
    lifetimeSpend: 500000,
    averageSpend: 500000,
    recent90DayVisits: 0,
    previous90DayVisits: 0,
    avgVisitGapDays: null,
    preferredService: "Whitening Laser",
    preferredServiceCategory: "Laser",
    preferredTherapist: null,
    preferredDayOfWeek: null,
    preferredHour: null,
    lastService: "Whitening Laser",
    lastPaymentMethod: "Cash",
    packagePurchaseCount: 1,
    activePackageCount: 0,
    totalPackageSessions: 0,
    remainingPackageSessions: 0,
    visitsAfterLastPackagePurchase: overrides.visitsAfterLastPackagePurchase ?? 0,
    packageHoldingsJson: packageHolding,
    packagePurchasesJson: packagePurchase,
    serviceUsageJson: null,
    ...overrides,
  }
}

function buildV2Memory(rows: ReturnType<typeof buildV2Row>[]) {
  return buildCustomerRelationshipDailyMemoryV2FromRows({
    clinicId: "clinic-1",
    clinicCode: "QUEEN",
    rows,
    learnedAt: "2026-06-24T02:00:00.000Z",
    lookbackDays: 365,
    learningRunId: "run-20260624",
    snapshotDate: "2026-06-24",
  })
}

test("V2 classifies recent purchase with zero usage as purchase pending activation", () => {
  const memory = buildV2Memory([
    buildV2Row({
      lastPackagePurchaseDate: "2026-06-22",
      lastVisitDate: "2026-06-20",
      daysSinceLastVisit: 4,
    }),
  ])
  const profile = memory.profiles[0]

  assert.ok(profile.segments.includes("purchase_pending_activation"))
  assert.equal(profile.primarySegment, "purchase_pending_activation")
  assert.equal(profile.packageBoughtNeverCame, false)
})

test("V2 classifies purchase older than grace period with zero matching usage as unactivated purchase", () => {
  const memory = buildV2Memory([
    buildV2Row({
      lastPackagePurchaseDate: "2026-06-01",
    }),
  ])
  const profile = memory.profiles[0]

  assert.ok(profile.segments.includes("unactivated_purchase"))
  assert.ok(profile.segments.includes("package_bought_never_came"))
  assert.equal(profile.primarySegment, "unactivated_purchase")
  assert.match(profile.reasons[0], /no matching usage/i)
})

test("V2 does not treat an unrelated visit as activation of a different purchased package", () => {
  const memory = buildV2Memory([
    buildV2Row({
      lastVisitDate: "2026-06-10",
      daysSinceLastVisit: 14,
      lastService: "Hydra Facial",
      lastPackagePurchaseDate: "2026-06-01",
      packageHoldingsJson: JSON.stringify([
        {
          serviceName: "Hydra Facial",
          packageName: "Facial Package",
          serviceCategory: "Facial",
          packageTotal: 5,
          usedCount: 1,
          remainingCount: 4,
          latestUsageDate: "2026-06-10",
          latestTherapist: "May",
        },
      ]),
    }),
  ])
  const lifecycle = memory.profiles[0].packageLifecycles?.[0]

  assert.equal(lifecycle?.activationStatus, "unactivated_purchase")
  assert.equal(lifecycle?.lastMatchingUsageDate, null)
})

test("V2 classifies confirmed remaining balance plus 90 days without usage as dormant active balance", () => {
  const memory = buildV2Memory([
    buildV2Row({
      lastPackagePurchaseDate: "2025-12-01",
      packageHoldingsJson: JSON.stringify([
        {
          serviceName: "Whitening Laser",
          packageName: "Laser Package",
          serviceCategory: "Laser",
          packageTotal: 10,
          usedCount: 3,
          remainingCount: 7,
          latestUsageDate: "2026-01-01",
          latestTherapist: "Wai Phoo",
        },
      ]),
    }),
  ])
  const profile = memory.profiles[0]

  assert.ok(profile.segments.includes("dormant_with_active_balance_90d"))
  assert.equal(profile.primarySegment, "dormant_with_active_balance_90d")
  assert.equal(profile.remainingPackageSessions, 7)
})

test("V2 does not classify unknown balance as confirmed active balance", () => {
  const memory = buildV2Memory([
    buildV2Row({
      lastPackagePurchaseDate: "2025-12-01",
      packageHoldingsJson: null,
    }),
  ])
  const profile = memory.profiles[0]

  assert.equal(profile.remainingPackageSessions, 0)
  assert.equal(profile.hasUnusedPackageBalance, false)
  assert.equal(profile.segments.includes("dormant_with_active_balance_90d"), false)
})

test("V2 classifies 90-day inactive customer without confirmed balance as lapsed customer", () => {
  const memory = buildV2Memory([
    buildV2Row({
      packagePurchaseCount: 0,
      lastPackagePurchaseDate: null,
      lastPackageServiceName: null,
      lastPackageName: null,
      packagePurchasesJson: null,
      packageHoldingsJson: null,
      lastVisitDate: "2026-03-01",
      daysSinceLastVisit: 115,
    }),
  ])
  const profile = memory.profiles[0]

  assert.ok(profile.segments.includes("lapsed_customer_90d"))
  assert.equal(profile.primarySegment, "lapsed_customer_90d")
})

test("V2 prefers stable service IDs over name matching", () => {
  const memory = buildV2Memory([
    buildV2Row({
      serviceId: "svc-1",
      lastPackagePurchaseDate: "2026-06-01",
      packagePurchasesJson: JSON.stringify([
        {
          purchaseKey: "purchase-stable",
          invoiceNumber: "INV-STABLE",
          serviceId: "svc-1",
          packageId: null,
          serviceName: "Whitening Laser",
          packageName: "Laser Package",
          serviceCategory: "Laser",
          purchaseCount: 1,
          latestPurchaseDate: "2026-06-01",
          totalAmount: 500000,
        },
      ]),
      packageHoldingsJson: JSON.stringify([
        {
          serviceId: "svc-1",
          serviceName: "Different display name",
          packageName: "Laser Package",
          serviceCategory: "Laser",
          packageTotal: 5,
          usedCount: 1,
          remainingCount: 4,
          latestUsageDate: "2026-06-05",
          latestTherapist: "Wai Phoo",
        },
      ]),
    }),
  ])
  const lifecycle = memory.profiles[0].packageLifecycles?.[0]

  assert.equal(lifecycle?.matchMethod, "stable_customer_service_identity")
  assert.equal(lifecycle?.activationStatus, "activated")
})

test("V2 describes low-confidence name matching as unconfirmed", () => {
  const memory = buildV2Memory([
    buildV2Row({
      phoneNumber: null,
      memberId: null,
      lastPackagePurchaseDate: "2026-06-01",
      packageHoldingsJson: JSON.stringify([
        {
          serviceName: "Whitening Laser",
          packageName: "Laser Package",
          serviceCategory: "Laser",
          packageTotal: 5,
          usedCount: 0,
          remainingCount: 5,
          latestUsageDate: null,
          latestTherapist: null,
        },
      ]),
    }),
  ])
  const lifecycle = memory.profiles[0].packageLifecycles?.[0]

  assert.equal(lifecycle?.matchMethod, "name_service_identity")
  assert.equal(lifecycle?.dataStatus, "partial")
  assert.match(lifecycle?.evidenceReason ?? "", /usage could not be confirmed/i)
})

test("V2 active run filtering excludes profiles from older learning runs", () => {
  const older = { ...buildV2Memory([buildV2Row({ customerName: "Old Customer" })]).profiles[0], learningRunId: "old-run" }
  const newer = { ...buildV2Memory([buildV2Row({ customerName: "New Customer" })]).profiles[0], learningRunId: "new-run" }
  const filtered = filterProfilesToLearningRun({
    profiles: [older, newer],
    learningRunId: "new-run",
  })

  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].customerName, "New Customer")
})

test("V2 failed learning run leaves previous completed run active", () => {
  const latest = selectLatestCompletedCustomerRelationshipLearningRun([
    { learningRunId: "old-run", status: "completed", createdAt: "2026-06-23T02:00:00.000Z" },
    { learningRunId: "failed-run", status: "failed", createdAt: "2026-06-24T02:00:00.000Z" },
  ])

  assert.equal(latest?.learningRunId, "old-run")
})

test("V2 follow-up mutable fields survive profile refresh", () => {
  const nextProfile = buildV2Memory([buildV2Row({ customerName: "Refresh Customer" })]).profiles[0]
  const merged = mergeCustomerRelationshipProfileForRefresh({
    nextProfile,
    existingProfile: {
      ...nextProfile,
      lastFollowUpAt: "2026-06-20T09:00:00.000Z",
      lastFollowUpOutcome: "replied",
      followUpCount: 3,
      lastMatchedAt: "2026-06-21T09:00:00.000Z",
      lastMatchedIntent: "follow_up_today",
    },
  })

  assert.equal(merged.lastFollowUpAt, "2026-06-20T09:00:00.000Z")
  assert.equal(merged.lastFollowUpOutcome, "replied")
  assert.equal(merged.followUpCount, 3)
  assert.equal(merged.lastMatchedIntent, "follow_up_today")
})

test("V2 daily memory output is idempotent for same clinic, snapshot, and learning run", () => {
  const rows = [buildV2Row({ lastPackagePurchaseDate: "2026-06-01" })]
  const first = buildV2Memory(rows)
  const second = buildV2Memory(rows)

  assert.deepEqual(first.packageRows, second.packageRows)
  assert.deepEqual(first.relationshipRows, second.relationshipRows)
})
