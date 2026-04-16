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
    items: [
      { to: "/dashboard", label: "Home" },
      { to: "/dashboard/overview", label: "Executive dashboard" },
    ],
  },
  {
    title: "Operations",
    items: [
      { to: "/operational/appointments", label: "Appointments" },
      { to: "/operational/check-in-out", label: "Check In/Out" },
      { to: "/operational/sales", label: "Sales" },
      { to: "/operational/members", label: "Members" },
      { to: "/operational/wallets", label: "Wallets" },
      { to: "/operational/transactions", label: "Transactions" },
    ],
  },
  {
    title: "Offers",
    items: [
      { to: "/offers/categories", label: "Offer Category" },
      { to: "/offers/list", label: "Offer List" },
    ],
  },
  {
    title: "Core",
    items: [
      {
        label: "Services",
        children: [
          { to: "/core/services/list", label: "Service List" },
          { to: "/core/services/packages", label: "Service Packages" },
          { to: "/core/services/categories", label: "Service Type Category" },
          { to: "/core/services/record-forms", label: "Service Record Form" },
          { to: "/core/services/consent-forms", label: "Service Consent Form" },
        ],
      },
      {
        label: "Products",
        children: [
          { to: "/core/products/list", label: "Product List" },
          { to: "/core/products/stock-items", label: "Product Stock Items" },
        ],
      },
      {
        label: "Inventory",
        children: [
          { to: "/core/inventory/history", label: "Inventory History" },
          { to: "/core/inventory/report", label: "Inventory Report" },
          { to: "/core/inventory/stock-summary", label: "Stock Summary" },
        ],
      },
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
          { to: "/analytics/commission", label: "Commission report" },
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
      { to: "/analytics/therapists", label: "Therapist portal" },
      { to: "/analytics/services", label: "Service portal" },
      { to: "/analytics/packages", label: "Package portal" },
      { to: "/analytics/customer-behavior", label: "Customer behavior" },
      { to: "/analytics/service-behavior", label: "Service behavior" },
      { to: "/analytics/daily-treatment", label: "Daily treatment" },
    ],
  },
  {
    title: "Settings",
    items: [
      { to: "/settings/commission", label: "Commission rules" },
      { to: "/settings/telegram", label: "Telegram" },
      { to: "/settings/sales-document", label: "Sales document designer" },
    ],
  },
];
