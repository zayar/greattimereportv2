import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  type SalesDocumentMarginPreset,
  type SalesDocumentOrientation,
  type SalesDocumentPaperSize,
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
  | "showItemsTable"
  | "showPaymentDetails"
  | "showNotes"
  | "showFooterNote";

export function SalesDocumentSettingsPage() {
  const navigate = useNavigate();
  const { currentClinic } = useAccess();
  const { config, loading, saving, errorMessage, hasSavedConfig, saveConfig } = useSalesDocumentConfig(currentClinic?.id);
  const [draftConfig, setDraftConfig] = useState<SalesDocumentConfig>(defaultSalesDocumentConfig);
  const [notice, setNotice] = useState<string | null>(null);
  const colorPickerValue = /^#[0-9a-fA-F]{6}$/.test(draftConfig.accentColor)
    ? draftConfig.accentColor
    : defaultSalesDocumentConfig.accentColor;
  const headerTextColorPickerValue = /^#[0-9a-fA-F]{6}$/.test(draftConfig.headerTextColor)
    ? draftConfig.headerTextColor
    : defaultSalesDocumentConfig.headerTextColor;
  const itemsColorPickerValue = /^#[0-9a-fA-F]{6}$/.test(draftConfig.itemsAccentColor)
    ? draftConfig.itemsAccentColor
    : defaultSalesDocumentConfig.itemsAccentColor;

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

  function handleBackToSales() {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate("/operational/sales");
  }

  return (
    <div className="page-stack page-stack--workspace analytics-report sales-document-settings">
      <PageHeader
        title="Sales document designer"
        hideContext
        actions={
          <div className="sales-document-settings__actions">
            <button className="button button--ghost" onClick={handleBackToSales}>
              Back to sales
            </button>
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
            <section className="sales-document-settings__section">
              <div className="sales-document-settings__section-heading">
                <strong>Document</strong>
                <span>Set the invoice heading and overall paper rhythm.</span>
              </div>

              <label className="field">
                <span>Document title</span>
                <input
                  type="text"
                  value={draftConfig.documentTitle}
                  onChange={(event) => updateConfig("documentTitle", event.target.value)}
                />
              </label>

              <div className="sales-document-settings__two-up">
                <label className="field">
                  <span>Paper size</span>
                  <select
                    value={draftConfig.paperSize}
                    onChange={(event) => updateConfig("paperSize", event.target.value as SalesDocumentPaperSize)}
                  >
                    <option value="A4">A4</option>
                    <option value="Letter">Letter</option>
                  </select>
                </label>

                <label className="field">
                  <span>Orientation</span>
                  <select
                    value={draftConfig.orientation}
                    onChange={(event) => updateConfig("orientation", event.target.value as SalesDocumentOrientation)}
                  >
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </label>
              </div>

              <div className="sales-document-settings__three-up">
                <label className="field">
                  <span>Margins</span>
                  <select
                    value={draftConfig.marginPreset}
                    onChange={(event) => updateConfig("marginPreset", event.target.value as SalesDocumentMarginPreset)}
                  >
                    <option value="narrow">Narrow</option>
                    <option value="normal">Normal</option>
                    <option value="wide">Wide</option>
                  </select>
                </label>

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
            </section>

            <section className="sales-document-settings__section">
              <div className="sales-document-settings__section-heading">
                <strong>Colors</strong>
                <span>Use color sparingly for the header, table, and fine accents.</span>
              </div>

              <div className="sales-document-settings__two-up">
                <label className="field">
                  <span>Primary accent</span>
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
                  <span>Header text</span>
                  <div className="sales-document-settings__color-field">
                    <input
                      className="sales-document-settings__color-picker"
                      type="color"
                      value={headerTextColorPickerValue}
                      onChange={(event) => updateConfig("headerTextColor", event.target.value)}
                    />
                    <input
                      type="text"
                      value={draftConfig.headerTextColor}
                      onChange={(event) => updateConfig("headerTextColor", event.target.value)}
                    />
                  </div>
                </label>
              </div>

              <label className="field">
                <span>Items table accent</span>
                <div className="sales-document-settings__color-field">
                  <input
                    className="sales-document-settings__color-picker"
                    type="color"
                    value={itemsColorPickerValue}
                    onChange={(event) => updateConfig("itemsAccentColor", event.target.value)}
                  />
                  <input
                    type="text"
                    value={draftConfig.itemsAccentColor}
                    onChange={(event) => updateConfig("itemsAccentColor", event.target.value)}
                  />
                </div>
              </label>
            </section>

            <section className="sales-document-settings__section">
              <div className="sales-document-settings__section-heading">
                <strong>Visible sections</strong>
                <span>Keep the paper simple and only show the pieces you need.</span>
              </div>

              <div className="sales-document-settings__toggle-group">
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
                    <span>Show address and phone with the clinic details.</span>
                  </div>
                </label>

                <label className="sales-document-settings__toggle">
                  <input type="checkbox" checked={draftConfig.showMemberPhone} onChange={() => toggleConfig("showMemberPhone")} />
                  <div>
                    <strong>Customer / member phone</strong>
                    <span>Include the member phone number in the Bill To section.</span>
                  </div>
                </label>

                <label className="sales-document-settings__toggle">
                  <input type="checkbox" checked={draftConfig.showItemsTable} onChange={() => toggleConfig("showItemsTable")} />
                  <div>
                    <strong>Items table</strong>
                    <span>Render the line-item table as the center of the invoice.</span>
                  </div>
                </label>

                <label className="sales-document-settings__toggle">
                  <input type="checkbox" checked={draftConfig.showNotes} onChange={() => toggleConfig("showNotes")} />
                  <div>
                    <strong>Notes block</strong>
                    <span>Show notes or aftercare instructions beneath the items table.</span>
                  </div>
                </label>

                <label className="sales-document-settings__toggle">
                  <input type="checkbox" checked={draftConfig.showPaymentDetails} onChange={() => toggleConfig("showPaymentDetails")} />
                  <div>
                    <strong>Payments block</strong>
                    <span>List recorded payments in a subtle section beneath the totals.</span>
                  </div>
                </label>

                <label className="sales-document-settings__toggle">
                  <input type="checkbox" checked={draftConfig.showFooterNote} onChange={() => toggleConfig("showFooterNote")} />
                  <div>
                    <strong>Footer note</strong>
                    <span>Add a quiet footer message below the invoice body.</span>
                  </div>
                </label>
              </div>
            </section>

            <section className="sales-document-settings__section">
              <div className="sales-document-settings__section-heading">
                <strong>Footer</strong>
                <span>Keep the ending note light and print-friendly.</span>
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
            </section>
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
