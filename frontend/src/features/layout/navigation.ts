export const navigationSections = [
  {
    title: "Overview",
    items: [{ to: "/dashboard", label: "Dashboard", badge: "Live" }],
  },
  {
    title: "Operational",
    items: [
      { to: "/operational/appointments", label: "Appointments", badge: "Core" },
      { to: "/operational/sales", label: "Sales", badge: "Core" },
      { to: "/operational/members", label: "Members", badge: "Core" },
    ],
  },
  {
    title: "Analytics",
    items: [
      { to: "/analytics/sales-report", label: "Sales Report", badge: "BQ" },
      { to: "/analytics/banking-summary", label: "Banking Summary", badge: "BQ" },
      { to: "/analytics/customer-behavior", label: "Customer Behavior", badge: "BQ" },
      { to: "/analytics/service-behavior", label: "Service Behavior", badge: "BQ" },
      { to: "/analytics/daily-treatment", label: "Daily Treatment", badge: "BQ" },
      { to: "/analytics/payment-report", label: "Payment Report", badge: "BQ" },
      { to: "/analytics/sales-by-seller", label: "Sales by Seller", badge: "BQ" },
    ],
  },
];
