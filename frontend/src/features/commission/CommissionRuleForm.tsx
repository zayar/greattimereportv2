import { useDeferredValue, useEffect, useMemo, useState } from "react"
import { Panel } from "../../components/Panel"
import type {
  CommissionBranchOption,
  CommissionFormulaConfig,
  CommissionRulePayload,
  CommissionSourceOptions,
  CommissionTier,
} from "./types"
import {
  buildRulePreview,
  deriveSupportedRoles,
  filterStaffOptions,
  formatCommissionFormulaSummary,
} from "./commissionHelpers"
import {
  applyFixedAmountToAllServices,
  areServiceAmountsEqual,
  buildDefaultFormulaConfig,
  clearFixedAmountPerServiceAmounts,
  getFixedAmountPerServiceConfig,
  syncFixedAmountPerServiceConfig,
  updateFixedAmountPerServiceValue,
  validateCommissionRulePayload,
} from "./commissionFormulaHelpers"

type Props = {
  branches: CommissionBranchOption[]
  options: CommissionSourceOptions | null
  initialValue: CommissionRulePayload
  saving: boolean
  title: string
  onCancel: () => void
  onSave: (payload: CommissionRulePayload) => Promise<void>
}

type CheckboxGridProps = {
  items: Array<{ value: string; label: string; hint?: string }>
  selectedValues: string[]
  onToggle: (value: string) => void
  emptyLabel: string
}

type SelectionItem = {
  value: string
  label: string
  hint?: string
}

type SelectedServiceDescriptor = {
  serviceName: string
  categoryName: string
}

function CheckboxGrid({ items, selectedValues, onToggle, emptyLabel }: CheckboxGridProps) {
  if (items.length === 0) {
    return <div className="inline-note">{emptyLabel}</div>
  }

  return (
    <div className="commission-form__option-grid">
      {items.map((item) => {
        const selected = selectedValues.includes(item.value)
        return (
          <label key={item.value} className={`commission-form__check-card ${selected ? "commission-form__check-card--selected" : ""}`.trim()}>
            <input type="checkbox" checked={selected} onChange={() => onToggle(item.value)} />
            <span>{item.label}</span>
            {item.hint ? <small>{item.hint}</small> : null}
          </label>
        )
      })}
    </div>
  )
}

function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase()
}

function describeEventTrigger(eventType: CommissionRulePayload["eventType"]) {
  if (eventType === "payment_based") {
    return "Commission is created from collected payments and uses sales staff attribution from payment data."
  }

  if (eventType === "treatment_completed_based") {
    return "Commission is created only when treatments are completed and uses practitioner attribution from treatment data."
  }

  return "Commission is created from sold services or packages and uses sales staff attribution from sale data."
}

type SearchableSelectionListProps = {
  items: SelectionItem[]
  selectedValues: string[]
  onToggle: (value: string) => void
  onReplaceSelected: (values: string[]) => void
  emptyLabel: string
  title: string
  searchPlaceholder: string
}

