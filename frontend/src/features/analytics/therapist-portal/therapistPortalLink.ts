import { createSearchParams } from "react-router-dom";

type TherapistPortalIdentity = {
  therapistName: string;
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

export function buildTherapistPortalDetailPath({
  therapistName,
  fromDate,
  toDate,
}: TherapistPortalIdentity) {
  const slug = slugify(therapistName) || "therapist";
  const search = createSearchParams({
    name: therapistName,
    fromDate,
    toDate,
  });

  return `/analytics/therapists/${slug}?${search.toString()}`;
}
