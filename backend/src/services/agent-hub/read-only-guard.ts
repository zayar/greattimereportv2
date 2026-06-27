const BUSINESS_SOURCE_OBJECT =
  /(?:appointments?|bookings?|check-?ins?|check-?outs?|customers?|members?|payments?|invoices?|vouchers?|services?|practitioners?|therapists?|packages?|sessions?|records?|sales?|refunds?|inventory|stock|tables?|databases?|db|datasets?|schemas?|views?|system|phone|အချက်အလက်|ဖောက်သည်|ချိန်း|ဘိုကင်|ငွေ|ဘောက်ချာ)/i;

const STRONG_WRITE_ACTION =
  /(?:create|add|book|cancel|reschedule|update|delete|remove|destroy|erase|clear|wipe|purge|refund|collect|charge|edit|change|modify|void|adjust|mark|check\s*-?\s*in|check\s*-?\s*out)/i;

const ACTION_OBJECT_REQUEST = new RegExp(
  `\\b${STRONG_WRITE_ACTION.source}\\b\\s+(?:an?\\s+|the\\s+|this\\s+|that\\s+|first\\s+|second\\s+|third\\s+|all\\s+|every\\s+|customer\\s+)*${BUSINESS_SOURCE_OBJECT.source}\\b`,
  "i",
);

const OBJECT_ACTION_REQUEST = new RegExp(
  `\\b${BUSINESS_SOURCE_OBJECT.source}\\b[\\s\\S]{0,40}\\b(?:delete|remove|destroy|cancel|reschedule|update|edit|modify|refund|charge|collect|ဖျက်|ပြင်|ချိန်း)\\b`,
  "i",
);

const SQL_DDL_DML_REQUEST =
  /\b(?:insert\s+into|merge\s+into|delete\s+from|update\s+[A-Za-z0-9_.`-]+(?:\s+set|\b)|create\s+(?:or\s+replace\s+)?(?:table|database|schema|view|dataset)|drop\s+(?:database|db|table|schema|view|dataset)|truncate\s+(?:table\s+)?[A-Za-z0-9_.`-]+|alter\s+table)\b/i;

const SQL_OR_QUERY_EXECUTION_REQUEST =
  /\b(?:run|execute|write|perform|use)\s+(?:this\s+|that\s+|the\s+|raw\s+|arbitrary\s+|custom\s+){0,5}(?:sql|mysql|bigquery|graphql|graph\s*ql|query|mutation|command)\b|\b(?:sql|mysql|bigquery|graphql|graph\s*ql)\s+(?:query|mutation|command)\b/i;

