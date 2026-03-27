export const navigationSections = [
  {
    title: "Home",
    items: [{ to: "/dashboard", label: "Dashboard" }],
  },
  {
    title: "Operations",
    items: [
      { to: "/operational/appointments", label: "Appointments" },
      { to: "/operational/sales", label: "Sales" },
      { to: "/operational/members", label: "Members" },
    ],
  },
  {
    title: "Revenue",
    items: [
      { to: "/analytics/sales-report", label: "Sales report" },
      { to: "/analytics/banking-summary", label: "Banking summary" },
      { to: "/analytics/payment-report", label: "Payment report" },
      { to: "/analytics/sales-by-seller", label: "Sales by seller" },
    ],
  },
  {
    title: "Behavior",
    items: [
      { to: "/analytics/customer-behavior", label: "Customer behavior" },
      { to: "/analytics/service-behavior", label: "Service behavior" },
      { to: "/analytics/daily-treatment", label: "Daily treatment" },
    ],
  },
];
