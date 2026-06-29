const DEFAULT_AI_CONTROL_PANEL_ADMIN_EMAILS = "zayar@datafocus.cloud";
const DEFAULT_AI_AGENT_MONITORING_ADMIN_EMAILS = "zayar@datafocus.cloud";

export function resolveAiControlPanelAdminEmails(value?: string | null) {
  const configuredValue = value?.trim() ?? "";
  return configuredValue || DEFAULT_AI_CONTROL_PANEL_ADMIN_EMAILS;
}

function readConfiguredAdminEmails() {
  return resolveAiControlPanelAdminEmails(
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_AI_CONTROL_PANEL_ADMIN_EMAILS,
  );
}

export function parseAiControlPanelAdminEmails(value: string) {
  return new Set(
    value
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function canAccessAiControlPanel(email?: string | null) {
  const normalizedEmail = email?.trim().toLowerCase() ?? "";
  return normalizedEmail !== "" && parseAiControlPanelAdminEmails(readConfiguredAdminEmails()).has(normalizedEmail);
}

export function resolveAiAgentMonitoringAdminEmails(value?: string | null) {
  const configuredValue = value?.trim() ?? "";
  return configuredValue || DEFAULT_AI_AGENT_MONITORING_ADMIN_EMAILS;
}

function readConfiguredMonitoringAdminEmails() {
  return resolveAiAgentMonitoringAdminEmails(
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_AI_AGENT_MONITORING_ADMIN_EMAILS,
  );
}

export function parseAiAgentMonitoringAdminEmails(value: string) {
  return new Set(
    value
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function canAccessAiAgentMonitoring(email?: string | null) {
  const normalizedEmail = email?.trim().toLowerCase() ?? "";
  return normalizedEmail !== "" && parseAiAgentMonitoringAdminEmails(readConfiguredMonitoringAdminEmails()).has(normalizedEmail);
}