function SearchableSelectionList({
  items,
  selectedValues,
  onToggle,
  onReplaceSelected,
  emptyLabel,
  title,
  searchPlaceholder,
}: SearchableSelectionListProps) {
  const [searchText, setSearchText] = useState("")
  const deferredSearchText = useDeferredValue(searchText)

  const filteredItems = useMemo(() => {
    const normalizedQuery = normalizeSearchText(deferredSearchText)
    const matchedItems =
      normalizedQuery.length === 0
        ? items
        : items.filter((item) => {
            const label = normalizeSearchText(item.label)
            const hint = normalizeSearchText(item.hint ?? "")
            return label.includes(normalizedQuery) || hint.includes(normalizedQuery)
          })

    return [...matchedItems].sort((left, right) => {
      const leftSelected = selectedValues.includes(left.value)
      const rightSelected = selectedValues.includes(right.value)
      if (leftSelected !== rightSelected) {
        return leftSelected ? -1 : 1
      }

      const hintCompare = (left.hint ?? "").localeCompare(right.hint ?? "")
      if (hintCompare !== 0) {
        return hintCompare
      }

      return left.label.localeCompare(right.label)
    })
  }, [deferredSearchText, items, selectedValues])

  const visibleValues = filteredItems.map((item) => item.value)
  const visibleSelectedCount = visibleValues.filter((value) => selectedValues.includes(value)).length
  const totalSelectedCount = selectedValues.length

  function selectVisible() {
    onReplaceSelected(Array.from(new Set([...selectedValues, ...visibleValues])))
  }

  function clearVisible() {
    onReplaceSelected(selectedValues.filter((value) => !visibleValues.includes(value)))
  }

  function clearAll() {
    onReplaceSelected([])
  }

  if (items.length === 0) {
    return <div className="inline-note">{emptyLabel}</div>
  }

  return (
    <div className="commission-form__selection-list">
      <div className="commission-form__selection-toolbar">
        <label className="field field--compact">
          <span>{title}</span>
          <input
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder={searchPlaceholder}
          />
        </label>

        <div className="commission-form__selection-meta">
          <strong>{totalSelectedCount.toLocaleString("en-US")} selected</strong>
          <span>
            {filteredItems.length.toLocaleString("en-US")} visible
            {searchText.trim() ? ` • ${visibleSelectedCount.toLocaleString("en-US")} checked in results` : ""}
          </span>
        </div>
      </div>

      <div className="commission-form__selection-actions">
        <button className="button button--ghost" type="button" onClick={selectVisible} disabled={filteredItems.length === 0}>
          Select visible
        </button>
        <button className="button button--ghost" type="button" onClick={clearVisible} disabled={visibleSelectedCount === 0}>
          Clear visible
        </button>
        <button className="button button--ghost" type="button" onClick={clearAll} disabled={totalSelectedCount === 0}>
          Clear all
        </button>
      </div>

      {totalSelectedCount > 0 ? (
        <div className="commission-form__selection-summary">
          {items
            .filter((item) => selectedValues.includes(item.value))
            .slice(0, 8)
            .map((item) => (
              <button key={item.value} className="commission-form__selection-pill" type="button" onClick={() => onToggle(item.value)}>
                <span>{item.label}</span>
                <small>{item.hint || "Service"}</small>
              </button>
            ))}
          {totalSelectedCount > 8 ? (
            <span className="commission-form__selection-overflow">+{(totalSelectedCount - 8).toLocaleString("en-US")} more</span>
          ) : null}
        </div>
      ) : null}

      <div className="commission-form__selection-listbox" role="list">
        {filteredItems.length === 0 ? (
          <div className="inline-note">No services match the current search.</div>
        ) : (
          filteredItems.map((item) => {
            const selected = selectedValues.includes(item.value)
            return (
              <label
                key={item.value}
                className={`commission-form__selection-row ${selected ? "commission-form__selection-row--selected" : ""}`.trim()}
              >
                <input type="checkbox" checked={selected} onChange={() => onToggle(item.value)} />
                <div className="commission-form__selection-content">
                  <strong>{item.label}</strong>
                  <span>{item.hint || "Other"}</span>
                </div>
              </label>
            )
          })
        )}
      </div>
    </div>
  )
}

type FixedAmountPerServiceEditorProps = {
  selectedServices: SelectedServiceDescriptor[]
  formulaConfig: CommissionFormulaConfig
  onChange: (nextConfig: CommissionFormulaConfig) => void
}

