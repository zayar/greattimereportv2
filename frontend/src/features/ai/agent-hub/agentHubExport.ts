import type { GreatTimeAgentChatResponse, GreatTimeAgentTable, GreatTimeAgentTableColumn } from "../../../types/domain";

const UTF8_BOM = "\uFEFF";

function normalizeExportMessage(message: string) {
  return message
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function exportTokens(message: string) {
  return normalizeExportMessage(message).split(" ").filter(Boolean);
}

export function isAgentHubCsvExportRequested(message: string) {
  const normalized = normalizeExportMessage(message);
  if (!normalized) {
    return false;
  }

  if (/\.(?:csv|xls|xlsx)\b/i.test(message)) {
    return true;
  }

  if (/\b(?:csv|excel|xls|xlsx|export|download|spreadsheet)\b/i.test(normalized)) {
    return true;
  }

  return /\bgoogle\s+sheets?\b/i.test(normalized) || /\bsheets?\s+file\b/i.test(normalized);
}

export function isAgentHubExportOnlyFollowUp(message: string) {
  const normalized = normalizeExportMessage(message);
  if (!normalized || !isAgentHubCsvExportRequested(message)) {
    return false;
  }

  const allowedTokens = new Set([
    "as",
    "can",
    "could",
    "csv",
    "download",
    "excel",
    "export",
    "file",
    "for",
    "give",
    "google",
    "it",
    "make",
    "me",
    "please",
    "previous",
    "result",
    "send",
    "sheet",
    "sheets",
    "spreadsheet",
    "the",
    "this",
    "to",
    "xls",
    "xlsx",
    "you",
  ]);

  return exportTokens(message).every((token) => allowedTokens.has(token));
}

export function hasExportableAgentTable(response: GreatTimeAgentChatResponse) {
  return response.tables?.some((table) => table.rows.length > 0) ?? false;
}

function firstTableWithRows(response: GreatTimeAgentChatResponse) {
  return response.tables?.find((table) => table.rows.length > 0) ?? null;
}

function primitiveValue(value: unknown) {
  return value == null || ["string", "number", "boolean"].includes(typeof value) ? value : undefined;
}

function stringifyObjectValue(value: Record<string, unknown>) {
  for (const key of ["name", "label", "title", "value", "amount"]) {
    const primitive = primitiveValue(value[key]);
    if (primitive !== undefined) {
      return primitive == null ? "" : String(primitive);
    }
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function valueToCsvString(value: unknown) {
  if (value == null) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") {
    return stringifyObjectValue(value as Record<string, unknown>);
  }
  return String(value);
}

function escapeCsvValue(value: unknown) {
  const rawValue = valueToCsvString(value);
  const safeValue = /^[=+\-@\t\r]/.test(rawValue) ? `'${rawValue}` : rawValue;
  const mustQuote = /[",\r\n]/.test(safeValue) || rawValue !== rawValue.trim() || safeValue !== safeValue.trim();
  const escaped = safeValue.replace(/"/g, '""');
  return mustQuote ? `"${escaped}"` : escaped;
}

const sensitiveCsvKeys = new Set([
  "phone",
  "phoneNumber",
  "customerPhone",
  "customerPhoneNumber",
  "mobile",
  "memberId",
  "customerId",
  "appointmentId",
  "invoiceId",
]);

function normalizeCsvKey(key: string) {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

const normalizedSensitiveCsvKeys = new Set([...sensitiveCsvKeys].map(normalizeCsvKey));

function isSensitiveCsvKey(key: string) {
  return normalizedSensitiveCsvKeys.has(normalizeCsvKey(key));
}

function shouldExportDeclaredColumn(column: GreatTimeAgentTableColumn) {
  if (column.exportable === false) {
    return false;
  }

  const sensitive = column.pii === "phone" || column.pii === "id" || isSensitiveCsvKey(column.key);
  return !sensitive || column.exportable === true;
}

function buildHeaders(table: GreatTimeAgentTable) {
  const seen = new Set<string>();
  const headers = table.columns.flatMap((column) => {
    seen.add(column.key);
    if (!shouldExportDeclaredColumn(column)) {
      return [];
    }

    return [
      {
        key: column.key,
        title: column.title || column.key,
      },
    ];
  });

  for (const row of table.rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key) && !isSensitiveCsvKey(key)) {
        seen.add(key);
        headers.push({ key, title: key });
      }
    }
  }

  return headers;
}

function slugPart(value: string) {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/_+/g, "_") || "export"
  );
}

export function buildAgentHubCsvExport(params: {
  response: GreatTimeAgentChatResponse;
  originalMessage: string;
  now?: Date | number | string;
}) {
  const table = firstTableWithRows(params.response);
  if (!table) {
    return null;
  }

  const headers = buildHeaders(table);
  const date = params.now === undefined ? new Date() : new Date(params.now);
  const dateKey = Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
  const agent = slugPart(params.response.resolvedAgent);
  const descriptor = slugPart(table.title || params.response.intent || params.originalMessage || "export");
  const fileName = `${`${agent}_${descriptor}_${dateKey}`.replace(/_+/g, "_").slice(0, 96)}.csv`;
  const lines = [
    headers.map((header) => escapeCsvValue(header.title)).join(","),
    ...table.rows.map((row) => headers.map((header) => escapeCsvValue(row[header.key])).join(",")),
  ];

  return {
    fileName,
    csv: `${UTF8_BOM}${lines.join("\r\n")}\r\n`,
    rowCount: table.rows.length,
    tableTitle: table.title,
  };
}

export function downloadAgentHubCsvExport(exportFile: { fileName: string; csv: string }) {
  const blob = new Blob([exportFile.csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = exportFile.fileName.endsWith(".csv") ? exportFile.fileName : `${exportFile.fileName}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