const GRAPHQL_MUTATION_REQUEST = /\bmutation\s*(?:[({]|\w)/i;

const CUSTOMER_MESSAGE_REQUEST =
  /\b(?:send\s+(?:an?\s+)?(?:sms|message|text|telegram|whatsapp|email)|message|sms|text|telegram|whatsapp|email)\s+(?:message\s+)?(?:to\s+)?(?:this\s+|that\s+|the\s+|first\s+|second\s+|third\s+)?(?:customer|member)\b/i;

const CUSTOMER_SEND_REQUEST =
  /\bsend\s+(?:this\s+|that\s+|the\s+|first\s+|second\s+|third\s+)?(?:customer|member)\s+(?:an?\s+)?(?:sms|message|text|telegram|whatsapp|email|reminder|follow-?up)\b|\bsend\b[\s\S]{0,80}\bto\s+(?:this\s+|that\s+|the\s+|first\s+|second\s+|third\s+)?(?:customer|member)\b/i;

const MESSAGE_SEND_REQUEST = /\bsend\s+(?:an?\s+)?(?:sms|message|text|telegram|whatsapp|email)\b/i;

const WRITE_BACK_REQUEST = /\bwrite\s+back\s+(?:to\s+)?(?:the\s+)?(?:system|database|db|source|apicore|mysql|bigquery)\b/i;

const PROMPT_INJECTION_WITH_MUTATION =
  /\bignore\s+(?:all\s+)?(?:previous|above|prior)\s+instructions?\b[\s\S]{0,120}\b(?:delete|destroy|drop|truncate|update|insert|merge|alter|refund|charge|collect|book|cancel|reschedule|send)\b/i;

const MYANMAR_WRITE_REQUEST = /(?:ဖျက်|ပြင်|ချိန်းပေး|ပို့|ဖျက်ပေး|\b(?:delete|update|edit|cancel|booking|appointment)\s+လုပ်|booking\s+ဖျက်|appointment\s+ချိန်း)/i;

const SQL_LEADING_COMMENT = /^(?:\s*(?:--[^\n\r]*(?:\r?\n|$)|#[^\n\r]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/))+/;
const FORBIDDEN_SQL_KEYWORD =
  /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|CALL|EXECUTE|BEGIN|COMMIT|ROLLBACK)\b/i;
const SQL_SCRIPTING_KEYWORD = /\b(?:DECLARE|SET|LOOP)\b/i;
const GRAPHQL_LINE_COMMENT = /#[^\n\r]*/g;
const GRAPHQL_BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;

export function isDangerousBusinessMutationRequest(message: string): boolean {
  const normalized = message.trim().replace(/[\/_-]+/g, " ");
  if (!normalized) {
    return false;
  }

  if (
    PROMPT_INJECTION_WITH_MUTATION.test(normalized) ||
    SQL_DDL_DML_REQUEST.test(normalized) ||
    SQL_OR_QUERY_EXECUTION_REQUEST.test(normalized) ||
    GRAPHQL_MUTATION_REQUEST.test(normalized)
  ) {
    return true;
  }

  if (
    CUSTOMER_MESSAGE_REQUEST.test(normalized) ||
    CUSTOMER_SEND_REQUEST.test(normalized) ||
    MESSAGE_SEND_REQUEST.test(normalized) ||
    WRITE_BACK_REQUEST.test(normalized) ||
    MYANMAR_WRITE_REQUEST.test(normalized)
  ) {
    return true;
  }

  if (ACTION_OBJECT_REQUEST.test(normalized) || OBJECT_ACTION_REQUEST.test(normalized)) {
    return true;
  }

  return false;
}

export function buildReadOnlyRefusalMessage(_message?: string): string {
  return "This Agent Hub is read-only. I can review sourced GreatTime data and prepare recommendations, but I cannot create, update, delete, drop, truncate, book, cancel, charge, refund, or message customers.";
}

function stripLeadingSqlComments(query: string) {
  let text = query.trim();
  let previous = "";

  while (text !== previous) {
    previous = text;
    text = text.replace(SQL_LEADING_COMMENT, "").trim();
  }

  return text;
}

function splitSqlStatements(query: string) {
  return query
    .split(";")
    .map((statement) => stripLeadingSqlComments(statement))
    .filter((statement) => statement.length > 0);
}

export function assertAgentReadOnlySql(query: string): void {
  const statements = splitSqlStatements(stripLeadingSqlComments(query));
  const statement = statements[0] ?? "";

  if (statements.length !== 1 || !/^(?:SELECT|WITH)\b/i.test(statement)) {
    throw new Error("Agent Hub BigQuery access is read-only.");
  }

  if (FORBIDDEN_SQL_KEYWORD.test(statement) || SQL_SCRIPTING_KEYWORD.test(statement)) {
    throw new Error("Agent Hub BigQuery access is read-only.");
  }
}

function stripSimpleGraphqlComments(query: string) {
  return query.replace(GRAPHQL_BLOCK_COMMENT, "").replace(GRAPHQL_LINE_COMMENT, "").trim();
}

export function assertAgentReadOnlyGraphql(query: string): void {
  const text = stripSimpleGraphqlComments(query);

  if (
    /^(?:mutation|subscription)\b/i.test(text) ||
    /\bmutation\s*(?:[({])/i.test(text) ||
    (!/^(?:query\b|\{)/i.test(text) && text.length > 0)
  ) {
    throw new Error("Agent Hub APICORE access is read-only.");
  }
}

export function sanitizeReadOnlyGuardReason(reason: unknown): string {
  if (reason instanceof Error && /Agent Hub (?:BigQuery|APICORE) access is read-only\./.test(reason.message)) {
    return reason.message;
  }

  if (typeof reason === "string" && /read-only/i.test(reason)) {
    return reason.slice(0, 160);
  }

  return "Agent Hub read-only guard blocked an unsafe business-source mutation request.";
}