function FixedAmountPerServiceEditor({
  selectedServices,
  formulaConfig,
  onChange,
}: FixedAmountPerServiceEditorProps) {
  const [bulkAmount, setBulkAmount] = useState("")
  const serviceAmounts = getFixedAmountPerServiceConfig(formulaConfig).serviceAmounts

  if (selectedServices.length === 0) {
    return (
      <div className="commission-form__formula-summary">
        <strong>No services selected yet</strong>
        <span>Select at least one service in Step 3 before configuring service-specific commission amounts.</span>
      </div>
    )
  }

  function applyToAll() {
    const parsed = Number(bulkAmount)
    if (!Number.isFinite(parsed)) {
      return
    }

    onChange(
      applyFixedAmountToAllServices({
        formulaConfig,
        selectedServices,
        amount: parsed,
      }),
    )
  }

  return (
    <div className="commission-form__stack">
      <div className="commission-form__trigger-summary">
        <strong>Service-specific fixed amounts</strong>
        <span>This formula pays a separate MMK amount for each selected service name, including completed treatments delivered from package usage.</span>
      </div>

      <div className="commission-form__service-amount-toolbar">
        <label className="field field--compact">
          <span>Apply same amount to all selected services</span>
          <div className="commission-form__service-amount-inline">
            <input
              type="number"
              min={0}
              step="0.01"
              value={bulkAmount}
              onChange={(event) => setBulkAmount(event.target.value)}
              placeholder="MMK amount"
            />
            <button className="button button--ghost" type="button" onClick={applyToAll} disabled={bulkAmount.trim() === ""}>
              Apply to all
            </button>
          </div>
        </label>

        <button
          className="button button--ghost"
          type="button"
          onClick={() =>
            onChange(
              clearFixedAmountPerServiceAmounts({
                formulaConfig,
                selectedServices,
              }),
            )
          }
          disabled={serviceAmounts.every((entry) => Number(entry.amount) <= 0)}
        >
          Clear all amounts
        </button>
      </div>

      <div className="commission-form__service-amount-list" role="list">
        {serviceAmounts.map((entry) => (
          <div key={entry.serviceName} className="commission-form__service-amount-row" role="listitem">
            <div className="commission-form__service-amount-copy">
              <strong>{entry.serviceName}</strong>
              <span>{entry.categoryName || "Other"}</span>
            </div>

            <label className="field field--compact">
              <span>Amount (MMK)</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={entry.amount === 0 ? "" : entry.amount}
                onChange={(event) =>
                  onChange(
                    updateFixedAmountPerServiceValue({
                      formulaConfig,
                      serviceName: entry.serviceName,
                      categoryName: entry.categoryName,
                      amount: Number(event.target.value),
                    }),
                  )
                }
                placeholder="Enter amount"
              />
            </label>
          </div>
        ))}
      </div>
    </div>
  )
}

