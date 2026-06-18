import type { GreatTimeAgentEntityContext } from "../../../types/domain";

export function contextFromAgentHubRow(row: Record<string, unknown>): GreatTimeAgentEntityContext | null {
  const text = (key: string) => (typeof row[key] === "string" ? String(row[key]) : undefined);
  const appointmentId = text("appointmentId");
  const customerKey = text("customerKey");
  const invoiceNumber = text("invoiceNumber");
  const serviceName = text("serviceName");
  const practitionerName = text("practitionerName") ?? text("therapistName");
  const customerName = text("customerName");

  if (appointmentId) {
    return {
      entityType: "appointment",
      entityId: appointmentId,
      appointmentId,
      displayName: customerName ?? appointmentId,
      customerName,
      serviceName,
      practitionerName,
    };
  }

  if (invoiceNumber) {
    return {
      entityType: "invoice",
      entityId: invoiceNumber,
      invoiceNumber,
      displayName: invoiceNumber,
      customerName,
    };
  }

  if (customerKey || customerName) {
    return {
      entityType: "customer",
      entityId: customerKey ?? customerName ?? "customer",
      customerKey,
      displayName: customerName,
      customerName,
      memberId: text("memberId"),
    };
  }

  if (serviceName) {
    return {
      entityType: "service",
      entityId: serviceName,
      serviceName,
      displayName: serviceName,
    };
  }

  if (practitionerName) {
    return {
      entityType: "practitioner",
      entityId: practitionerName,
      practitionerName,
      displayName: practitionerName,
    };
  }

  return null;
}

export function agentHubStatusClass(status: string) {
  if (status === "ok") {
    return "agent-hub-chip agent-hub-chip--ok";
  }
  if (status === "partial" || status === "stale" || status === "not_ready") {
    return "agent-hub-chip agent-hub-chip--warn";
  }
  if (status === "unavailable" || status === "not_found") {
    return "agent-hub-chip agent-hub-chip--danger";
  }
  return "agent-hub-chip";
}
