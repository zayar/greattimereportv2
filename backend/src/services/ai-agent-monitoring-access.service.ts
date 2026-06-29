import type { Request } from "express";
import { env } from "../config/env.js";
import { firestoreDb } from "../config/firebase.js";
import { HttpError } from "../utils/http-error.js";

const DEFAULT_AI_AGENT_MONITORING_ADMIN_EMAILS = "zayar@datafocus.cloud";
const AUDIT_COLLECTION = "gtAiMonitoringAuditLogs";

export function resolveAiAgentMonitoringAdminEmails(value?: string | null) {
  const configuredValue = value?.trim() ?? "";
  return configuredValue || DEFAULT_AI_AGENT_MONITORING_ADMIN_EMAILS;
}

export function parseAiAgentMonitoringAdminEmails(value: string) {
  return new Set(
    value
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAiAgentMonitoringAdminEmail(email?: string | null) {
  const normalizedEmail = email?.trim().toLowerCase() ?? "";
  return (
    normalizedEmail !== "" &&
    parseAiAgentMonitoringAdminEmails(resolveAiAgentMonitoringAdminEmails(env.AI_AGENT_MONITORING_ADMIN_EMAILS)).has(
      normalizedEmail,
    )
  );
}

function sanitizedQuery(query: Request["query"]) {
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => {
      if (/token|secret|authorization|password|key/i.test(key)) {
        return [key, "[redacted]"];
      }

      return [key, value];
    }),
  );
}

export async function auditAiAgentMonitoringAccess(params: {
  userEmail?: string | null;
  path: string;
  query?: Request["query"];
  allowed: boolean;
  statusCode: 200 | 401 | 403;
  now?: string;
}) {
  const createdAt = params.now ?? new Date().toISOString();

  try {
    await firestoreDb().collection(AUDIT_COLLECTION).add({
      userEmail: params.userEmail?.trim().toLowerCase() ?? null,
      path: params.path,
      query: sanitizedQuery(params.query ?? {}),
      allowed: params.allowed,
      statusCode: params.statusCode,
      createdAt,
    });
  } catch (error) {
    console.warn("[ai-agent-monitoring] failed to write audit log", error);
  }
}

export async function requireAiAgentMonitoringAdmin(req: Request) {
  if (!req.user) {
    await auditAiAgentMonitoringAccess({
      userEmail: null,
      path: req.path,
      query: req.query,
      allowed: false,
      statusCode: 401,
    });
    throw new HttpError(401, "User session is required.");
  }

  if (!isAiAgentMonitoringAdminEmail(req.user.email)) {
    await auditAiAgentMonitoringAccess({
      userEmail: req.user.email,
      path: req.path,
      query: req.query,
      allowed: false,
      statusCode: 403,
    });
    throw new HttpError(403, "AI Agent Monitoring access is restricted.");
  }

  await auditAiAgentMonitoringAccess({
    userEmail: req.user.email,
    path: req.path,
    query: req.query,
    allowed: true,
    statusCode: 200,
  });
}
