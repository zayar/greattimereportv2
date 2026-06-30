import type { GreatTimeAgentChatResponse, GreatTimeAgentTable, GreatTimeAgentTableColumn } from "../agent-hub/types.js";

const UTF8_BOM = "\uFEFF";

type CsvExportParams = {
  tables?: GreatTimeAgentTable[];
  resolvedAgent: string;
  intent?: string;
  period?: GreatTimeAgentChatResponse["period"];
  originalMessage: string;
  now?: Date | number | string;
};

function firstTableWithRows(tables?: GreatTimeAgentTable[]) {
  return tables?.find((table) => table.rows.length > 0) ?? null;
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

  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === "bigint") {
        return item.toString();
      }
      if (item && typeof item === "object") {
        if (seen.has(item)) {
          return "[Circular]";
        }
        seen.add(item);
      }
      return item;
    });
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

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "object") {
    return stringifyObjectValue(value as Record<string, unknown>);
  }

  return String(value);
}

function preventFormulaInjection(value: string) {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function escapeCsvValue(value: unknown) {
  const rawValue = valueToCsvString(value);
  const safeValue = preventFormulaInjection(rawValue);
  const mustQuote = /[",\r\n]/.test(safeValue) || rawValue !== rawValue.trim() || safeValue !== safeValue.trim();
  const escaped = safeValue.replace(/"/g, '""');
  return mustQuote ? `"${escaped}"` : escaped;
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

function exportDateKey(now?: Date | number | string) {
  const date = now === undefined ? new Date() : new Date(now);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function buildFileName(params: CsvExportParams, table: GreatTimeAgentTable) {
  const agent = slugPart(params.resolvedAgent);
  const descriptor = slugPart(table.title || params.intent || params.originalMessage || "export");
  const dateKey = exportDateKey(params.now);
  const base = `${agent}_${descriptor}_${dateKey}`.replace(/_+/g, "_");
  return `${base.slice(0, 96)}.csv`;
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

export function buildGreatTimeAgentCsvExportFromTables(params: CsvExportParams) {
  const table = firstTableWithRows(params.tables);
  if (!table) {
    throw new Error("No exportable table rows found.");
  }

  const headers = buildHeaders(table);
  const lines = [
    headers.map((header) => escapeCsvValue(header.title)).join(","),
    ...table.rows.map((row) => headers.map((header) => escapeCsvValue(row[header.key])).join(",")),
  ];

  return {
    fileName: buildFileName(params, table),
    csv: `${UTF8_BOM}${lines.join("\r\n")}\r\n`,
    rowCount: table.rows.length,
    tableTitle: table.title,
  };
}

export function buildGreatTimeAgentCsvCaption(params: {
  rowCount?: number;
  fromPreviousResult?: boolean;
  excelRequested?: boolean;
}) {
  const lines = [params.fromPreviousResult ? "CSV export ready from the previous result." : "CSV export ready."];

  if (typeof params.rowCount === "number") {
    lines.push(`Rows: ${params.rowCount}`);
  }

  if (params.excelRequested) {
    lines.push("Excel requests currently return CSV.");
  }

  return lines.join("\n");
}
