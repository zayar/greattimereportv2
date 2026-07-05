import { Link } from "react-router-dom";
import { PageHeader } from "../../../components/PageHeader";
import { Panel } from "../../../components/Panel";
import { EmptyState } from "../../../components/StatusViews";
import { useAccess } from "../../access/AccessProvider";

type PortalCard = {
  title: string;
  description: string;
  to: string;
  status: string;
  tone: "ready" | "planned" | "admin";
};

const PORTAL_CARDS: PortalCard[] = [
  {
    title: "AI Revenue Agent",
    description: "Find revenue opportunities, prepare staff approval queues, monitor appointments, and attribute results.",
    to: "/ai/agent-portal/revenue-agent",
    status: "MVP shell",
    tone: "ready",
  },
  {
    title: "Customer Relationship Agent",
    description: "Review customer retention, remaining package balance, inactive VIPs, and follow-up strategy.",
    to: "/ai/customer-relationship-agent",
    status: "Coming into portal",
    tone: "planned",
  },
  {
    title: "Agent Workspace",
    description: "Ask clinic questions across operations, revenue, customers, services, and live appointments.",
    to: "/ai/agent-hub",
    status: "Available",
    tone: "ready",
  },
  {
    title: "Monitoring",
    description: "Track agent runs, health, latency, failures, alerts, and recent tool activity.",
    to: "/settings/ai-agent-monitoring",
    status: "Admin",
    tone: "admin",
  },
  {
    title: "Settings",
    description: "Control AI access, clinic feature gates, health checks, and administrative configuration.",
    to: "/settings/ai-control-panel",
    status: "Admin",
    tone: "admin",
  },
];

export function AiAgentPortalPage() {
  const { currentClinic } = useAccess();

  return (
    <div className="page-stack page-stack--workspace analytics-report ai-agent-portal">
      <PageHeader
        eyebrow="AI"
        title="AI Agent Portal"
        description="Central workspace for AI Revenue Agent and future GreatTime agents."
        actions={
          <Link className="button button--secondary" to="/ai/agent-hub">
            Open Agent Workspace
          </Link>
        }
      />

      <div className="telegram-settings__status-strip">
        <div>
          <strong>{currentClinic?.name ?? "No clinic selected"}</strong>
          <span>
            {currentClinic?.code
              ? `Clinic code: ${currentClinic.code}`
              : "Choose a clinic to connect live agent data in later phases."}
          </span>
        </div>
        <span className="telegram-settings__notice telegram-settings__notice--success">Portal Phase 1</span>
      </div>

      <Panel
        title="Agent modules"
        subtitle="Use this portal as the home for AI Revenue Agent, operational assistants, monitoring, and settings."
      >
        <div className="ai-agent-portal__grid">
          {PORTAL_CARDS.map((card) => (
            <Link key={card.title} className="ai-agent-portal__card" to={card.to}>
              <div className="ai-agent-portal__card-header">
                <span className={`ai-agent-portal__badge ai-agent-portal__badge--${card.tone}`}>{card.status}</span>
              </div>
              <strong>{card.title}</strong>
              <p>{card.description}</p>
              <span className="ai-agent-portal__card-action">Open</span>
            </Link>
          ))}
        </div>
      </Panel>

      <Panel title="Portal readiness" subtitle="Phase 1 creates navigation and safe empty shells only.">
        <EmptyState
          label="AI workflow data is not connected yet"
          detail="Revenue opportunities, approvals, conversations, appointments, revenue attribution, and audit logs will be connected in later phases."
        />
      </Panel>
    </div>
  );
}
