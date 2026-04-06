import { useEffect, useMemo, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import {
  createCommissionAdjustment,
  fetchCommissionOptions,
  fetchCommissionRules,
  fetchCommissionRunDetail,
  fetchCommissionRuns,
  generateCommissionReport,
} from "../../../api/commission"
import { DataTable } from "../../../components/DataTable"
import { DateRangeControls } from "../../../components/DateRangeControls"
import { EmptyState, ErrorState } from "../../../components/StatusViews"
import { Panel } from "../../../components/Panel"
import { PageHeader } from "../../../components/PageHeader"
import { useAccess } from "../../access/AccessProvider"
import {
  endOfMonth,
  formatCommissionFormulaSummary,
  monthInputFromDate,
  startOfMonth,
} from "../../commission/commissionHelpers"
import type {
  CommissionEventType,
  CommissionRule,
  CommissionReportResult,
  CommissionRun,
  CommissionSourceOptions,
} from "../../commission/types"
import { buildDatedExportFileName, downloadExcelWorkbook } from "../../../utils/exportExcel"
import { formatCurrency, formatDate, formatDateTime } from "../../../utils/format"

type ReportLocationState = {
  preselectedRule?: {
    ruleId: string
    ruleName: string
    appliesToRole: string | null
    eventType: CommissionEventType
  }
}

function formatEventType(value: CommissionEventType) {
  if (value === "sale_based") {
    return "Sale based"
  }
  if (value === "payment_based") {
    return "Payment based"
  }
  return "Treatment completed"
}

function formatRuleStaffScope(rule: CommissionRule) {
  if (rule.appliesToStaffIds.length > 0) {
    return `${rule.appliesToStaffIds.length.toLocaleString("en-US")} selected staff`
  }

  return rule.appliesToRole || "All matching staff"
}

function formatRuleServiceScope(rule: CommissionRule) {
  if (rule.conditions.serviceNames.length > 0) {
    if (rule.conditions.serviceNames.length === 1) {
      return rule.conditions.serviceNames[0]
    }

    return `${rule.conditions.serviceNames.length.toLocaleString("en-US")} selected services`
  }

  if (rule.conditions.categoryNames.length > 0) {
    if (rule.conditions.categoryNames.length === 1) {
      return `${rule.conditions.categoryNames[0]} services`
    }

    return `${rule.conditions.categoryNames.length.toLocaleString("en-US")} categories`
  }

  return "All eligible services"
}

function formatResultEventType(value: CommissionReportResult["sourceType"]) {
  if (value === "sale_based") {
    return "Sale"
  }
  if (value === "payment_based") {
    return "Payment"
  }
  if (value === "treatment_completed_based") {
    return "Treatment completed"
  }
  return "Target bonus"
}

export function CommissionReportPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const routeState = (location.state ?? null) as ReportLocationState | null
  const preselectedRule = routeState?.preselectedRule ?? null
  const { currentBusiness, currentClinic } = useAccess()
  const [monthInput, setMonthInput] = useState(monthInputFromDate(startOfMonth()))
  const [range, setRange] = useState({
    fromDate: startOfMonth(),
    toDate: endOfMonth(monthInputFromDate(startOfMonth())),
  })
  const [selectedRuleId, setSelectedRuleId] = useState(preselectedRule?.ruleId ?? "")
  const [options, setOptions] = useState<CommissionSourceOptions | null>(null)
  const [rules, setRules] = useState<CommissionRule[]>([])
  const [runs, setRuns] = useState<CommissionRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState("")
  const [selectedRun, setSelectedRun] = useState<CommissionRun | null>(null)
  const [results, setResults] = useState<CommissionReportResult[]>([])
  const [selectedSummaryStaffId, setSelectedSummaryStaffId] = useState<string | null>(null)
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [loadingRules, setLoadingRules] = useState(false)
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [loadingRunDetail, setLoadingRunDetail] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [adjustmentAmount, setAdjustmentAmount] = useState("")
  const [adjustmentReason, setAdjustmentReason] = useState("")
  const [savingAdjustment, setSavingAdjustment] = useState(false)

  const branchOptions = useMemo(
    () => (currentClinic ? [{ id: currentClinic.id, code: currentClinic.code, name: currentClinic.name }] : []),
    [currentClinic],
  )
  const selectedBranchIds = useMemo(() => branchOptions.map((branch) => branch.id), [branchOptions])
  const selectedBranchCodes = useMemo(
    () => branchOptions.filter((branch) => selectedBranchIds.includes(branch.id)).map((branch) => branch.code),
    [branchOptions, selectedBranchIds],
  )
  const monthKey = range.fromDate.slice(0, 7) === range.toDate.slice(0, 7) ? range.fromDate.slice(0, 7) : undefined

  const activeRules = useMemo(
    () =>
      rules
        .filter((rule) => rule.status === "active")
        .sort((left, right) => left.ruleName.localeCompare(right.ruleName)),
    [rules],
  )

  const focusedRule = useMemo(
    () => activeRules.find((rule) => rule.id === selectedRuleId) ?? null,
    [activeRules, selectedRuleId],
  )

  const activeRuleLabel = focusedRule ? `${focusedRule.ruleName} v${focusedRule.version}` : preselectedRule?.ruleName ?? null

  const filteredResults = useMemo(
    () => (focusedRule ? results.filter((row) => row.ruleId === focusedRule.id) : []),
    [focusedRule, results],
  )

  const filteredRuns = useMemo(
    () => (focusedRule ? runs.filter((run) => run.selectedRuleIds.includes(focusedRule.id)) : []),
    [focusedRule, runs],
  )

  const detailRows = useMemo(() => {
    if (!selectedSummaryStaffId) {
      return filteredResults
    }

    return filteredResults.filter((row) => row.staffId === selectedSummaryStaffId)
  }, [filteredResults, selectedSummaryStaffId])

  const summaryRows = useMemo(() => {
    if (!selectedRun) {
      return []
    }

    if (!selectedRuleId) {
      return selectedRun.staffSummaries
    }

    const grouped = new Map<
      string,
      {
        staffId: string
        staffName: string
        staffRole: string
        branchCodes: Set<string>
        baseAmount: number
        commissionAmount: number
        adjustmentAmount: number
        finalPayoutAmount: number
        transactionCount: number
        completedTreatmentCount: number
        appliedRuleNames: Set<string>
      }
    >()

    filteredResults.forEach((row) => {
      const existing =
        grouped.get(row.staffId) ??
        {
          staffId: row.staffId,
          staffName: row.staffName,
          staffRole: row.staffRole,
          branchCodes: new Set<string>(),
          baseAmount: 0,
          commissionAmount: 0,
          adjustmentAmount: 0,
          finalPayoutAmount: 0,
          transactionCount: 0,
          completedTreatmentCount: 0,
          appliedRuleNames: new Set<string>(),
        }

      existing.branchCodes.add(row.branchCode)
      existing.baseAmount += row.baseAmount
      existing.commissionAmount += row.commissionAmount
      existing.finalPayoutAmount += row.commissionAmount
      existing.transactionCount += 1
      existing.completedTreatmentCount += row.breakdown.completedTreatmentCount
      existing.appliedRuleNames.add(`${row.ruleName} v${row.ruleVersion}`)
      grouped.set(row.staffId, existing)
    })

    return [...grouped.values()]
      .map((row) => ({
        ...row,
        branchCodes: [...row.branchCodes],
        appliedRuleNames: [...row.appliedRuleNames],
      }))
      .sort((left, right) => right.commissionAmount - left.commissionAmount)
  }, [filteredResults, focusedRule, selectedRun])

  const displayedTotals = useMemo(() => {
    if (!selectedRun) {
      return null
    }

    if (!focusedRule) {
      return null
    }

    return {
      totalBaseAmount: filteredResults.reduce((sum, row) => sum + row.baseAmount, 0),
      totalCommissionAmount: filteredResults.reduce((sum, row) => sum + row.commissionAmount, 0),
      totalAdjustmentAmount: 0,
      finalPayoutAmount: filteredResults.reduce((sum, row) => sum + row.commissionAmount, 0),
      sourceRowCount: filteredResults.length,
      matchedRowCount: filteredResults.length,
      skippedRowCount: 0,
      conflictRowCount: 0,
      missingDataRowCount: 0,
      bonusRowCount: 0,
    }
  }, [filteredResults, focusedRule, selectedRun])

  const selectedStaffNameMap = useMemo(() => {
    const entries = new Map<string, string>()

    ;(options?.staff ?? []).forEach((staff) => {
      entries.set(staff.id, staff.name)
    })

    selectedRun?.staffSummaries.forEach((staff) => {
      entries.set(staff.staffId, staff.staffName)
    })

    return entries
  }, [options?.staff, selectedRun?.staffSummaries])

  const focusedRuleStaffLabels = useMemo(() => {
    const staffIds = focusedRule?.appliesToStaffIds ?? []
    return staffIds.map((staffId) => selectedStaffNameMap.get(staffId) ?? staffId)
  }, [focusedRule?.appliesToStaffIds, selectedStaffNameMap])

  function handleReturnToReportList() {
    setSelectedRuleId("")
    setSelectedRunId("")
    setSelectedRun(null)
    setResults([])
    setSelectedSummaryStaffId(null)
    setNotice("Choose a configured rule to open its report.")
    navigate("/analytics/commission", { replace: true })
  }

  useEffect(() => {
    if (!preselectedRule) {
      return
    }

    setSelectedRuleId(preselectedRule.ruleId)
    setNotice(`Report context loaded for ${preselectedRule.ruleName}.`)
  }, [preselectedRule])

  useEffect(() => {
    if (focusedRule) {
      setNotice(`${focusedRule.ruleName} v${focusedRule.version} uses the saved rule scope below. Choose a month and generate a snapshot when needed.`)
      return
    }

    if (activeRules.length > 0) {
      setNotice("Choose a configured rule to open its report.")
      return
    }

    setNotice(null)
  }, [activeRules.length, focusedRule])

  useEffect(() => {
    if (summaryRows.length === 0) {
      setSelectedSummaryStaffId(null)
      return
    }

    if (selectedSummaryStaffId && summaryRows.some((row) => row.staffId === selectedSummaryStaffId)) {
      return
    }

    setSelectedSummaryStaffId(summaryRows[0]?.staffId ?? null)
  }, [selectedSummaryStaffId, summaryRows])

  useEffect(() => {
    if (!currentBusiness || !currentClinic || selectedBranchIds.length === 0) {
      return
    }

    let active = true
    setLoadingOptions(true)
    setError(null)

    fetchCommissionOptions({
      clinicId: currentClinic.id,
      merchantId: currentBusiness.id,
      merchantName: currentBusiness.name,
      branchIds: selectedBranchIds,
      branchCodes: selectedBranchCodes,
    })
      .then((nextOptions) => {
        if (active) {
          setOptions(nextOptions)
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Commission report filters could not be loaded.")
        }
      })
      .finally(() => {
        if (active) {
          setLoadingOptions(false)
        }
      })

    return () => {
      active = false
    }
  }, [currentBusiness, currentClinic, selectedBranchCodes, selectedBranchIds])

  useEffect(() => {
    if (!currentBusiness || !currentClinic) {
      return
    }

    let active = true
    setLoadingRules(true)

    fetchCommissionRules({
      clinicId: currentClinic.id,
      merchantId: currentBusiness.id,
      merchantName: currentBusiness.name,
      branchIds: branchOptions.map((branch) => branch.id),
      branchCodes: branchOptions.map((branch) => branch.code),
    })
      .then((nextRules) => {
        if (active) {
          setRules(nextRules)
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Commission report rules could not be loaded.")
        }
      })
      .finally(() => {
        if (active) {
          setLoadingRules(false)
        }
      })

    return () => {
      active = false
    }
  }, [branchOptions, currentBusiness, currentClinic])

  useEffect(() => {
    if (!currentBusiness || !currentClinic) {
      return
    }

    let active = true
    setLoadingRuns(true)

    fetchCommissionRuns({
      clinicId: currentClinic.id,
      merchantId: currentBusiness.id,
      merchantName: currentBusiness.name,
      branchIds: branchOptions.map((branch) => branch.id),
      branchCodes: branchOptions.map((branch) => branch.code),
      monthKey,
    })
      .then((nextRuns) => {
        if (active) {
          setRuns(nextRuns)
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Commission snapshots could not be loaded.")
        }
      })
      .finally(() => {
        if (active) {
          setLoadingRuns(false)
        }
      })

    return () => {
      active = false
    }
  }, [branchOptions, currentBusiness, currentClinic, monthKey])

  useEffect(() => {
    if (!focusedRule) {
      setSelectedRunId("")
      setSelectedRun(null)
      setResults([])
      return
    }

    if (selectedRunId && filteredRuns.some((run) => run.id === selectedRunId)) {
      return
    }

    setSelectedRunId(filteredRuns[0]?.id ?? "")
  }, [filteredRuns, focusedRule, selectedRunId])

  useEffect(() => {
    if (!selectedRunId || !currentClinic) {
      setSelectedRun(null)
      setResults([])
      return
    }

    let active = true
    setLoadingRunDetail(true)

    fetchCommissionRunDetail(selectedRunId, currentClinic.id)
      .then((detail) => {
        if (active) {
          setSelectedRun(detail.run)
          setResults(detail.results)
          setSelectedSummaryStaffId((current) =>
            current && detail.run.staffSummaries.some((summary) => summary.staffId === current)
              ? current
              : detail.run.staffSummaries[0]?.staffId ?? null,
          )
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Commission run details could not be loaded.")
        }
      })
      .finally(() => {
        if (active) {
          setLoadingRunDetail(false)
        }
      })

    return () => {
      active = false
    }
  }, [currentClinic, selectedRunId])

  async function handleGenerate() {
    if (!currentBusiness || !currentClinic || !focusedRule) {
      return
    }

    setGenerating(true)
    setError(null)
    setNotice(null)

    try {
      const generated = await generateCommissionReport({
        clinicId: currentClinic.id,
        merchantId: currentBusiness.id,
        merchantName: currentBusiness.name,
        branchIds: focusedRule.branchIds.length > 0 ? focusedRule.branchIds : selectedBranchIds,
        branchCodes: focusedRule.branchCodes.length > 0 ? focusedRule.branchCodes : selectedBranchCodes,
        fromDate: range.fromDate,
        toDate: range.toDate,
        staffIds: focusedRule.appliesToStaffIds,
        staffRoles: focusedRule.appliesToRole ? [focusedRule.appliesToRole] : [],
      })
      setSelectedRunId(generated.run.id)
      setSelectedRun(generated.run)
      setResults(generated.results)
      setRuns((current) => [generated.run, ...current.filter((run) => run.id !== generated.run.id)])
      setSelectedSummaryStaffId(generated.run.staffSummaries[0]?.staffId ?? null)
      setNotice(`Snapshot generated for ${focusedRule.ruleName} v${focusedRule.version}.`)
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Commission report generation failed.")
    } finally {
      setGenerating(false)
    }
  }

  async function handleExport() {
    if (!selectedRun || filteredResults.length === 0) {
      return
    }

    setExporting(true)
    try {
      await downloadExcelWorkbook({
        fileName: buildDatedExportFileName("commission-report", selectedRun.dateFrom, selectedRun.dateTo),
        sheetName: "Commission",
        headers: [
          "Staff",
          "Role",
          "Event Date",
          "Invoice / Source Ref",
          "Customer",
          "Event Type",
          "Service",
          "Category",
          "Base Amount",
          "Formula",
          "Commission",
          "Rule",
          "Explanation",
        ],
        rows: filteredResults.map((row) => [
          row.staffName,
          row.staffRole,
          row.sourceDate,
          row.sourceRef,
          row.breakdown.customerName || "",
          formatResultEventType(row.sourceType),
          row.breakdown.serviceName || "",
          row.breakdown.categoryName || "",
          row.baseAmount,
          row.formulaSummary,
          row.commissionAmount,
          `${row.ruleName} v${row.ruleVersion}`,
          row.explanation,
        ]),
      })
    } finally {
      setExporting(false)
    }
  }

  async function handleAdjustmentSave() {
    if (!currentBusiness || !currentClinic || !selectedRun || !selectedSummaryStaffId || !adjustmentReason.trim()) {
      return
    }

    const targetStaff =
      selectedRun.staffSummaries.find((summary) => summary.staffId === selectedSummaryStaffId) ??
      (selectedRun.staffSummaries[0] || null)

    if (!targetStaff) {
      return
    }

    setSavingAdjustment(true)
    setError(null)

    try {
      await createCommissionAdjustment({
        clinicId: currentClinic.id,
        merchantId: currentBusiness.id,
        merchantName: currentBusiness.name,
        monthKey: selectedRun.monthKey,
        staffId: targetStaff.staffId,
        staffName: targetStaff.staffName,
        amount: Number(adjustmentAmount || 0),
        reason: adjustmentReason.trim(),
      })
      setAdjustmentAmount("")
      setAdjustmentReason("")
      setNotice("Adjustment saved. Generate a new snapshot to capture it in the report history.")
    } catch (adjustmentError) {
      setError(adjustmentError instanceof Error ? adjustmentError.message : "Adjustment could not be saved.")
    } finally {
      setSavingAdjustment(false)
    }
  }

  const reportTitle =
    focusedRule ? activeRuleLabel || focusedRule.ruleName : selectedRuleId && preselectedRule ? preselectedRule.ruleName : "Commission report"
  const focusedRuleSpecificStaffSummary =
    focusedRuleStaffLabels.length > 0
      ? focusedRuleStaffLabels.slice(0, 4).join(", ")
      : focusedRule?.appliesToRole
        ? `All ${focusedRule.appliesToRole} staff in this rule`
        : "All matching staff"

  if (!currentBusiness || !currentClinic) {
    return (
      <div className="page-stack page-stack--workspace analytics-report commission-report">
        <EmptyState
          label="No merchant context"
          detail="Choose a clinic first so commission reports can be generated in the current merchant scope."
        />
      </div>
    )
  }

  return (
    <div className="page-stack page-stack--workspace analytics-report commission-report">
      <PageHeader
        title={reportTitle}
        actions={
          focusedRule ? (
            <div className="commission-report__toolbar">
              <button className="button button--ghost" onClick={handleReturnToReportList}>
                Back to report list
              </button>
              <label className="field field--compact">
                <span>Month</span>
                <input
                  type="month"
                  value={monthInput}
                  onChange={(event) => {
                    const nextMonth = event.target.value
                    setMonthInput(nextMonth)
                    setRange({
                      fromDate: `${nextMonth}-01`,
                      toDate: endOfMonth(nextMonth),
                    })
                  }}
                />
              </label>

              <DateRangeControls
                fromDate={range.fromDate}
                toDate={range.toDate}
                onChange={(next) => {
                  setRange(next)
                  setMonthInput(monthInputFromDate(next.fromDate))
                }}
              />

              <button className="button button--secondary" disabled={generating || selectedBranchIds.length === 0} onClick={() => void handleGenerate()}>
                {generating ? "Generating..." : "Generate snapshot"}
              </button>
            </div>
          ) : null
        }
      />

      {notice ? <div className="inline-note">{notice}</div> : null}
      {error ? <ErrorState label="Commission report issue" detail={error} /> : null}

      {!focusedRule ? (
        <Panel
          className="commission-report__filter-panel"
          title="Configured reports"
          subtitle="Open an active commission rule to view its saved snapshots and generate a new monthly report from the rule setup."
        >
          {loadingRules ? <div className="inline-note inline-note--loading">Loading configured reports...</div> : null}
          {!loadingRules && activeRules.length === 0 ? (
            <EmptyState
              label="No active commission reports yet"
              detail="Create and activate a commission rule first, then it will appear here as a report."
            />
          ) : null}
          {!loadingRules && activeRules.length > 0 ? (
            <DataTable
              columns={[
                {
                  key: "ruleName",
                  header: "Report",
                  render: (rule) => (
                    <div className="commission-settings__rule-cell">
                      <strong>{rule.ruleName}</strong>
                      <span>v{rule.version}</span>
                    </div>
                  ),
                },
                {
                  key: "eventType",
                  header: "Trigger",
                  render: (rule) => formatEventType(rule.eventType),
                },
                {
                  key: "staffScope",
                  header: "Staff scope",
                  render: (rule) => formatRuleStaffScope(rule),
                },
                {
                  key: "serviceScope",
                  header: "Service scope",
                  render: (rule) => formatRuleServiceScope(rule),
                },
                {
                  key: "formula",
                  header: "Formula",
                  render: (rule) => formatCommissionFormulaSummary(rule.formulaType, rule.formulaConfig),
                },
                {
                  key: "actions",
                  header: "Actions",
                  render: (rule) => (
                    <button className="button button--ghost" onClick={() => setSelectedRuleId(rule.id)}>
                      Open report
                    </button>
                  ),
                },
              ]}
              rows={activeRules}
              rowKey={(rule) => rule.id}
              onRowClick={(rule) => setSelectedRuleId(rule.id)}
            />
          ) : null}
        </Panel>
      ) : (
        <Panel
          className="commission-report__filter-panel"
          title="Rule scope"
          subtitle="This report uses the saved rule configuration. You only choose the month and date range when generating a new snapshot."
        >
          <div className="commission-report__scope-grid">
            <article className="commission-report__scope-card">
              <strong>Branch</strong>
              <span>
                {branchOptions.length > 0 ? `${branchOptions[0].name} (${branchOptions[0].code})` : "No clinic selected"}
              </span>
            </article>
            <article className="commission-report__scope-card">
              <strong>Trigger</strong>
              <span>{formatEventType(focusedRule.eventType)}</span>
            </article>
            <article className="commission-report__scope-card">
              <strong>Formula</strong>
              <span>{formatCommissionFormulaSummary(focusedRule.formulaType, focusedRule.formulaConfig)}</span>
            </article>
            <article className="commission-report__scope-card">
              <strong>Staff role</strong>
              <span>{focusedRule.appliesToRole || "All matching staff"}</span>
            </article>
            <article className="commission-report__scope-card">
              <strong>Specific staff</strong>
              {loadingOptions ? <span>Loading staff scope...</span> : <span>{focusedRuleSpecificStaffSummary}</span>}
              {focusedRuleStaffLabels.length > 4 ? (
                <small>+{(focusedRuleStaffLabels.length - 4).toLocaleString("en-US")} more selected in this rule</small>
              ) : null}
            </article>
            <article className="commission-report__scope-card">
              <strong>Service scope</strong>
              <span>{formatRuleServiceScope(focusedRule)}</span>
            </article>
          </div>
        </Panel>
      )}

      <div className="commission-report__layout">
        <Panel
          className="commission-report__history-panel"
          title={focusedRule ? "Snapshots" : "How It Works"}
          subtitle={
            focusedRule
              ? "Every generation creates a new saved run for this rule so historical commission results stay stable."
              : "Commission reports come from your active commission rules. Open a rule first, then generate or review snapshots for that rule."
          }
        >
          {!focusedRule ? (
            <EmptyState
              label="Choose a report to continue"
              detail="Select a configured report from the list above. The page will then show the rule title, saved scope, and snapshots for that report only."
            />
          ) : null}
          {focusedRule && loadingRuns ? <div className="inline-note inline-note--loading">Loading snapshots...</div> : null}
          {focusedRule && !loadingRuns && filteredRuns.length === 0 ? (
            <EmptyState
              label="No snapshots yet for this report"
              detail="Generate the first snapshot for this rule and selected month."
            />
          ) : null}
          {focusedRule && !loadingRuns && filteredRuns.length > 0 ? (
            <div className="commission-report__snapshot-list">
              {filteredRuns.map((run) => (
                <button
                  key={run.id}
                  className={`commission-report__snapshot-item ${selectedRunId === run.id ? "commission-report__snapshot-item--selected" : ""}`.trim()}
                  onClick={() => setSelectedRunId(run.id)}
                >
                  <strong>{formatDateTime(run.generatedAt)}</strong>
                  <span>{run.status}</span>
                  <small>{formatCurrency(run.summaryTotals.totalCommissionAmount, currentClinic.currency || "MMK")}</small>
                </button>
              ))}
            </div>
          ) : null}
        </Panel>

        <div className="commission-report__workspace">
          {!focusedRule ? (
            <Panel
              className="commission-report__results-panel"
              title="Report preview"
              subtitle="After you open a configured report, this area will show the saved rule scope, snapshots, payout summary, and commission drilldown for that rule."
            >
              <EmptyState
                label="No report selected"
                detail="Choose a configured rule first. The report page will then use that rule name in the title and apply its saved staff and service setup automatically."
              />
            </Panel>
          ) : (
            <>
              <div className="report-kpi-strip">
                <article className="report-kpi-strip__card">
                  <span className="report-kpi-strip__label">Total commission</span>
                  <strong className="report-kpi-strip__value">
                    {formatCurrency(displayedTotals?.totalCommissionAmount ?? 0, currentClinic.currency || "MMK")}
                  </strong>
                  <span className="report-kpi-strip__hint">Showing only {activeRuleLabel}.</span>
                </article>
                <article className="report-kpi-strip__card">
                  <span className="report-kpi-strip__label">Adjustments</span>
                  <strong className="report-kpi-strip__value">
                    {formatCurrency(displayedTotals?.totalAdjustmentAmount ?? 0, currentClinic.currency || "MMK")}
                  </strong>
                  <span className="report-kpi-strip__hint">
                    Adjustments stay at the snapshot level, so this rule view shows only adjustments saved with the snapshot.
                  </span>
                </article>
                <article className="report-kpi-strip__card">
                  <span className="report-kpi-strip__label">Final payout</span>
                  <strong className="report-kpi-strip__value">
                    {formatCurrency(displayedTotals?.finalPayoutAmount ?? 0, currentClinic.currency || "MMK")}
                  </strong>
                  <span className="report-kpi-strip__hint">
                    {displayedTotals?.matchedRowCount ?? 0} matched row(s) for this rule
                  </span>
                </article>
              </div>

              <Panel
                className="commission-report__results-panel"
                title={`${focusedRule.ruleName} payout summary`}
                subtitle="Click a staff row to inspect the exact transactions and explanations behind this rule payout."
                action={
                  <div className="report-panel__actions">
                    <button className="button button--secondary" disabled={!selectedRun || exporting || filteredResults.length === 0} onClick={() => void handleExport()}>
                      {exporting ? "Exporting..." : "Export Excel"}
                    </button>
                  </div>
                }
              >
                {loadingRunDetail ? <div className="inline-note inline-note--loading">Loading snapshot details...</div> : null}
                {!loadingRunDetail && !selectedRun ? (
                  <EmptyState
                    label="No snapshot selected"
                    detail="Pick a saved snapshot from the list or generate a new one for this rule."
                  />
                ) : null}
                {!loadingRunDetail && selectedRun ? (
                  <DataTable
                    columns={[
                      { key: "staffName", header: "Staff", render: (row) => row.staffName },
                      { key: "staffRole", header: "Role", render: (row) => row.staffRole },
                      {
                        key: "baseAmount",
                        header: "Base amount",
                        render: (row) => formatCurrency(row.baseAmount, currentClinic.currency || "MMK"),
                      },
                      {
                        key: "commissionAmount",
                        header: "Commission",
                        render: (row) => formatCurrency(row.commissionAmount, currentClinic.currency || "MMK"),
                      },
                      {
                        key: "adjustmentAmount",
                        header: "Adjustments",
                        render: (row) => formatCurrency(row.adjustmentAmount, currentClinic.currency || "MMK"),
                      },
                      {
                        key: "finalPayoutAmount",
                        header: "Final payout",
                        render: (row) => formatCurrency(row.finalPayoutAmount, currentClinic.currency || "MMK"),
                      },
                      {
                        key: "transactionCount",
                        header: "Transactions",
                        render: (row) => row.transactionCount.toLocaleString("en-US"),
                      },
                      {
                        key: "appliedRuleNames",
                        header: "Primary rules",
                        render: (row) => row.appliedRuleNames.join(", "),
                      },
                    ]}
                    rows={summaryRows}
                    rowKey={(row) => row.staffId}
                    onRowClick={(row) => setSelectedSummaryStaffId(row.staffId)}
                    rowClassName={(row) => (selectedSummaryStaffId === row.staffId ? "commission-report__selected-row" : undefined)}
                  />
                ) : null}
              </Panel>
            </>
          )}

          {selectedRun ? (
            <Panel
              className="commission-report__detail-panel"
              title="Commission drilldown"
              subtitle={
                selectedSummaryStaffId
                  ? `Showing ${detailRows.length.toLocaleString("en-US")} explanation row(s) for the selected staff member.`
                  : "Showing all explanation rows in the snapshot."
              }
            >
              <div className="inline-note">
                Sale and payment rows show invoice numbers here. Treatment completed rows use the reporting source reference, so customer name is included to make review easier.
              </div>

              {selectedRun.warnings.length > 0 ? (
                <div className="commission-report__warnings">
                  {selectedRun.warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              ) : null}

              <DataTable
                columns={[
                  { key: "sourceDate", header: "Date", render: (row) => formatDate(row.sourceDate) },
                  { key: "sourceRef", header: "Invoice / Source", render: (row) => row.sourceRef || "—" },
                  { key: "customerName", header: "Customer", render: (row) => row.breakdown.customerName || "—" },
                  { key: "sourceType", header: "Event", render: (row) => formatResultEventType(row.sourceType) },
                  { key: "service", header: "Service", render: (row) => row.breakdown.serviceName || "—" },
                  { key: "category", header: "Category", render: (row) => row.breakdown.categoryName || "—" },
                  {
                    key: "baseAmount",
                    header: "Base",
                    render: (row) => formatCurrency(row.baseAmount, currentClinic.currency || "MMK"),
                  },
                  {
                    key: "commissionAmount",
                    header: "Commission",
                    render: (row) => formatCurrency(row.commissionAmount, currentClinic.currency || "MMK"),
                  },
                  { key: "ruleName", header: "Rule", render: (row) => `${row.ruleName} v${row.ruleVersion}` },
                  { key: "formulaSummary", header: "Formula", render: (row) => row.formulaSummary },
                  { key: "explanation", header: "Explanation", render: (row) => row.explanation },
                ]}
                rows={detailRows}
                rowKey={(row) => row.id}
              />
            </Panel>
          ) : null}

          {selectedRun ? (
            <Panel
              className="commission-report__detail-panel"
              title="Manual adjustment"
              subtitle="Adjustments are stored separately and only become part of history when you generate a fresh snapshot."
            >
              <div className="commission-report__adjustment-grid">
                <label className="field">
                  <span>Target staff</span>
                  <select value={selectedSummaryStaffId ?? ""} onChange={(event) => setSelectedSummaryStaffId(event.target.value || null)}>
                    <option value="">Select staff</option>
                    {selectedRun.staffSummaries.map((summary) => (
                      <option key={summary.staffId} value={summary.staffId}>
                        {summary.staffName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Amount</span>
                  <input type="number" value={adjustmentAmount} onChange={(event) => setAdjustmentAmount(event.target.value)} />
                </label>
                <label className="field">
                  <span>Reason</span>
                  <input type="text" value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} />
                </label>
                <button className="button button--secondary" disabled={savingAdjustment || !selectedSummaryStaffId} onClick={() => void handleAdjustmentSave()}>
                  {savingAdjustment ? "Saving..." : "Save adjustment"}
                </button>
              </div>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  )
}
