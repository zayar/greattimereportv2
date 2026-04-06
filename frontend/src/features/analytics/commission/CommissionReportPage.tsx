import { useEffect, useMemo, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import {
  createCommissionAdjustment,
  fetchCommissionOptions,
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
  monthInputFromDate,
  startOfMonth,
} from "../../commission/commissionHelpers"
import type {
  CommissionEventType,
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
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([])
  const [selectedStaffRole, setSelectedStaffRole] = useState("")
  const [selectedRuleId, setSelectedRuleId] = useState(preselectedRule?.ruleId ?? "")
  const [showScopeEditor, setShowScopeEditor] = useState(false)
  const [options, setOptions] = useState<CommissionSourceOptions | null>(null)
  const [runs, setRuns] = useState<CommissionRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState("")
  const [selectedRun, setSelectedRun] = useState<CommissionRun | null>(null)
  const [results, setResults] = useState<CommissionReportResult[]>([])
  const [selectedSummaryStaffId, setSelectedSummaryStaffId] = useState<string | null>(null)
  const [loadingOptions, setLoadingOptions] = useState(false)
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

  const sourceStaffOptions = useMemo(
    () => (selectedStaffRole ? (options?.staff ?? []).filter((staff) => staff.role === selectedStaffRole) : options?.staff ?? []),
    [options?.staff, selectedStaffRole],
  )

  const ruleOptions = useMemo(
    () =>
      Array.from(
        new Map(
          results.map((row) => [
            row.ruleId,
            {
              id: row.ruleId,
              label: `${row.ruleName} v${row.ruleVersion}`,
            },
          ]),
        ).values(),
      ).sort((left, right) => left.label.localeCompare(right.label)),
    [results],
  )

  const activeRuleLabel = useMemo(() => {
    if (!selectedRuleId) {
      return null
    }

    return ruleOptions.find((rule) => rule.id === selectedRuleId)?.label ?? preselectedRule?.ruleName ?? null
  }, [preselectedRule?.ruleName, ruleOptions, selectedRuleId])

  const filteredResults = useMemo(
    () => (selectedRuleId ? results.filter((row) => row.ruleId === selectedRuleId) : results),
    [results, selectedRuleId],
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
  }, [filteredResults, selectedRuleId, selectedRun])

  const displayedTotals = useMemo(() => {
    if (!selectedRun) {
      return null
    }

    if (!selectedRuleId) {
      return selectedRun.summaryTotals
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
  }, [filteredResults, selectedRuleId, selectedRun])

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

  const snapshotStaffLabels = useMemo(() => {
    const staffIds = selectedRun?.filters.staffIds ?? []
    return staffIds.map((staffId) => selectedStaffNameMap.get(staffId) ?? staffId)
  }, [selectedRun?.filters.staffIds, selectedStaffNameMap])

  function handleOpenNewReport() {
    if (preselectedRule) {
      navigate("/analytics/commission", { replace: true })
    }

    setSelectedRuleId("")
    setShowScopeEditor(true)
    setNotice("Set the scope below to generate a new commission snapshot.")
  }

  function handleBackToSnapshot() {
    setShowScopeEditor(false)
    setNotice("Showing the saved commission snapshot.")
  }

  useEffect(() => {
    if (!preselectedRule) {
      return
    }

    setSelectedRuleId(preselectedRule.ruleId)
    if (preselectedRule.appliesToRole) {
      setSelectedStaffRole(preselectedRule.appliesToRole)
    }
    setNotice(
      `Report context loaded for ${preselectedRule.ruleName}. Generate a snapshot to validate this rule, or use New report when you want to create a fresh report.`,
    )
  }, [preselectedRule])

  useEffect(() => {
    if (selectedRuleId && results.length > 0 && !results.some((row) => row.ruleId === selectedRuleId)) {
      setSelectedRuleId("")
    }
  }, [results, selectedRuleId])

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
          if (!selectedRunId || (selectedRunId && !nextRuns.some((run) => run.id === selectedRunId))) {
            setSelectedRunId(nextRuns[0]?.id ?? "")
          }
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
          setSelectedStaffIds(detail.run.filters.staffIds)
          setSelectedStaffRole(detail.run.filters.staffRoles[0] ?? "")
          setShowScopeEditor(false)
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
    if (!currentBusiness || !currentClinic || selectedBranchIds.length === 0) {
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
        branchIds: selectedBranchIds,
        branchCodes: selectedBranchCodes,
        fromDate: range.fromDate,
        toDate: range.toDate,
        staffIds: selectedStaffIds,
        staffRoles: selectedStaffRole ? [selectedStaffRole] : [],
      })
      setSelectedRunId(generated.run.id)
      setSelectedRun(generated.run)
      setResults(generated.results)
      setRuns((current) => [generated.run, ...current.filter((run) => run.id !== generated.run.id)])
      setShowScopeEditor(false)
      setSelectedSummaryStaffId(generated.run.staffSummaries[0]?.staffId ?? null)
      setNotice("Commission snapshot generated successfully.")
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
          "Source Ref",
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
          row.sourceType,
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
        title="Commission report"
        actions={
          <div className="commission-report__toolbar">
            {selectedRun ? (
              <button className="button button--ghost" onClick={showScopeEditor ? handleBackToSnapshot : handleOpenNewReport}>
                {showScopeEditor ? "Back to snapshot" : "New report"}
              </button>
            ) : preselectedRule ? (
              <button className="button button--ghost" onClick={handleOpenNewReport}>
                Back to report list
              </button>
            ) : null}
            {activeRuleLabel ? (
              <div className="commission-report__context-pill">
                <strong>Rule focus</strong>
                <span>{activeRuleLabel}</span>
              </div>
            ) : null}
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
            {selectedRuleId ? (
              <button className="button button--ghost" onClick={() => setSelectedRuleId("")}>
                Show full snapshot
              </button>
            ) : null}
          </div>
        }
      />

      {notice ? <div className="inline-note">{notice}</div> : null}
      {error ? <ErrorState label="Commission report issue" detail={error} /> : null}

      <Panel
        className="commission-report__filter-panel"
        title={selectedRun && !showScopeEditor ? "Snapshot scope" : "Generation scope"}
        subtitle={
          selectedRun && !showScopeEditor
            ? "This snapshot already includes the saved staff scope. Open the scope editor only when you want to generate a new snapshot."
            : "Choose the staff scope for the next snapshot. After generation, this page switches to a read-only snapshot view."
        }
      >
        {selectedRun && !showScopeEditor ? (
          <div className="commission-report__scope-grid">
            <article className="commission-report__scope-card">
              <strong>Branch</strong>
              <span>
                {branchOptions.length > 0 ? `${branchOptions[0].name} (${branchOptions[0].code})` : "No clinic selected"}
              </span>
            </article>
            <article className="commission-report__scope-card">
              <strong>Staff role</strong>
              <span>{selectedRun.filters.staffRoles[0] || "All roles"}</span>
            </article>
            <article className="commission-report__scope-card">
              <strong>Specific staff</strong>
              <span>
                {snapshotStaffLabels.length > 0
                  ? snapshotStaffLabels.slice(0, 4).join(", ")
                  : "All staff matching the saved role scope"}
              </span>
              {snapshotStaffLabels.length > 4 ? (
                <small>+{(snapshotStaffLabels.length - 4).toLocaleString("en-US")} more selected in this snapshot</small>
              ) : null}
            </article>
            <article className="commission-report__scope-card">
              <strong>Rule view</strong>
              <span>{activeRuleLabel || "Showing the full snapshot"}</span>
            </article>
          </div>
        ) : (
          <div className="commission-report__filter-grid">
            <div>
              <strong>Branches</strong>
              {branchOptions.length > 0 ? (
                <div className="inline-note">
                  Filtered to {branchOptions[0].name} ({branchOptions[0].code}).
                </div>
              ) : (
                <div className="inline-note">No clinic is selected.</div>
              )}
            </div>

            <label className="field">
              <span>Staff role</span>
              <select value={selectedStaffRole} onChange={(event) => setSelectedStaffRole(event.target.value)}>
                <option value="">All roles</option>
                {[...new Set((options?.staff ?? []).map((staff) => staff.role))].map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>

            <div>
              <strong>Specific staff</strong>
              {loadingOptions ? <div className="inline-note inline-note--loading">Loading staff...</div> : null}
              <div className="commission-report__check-grid">
                {sourceStaffOptions.map((staff) => (
                  <label key={staff.id} className="commission-report__check-item">
                    <input
                      type="checkbox"
                      checked={selectedStaffIds.includes(staff.id)}
                      onChange={() =>
                        setSelectedStaffIds((current) =>
                          current.includes(staff.id) ? current.filter((entry) => entry !== staff.id) : [...current, staff.id],
                        )
                      }
                    />
                    <span>{staff.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </Panel>

      <div className="commission-report__layout">
        <Panel
          className="commission-report__history-panel"
          title="Snapshots"
          subtitle="Every generation creates a new saved run so historical commission results stay stable."
        >
          {loadingRuns ? <div className="inline-note inline-note--loading">Loading snapshots...</div> : null}
          {!loadingRuns && runs.length === 0 ? (
            <EmptyState
              label="No snapshots yet"
              detail="Generate the first commission snapshot for the selected month."
            />
          ) : null}
          {!loadingRuns && runs.length > 0 ? (
            <div className="commission-report__snapshot-list">
              {runs.map((run) => (
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
          <div className="report-kpi-strip">
            <article className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Total commission</span>
              <strong className="report-kpi-strip__value">
                {formatCurrency(displayedTotals?.totalCommissionAmount ?? 0, currentClinic.currency || "MMK")}
              </strong>
              <span className="report-kpi-strip__hint">
                {selectedRuleId ? "Filtered to the selected rule." : "Generated commission across the current snapshot."}
              </span>
            </article>
            <article className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Adjustments</span>
              <strong className="report-kpi-strip__value">
                {formatCurrency(displayedTotals?.totalAdjustmentAmount ?? 0, currentClinic.currency || "MMK")}
              </strong>
              <span className="report-kpi-strip__hint">
                {selectedRuleId
                  ? "Adjustments stay at the snapshot level, so filtered rule views show 0 here."
                  : "Manual adjustments captured inside this saved snapshot."}
              </span>
            </article>
            <article className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Final payout</span>
              <strong className="report-kpi-strip__value">
                {formatCurrency(displayedTotals?.finalPayoutAmount ?? 0, currentClinic.currency || "MMK")}
              </strong>
              <span className="report-kpi-strip__hint">
                {displayedTotals?.matchedRowCount ?? 0} matched row(s)
                {selectedRuleId ? "" : ` · ${displayedTotals?.skippedRowCount ?? 0} skipped`}
              </span>
            </article>
          </div>

          <Panel
            className="commission-report__results-panel"
            title="Staff payout summary"
            subtitle="Click a staff row to inspect the exact transactions, rules, and explanations behind the payout."
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
                detail="Pick a saved snapshot from the list or generate a new one."
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
                  { key: "sourceRef", header: "Source ref", render: (row) => row.sourceRef },
                  { key: "sourceType", header: "Event", render: (row) => row.sourceType },
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
