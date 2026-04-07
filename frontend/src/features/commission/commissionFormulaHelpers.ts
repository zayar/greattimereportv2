import type {
  CommissionFormulaConfig,
  CommissionFormulaType,
  CommissionRulePayload,
  CommissionServiceAmount,
} from "./types"

type SelectedServiceDescriptor = {
  serviceName: string
  categoryName?: string
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim()
}

function normalizeKey(value: unknown) {
  return normalizeText(value).toLocaleLowerCase()
}

function parseAmount(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function buildDefaultFormulaConfig(formulaType: CommissionFormulaType): CommissionFormulaConfig {
  if (formulaType === "fixed_amount_per_item" || formulaType === "fixed_amount_per_completed_treatment") {
    return {
      value: 0,
    }
  }

  if (formulaType === "fixed_amount_per_service") {
    return {
      serviceAmounts: [],
    }
  }

  if (formulaType === "tiered_percentage") {
    return {
      baseField: "netAmount",
      tiers: [
        {
          min: 0,
          max: null,
          value: 0,
        },
      ],
    }
  }

  if (formulaType === "target_bonus") {
    return {
      baseField: "netAmount",
      threshold: 0,
      bonusType: "fixed",
      value: 0,
    }
  }

  return {
    baseField: "netAmount",
    value: 0,
  }
}

export function getFixedAmountPerServiceConfig(formulaConfig: CommissionFormulaConfig) {
  if ("serviceAmounts" in formulaConfig && Array.isArray(formulaConfig.serviceAmounts)) {
    return {
      serviceAmounts: formulaConfig.serviceAmounts.map((entry) => ({
        serviceName: normalizeText(entry.serviceName),
        categoryName: normalizeText(entry.categoryName) || "Other",
        amount: parseAmount(entry.amount),
      })),
    }
  }

  return {
    serviceAmounts: [],
  }
}

export function syncFixedAmountPerServiceConfig(input: {
  selectedServices: SelectedServiceDescriptor[]
  formulaConfig: CommissionFormulaConfig
}) {
  const existingEntries = new Map<string, CommissionServiceAmount>()

  getFixedAmountPerServiceConfig(input.formulaConfig).serviceAmounts.forEach((entry) => {
    const key = normalizeKey(entry.serviceName)
    if (!key || existingEntries.has(key)) {
      return
    }

    existingEntries.set(key, {
      serviceName: normalizeText(entry.serviceName),
      categoryName: normalizeText(entry.categoryName) || "Other",
      amount: parseAmount(entry.amount),
    })
  })

  return {
    serviceAmounts: input.selectedServices
      .map((service) => {
        const serviceName = normalizeText(service.serviceName)
        const key = normalizeKey(serviceName)
        if (!key) {
          return null
        }

        const existing = existingEntries.get(key)
        return {
          serviceName,
          categoryName: normalizeText(service.categoryName) || existing?.categoryName || "Other",
          amount: existing ? parseAmount(existing.amount) : 0,
        }
      })
      .filter((entry): entry is CommissionServiceAmount => entry !== null),
  }
}

export function areServiceAmountsEqual(left: CommissionFormulaConfig, right: CommissionFormulaConfig) {
  const leftEntries = getFixedAmountPerServiceConfig(left).serviceAmounts
  const rightEntries = getFixedAmountPerServiceConfig(right).serviceAmounts

  if (leftEntries.length !== rightEntries.length) {
    return false
  }

  return leftEntries.every((entry, index) => {
    const nextEntry = rightEntries[index]
    return (
      normalizeKey(entry.serviceName) === normalizeKey(nextEntry?.serviceName) &&
      normalizeText(entry.categoryName) === normalizeText(nextEntry?.categoryName) &&
      parseAmount(entry.amount) === parseAmount(nextEntry?.amount)
    )
  })
}

export function updateFixedAmountPerServiceValue(input: {
  formulaConfig: CommissionFormulaConfig
  serviceName: string
  amount: number
  categoryName?: string
}) {
  const nextAmount = parseAmount(input.amount)
  return {
    serviceAmounts: getFixedAmountPerServiceConfig(input.formulaConfig).serviceAmounts.map((entry) =>
      normalizeKey(entry.serviceName) === normalizeKey(input.serviceName)
        ? {
            ...entry,
            categoryName: normalizeText(input.categoryName) || entry.categoryName || "Other",
            amount: nextAmount,
          }
        : entry,
    ),
  }
}

export function applyFixedAmountToAllServices(input: {
  formulaConfig: CommissionFormulaConfig
  selectedServices: SelectedServiceDescriptor[]
  amount: number
}) {
  const nextAmount = parseAmount(input.amount)
  return {
    serviceAmounts: syncFixedAmountPerServiceConfig(input).serviceAmounts.map((entry) => ({
      ...entry,
      amount: nextAmount,
    })),
  }
}

export function clearFixedAmountPerServiceAmounts(input: {
  formulaConfig: CommissionFormulaConfig
  selectedServices: SelectedServiceDescriptor[]
}) {
  return {
    serviceAmounts: syncFixedAmountPerServiceConfig(input).serviceAmounts.map((entry) => ({
      ...entry,
      amount: 0,
    })),
  }
}

export function validateCommissionRulePayload(rule: CommissionRulePayload) {
  if (rule.formulaType !== "fixed_amount_per_service") {
    return []
  }

  const errors: string[] = []
  const selectedServices = rule.conditions.serviceNames.map((serviceName) => normalizeText(serviceName)).filter(Boolean)
  if (selectedServices.length === 0) {
    errors.push("Select at least one service before using Fixed amount per service.")
  }

  const serviceAmounts = getFixedAmountPerServiceConfig(rule.formulaConfig).serviceAmounts
  const serviceAmountMap = new Map(serviceAmounts.map((entry) => [normalizeKey(entry.serviceName), parseAmount(entry.amount)]))

  const missingServices = selectedServices.filter((serviceName) => !serviceAmountMap.has(normalizeKey(serviceName)))
  if (missingServices.length > 0) {
    errors.push("Enter an MMK amount for every selected service.")
  }

  const invalidAmounts = selectedServices.filter((serviceName) => {
    const amount = serviceAmountMap.get(normalizeKey(serviceName)) ?? 0
    return amount <= 0
  })

  if (invalidAmounts.length > 0) {
    errors.push("Each selected service must have an amount greater than 0 MMK.")
  }

  return Array.from(new Set(errors))
}
