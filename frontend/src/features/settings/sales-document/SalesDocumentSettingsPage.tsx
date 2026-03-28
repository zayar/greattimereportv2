import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../../../components/PageHeader";
import { Panel } from "../../../components/Panel";
import { EmptyState } from "../../../components/StatusViews";
import { useAccess } from "../../access/AccessProvider";
import { SalesDocumentPreview } from "../../operational/sales/SalesDocumentPreview";
import {
  defaultSalesDocumentConfig,
  type SalesDocumentConfig,
  type SalesDocumentDensity,
  type SalesDocumentHeaderLayout,
  type SalesDocumentPaperTone,
} from "../../operational/sales/salesDocumentConfig";
import { buildSampleSalesDocumentModel } from "../../operational/sales/salesDocumentModel";
import { useSalesDocumentConfig } from "../../operational/sales/useSalesDocumentConfig";

function configsEqual(left: SalesDocumentConfig, right: SalesDocumentConfig) {
  return JSON.stringify(left) === JSON.stringify(right);
}

type ToggleKey =
  | "showClinicLogo"
  | "showClinicContact"
  | "showMemberPhone"
  | "showSeller"
  | "showPaymentDetails"
  | "showNotes"
  | "showFooterNote";

export function SalesDocumentSettingsPage() {
  const { currentClinic } = useAccess();
  const { config, loading, saving, errorMessage, hasSavedConfig, saveConfig } = useSalesDocumentConfig(currentClinic?.id);
  const [draftConfig, setDraftConfig] = useState<SalesDocumentConfig>(defaultSalesDocumentConfig);
  const [notice, setNotice] = useState<string | null>(null);
  const colorPickerValue = /^#[0-9a-fA-F]{6}$/.test(draftConfig.accentColor)
    ? draftConfig.accentColor
    : defaultSalesDocumentConfig.accentColor;

  useEffect(() => {
    setDraftConfig(config);
  }, [config]);

  const sampleModel = useMemo(() => buildSampleSalesDocumentModel(currentClinic), [currentClinic]);
  const hasChanges = !configsEqual(draftConfig, config);

  if (!currentClinic) {
    return (
      <div className="page-stack page-stack--workspace analytics-report sales-document-settings">
        <EmptyState
          label="No clinic selected"
          detail="Choose a clinic first so the document designer knows where to save template settings."
        />
      </div>
    );
  }

  function updateConfig<K extends keyof SalesDocumentConfig>(key: K, value: SalesDocumentConfig[K]) {
    setDraftConfig((current) => ({
      ...current,
      [key]: value,
    }));
    setNotice(null);
  }

  function toggleConfig(key: ToggleKey) {
    setDraftConfig((current) => ({
      ...current,
      [key]: !current[key],
    }));
    setNotice(null);
  }

  async function handleSave() {
    try {
      const savedConfig = await saveConfig(draftConfig);
      setDraftConfig(savedConfig);
      setNotice("Template settings saved for the current clinic.");
    } catch (saveError) {
      setNotice(saveError instanceof Error ? saveError.message : "Template settings could not be saved.");
    }
  }

  return (
    <div className="page-stack page-stack--workspace analytics-report sales-document-settings">
      <PageHeader
        title="Sales document designer"
        hideContext
        actions={
          <div className="sales-document-settings__actions">
            <button
              className="button button--secondary"
              onClick={() => {
                setDraftConfig(config);
                setNotice("Draft reset to the current saved template.");
              }}
              disabled={!hasChanges}
            >
              Discard changes
            </button>
            <button
              className="button button--ghost"
              onClick={() => {
                setDraftConfig(defaultSalesDocumentConfig);
                setNotice("Draft reset to the default template.");
              }}
            >
              Use defaults
            </button>
            <button className="button button--secondary" onClick={() => void handleSave()} disabled={saving || !hasChanges || loading}>
              {saving ? "Saving..." : "Save template"}
            </button>
          </div>
        }
      />

      <div className="sales-document-settings__status">
        <div>
          <strong>{currentClinic.name}</strong>
          <span>{hasSavedConfig ? "Custom template saved for this clinic" : "Using default template until you save a custom one"}</span>
        </div>
        {notice ? <span className="sales-document-settings__notice">{notice}</span> : null}
        {!notice && errorMessage ? <span className="sales-document-settings__notice">{errorMessage}</span> : null}
      </div>

      <div className="sales-document-settings__layout">
        <Panel
          className="analytics-report__panel sales-document-settings__controls"
          title="Layout controls"
          subtitle="Tune the paper presentation while keeping the underlying sales data and storage contract unchanged."
        >
          <div className="sales-document-settings__control-stack">
            <label className="field">
              <span>Document title</span>
              <input
                type="text"
                value={draftConfig.documentTitle}
                onChange={(event) => updateConfig("documentTitle", event.target.value)}
              />
            </label>

            <label className="field">
              <span>Document subtitle</span>
              <textarea
                className="sales-document-settings__textarea"
                value={draftConfig.documentSubtitle}
                onChange={(event) => updateConfig("documentSubtitle", event.target.value)}
                rows={3}
              />
            </label>

            <div className="sales-document-settings__two-up">
              <label className="field">
                <span>Accent color</span>
                <div className="sales-document-settings__color-field">
                  <input
                    className="sales-document-settings__color-picker"
                    type="color"
                    value={colorPickerValue}
                    onChange={(event) => updateConfig("accentColor", event.target.value)}
                  />
                  <input
                    type="text"
                    value={draftConfig.accentColor}
                    onChange={(event) => updateConfig("accentColor", event.target.value)}
                  />
                </div>
              </label>

              <label className="field">
                <span>Paper tone</span>
                <select
                  value={draftConfig.paperTone}
                  onChange={(event) => updateConfig("paperTone", event.target.value as SalesDocumentPaperTone)}
                >
                  <option value="ivory">Ivory</option>
                  <option value="white">White</option>
                </select>
              </label>
            </div>

            <div className="sales-document-settings__two-up">
              <label className="field">
                <span>Header layout</span>
                <select
                  value={draftConfig.headerLayout}
                  onChange={(event) => updateConfig("headerLayout", event.target.value as SalesDocumentHeaderLayout)}
                >
                  <option value="split">Split</option>
                  <option value="stacked">Stacked</option>
                </select>
              </label>

              <label className="field">
                <span>Density</span>
                <select
                  value={draftConfig.density}
                  onChange={(event) => updateConfig("density", event.target.value as SalesDocumentDensity)}
                >
                  <option value="comfortable">Comfortable</option>
                  <option value="compact">Compact</option>
                </select>
              </label>
            </div>

            <div className="sales-document-settings__toggle-group">
              <span className="sales-document-settings__group-label">Visible sections</span>

              <label className="sales-document-settings__toggle">
                <input type="checkbox" checked={draftConfig.showClinicLogo} onChange={() => toggleConfig("showClinicLogo")} />
                <div>
                  <strong>Clinic logo</strong>
                  <span>Display clinic branding in the header.</span>
                </div>
              </label>

              <label className="sales-document-settings__toggle">
                <input type="checkbox" checked={draftConfig.showClinicContact} onChange={() => toggleConfig("showClinicContact")} />
                <div>
                  <strong>Clinic contact block</strong>
                  <span>Show address and phone beneath the clinic name.</span>
                </div>
              </label>

              <label className="sales-document-settings__toggle">
                <input type="checkbox" checked={draftConfig.showMemberPhone} onChange={() => toggleConfig("showMemberPhone")} />
                <div>
                  <strong>Member phone</strong>
                  <span>Include phone number in the customer section when present.</span>
                </div>
              </label>

              <label className="sales-document-settings__toggle">
                <input type="checkbox" checked={draftConfig.showSeller} onChange={() => toggleConfig("showSeller")} />
                <div>
                  <strong>Seller section</strong>
                  <span>Show seller, sold-by, and payment method details.</span>
                </div>
              </label>

              <label className="sales-document-settings__toggle">
                <input type="checkbox" checked={draftConfig.showPaymentDetails} onChange={() => toggleConfig("showPaymentDetails")} />
                <div>
                  <strong>Payment breakdown</strong>
                  <span>List split or recorded payments under the totals panel.</span>
                </div>
              </label>

              <label className="sales-document-settings__toggle">
                <input type="checkbox" checked={draftConfig.showNotes} onChange={() => toggleConfig("showNotes")} />
                <div>
                  <strong>Notes block</strong>
                  <span>Render merchant notes or aftercare instructions when available.</span>
                </div>
              </label>

              <label className="sales-document-settings__toggle">
                <input type="checkbox" checked={draftConfig.showFooterNote} onChange={() => toggleConfig("showFooterNote")} />
                <div>
                  <strong>Footer note</strong>
                  <span>Add a quiet review/print note at the bottom of the document.</span>
                </div>
              </label>
            </div>

            <label className="field">
              <span>Footer note</span>
              <textarea
                className="sales-document-settings__textarea"
                value={draftConfig.footerNote}
                onChange={(event) => updateConfig("footerNote", event.target.value)}
                rows={4}
              />
            </label>
          </div>
        </Panel>

        <Panel
          className="analytics-report__panel sales-document-settings__preview"
          title="Live preview"
          subtitle="The same renderer is used by the Sales row-click detail page."
        >
          {loading ? <div className="inline-note">Loading saved template...</div> : null}
          <div className="sales-document-settings__preview-stage">
            <SalesDocumentPreview model={sampleModel} config={draftConfig} previewLabel="Designer preview" />
          </div>
        </Panel>
      </div>
    </div>
  );
}
