export type NavigationItem = {
  label: string;
  to?: string;
  children?: NavigationItem[];
  icon?: NavigationIconName;
  requiresAiControlPanelAdmin?: boolean;
  requiresAiAgentMonitoringAdmin?: boolean;
};

export type NavigationSection = {
  title: string;
  items: NavigationItem[];
};

export type NavigationIconName =
  | "activity"
  | "ai"
  | "calendar"
  | "chart"
  | "check"
  | "clipboard"
  | "customers"
  | "document"
  | "grid"
  | "inventory"
  | "layers"
  | "package"
  | "payment"
  | "settings"
  | "tag"
  | "telegram"
  | "wallet";

export const navigationSections: NavigationSection[] = [
  {
    title: "Workspace",
    items: [
      { to: "/dashboard", label: "Overview", icon: "grid" },
      { to: "/dashboard/overview", label: "Executive view", icon: "chart" },
    ],
  },
  {
    title: "Operations",
    items: [
      { to: "/operational/appointments", label: "Appointments", icon: "calendar" },
      { to: "/operational/check-in-out", label: "Check in / out", icon: "check" },
      { to: "/operational/sales", label: "Sales", icon: "payment" },
      { to: "/operational/members", label: "Members", icon: "customers" },
      {
        label: "Wallets & transactions",
        icon: "wallet",
        children: [
          { to: "/operational/wallets", label: "Wallets", icon: "wallet" },
          { to: "/operational/transactions", label: "Transactions", icon: "payment" },
        ],
      },
    ],
  },
  {
    title: "AI",
    items: [
      { to: "/ai/agent-portal", label: "AI Agent Portal", icon: "ai" },
      { to: "/ai/agent-hub", label: "Agent workspace", icon: "activity" },
      {
        to: "/ai/consultant-knowledge",
        label: "Consultant knowledge",
        icon: "document",
        requiresAiControlPanelAdmin: true,
      },
    ],
  },
  {
    title: "Reports",
    items: [
      {
        label: "Daily reports",
        icon: "calendar",
        children: [
          { to: "/analytics/appointment-report", label: "Daily appointments", icon: "calendar" },
          { to: "/analytics/payment-report", label: "Daily payments", icon: "payment" },
          { to: "/analytics/weekly-summary-report", label: "Weekly summary", icon: "chart" },
        ],
      },
      {
        label: "Revenue performance",
        icon: "chart",
        children: [
          { to: "/analytics/banking-summary", label: "Payment summary", icon: "payment" },
          { to: "/analytics/commission", label: "Commission", icon: "clipboard" },
          { to: "/analytics/sales-by-seller", label: "Sales by person", icon: "customers" },
          { to: "/analytics/customers-by-salesperson", label: "Customers by salesperson", icon: "customers" },
        ],
      },
      {
        label: "Customer intelligence",
        icon: "customers",
        children: [
          { to: "/analytics/customers", label: "Customers", icon: "customers" },
          { to: "/analytics/therapists", label: "Therapists", icon: "activity" },
          { to: "/analytics/services", label: "Services", icon: "layers" },
          { to: "/analytics/packages", label: "Packages", icon: "package" },
          { to: "/analytics/customer-behavior", label: "Customer behavior", icon: "chart" },
          { to: "/analytics/service-behavior", label: "Service behavior", icon: "chart" },
          { to: "/analytics/daily-treatment", label: "Daily treatment", icon: "activity" },
        ],
      },
    ],
  },
  {
    title: "Manage",
    items: [
      {
        label: "Offers",
        icon: "tag",
        children: [
          { to: "/offers/categories", label: "Offer categories", icon: "tag" },
          { to: "/offers/list", label: "Offer list", icon: "document" },
        ],
      },
      {
        label: "Services",
        icon: "layers",
        children: [
          { to: "/core/services/list", label: "Service list", icon: "layers" },
          { to: "/core/services/packages", label: "Service packages", icon: "package" },
          { to: "/core/services/categories", label: "Service categories", icon: "tag" },
          { to: "/core/services/record-forms", label: "Record forms", icon: "clipboard" },
          { to: "/core/services/consent-forms", label: "Consent forms", icon: "document" },
        ],
      },
      {
        label: "Products",
        icon: "package",
        children: [
          { to: "/core/products/list", label: "Product list", icon: "package" },
          { to: "/core/products/stock-items", label: "Stock items", icon: "inventory" },
        ],
      },
      {
        label: "Inventory",
        icon: "inventory",
        children: [
          { to: "/core/inventory/history", label: "Inventory history", icon: "activity" },
          { to: "/core/inventory/report", label: "Inventory report", icon: "document" },
          { to: "/core/inventory/stock-summary", label: "Stock summary", icon: "chart" },
        ],
      },
    ],
  },
  {
    title: "Settings",
    items: [
      { to: "/settings/commission", label: "Commission rules", icon: "clipboard" },
      { to: "/settings/telegram", label: "Telegram", icon: "telegram" },
      { to: "/settings/ai-control-panel", label: "AI control panel", icon: "settings", requiresAiControlPanelAdmin: true },
      { to: "/settings/ai-agent-monitoring", label: "AI Agent Monitoring", icon: "activity", requiresAiAgentMonitoringAdmin: true },
      { to: "/settings/sales-document", label: "Sales document", icon: "document" },
    ],
  },
];
