import type {
  CommissionBaseField,
  CommissionFormulaConfig,
  CommissionFormulaType,
  CommissionItemType,
  CommissionRuleConditions,
  CommissionSourceRow,
  CommissionTier,
} from "./commission.types.js"

export function nowIso() {
  return new Date().toISOString()
}

export function normalizeText(value: unknown) {
  return String(value ?? "").trim()
}

export function normalizeLower(value: unknown) {
  return normalizeText(value).toLowerCase()
}

export function slugify(value: unknown) {
  const normalized = normalizeLower(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return normalized || "unknown"
}

export function parseNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0
  }

  if (typeof value === "bigint") {
    return Number(value)
  }

  if (value && typeof value === "object" && "value" in value) {
    return parseNumber((value as { value: unknown }).value)
  }

  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function roundMoney(value: unknown) {
  return Math.round(parseNumber(value) * 100) / 100
}

export function safePercentOf(base: unknown, percent: unknown) {
  const safeBase = parseNumber(base)
  const safePercent = parseNumber(percent)
  if (!Number.isFinite(safeBase) || !Number.isFinite(safePercent)) {
    return 0
  }

  return roundMoney((safeBase * safePercent) / 100)
}

export function formatMoney(value: number) {
  return roundMoney(value).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

export function normalizeRole(value: string | null | undefined) {
  const normalized = normalizeLower(value)
  if (normalized.includes("sale")) {
    return "salesperson"
  }
  if (normalized.includes("therap") || normalized.includes("practitioner")) {
    return "practitioner"
  }
  if (normalized.includes("doctor")) {
    return "doctor"
  }
  if (normalized.includes("helper")) {
    return "helper"
  }

  return normalized
}

export function normalizeItemType(value: string | null | undefined): CommissionItemType | null {
  const normalized = normalizeLower(value)
  if (normalized === "service" || normalized === "package" || normalized === "product") {
    return normalized
  }

  return null
}

export function normalizeConditions(input?: Partial<CommissionRuleConditions> | null): CommissionRuleConditions {
  return {
    branchIds: Array.from(new Set((input?.branchIds ?? []).map(normalizeText).filter(Boolean))),
    branchCodes: Array.from(new Set((input?.branchCodes ?? []).map(normalizeText).filter(Boolean))),
    categoryNames: Array.from(new Set((input?.categoryNames ?? []).map(normalizeText).filter(Boolean))),
    serviceNames: Array.from(new Set((input?.serviceNames ?? []).map(normalizeText).filter(Boolean))),
    itemTypes: Array.from(
      new Set((input?.itemTypes ?? []).map((itemType) => normalizeItemType(itemType)).filter(Boolean)),
    ) as CommissionItemType[],
    paymentStatuses: Array.from(new Set((input?.paymentStatuses ?? []).map(normalizeText).filter(Boolean))),
  }
}

export function getSourceBaseFieldValue(row: CommissionSourceRow, baseField: CommissionBaseField) {
  if (baseField === "grossAmount") {
    return roundMoney(row.grossAmount)
  }
  if (baseField === "collectedAmount") {
    return roundMoney(row.collectedAmount)
  }

  return roundMoney(row.netAmount)
}

export function getTierForValue(tiers: CommissionTier[], value: number) {
  return [...tiers]
    .sort((left, right) => left.min - right.min)
    .find((tier) => {
      const lowerMatches = value >= parseNumber(tier.min)
      const upperMatches = tier.max == null ? true : value <= parseNumber(tier.max)
      return lowerMatches && upperMatches
    })
}

export function buildFormulaSummary(formulaType: CommissionFormulaType, formulaConfig: CommissionFormulaConfig) {
  if (formulaType === "percentage_of_amount") {
    const config = formulaConfig as { baseField: CommissionBaseField; value: number }
    return `${config.value}% of ${config.baseField}`
  }

  if (formulaType === "fixed_amount_per_item") {
    const config = formulaConfig as { value: number }
    return `${formatMoney(config.value)} per item`
  }

  if (formulaType === "fixed_amount_per_completed_treatment") {
    const config = formulaConfig as { value: number }
    return `${formatMoney(config.value)} per completed treatment`
  }

  if (formulaType === "tiered_percentage") {
    const config = formulaConfig as { baseField: CommissionBaseField; tiers: CommissionTier[] }
    const tierSummary = config.tiers
      .map((tier) => {
        const upper = tier.max == null ? "+" : `-${formatMoney(tier.max)}`
        return `${formatMoney(tier.min)}${upper}: ${tier.value}%`
      })
      .join(", ")
    return `Tiered ${config.baseField}: ${tierSummary}`
  }

  const config = formulaConfig as {
    baseField: CommissionBaseField
    threshold: number
    bonusType: "percentage" | "fixed"
    value: number
  }
  const bonusSuffix = config.bonusType === "percentage" ? `${config.value}%` : formatMoney(config.value)
  return `Bonus on ${config.baseField} at ${formatMoney(config.threshold)}: ${bonusSuffix}`
}

export function buildRulePreviewSentence(input: {
  eventType: string
  role: string | null
  branchCount: number
  serviceCount: number
  categoryCount: number
  formulaSummary: string
}) {
  const roleLabel = input.role || "matching staff"
  const trigger =
    input.eventType === "sale_based"
      ? "sales"
      : input.eventType === "payment_based"
        ? "payments"
        : "completed treatments"

  const scopeParts: string[] = []
  if (input.serviceCount > 0) {
    scopeParts.push(`${input.serviceCount} selected service${input.serviceCount === 1 ? "" : "s"}`)
  } else if (input.categoryCount > 0) {
    scopeParts.push(`${input.categoryCount} categor${input.categoryCount === 1 ? "y" : "ies"}`)
  } else {
    scopeParts.push("all eligible services")
  }

  if (input.branchCount > 0) {
    scopeParts.push(`${input.branchCount} branch${input.branchCount === 1 ? "" : "es"}`)
  }

  return `For ${trigger}, ${roleLabel} receive ${input.formulaSummary} across ${scopeParts.join(" and ")}.`
}

export function matchesRuleCollectionFilter(values: string[], candidate: string | null | undefined) {
  if (values.length === 0) {
    return true
  }

  const lookup = normalizeLower(candidate)
  return values.some((value) => normalizeLower(value) === lookup)
}

export function buildStaffId(prefix: string, id: string | null | undefined, name: string | null | undefined) {
  const explicitId = normalizeText(id)
  if (explicitId) {
    return `${prefix}:${explicitId}`
  }

  return `${prefix}:${slugify(name)}`
}

export function dedupeStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map(normalizeText).filter(Boolean)))
}

export function monthKeyFromDate(dateValue: string) {
  return dateValue.slice(0, 7)
}
