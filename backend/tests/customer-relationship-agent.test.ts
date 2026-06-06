import assert from "node:assert/strict"
import test from "node:test"
import type { CustomerRelationshipAgentRow } from "../src/services/ai/customer-relationship-schemas.ts"

process.env.APICORE_GRAPHQL_URL ??= "https://example.com/graphql"

const { buildFallbackAgentCopy, detectCustomerRelationshipIntent, selectCustomerRelationshipEvidenceType } = await import(
  "../src/services/ai/customer-relationship-agent.service.ts"
)
const { buildCustomerRelationshipProfilesFromRows } = await import(
  "../src/services/reports/customer-relationship-learning.service.ts"
)
const { normalizeCustomerRelationshipProfile } = await import(
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