export function CommissionRuleForm({ branches, options, initialValue, saving, title, onCancel, onSave }: Props) {
  const [draft, setDraft] = useState(initialValue)
  const [submitAttempted, setSubmitAttempted] = useState(false)

  useEffect(() => {
    setDraft(initialValue)
    setSubmitAttempted(false)
  }, [initialValue])

  useEffect(() => {
    if (branches.length !== 1) {
      return
    }

    const [branch] = branches
    setDraft((current) => ({
      ...current,
      branchIds: [branch.id],
      branchCodes: [branch.code],
      conditions: {
        ...current.conditions,
        branchIds: [branch.id],
        branchCodes: [branch.code],
      },
    }))
  }, [branches])

  const staffOptions = useMemo(() => filterStaffOptions(options, draft.eventType), [options, draft.eventType])
  const staffItems = useMemo(
    () =>
      staffOptions.map((staff) => ({
        value: staff.id,
        label: staff.name,
        hint: staff.role,
      })),
    [staffOptions],
  )
  const supportedRoles = useMemo(() => deriveSupportedRoles(draft.eventType), [draft.eventType])
  const eventScopedServices = useMemo(
    () => (options?.services ?? []).filter((service) => service.eventTypes.includes(draft.eventType)),
    [draft.eventType, options?.services],
  )
  const serviceItems = useMemo(
    () =>
      eventScopedServices
        .filter((service) =>
          draft.conditions.categoryNames.length > 0
            ? draft.conditions.categoryNames.some((category) => service.categoryName.includes(category))
            : true,
        )
        .map((service) => ({
          value: service.name,
          label: service.name,
          hint: service.categoryName,
        })),
    [draft.conditions.categoryNames, eventScopedServices],
  )
  const selectedServiceDescriptors = useMemo<SelectedServiceDescriptor[]>(
    () =>
      draft.conditions.serviceNames.map((serviceName) => {
        const matched = eventScopedServices.find((service) => service.name === serviceName)
        return {
          serviceName,
          categoryName: matched?.categoryName || "Other",
        }
      }),
    [draft.conditions.serviceNames, eventScopedServices],
  )
  const validationMessages = useMemo(() => validateCommissionRulePayload(draft), [draft])

  useEffect(() => {
    if (draft.formulaType !== "fixed_amount_per_service") {
      return
    }

    const syncedConfig = syncFixedAmountPerServiceConfig({
      selectedServices: selectedServiceDescriptors,
      formulaConfig: draft.formulaConfig,
    })

    if (areServiceAmountsEqual(draft.formulaConfig, syncedConfig)) {
      return
    }

    setDraft((current) => ({
      ...current,
      formulaConfig: syncedConfig,
      conditions: {
        ...current.conditions,
        itemTypes: [],
      },
    }))
  }, [draft.formulaConfig, draft.formulaType, selectedServiceDescriptors])

  function toggleValue(values: string[], value: string) {
    return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]
  }

  function updateDraft(partial: Partial<CommissionRulePayload>) {
    setDraft((current) => ({
      ...current,
      ...partial,
    }))
  }

  function updateConditions<K extends keyof CommissionRulePayload["conditions"]>(
    key: K,
    value: CommissionRulePayload["conditions"][K],
  ) {
    setDraft((current) => {
      const nextValue =
        current.formulaType === "fixed_amount_per_service" && key === "itemTypes"
          ? ([] as CommissionRulePayload["conditions"][K])
          : value

      return {
        ...current,
        conditions: {
          ...current.conditions,
          [key]: nextValue,
        },
      }
    })
  }

  function updateBranchSelection(nextBranchIds: string[]) {
    const nextBranches = branches.filter((branch) => nextBranchIds.includes(branch.id))
    const nextCodes = nextBranches.map((branch) => branch.code)
    setDraft((current) => ({
      ...current,
      branchIds: nextBranchIds,
      branchCodes: nextCodes,
      conditions: {
        ...current.conditions,
        branchIds: nextBranchIds,
        branchCodes: nextCodes,
      },
    }))
  }

  function updateEventType(nextEventType: CommissionRulePayload["eventType"]) {
    const nextRole = deriveSupportedRoles(nextEventType)[0] ?? ""
    setDraft((current) => ({
      ...current,
      eventType: nextEventType,
      appliesToRole: nextRole,
      appliesToStaffIds: [],
      conditions: {
        ...current.conditions,
        paymentStatuses: nextEventType === "payment_based" ? current.conditions.paymentStatuses : [],
      },
    }))
  }

  function updateFormulaType(nextFormulaType: CommissionRulePayload["formulaType"]) {
    setDraft((current) => ({
      ...current,
      formulaType: nextFormulaType,
      conditions: {
        ...current.conditions,
        itemTypes: nextFormulaType === "fixed_amount_per_service" ? [] : current.conditions.itemTypes,
      },
      formulaConfig: buildDefaultFormulaConfig(nextFormulaType),
    }))
  }

  function updateTier(index: number, nextTier: Partial<CommissionTier>) {
    setDraft((current) => {
      if (current.formulaType !== "tiered_percentage") {
        return current
      }

      const formulaConfig = current.formulaConfig as {
        baseField: "grossAmount" | "netAmount" | "collectedAmount"
        tiers: CommissionTier[]
      }

      return {
        ...current,
        formulaConfig: {
          ...formulaConfig,
          tiers: formulaConfig.tiers.map((tier, tierIndex) => (tierIndex === index ? { ...tier, ...nextTier } : tier)),
        },
      }
    })
  }

  async function submit(nextStatus: CommissionRulePayload["status"]) {
    setSubmitAttempted(true)

    if (validationMessages.length > 0) {
      return
    }

    await onSave({
      ...draft,
      status: nextStatus,
    })
  }

  const preview = buildRulePreview(draft)
  const formulaSummary = formatCommissionFormulaSummary(draft.formulaType, draft.formulaConfig)
  const triggerDescription = describeEventTrigger(draft.eventType)
  const allSpecificStaffSelected = staffItems.length > 0 && staffItems.every((staff) => draft.appliesToStaffIds.includes(staff.value))

  return (
    <div className="page-stack page-stack--workspace analytics-report commission-editor">
      <PageHeaderBlock title={title} onCancel={onCancel} />

      <div className="commission-editor__layout">
        <Panel
          className="commission-editor__panel"
          title="Step 1. What triggers commission?"
          subtitle="Choose the reporting event first because it determines which staff roles and people can receive commission."
        >
          <div className="commission-form__segmented">
            {[
              { value: "sale_based", label: "Sale based" },
              { value: "payment_based", label: "Payment based" },
              { value: "treatment_completed_based", label: "Treatment completed" },
            ].map((option) => (
              <button
                key={option.value}
                className={`button commission-form__trigger-option ${draft.eventType === option.value ? "commission-form__trigger-option--selected" : "commission-form__trigger-option--idle"}`.trim()}
                onClick={() => updateEventType(option.value as CommissionRulePayload["eventType"])}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="commission-form__trigger-summary">
            <strong>Selected trigger</strong>
            <span>{triggerDescription}</span>
          </div>
        </Panel>

        <Panel
          className="commission-editor__panel"
          title="Step 2. Who gets commission?"
          subtitle="Pick the eligible staff role for this trigger, then narrow it to specific people only if needed."
        >
          <div className="commission-form__grid commission-form__grid--two">
            <label className="field">
              <span>Rule name</span>
              <input
                type="text"
                value={draft.ruleName}
                onChange={(event) => updateDraft({ ruleName: event.target.value })}
                placeholder="Therapist facial commission"
              />
            </label>

            <label className="field">
              <span>Priority</span>
              <input
                type="number"
                min={0}
                value={draft.priority}
                onChange={(event) => updateDraft({ priority: Number(event.target.value) })}
              />
            </label>
          </div>

          <label className="field">
            <span>Description</span>
            <textarea
              value={draft.description}
              onChange={(event) => updateDraft({ description: event.target.value })}
              rows={3}
              placeholder="Optional internal note so the merchant remembers why this rule exists."
            />
          </label>

          <div className="commission-form__grid commission-form__grid--two">
            <label className="field">
              <span>Role</span>
              <select
                value={draft.appliesToRole}
                onChange={(event) => updateDraft({ appliesToRole: event.target.value, appliesToStaffIds: [] })}
              >
                {supportedRoles.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Effective from</span>
              <input
                type="date"
                value={draft.effectiveFrom}
                onChange={(event) => updateDraft({ effectiveFrom: event.target.value })}
              />
            </label>
          </div>

          <label className="field">
            <span>Effective to</span>
            <input type="date" value={draft.effectiveTo} onChange={(event) => updateDraft({ effectiveTo: event.target.value })} />
          </label>

          <div className="commission-form__subsection">
            <strong>Specific staff</strong>
            <span>Leave this empty to include everyone in the selected role. This list updates based on the trigger selected above.</span>
          </div>
          {staffItems.length > 0 ? (
            <div className="commission-form__selection-actions">
              <button
                className="button button--ghost"
                type="button"
                onClick={() => updateDraft({ appliesToStaffIds: staffItems.map((staff) => staff.value) })}
                disabled={allSpecificStaffSelected}
              >
                Select all
              </button>
              <button
                className="button button--ghost"
                type="button"
                onClick={() => updateDraft({ appliesToStaffIds: [] })}
                disabled={draft.appliesToStaffIds.length === 0}
              >
                Clear all
              </button>
            </div>
          ) : null}
          <CheckboxGrid
            items={staffItems}
            selectedValues={draft.appliesToStaffIds}
            onToggle={(value) => updateDraft({ appliesToStaffIds: toggleValue(draft.appliesToStaffIds, value) })}
            emptyLabel="No matching staff were found in the current reporting data."
          />
        </Panel>

        <Panel
          className="commission-editor__panel"
          title="Step 3. What does it apply to?"
          subtitle="Use branch, category, service, item type, and payment status filters only when you need a narrower scope."
        >
          <div className="commission-form__subsection">
            <strong>Branches</strong>
            <span>
              {branches.length === 1
                ? "The current clinic is applied automatically to keep this rule inside the selected clinic."
                : "Selected branches define the rule scope inside this merchant."}
            </span>
          </div>
          {branches.length === 1 ? (
            <div className="inline-note">
              {branches[0].name} ({branches[0].code})
            </div>
          ) : (
            <CheckboxGrid
              items={branches.map((branch) => ({
                value: branch.id,
                label: branch.name,
                hint: branch.code,
              }))}
              selectedValues={draft.branchIds}
              onToggle={(value) => updateBranchSelection(toggleValue(draft.branchIds, value))}
              emptyLabel="No branches are available under the current merchant."
            />
          )}

          <div className="commission-form__subsection">
            <strong>Service categories</strong>
            <span>Categories are derived from service names because the reporting views do not expose a native category field.</span>
          </div>
          <CheckboxGrid
            items={(options?.categories ?? []).map((category) => ({
              value: category,
              label: category,
            }))}
            selectedValues={draft.conditions.categoryNames}
            onToggle={(value) => updateConditions("categoryNames", toggleValue(draft.conditions.categoryNames, value))}
            emptyLabel="No service categories were found."
          />

          <div className="commission-form__subsection">
            <strong>Specific services</strong>
            <span>Use search to find services quickly, then check the exact ones to include. Leave empty to keep the rule broad.</span>
          </div>
          <SearchableSelectionList
            items={serviceItems}
            selectedValues={draft.conditions.serviceNames}
            onToggle={(value) => updateConditions("serviceNames", toggleValue(draft.conditions.serviceNames, value))}
            onReplaceSelected={(values) => updateConditions("serviceNames", values)}
            emptyLabel="No services were found in the current reporting scope."
            title="Search services"
            searchPlaceholder="Search by service name or category"
          />

          <div className="commission-form__subsection">
            <strong>Item types</strong>
          </div>
          {draft.formulaType === "fixed_amount_per_service" ? (
            <div className="commission-form__formula-summary">
              <strong>Item type filter not used</strong>
              <span>Fixed amount per service matches the selected service names directly, so treatments from both direct services and package usage can qualify.</span>
            </div>
          ) : (
            <CheckboxGrid
              items={(options?.itemTypes ?? []).map((itemType) => ({
                value: itemType,
                label: itemType,
              }))}
              selectedValues={draft.conditions.itemTypes}
              onToggle={(value) =>
                updateConditions(
                  "itemTypes",
                  toggleValue(draft.conditions.itemTypes, value) as CommissionRulePayload["conditions"]["itemTypes"],
                )
              }
              emptyLabel="No item types are available."
            />
          )}

          {draft.eventType === "payment_based" ? (
            <>
              <div className="commission-form__subsection">
                <strong>Payment status</strong>
              </div>
              <CheckboxGrid
                items={(options?.paymentStatuses ?? []).map((status) => ({
                  value: status,
                  label: status,
                }))}
                selectedValues={draft.conditions.paymentStatuses}
                onToggle={(value) => updateConditions("paymentStatuses", toggleValue(draft.conditions.paymentStatuses, value))}
                emptyLabel="No payment statuses were found."
              />
            </>
          ) : null}
        </Panel>

        <Panel
          className="commission-editor__panel"
          title="Step 4. How is it calculated?"
          subtitle="Pick a simple formula. V1 keeps this structured and explainable instead of allowing raw scripting."
        >
          <label className="field">
            <span>Formula type</span>
            <select value={draft.formulaType} onChange={(event) => updateFormulaType(event.target.value as CommissionRulePayload["formulaType"])}>
              <option value="percentage_of_amount">Percentage of amount</option>
              <option value="fixed_amount_per_item">Fixed amount per item</option>
              <option value="fixed_amount_per_completed_treatment">Fixed amount per completed treatment</option>
              <option value="fixed_amount_per_service">Fixed amount per service</option>
              <option value="tiered_percentage">Tiered percentage</option>
              <option value="target_bonus">Target bonus</option>
            </select>
          </label>

          {draft.formulaType === "percentage_of_amount" ? (
            <div className="commission-form__grid commission-form__grid--two">
              <label className="field">
                <span>Base field</span>
                <select
                  value={(draft.formulaConfig as { baseField: string }).baseField}
                  onChange={(event) =>
                    updateDraft({
                      formulaConfig: {
                        ...(draft.formulaConfig as { baseField: string; value: number }),
                        baseField: event.target.value as "grossAmount" | "netAmount" | "collectedAmount",
                      },
                    })
                  }
                >
                  <option value="grossAmount">Gross amount</option>
                  <option value="netAmount">Net amount</option>
                  <option value="collectedAmount">Collected amount</option>
                </select>
              </label>
              <label className="field">
                <span>Percent value</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={(draft.formulaConfig as { value: number }).value}
                  onChange={(event) =>
                    updateDraft({
                      formulaConfig: {
                        ...(draft.formulaConfig as { baseField: string; value: number }),
                        value: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
            </div>
          ) : null}

          {draft.formulaType === "fixed_amount_per_item" || draft.formulaType === "fixed_amount_per_completed_treatment" ? (
            <label className="field">
              <span>Fixed amount</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={(draft.formulaConfig as { value: number }).value}
                onChange={(event) => updateDraft({ formulaConfig: { value: Number(event.target.value) } })}
              />
            </label>
          ) : null}

          {draft.formulaType === "fixed_amount_per_service" ? (
            <FixedAmountPerServiceEditor
              selectedServices={selectedServiceDescriptors}
              formulaConfig={draft.formulaConfig}
              onChange={(nextConfig) => updateDraft({ formulaConfig: nextConfig })}
            />
          ) : null}

          {draft.formulaType === "tiered_percentage" ? (
            <div className="commission-form__stack">
              <label className="field">
                <span>Base field</span>
                <select
                  value={(draft.formulaConfig as { baseField: string }).baseField}
                  onChange={(event) =>
                    updateDraft({
                      formulaConfig: {
                        ...(draft.formulaConfig as { baseField: string; tiers: CommissionTier[] }),
                        baseField: event.target.value as "grossAmount" | "netAmount" | "collectedAmount",
                      },
                    })
                  }
                >
                  <option value="grossAmount">Gross amount</option>
                  <option value="netAmount">Net amount</option>
                  <option value="collectedAmount">Collected amount</option>
                </select>
              </label>

              {(draft.formulaConfig as { tiers: CommissionTier[] }).tiers.map((tier, index) => (
                <div key={`${tier.min}-${index}`} className="commission-form__tier-row">
                  <label className="field">
                    <span>Min</span>
                    <input type="number" value={tier.min} onChange={(event) => updateTier(index, { min: Number(event.target.value) })} />
                  </label>
                  <label className="field">
                    <span>Max</span>
                    <input
                      type="number"
                      value={tier.max ?? ""}
                      placeholder="No max"
                      onChange={(event) =>
                        updateTier(index, {
                          max: event.target.value === "" ? null : Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Percent</span>
                    <input
                      type="number"
                      step="0.01"
                      value={tier.value}
                      onChange={(event) => updateTier(index, { value: Number(event.target.value) })}
                    />
                  </label>
                </div>
              ))}

              <button
                className="button button--ghost"
                type="button"
                onClick={() =>
                  updateDraft({
                    formulaConfig: {
                      ...(draft.formulaConfig as { baseField: "grossAmount" | "netAmount" | "collectedAmount"; tiers: CommissionTier[] }),
                      tiers: [
                        ...(draft.formulaConfig as { tiers: CommissionTier[] }).tiers,
                        {
                          min: 0,
                          max: null,
                          value: 0,
                        },
                      ],
                    },
                  })
                }
              >
                Add tier
              </button>
            </div>
          ) : null}

          {draft.formulaType === "target_bonus" ? (
            <div className="commission-form__grid commission-form__grid--two">
              <label className="field">
                <span>Base field</span>
                <select
                  value={(draft.formulaConfig as { baseField: string }).baseField}
                  onChange={(event) =>
                    updateDraft({
                      formulaConfig: {
                        ...(draft.formulaConfig as {
                          baseField: string
                          threshold: number
                          bonusType: "percentage" | "fixed"
                          value: number
                        }),
                        baseField: event.target.value as "grossAmount" | "netAmount" | "collectedAmount",
                      },
                    })
                  }
                >
                  <option value="grossAmount">Gross amount</option>
                  <option value="netAmount">Net amount</option>
                  <option value="collectedAmount">Collected amount</option>
                </select>
              </label>
              <label className="field">
                <span>Threshold</span>
                <input
                  type="number"
                  min={0}
                  value={(draft.formulaConfig as { threshold: number }).threshold}
                  onChange={(event) =>
                    updateDraft({
                      formulaConfig: {
                        ...(draft.formulaConfig as {
                          baseField: string
                          threshold: number
                          bonusType: "percentage" | "fixed"
                          value: number
                        }),
                        threshold: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Bonus type</span>
                <select
                  value={(draft.formulaConfig as { bonusType: string }).bonusType}
                  onChange={(event) =>
                    updateDraft({
                      formulaConfig: {
                        ...(draft.formulaConfig as {
                          baseField: string
                          threshold: number
                          bonusType: "percentage" | "fixed"
                          value: number
                        }),
                        bonusType: event.target.value as "percentage" | "fixed",
                      },
                    })
                  }
                >
                  <option value="fixed">Fixed</option>
                  <option value="percentage">Percentage</option>
                </select>
              </label>
              <label className="field">
                <span>Bonus value</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={(draft.formulaConfig as { value: number }).value}
                  onChange={(event) =>
                    updateDraft({
                      formulaConfig: {
                        ...(draft.formulaConfig as {
                          baseField: string
                          threshold: number
                          bonusType: "percentage" | "fixed"
                          value: number
                        }),
                        value: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
            </div>
          ) : null}

          <div className="commission-form__formula-summary">
            <strong>Formula summary</strong>
            <span>{formulaSummary}</span>
          </div>
        </Panel>

        <Panel
          className="commission-editor__panel"
          title="Step 5. Preview"
          subtitle="This sentence is what the rule is expected to mean in plain business language."
        >
          <p className="commission-form__preview">{preview}</p>
        </Panel>

        <Panel
          className="commission-editor__panel"
          title="Step 6. Save"
          subtitle="Save as draft if the merchant is still reviewing it, or activate it when it is ready to participate in report generation."
        >
          {submitAttempted && validationMessages.length > 0 ? (
            <div className="commission-form__validation-list" role="alert">
              <strong>Check this rule before saving</strong>
              <ul>
                {validationMessages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="commission-form__actions">
            <button className="button button--ghost" type="button" onClick={onCancel}>
              Cancel
            </button>
            <button className="button button--secondary" type="button" disabled={saving} onClick={() => void submit("draft")}>
              {saving ? "Saving..." : "Save draft"}
            </button>
            <button className="button button--secondary" type="button" disabled={saving} onClick={() => void submit("active")}>
              {saving ? "Saving..." : "Save & activate"}
            </button>
          </div>
        </Panel>
      </div>
    </div>
  )
}

function PageHeaderBlock({ title, onCancel }: { title: string; onCancel: () => void }) {
  return (
    <div className="page-header commission-editor__header">
      <div className="page-header__context">
        <span className="page-header__title">{title}</span>
      </div>
      <div className="page-header__actions">
        <button className="button button--ghost" onClick={onCancel}>
          Back to rules
        </button>
      </div>
    </div>
  )
}
