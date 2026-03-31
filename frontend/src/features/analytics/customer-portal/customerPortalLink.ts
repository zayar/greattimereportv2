import { createSearchParams } from "react-router-dom";

type CustomerPortalIdentity = {
  customerName: string;
  customerPhone: string;
  fromDate: string;
  toDate: string;
  tab?: "overview" | "packages" | "bookings" | "payments" | "usage";
};

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildCustomerPortalDetailPath({
  customerName,
  customerPhone,
  fromDate,
  toDate,
  tab,
}: CustomerPortalIdentity) {
  const slugBase = customerName || customerPhone || "customer";
  const slug = slugify(slugBase) || "customer";
  const search = createSearchParams({
    name: customerName,
    phone: customerPhone,
    fromDate,
    toDate,
    ...(tab ? { tab } : {}),
  });

  return `/analytics/customers/${slug}?${search.toString()}`;
}
