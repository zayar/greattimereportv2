import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { isAxiosError } from "axios"
import {
  createCommissionRule,
  fetchCommissionOptions,
  fetchCommissionRules,
  updateCommissionRule,
} from "../../../api/commission"
import { EmptyState, ErrorState } from "../../../components/StatusViews"
import { useAccess } from "../../access/AccessProvider"
import { CommissionRuleForm } from "../../commission/CommissionRuleForm"
import {
  buildCommissionRuleDraft,
  mapRuleToPayload,
} from "../../commission/commissionHelpers"
import type { CommissionRule, CommissionRulePayload, CommissionSourceOptions } from "../../commission/types"

function getApiErrorMessage(error: unknown, fallback: string) {
  if (isAxiosError(error)) {
    const apiMessage = typeof error.response?.data?.error === "string" ? error.response.data.error : null
    return apiMessage || error.message || fallback
  }

  return error instanceof Error ? error.message : fallback
}

export function CommissionRuleEditorPage() {
  const navigate = useNavigate()
  const { ruleId } = useParams()
  const { currentBusiness, currentClinic } = useAccess()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rule, setRule] = useState<CommissionRule | null>(null)
  const [options, setOptions] = useState<CommissionSourceOptions | null>(null)

  const branchOptions = useMemo(
    () => (currentClinic ? [{ id: currentClinic.id, code: currentClinic.code, name: currentClinic.name }] : []),
    [currentClinic],
  )

  const initialValue = useMemo(() => {
    if (!currentBusiness || !currentClinic) {
      return null
    }

    if (rule) {
      return mapRuleToPayload(rule, currentClinic.id, branchOptions)
    }

    return buildCommissionRuleDraft({
      merchantId: currentBusiness.id,
      merchantName: currentBusiness.name,
      clinicId: currentClinic.id,
      branches: branchOptions,
      defaultBranchId: currentClinic.id,
    })
  }, [branchOptions, currentBusiness, currentClinic, rule])

  useEffect(() => {
    if (!currentBusiness || !currentClinic) {
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)
    setError(null)

    Promise.all([
      fetchCommissionRules({
        clinicId: currentClinic.id,
        merchantId: currentBusiness.id,
        merchantName: currentBusiness.name,
        branchIds: branchOptions.map((branch) => branch.id),
        branchCodes: branchOptions.map((branch) => branch.code),
      }),
      fetchCommissionOptions({
        clinicId: currentClinic.id,
        merchantId: currentBusiness.id,
        merchantName: currentBusiness.name,
        branchIds: branchOptions.map((branch) => branch.id),
        branchCodes: branchOptions.map((branch) => branch.code),
      }),
    ])
      .then(([rules, sourceOptions]) => {
        if (!active) {
          return
        }

        setOptions(sourceOptions)
        setRule(ruleId ? rules.find((entry) => entry.id === ruleId) ?? null : null)
      })
      .catch((loadError) => {
        if (active) {
          setError(getApiErrorMessage(loadError, "Commission rule editor could not be loaded."))
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [branchOptions, currentBusiness, currentClinic, ruleId])

  async function handleSave(payload: CommissionRulePayload) {
    setSaving(true)
    setError(null)

    try {
      if (ruleId) {
        await updateCommissionRule(ruleId, payload)
      } else {
        await createCommissionRule(payload)
      }
      navigate("/settings/commission")
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, "Commission rule could not be saved."))
    } finally {
      setSaving(false)
    }
  }

  if (!currentBusiness || !currentClinic) {
    return (
      <div className="page-stack page-stack--workspace analytics-report commission-editor">
        <EmptyState
          label="No merchant context"
          detail="Choose a clinic first so the commission rule can be saved inside the current merchant."
        />
      </div>
    )
  }

  if (loading || !initialValue) {
    return (
      <div className="page-stack page-stack--workspace analytics-report commission-editor">
        <div className="inline-note inline-note--loading">Loading commission rule editor...</div>
      </div>
    )
  }

  if (ruleId && !rule && !error) {
    return (
      <div className="page-stack page-stack--workspace analytics-report commission-editor">
        <ErrorState
          label="Rule not found"
          detail="The selected rule could not be found in the current merchant scope."
        />
      </div>
    )
  }

  if (error && !options) {
    return (
      <div className="page-stack page-stack--workspace analytics-report commission-editor">
        <ErrorState label="Commission rule editor could not be loaded" detail={error} />
      </div>
    )
  }

  return (
    <>
      {error ? (
        <div className="commission-editor__error-banner">
          <ErrorState label="Save failed" detail={error} />
        </div>
      ) : null}
      <CommissionRuleForm
        title={ruleId ? `Edit rule${rule ? `: ${rule.ruleName}` : ""}` : "Create commission rule"}
        branches={branchOptions}
        options={options}
        initialValue={initialValue}
        saving={saving}
        onCancel={() => navigate("/settings/commission")}
        onSave={handleSave}
      />
    </>
  )
}
