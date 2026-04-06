import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  archiveCommissionRule,
  duplicateCommissionRule,
  fetchCommissionRules,
} from "../../../api/commission"
import { DataTable } from "../../../components/DataTable"
import { EmptyState, ErrorState } from "../../../components/StatusViews"
import { Panel } from "../../../components/Panel"
import { PageHeader } from "../../../components/PageHeader"
import { useAccess } from "../../access/AccessProvider"
import type { CommissionRule } from "../../commission/types"
import { formatCommissionFormulaSummary } from "../../commission/commissionHelpers"
import { formatDate } from "../../../utils/format"

function formatEventType(value: CommissionRule["eventType"]) {
  if (value === "sale_based") {
    return "Sale based"
  }
  if (value === "payment_based") {
    return "Payment based"
  }
  return "Treatment completed"
}

function formatEffectiveRange(rule: CommissionRule) {
  if (!rule.effectiveFrom && !rule.effectiveTo) {
    return "Always active"
  }

  if (rule.effectiveFrom && !rule.effectiveTo) {
    return `From ${formatDate(rule.effectiveFrom)}`
  }

  if (!rule.effectiveFrom && rule.effectiveTo) {
    return `Until ${formatDate(rule.effectiveTo)}`
  }

  return `${formatDate(rule.effectiveFrom!)} to ${formatDate(rule.effectiveTo!)}`
}

export function CommissionSettingsPage() {
  const navigate = useNavigate()
  const { currentBusiness, currentClinic } = useAccess()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rules, setRules] = useState<CommissionRule[]>([])
  const [busyRuleId, setBusyRuleId] = useState<string | null>(null)

  const branchOptions = useMemo(
    () => (currentClinic ? [{ id: currentClinic.id, code: currentClinic.code, name: currentClinic.name }] : []),
    [currentClinic],
  )

  const loadRules = useCallback(async () => {
    if (!currentBusiness || !currentClinic) {
      setRules([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const nextRules = await fetchCommissionRules({
        clinicId: currentClinic.id,
        merchantId: currentBusiness.id,
        merchantName: currentBusiness.name,
        branchIds: branchOptions.map((branch) => branch.id),
        branchCodes: branchOptions.map((branch) => branch.code),
      })
      setRules(nextRules)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Commission rules could not be loaded.")
    } finally {
      setLoading(false)
    }
  }, [branchOptions, currentBusiness, currentClinic])

  useEffect(() => {
    void loadRules()
  }, [loadRules])

  const activeCount = rules.filter((rule) => rule.status === "active").length
  const draftCount = rules.filter((rule) => rule.status === "draft").length
  const archivedCount = rules.filter((rule) => rule.status === "archived").length

  async function handleDuplicate(ruleId: string) {
    if (!currentClinic) {
      return
    }

    setBusyRuleId(ruleId)
    try {
      await duplicateCommissionRule(ruleId, currentClinic.id)
      await loadRules()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Rule duplication failed.")
    } finally {
      setBusyRuleId(null)
    }
  }

  async function handleArchive(ruleId: string) {
    if (!currentClinic || !window.confirm("Archive this rule? Historical report snapshots will remain unchanged.")) {
      return
    }

    setBusyRuleId(ruleId)
    try {
      await archiveCommissionRule(ruleId, currentClinic.id)
      await loadRules()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Rule archival failed.")
    } finally {
      setBusyRuleId(null)
    }
  }

  if (!currentBusiness || !currentClinic) {
    return (
      <div className="page-stack page-stack--workspace analytics-report commission-settings">
        <EmptyState
          label="No merchant context"
          detail="Choose a clinic first so commission rules can be scoped to the current merchant."
        />
      </div>
    )
  }

  return (
    <div className="page-stack page-stack--workspace analytics-report commission-settings">
      <PageHeader
        title="Commission rules"
        actions={
          <div className="commission-settings__actions">
            <button className="button button--ghost" onClick={() => navigate("/analytics/commission")}>
              View report
            </button>
            <button className="button button--secondary" onClick={() => navigate("/settings/commission/rules/new")}>
              Create new rule
            </button>
          </div>
        }
      />

      <div className="report-kpi-strip">
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Merchant</span>
          <strong className="report-kpi-strip__value">{currentBusiness.name}</strong>
          <span className="report-kpi-strip__hint">Filtered to {currentClinic.name}.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Active rules</span>
          <strong className="report-kpi-strip__value">{activeCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">These rules can participate in report generation today.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Draft and archived</span>
          <strong className="report-kpi-strip__value">{(draftCount + archivedCount).toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">{draftCount} draft · {archivedCount} archived</span>
        </article>
      </div>

      <Panel
        className="commission-settings__panel"
        title="Rule library"
        subtitle="Each saved rule is versioned. Updating a rule later will not change historical commission runs because report snapshots store the applied rule version."
      >
        {loading ? <div className="inline-note inline-note--loading">Loading commission rules...</div> : null}
        {error ? <ErrorState label="Commission rules could not be loaded" detail={error} /> : null}
        {!loading && !error && rules.length === 0 ? (
          <EmptyState
            label="No commission rules yet"
            detail="Create the first rule to enable monthly commission reporting for this merchant."
          />
        ) : null}
        {!loading && !error && rules.length > 0 ? (
          <DataTable
            columns={[
              {
                key: "ruleName",
                header: "Rule",
                render: (rule) => (
                  <div className="commission-settings__rule-cell">
                    <strong>{rule.ruleName}</strong>
                    <span>v{rule.version}</span>
                  </div>
                ),
              },
              {
                key: "role",
                header: "Role",
                render: (rule) => rule.appliesToRole || "All matching staff",
              },
              {
                key: "eventType",
                header: "Event",
                render: (rule) => formatEventType(rule.eventType),
              },
              {
                key: "formula",
                header: "Formula",
                render: (rule) => formatCommissionFormulaSummary(rule.formulaType, rule.formulaConfig),
              },
              {
                key: "effective",
                header: "Effective",
                render: (rule) => formatEffectiveRange(rule),
              },
              {
                key: "status",
                header: "Status",
                render: (rule) => (
                  <span className={`status-pill status-pill--${rule.status}`.trim()}>{rule.status}</span>
                ),
              },
              {
                key: "priority",
                header: "Priority",
                render: (rule) => rule.priority.toLocaleString("en-US"),
              },
              {
                key: "actions",
                header: "Actions",
                render: (rule) => (
                  <div className="commission-settings__table-actions">
                    <button
                      className="button button--ghost"
                      disabled={rule.status !== "active"}
                      onClick={() =>
                        navigate("/analytics/commission", {
                          state: {
                            preselectedRule: {
                              ruleId: rule.id,
                              ruleName: rule.ruleName,
                              appliesToRole: rule.appliesToRole,
                              eventType: rule.eventType,
                            },
                          },
                        })
                      }
                    >
                      View report
                    </button>
                    <button className="button button--ghost" onClick={() => navigate(`/settings/commission/rules/${rule.id}`)}>
                      Edit
                    </button>
                    <button className="button button--ghost" disabled={busyRuleId === rule.id} onClick={() => void handleDuplicate(rule.id)}>
                      Duplicate
                    </button>
                    <button className="button button--ghost" disabled={busyRuleId === rule.id || rule.status === "archived"} onClick={() => void handleArchive(rule.id)}>
                      Archive
                    </button>
                  </div>
                ),
              },
            ]}
            rows={rules}
            rowKey={(rule) => rule.id}
          />
        ) : null}
      </Panel>
    </div>
  )
}
