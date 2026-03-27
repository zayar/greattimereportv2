export type NavigationItem = {
  label: string;
  to?: string;
  children?: NavigationItem[];
};

export type NavigationSection = {
  title: string;
  items: NavigationItem[];
};

export const navigationSections: NavigationSection[] = [
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
      {
        label: "Sales",
        children: [
          { to: "/analytics/payment-report", label: "Sales details" },
          { to: "/analytics/banking-summary", label: "Payment report" },
          { to: "/analytics/sales-by-seller", label: "Sales by sales person" },
          { to: "/analytics/customers-by-salesperson", label: "Customer by salesperson" },
        ],
      },
    ],
  },
  {
    title: "Behavior",
    items: [
      { to: "/analytics/customers", label: "Customer portal" },
      { to: "/analytics/customer-behavior", label: "Customer behavior" },
      { to: "/analytics/service-behavior", label: "Service behavior" },
      { to: "/analytics/daily-treatment", label: "Daily treatment" },
    ],
  },
];
