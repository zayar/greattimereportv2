export type SalesDocumentPaperTone = "ivory" | "white";
export type SalesDocumentDensity = "comfortable" | "compact";
export type SalesDocumentHeaderLayout = "split" | "stacked";
export type SalesDocumentPaperSize = "A4" | "Letter";
export type SalesDocumentOrientation = "portrait" | "landscape";
export type SalesDocumentMarginPreset = "narrow" | "normal" | "wide";

export interface SalesDocumentConfig {
  version: 1;
  documentTitle: string;
  documentSubtitle: string;
  accentColor: string;
  headerTextColor: string;
  itemsAccentColor: string;
  paperTone: SalesDocumentPaperTone;
  paperSize: SalesDocumentPaperSize;
  orientation: SalesDocumentOrientation;
  marginPreset: SalesDocumentMarginPreset;
  density: SalesDocumentDensity;
  headerLayout: SalesDocumentHeaderLayout;
  showClinicLogo: boolean;
  showClinicContact: boolean;
  showMemberPhone: boolean;
  showItemsTable: boolean;
  showSeller: boolean;
  showPaymentDetails: boolean;
  showNotes: boolean;
  showFooterNote: boolean;
  footerNote: string;
}

export const defaultSalesDocumentConfig: SalesDocumentConfig = {
  version: 1,
  documentTitle: "Sales Invoice",
  documentSubtitle: "",
  accentColor: "#1e4b4d",
  headerTextColor: "#24180d",
  itemsAccentColor: "#b38a4b",
  paperTone: "white",
  paperSize: "A4",
  orientation: "portrait",
  marginPreset: "normal",
  density: "comfortable",
  headerLayout: "split",
  showClinicLogo: true,
  showClinicContact: true,
  showMemberPhone: true,
  showItemsTable: true,
  showSeller: true,
  showPaymentDetails: true,
  showNotes: true,
  showFooterNote: true,
  footerNote: "This document preview is generated from the clinic sales record and is intended for review before print or export.",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeOption<T extends string>(value: unknown, allowed: readonly T[], fallback: T) {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function normalizeAccentColor(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

export function normalizeSalesDocumentConfig(value: unknown): SalesDocumentConfig {
  if (!isObject(value)) {
    return { ...defaultSalesDocumentConfig };
  }

  return {
    version: 1,
    documentTitle: normalizeString(value.documentTitle, defaultSalesDocumentConfig.documentTitle),
    documentSubtitle: normalizeString(value.documentSubtitle, defaultSalesDocumentConfig.documentSubtitle),
    accentColor: normalizeAccentColor(value.accentColor, defaultSalesDocumentConfig.accentColor),
    headerTextColor: normalizeAccentColor(value.headerTextColor, defaultSalesDocumentConfig.headerTextColor),
    itemsAccentColor: normalizeAccentColor(value.itemsAccentColor, defaultSalesDocumentConfig.itemsAccentColor),
    paperTone: normalizeOption(value.paperTone, ["ivory", "white"], defaultSalesDocumentConfig.paperTone),
    paperSize: normalizeOption(value.paperSize, ["A4", "Letter"], defaultSalesDocumentConfig.paperSize),
    orientation: normalizeOption(value.orientation, ["portrait", "landscape"], defaultSalesDocumentConfig.orientation),
    marginPreset: normalizeOption(value.marginPreset, ["narrow", "normal", "wide"], defaultSalesDocumentConfig.marginPreset),
    density: normalizeOption(value.density, ["comfortable", "compact"], defaultSalesDocumentConfig.density),
    headerLayout: normalizeOption(value.headerLayout, ["split", "stacked"], defaultSalesDocumentConfig.headerLayout),
    showClinicLogo: normalizeBoolean(value.showClinicLogo, defaultSalesDocumentConfig.showClinicLogo),
    showClinicContact: normalizeBoolean(value.showClinicContact, defaultSalesDocumentConfig.showClinicContact),
    showMemberPhone: normalizeBoolean(value.showMemberPhone, defaultSalesDocumentConfig.showMemberPhone),
    showItemsTable: normalizeBoolean(value.showItemsTable, defaultSalesDocumentConfig.showItemsTable),
    showSeller: normalizeBoolean(value.showSeller, defaultSalesDocumentConfig.showSeller),
    showPaymentDetails: normalizeBoolean(value.showPaymentDetails, defaultSalesDocumentConfig.showPaymentDetails),
    showNotes: normalizeBoolean(value.showNotes, defaultSalesDocumentConfig.showNotes),
    showFooterNote: normalizeBoolean(value.showFooterNote, defaultSalesDocumentConfig.showFooterNote),
    footerNote: typeof value.footerNote === "string" ? value.footerNote : defaultSalesDocumentConfig.footerNote,
  };
}

export function parseSalesDocumentConfig(metadata: string | null | undefined) {
  if (!metadata) {
    return { ...defaultSalesDocumentConfig };
  }

  try {
    return normalizeSalesDocumentConfig(JSON.parse(metadata) as unknown);
  } catch {
    return { ...defaultSalesDocumentConfig };
  }
}

export function getSalesDocumentConfigCode(clinicId: string) {
  return `${clinicId}_sales_document_template_v1`;
}
