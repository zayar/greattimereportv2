import { createSearchParams } from "react-router-dom";
import type { Clinic } from "../../types/domain";
import { daysAgo, startOfCurrentMonth, startOfCurrentYear, today } from "../../utils/date";

export type DirectoryGroup = "Featured" | "Revenue" | "Customers" | "Operations";
export type DirectoryWindow = "today" | "30d" | "month" | "year";

export type DirectoryItem = {
  id: string;
  title: string;
  description: string;
  route: string;
  group: DirectoryGroup;
  eyebrow: string;
  window: DirectoryWindow;
  featured?: boolean;
};

export const directoryItems: DirectoryItem[] = [
  {
    id: "executive-dashboard",
    title: "Executive dashboard",
    description: "Revenue, bookings, payments, and therapist momentum in one overview.",
    route: "/dashboard/overview",
    group: "Featured",
    eyebrow: "Overview",
    window: "month",
    featured: true,
  },
  {
    id: "customer-portal",
    title: "Customer portal",
    description: "Customer 360 records, retention signals, and service history.",
    route: "/analytics/customers",
    group: "Featured",
    eyebrow: "Customers",
    window: "year",
    featured: true,
  },
  {
    id: "payment-report",
    title: "Payment report",
    description: "Payment-method drilldown and detailed banking transactions.",
    route: "/analytics/banking-summary",
    group: "Revenue",
    eyebrow: "Revenue",
    window: "month",
  },
  {
    id: "sales-details",
    title: "Sales details",
    description: "Invoice lines, discounts, and service-level sales detail.",
    route: "/analytics/payment-report",
    group: "Revenue",
    eyebrow: "Revenue",
    window: "month",
  },
  {
    id: "sales-by-salesperson",
    title: "Sales by sales person",
    description: "Seller ranking with transaction-level drilldown.",
    route: "/analytics/sales-by-seller",
    group: "Revenue",
    eyebrow: "Revenue",
    window: "month",
  },
  {
    id: "customer-by-salesperson",
    title: "Customer by salesperson",
    description: "Customers attributed to each sales person and their spend.",
    route: "/analytics/customers-by-salesperson",
    group: "Revenue",
    eyebrow: "Revenue",
    window: "month",
  },
  {
    id: "customer-behavior",
    title: "Customer behavior",
    description: "Visit frequency, active members, and returning customer trends.",
    route: "/analytics/customer-behavior",
    group: "Customers",
    eyebrow: "Behavior",
    window: "year",
  },
  {
    id: "service-behavior",
    title: "Service behavior",
    description: "Demand ranking, practitioner mix, and service momentum.",
    route: "/analytics/service-behavior",
    group: "Customers",
    eyebrow: "Behavior",
    window: "year",
  },
  {
    id: "daily-treatment",
    title: "Daily treatment",
    description: "Therapist-by-service treatment matrix for a single day.",
    route: "/analytics/daily-treatment",
    group: "Operations",
    eyebrow: "Operations",
    window: "today",
  },
  {
    id: "appointments",
    title: "Appointments",
    description: "Operational booking flow and schedule visibility.",
    route: "/operational/appointments",
    group: "Operations",
    eyebrow: "Operations",
    window: "30d",
  },
];

function getWindowRange(window: DirectoryWindow) {
  if (window === "today") {
    return { fromDate: today(), toDate: today() };
  }

  if (window === "year") {
    return { fromDate: startOfCurrentYear(), toDate: today() };
  }

  if (window === "month") {
    return { fromDate: startOfCurrentMonth(), toDate: today() };
  }

  return { fromDate: daysAgo(29), toDate: today() };
}

export function buildDirectorySearch(clinic: Clinic | null | undefined, window: DirectoryWindow) {
  if (!clinic) {
    return "";
  }

  const range = getWindowRange(window);
  const params = createSearchParams({
    clinicId: clinic.id,
    clinicCode: clinic.code,
    fromDate: range.fromDate,
    toDate: range.toDate,
  });

  return `?${params.toString()}`;
}
