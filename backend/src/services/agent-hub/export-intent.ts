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

export function isAgentCsvExportRequested(message: string): boolean {
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

export function isExportOnlyFollowUp(message: string): boolean {
  const normalized = normalizeExportMessage(message);
  if (!normalized || !isAgentCsvExportRequested(message)) {
    return false;
  }

  const tokens = exportTokens(message);
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

  if (tokens.some((token) => !allowedTokens.has(token))) {
    return false;
  }

  return (
    /\b(?:csv|excel|xls|xlsx|export|download|spreadsheet)\b/i.test(normalized) ||
    /\bgoogle\s+sheets?\b/i.test(normalized) ||
    /\bsheets?\s+file\b/i.test(normalized)
  );
}
