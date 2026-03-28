import { createSearchParams } from "react-router-dom";

type ServicePortalIdentity = {
  serviceName: string;
  fromDate: string;
  toDate: string;
};

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildServicePortalDetailPath({
  serviceName,
  fromDate,
  toDate,
}: ServicePortalIdentity) {
  const slug = slugify(serviceName) || "service";
  const search = createSearchParams({
    name: serviceName,
    fromDate,
    toDate,
  });

  return `/analytics/services/${slug}?${search.toString()}`;
}
